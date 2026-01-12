"""add farm boundary geometry

Revision ID: c1a4b9f0d9a2
Revises: 7c2b1a9d3e21
Create Date: 2026-01-11

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# GeoAlchemy2 is already in requirements.txt
from geoalchemy2 import Geometry


# revision identifiers, used by Alembic.
revision: str = "c1a4b9f0d9a2"
down_revision: Union[str, Sequence[str], None] = "7c2b1a9d3e21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Ensure PostGIS is available (works even on existing DB volumes)
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    op.add_column(
        "farms",
        sa.Column(
            "boundary",
            Geometry(geometry_type="POLYGON", srid=4326),
            nullable=True,
        ),
    )

    # Spatial index for faster spatial queries later
    op.create_index(
        "ix_farms_boundary",
        "farms",
        ["boundary"],
        unique=False,
        postgresql_using="gist",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_farms_boundary", table_name="farms")
    op.drop_column("farms", "boundary")
