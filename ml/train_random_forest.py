"""Train a multi-class RandomForest crop classifier.

Input is the long-form CSV produced by export_gee_timeseries.py.
We pivot periods into a fixed-length feature vector per id.

Usage:
  python ml/train_random_forest.py --data ml/train_features.csv --label-field crop_name --out-dir ml/models

Notes:
- For many crop types, class imbalance is normal; we use class_weight='balanced_subsample'.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--label-field", default="crop_name")
    p.add_argument("--id-field", default=None, help="If omitted, uses row index groups")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--test-size", type=float, default=0.2)
    p.add_argument("--random-state", type=int, default=42)
    p.add_argument("--n-estimators", type=int, default=400)
    p.add_argument("--min-samples-leaf", type=int, default=2)
    p.add_argument(
        "--min-class-count",
        type=int,
        default=2,
        help="Drop classes with fewer than this many samples before training.",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    df = pd.read_csv(args.data)
    if args.label_field not in df.columns:
        raise SystemExit(f"Missing label field '{args.label_field}'")

    id_field = args.id_field
    if id_field is None:
        # training export may not include an id; group by label+geometry order is unreliable.
        # For MVP: require an id field for proper grouping.
        raise SystemExit("Please provide an id field in your export (e.g., --id-field id or export labels with 'id').")

    if id_field not in df.columns:
        raise SystemExit(f"Missing id field '{id_field}'")

    if "period" not in df.columns:
        raise SystemExit("Missing 'period' column")

    # All numeric feature columns except id/label/period
    non_features = {id_field, args.label_field, "period"}
    feature_cols = [c for c in df.columns if c not in non_features]

    # Pivot to wide: <feature>__<period>
    wide = df.pivot_table(index=[id_field, args.label_field], columns="period", values=feature_cols)
    wide.columns = [f"{feat}__{period}" for feat, period in wide.columns]
    wide = wide.reset_index()

    # Optionally drop rare classes to avoid degenerate training/splits.
    if args.min_class_count and args.min_class_count > 1:
        class_counts = wide[args.label_field].astype(str).value_counts()
        keep = class_counts[class_counts >= args.min_class_count].index
        dropped = class_counts[class_counts < args.min_class_count]
        if len(dropped) > 0:
            print(
                f"Dropping {len(dropped)} rare classes with < {args.min_class_count} samples: "
                + ", ".join([f"{k}({v})" for k, v in dropped.items()])
            )
        wide = wide[wide[args.label_field].astype(str).isin(set(keep))].copy()

    if len(wide) < 2:
        raise SystemExit("Not enough labeled samples to train. Add more crop_labels rows.")

    X = wide.drop(columns=[args.label_field])
    y_raw = wide[args.label_field].astype(str)

    le = LabelEncoder()
    y = le.fit_transform(y_raw)

    # Numeric columns (everything except id)
    numeric_cols = [c for c in X.columns if c != id_field]

    rf = RandomForestClassifier(
        n_estimators=args.n_estimators,
        random_state=args.random_state,
        n_jobs=-1,
        class_weight="balanced_subsample",
        min_samples_leaf=args.min_samples_leaf,
    )

    model = Pipeline(
        steps=[
            (
                "prep",
                ColumnTransformer(
                    transformers=[
                        (
                            "num",
                            Pipeline(
                                steps=[("imputer", SimpleImputer(strategy="median"))]
                            ),
                            numeric_cols,
                        )
                    ],
                    remainder="drop",
                ),
            ),
            ("rf", rf),
        ]
    )

    # For tiny bootstrapped datasets (e.g., a few farms), a train/test split can fail.
    # If any class has <2 samples, stratified split is impossible.
    class_counts = pd.Series(y).value_counts().to_dict()
    min_class = min(class_counts.values()) if class_counts else 0

    if len(wide) < 10 or min_class < 2:
        model.fit(X, y)
        print(
            "Trained on all labeled data (dataset too small for a reliable train/test split). "
            f"samples={len(wide)} classes={len(set(y))} min_class_count={min_class}"
        )
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=args.test_size,
            random_state=args.random_state,
            stratify=y,
        )

        model.fit(X_train, y_train)
        preds = model.predict(X_test)

        acc = accuracy_score(y_test, preds)
        print(f"Accuracy: {acc:.4f}")
        print(classification_report(y_test, preds, target_names=le.classes_, zero_division=0))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, out_dir / "crop_rf.joblib")
    joblib.dump(le, out_dir / "label_encoder.joblib")

    with open(out_dir / "feature_columns.json", "w", encoding="utf-8") as f:
        json.dump({"id_field": id_field, "numeric_cols": numeric_cols}, f, indent=2)

    print(f"Saved model to {out_dir / 'crop_rf.joblib'}")


if __name__ == "__main__":
    main()
