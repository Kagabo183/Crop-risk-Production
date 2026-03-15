"""Add geo-intelligence tables: productivity_zones, scouting_observations, ndvi_overlays

Revision ID: a1f2e3d4c5b6
Revises: 198f171fce28
Create Date: 2026-03-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

# revision identifiers, used by Alembic.
revision: str = "a1f2e3d4c5b6"
down_revision: Union[str, Sequence[str], None] = "198f171fce28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── productivity_zones ────────────────────────────────────────────────────
    op.create_table(
        "productivity_zones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "farm_id",
            sa.Integer(),
            sa.ForeignKey("farms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("zone_class", sa.String(20), nullable=False),
        sa.Column(
            "boundary",
            Geometry(geometry_type="POLYGON", srid=4326),
            nullable=True,
        ),
        sa.Column("mean_ndvi", sa.Float(), nullable=True),
        sa.Column("area_ha", sa.Float(), nullable=True),
        sa.Column("pixel_count", sa.Integer(), nullable=True),
        sa.Column("color_hex", sa.String(10), nullable=True),
        sa.Column("zone_index", sa.Integer(), nullable=True),
        sa.Column("ndvi_samples_used", sa.Integer(), nullable=True),
        sa.Column(
            "computed_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_productivity_zones_farm_id", "productivity_zones", ["farm_id"]
    )

    # ── scouting_observations ─────────────────────────────────────────────────
    op.create_table(
        "scouting_observations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "farm_id",
            sa.Integer(),
            sa.ForeignKey("farms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("observed_at", sa.DateTime(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column(
            "point",
            Geometry(geometry_type="POINT", srid=4326),
            nullable=True,
        ),
        sa.Column("observation_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photo_paths", sa.JSON(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_scouting_observations_farm_id", "scouting_observations", ["farm_id"]
    )

    # ── ndvi_overlays ─────────────────────────────────────────────────────────
    op.create_table(
        "ndvi_overlays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "farm_id",
            sa.Integer(),
            sa.ForeignKey("farms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("tile_url_template", sa.Text(), nullable=True),
        sa.Column("bounds", sa.JSON(), nullable=True),
        sa.Column("min_ndvi", sa.Float(), nullable=True),
        sa.Column("max_ndvi", sa.Float(), nullable=True),
        sa.Column("mean_ndvi", sa.Float(), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column(
            "generated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_ndvi_overlays_farm_id", "ndvi_overlays", ["farm_id"])


def downgrade() -> None:
    op.drop_index("ix_ndvi_overlays_farm_id", table_name="ndvi_overlays")
    op.drop_table("ndvi_overlays")

    op.drop_index(
        "ix_scouting_observations_farm_id", table_name="scouting_observations"
    )
    op.drop_table("scouting_observations")

    op.drop_index(
        "ix_productivity_zones_farm_id", table_name="productivity_zones"
    )
    op.drop_table("productivity_zones")
