"""
Add phenology_records table + satellite_fusion_log index

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-15 14:00:00

Changes:
  1. CREATE TABLE phenology_records  (spectral/GDD growth stage per farm)
  2. ADD INDEX ix_satellite_images_farm_date  (speeds up fusion & timeline queries)
  3. ADD COLUMN satellite_images.extra_metadata  (JSON, SAR attributes)
     – only if column doesn't already exist (Alembic conditional DDL)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. phenology_records ──────────────────────────────────────────────────
    op.create_table(
        "phenology_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "farm_id",
            sa.Integer(),
            sa.ForeignKey("farms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("crop_type", sa.String(50), nullable=True),
        sa.Column("detected_stage", sa.String(30), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("stage_start_date", sa.Date(), nullable=True),
        sa.Column("ndvi_at_detection", sa.Float(), nullable=True),
        sa.Column("ndvi_peak", sa.Float(), nullable=True),
        sa.Column("gdd_accumulated", sa.Float(), nullable=True),
        sa.Column(
            "detection_method",
            sa.String(30),
            nullable=True,
            server_default="spectral_curve",
        ),
        sa.Column("ndvi_series_used", sa.Integer(), nullable=True),
        sa.Column(
            "computed_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_phenology_records_farm_id", "phenology_records", ["farm_id"]
    )

    # ── 2. Composite index on satellite_images (farm_id + date) ───────────────
    # Skip if already exists (idempotent)
    try:
        op.create_index(
            "ix_satellite_images_farm_date",
            "satellite_images",
            ["farm_id", "date"],
        )
    except Exception:
        pass   # Index already exists

    # ── 3. Add extra_metadata JSON column to satellite_images ─────────────────
    # Use server_default='{}' so existing rows get an empty object
    try:
        op.add_column(
            "satellite_images",
            sa.Column(
                "extra_metadata",
                sa.JSON(),
                nullable=True,
                server_default=sa.text("'{}'::json"),
            ),
        )
    except Exception:
        pass   # Column already exists


def downgrade() -> None:
    try:
        op.drop_index("ix_satellite_images_farm_date", "satellite_images")
    except Exception:
        pass
    try:
        op.drop_column("satellite_images", "extra_metadata")
    except Exception:
        pass
    op.drop_index("ix_phenology_records_farm_id", "phenology_records")
    op.drop_table("phenology_records")
