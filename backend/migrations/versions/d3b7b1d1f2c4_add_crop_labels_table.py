"""add crop labels table

Revision ID: d3b7b1d1f2c4
Revises: c1a4b9f0d9a2
Create Date: 2026-01-11

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geometry


# revision identifiers, used by Alembic.
revision: str = "d3b7b1d1f2c4"
down_revision: Union[str, Sequence[str], None] = "c1a4b9f0d9a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    # Create table if missing (safe for partially-applied migrations)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS crop_labels (
            id SERIAL PRIMARY KEY,
            farm_id INTEGER NULL,
            boundary geometry(POLYGON, 4326) NOT NULL,
            crop_name VARCHAR(100) NOT NULL,
            country VARCHAR(60) NULL,
            admin1 VARCHAR(80) NULL,
            admin2 VARCHAR(80) NULL,
            season VARCHAR(40) NULL,
            label_date DATE NULL,
            source VARCHAR(100) NULL,
            source_id VARCHAR(120) NULL,
            notes TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

    # Indexes (idempotent)
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_farm_id ON crop_labels (farm_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_crop_name ON crop_labels (crop_name);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_country ON crop_labels (country);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_admin1 ON crop_labels (admin1);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_admin2 ON crop_labels (admin2);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_season ON crop_labels (season);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_source ON crop_labels (source);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_source_id ON crop_labels (source_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crop_labels_boundary ON crop_labels USING gist (boundary);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_boundary;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_source_id;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_source;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_season;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_admin2;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_admin1;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_country;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_crop_name;")
    op.execute("DROP INDEX IF EXISTS ix_crop_labels_farm_id;")
    op.execute("DROP TABLE IF EXISTS crop_labels;")
