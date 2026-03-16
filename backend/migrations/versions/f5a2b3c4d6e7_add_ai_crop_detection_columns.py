"""add ai crop detection columns to farms

Revision ID: f5a2b3c4d6e7
Revises: a3c5d7e9f1b2, c3d4e5f6a7b8
Create Date: 2026-03-15 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f5a2b3c4d6e7'
down_revision: Union[str, Sequence[str], None] = ('a3c5d7e9f1b2', 'c3d4e5f6a7b8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add AI crop detection columns to farms table."""
    op.add_column('farms', sa.Column('detected_crop',         sa.String(80),  nullable=True))
    op.add_column('farms', sa.Column('crop_confidence',       sa.Float(),     nullable=True))
    op.add_column('farms', sa.Column('detected_growth_stage', sa.String(50),  nullable=True))
    op.add_column('farms', sa.Column('last_satellite_date',   sa.Date(),      nullable=True))


def downgrade() -> None:
    """Remove AI crop detection columns from farms table."""
    op.drop_column('farms', 'last_satellite_date')
    op.drop_column('farms', 'detected_growth_stage')
    op.drop_column('farms', 'crop_confidence')
    op.drop_column('farms', 'detected_crop')
