"""add season column to farms

Revision ID: 1a2b3c4d5e67
Revises: merge_metrics_head
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '1a2b3c4d5e67'
down_revision = 'merge_metrics_head'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('farms', sa.Column('season', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('farms', 'season')
