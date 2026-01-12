"""Predict crop types from exported farm features using a trained RandomForest model.

Usage:
  python ml/predict_crops.py --model-dir ml/models --features ml/farm_features.csv --id-field id --out ml/farm_predictions.csv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--model-dir", required=True)
    p.add_argument("--features", required=True)
    p.add_argument("--id-field", default="id")
    p.add_argument("--out", required=True)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    model_dir = Path(args.model_dir)
    model = joblib.load(model_dir / "crop_rf.joblib")
    le = joblib.load(model_dir / "label_encoder.joblib")

    df = pd.read_csv(args.features)
    if args.id_field not in df.columns:
        raise SystemExit(f"Missing id field '{args.id_field}'")
    if "period" not in df.columns:
        raise SystemExit("Missing 'period' column")

    non_features = {args.id_field, "period", "crop_name"}
    feature_cols = [c for c in df.columns if c not in non_features]

    wide = df.pivot_table(index=[args.id_field], columns="period", values=feature_cols)
    wide.columns = [f"{feat}__{period}" for feat, period in wide.columns]
    wide = wide.reset_index()

    # Align columns with training
    meta = json.loads((model_dir / "feature_columns.json").read_text(encoding="utf-8"))
    numeric_cols = meta["numeric_cols"]

    for col in numeric_cols:
        if col not in wide.columns:
            wide[col] = 0.0

    X = wide[[args.id_field] + numeric_cols]

    probs = model.predict_proba(X)
    pred_idx = probs.argmax(axis=1)
    confidence = probs.max(axis=1)

    predicted_crop = le.inverse_transform(pred_idx)

    out = pd.DataFrame(
        {
            args.id_field: X[args.id_field],
            "predicted_crop": predicted_crop,
            "confidence": confidence,
        }
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    print(f"Wrote predictions for {len(out)} items to {out_path}")


if __name__ == "__main__":
    main()
