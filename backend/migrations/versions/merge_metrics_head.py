"""merge heads after farm vegetation metrics

Revision ID: merge_metrics_head
Revises: f5a2b3c4d6e7, f6b7c1a4d9e3
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'merge_metrics_head'
down_revision = ('f5a2b3c4d6e7', 'f6b7c1a4d9e3')
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Merge migrations; no schema changes.
    pass


def downgrade() -> None:
    # No-op merge downgrade.
    pass
