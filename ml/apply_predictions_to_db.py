"""Apply predicted crop types back into the farms table.

By default this only fills farms.crop_type when it's currently NULL.
Use --overwrite to force-update.

Example:
  python ml/apply_predictions_to_db.py --predictions ml/farm_predictions.csv --threshold 0.6
"""

from __future__ import annotations

import argparse
import os

import pandas as pd
from sqlalchemy import create_engine, text


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--predictions", required=True, help="CSV produced by ml/predict_crops.py")
    p.add_argument("--id-field", default="id")
    p.add_argument("--crop-field", default="predicted_crop")
    p.add_argument("--confidence-field", default="confidence")
    p.add_argument("--threshold", type=float, default=0.6)
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--db-url", default=None)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    df = pd.read_csv(args.predictions)
    for col in [args.id_field, args.crop_field, args.confidence_field]:
        if col not in df.columns:
            raise SystemExit(f"Missing column '{col}' in {args.predictions}")

    df = df[df[args.confidence_field] >= args.threshold].copy()
    if df.empty:
        print("No predictions meet threshold; nothing to apply.")
        return

    db_url = args.db_url or os.environ.get(
        "DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db"
    )
    engine = create_engine(db_url)

    updated = 0

    with engine.begin() as conn:
        for row in df.itertuples(index=False):
            farm_id = int(getattr(row, args.id_field))
            crop = str(getattr(row, args.crop_field))

            if args.overwrite:
                res = conn.execute(
                    text("UPDATE farms SET crop_type = :crop WHERE id = :id"),
                    {"crop": crop, "id": farm_id},
                )
            else:
                res = conn.execute(
                    text("UPDATE farms SET crop_type = :crop WHERE id = :id AND crop_type IS NULL"),
                    {"crop": crop, "id": farm_id},
                )

            if res.rowcount:
                updated += int(res.rowcount)

    print(f"Applied crop_type to {updated} farms (threshold={args.threshold}, overwrite={args.overwrite})")


if __name__ == "__main__":
    main()
