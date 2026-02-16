"""add action_days to alerts

Revision ID: a3c5d7e9f1b2
Revises: 198f171fce28
Create Date: 2026-02-15 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a3c5d7e9f1b2'
down_revision: Union[str, Sequence[str], None] = '198f171fce28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('alerts', sa.Column('action_days_min', sa.Integer(), nullable=True))
    op.add_column('alerts', sa.Column('action_days_max', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('alerts', 'action_days_max')
    op.drop_column('alerts', 'action_days_min')
