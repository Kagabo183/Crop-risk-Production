"""Bootstrap crop_labels from existing farms that already have crop_type.

This is useful to test the full ML pipeline end-to-end when you don't yet have
an external labeled dataset (e.g. Radiant MLHub). The resulting training set is
usually very small and not suitable for production accuracy.

Idempotent: re-running won't duplicate rows.

Usage:
  python scripts/bootstrap_crop_labels_from_farms.py
  python scripts/bootstrap_crop_labels_from_farms.py --source farm_crop_type
  python scripts/bootstrap_crop_labels_from_farms.py --db-url postgresql://... 
"""

from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine, text


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--source",
        default="farm_crop_type",
        help="Value to store in crop_labels.source for these bootstrapped labels",
    )
    p.add_argument(
        "--buffer-m",
        type=float,
        default=200.0,
        help="If a farm has no boundary, buffer its (lon,lat) by this many meters to create a polygon.",
    )
    p.add_argument("--db-url", default=None, help="Override DATABASE_URL")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    db_url = args.db_url or os.environ.get(
        "DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db"
    )

    engine = create_engine(db_url)

    sql = text(
        """
        INSERT INTO crop_labels (
            crop_name,
            boundary,
            country,
            admin1,
            admin2,
            season,
            label_date,
            source,
            source_id,
            notes
        )
        SELECT
            f.crop_type::text AS crop_name,
            COALESCE(
                f.boundary,
                ST_Buffer(
                    ST_SetSRID(ST_MakePoint(f.longitude, f.latitude), 4326)::geography,
                    :buffer_m
                )::geometry
            ) AS boundary,
            NULL::text AS country,
            f.province::text AS admin1,
            NULL::text AS admin2,
            NULL::text AS season,
            NULL::date AS label_date,
            CAST(:source AS text) AS source,
            f.id::text AS source_id,
            'Bootstrapped from farms.crop_type'::text AS notes
        FROM farms f
        WHERE
            f.crop_type IS NOT NULL
            AND (
                f.boundary IS NOT NULL
                OR (f.longitude IS NOT NULL AND f.latitude IS NOT NULL)
            )
            AND NOT EXISTS (
                SELECT 1
                FROM crop_labels cl
                WHERE cl.source = CAST(:source AS text) AND cl.source_id = f.id::text
            )
        """
    )

    with engine.begin() as conn:
        conn.execute(sql, {"source": args.source, "buffer_m": args.buffer_m})

        # res.rowcount may be -1 depending on driver; fetch inserted count explicitly.
        inserted = conn.execute(
            text(
                "SELECT count(*) FROM crop_labels WHERE source = CAST(:source AS text)"
            ),
            {"source": args.source},
        ).scalar()

    print(f"Bootstrapped labels present for source={args.source!r}: {inserted}")


if __name__ == "__main__":
    main()
