"""merge heads before disease_classifications

Revision ID: 294eb1473ec9
Revises: d3b7b1d1f2c4, e4f8c9a1d5b3
Create Date: 2026-02-15 12:00:33.410868

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '294eb1473ec9'
down_revision: Union[str, Sequence[str], None] = ('d3b7b1d1f2c4', 'e4f8c9a1d5b3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
