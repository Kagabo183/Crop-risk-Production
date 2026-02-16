"""add disease_classifications table

Revision ID: 198f171fce28
Revises: 294eb1473ec9
Create Date: 2026-02-15 12:00:44.244700

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '198f171fce28'
down_revision: Union[str, Sequence[str], None] = '294eb1473ec9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('disease_classifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('farm_id', sa.Integer(), nullable=True),
        sa.Column('image_path', sa.String(), nullable=True),
        sa.Column('original_filename', sa.String(length=255), nullable=True),
        sa.Column('plant', sa.String(length=100), nullable=False),
        sa.Column('disease', sa.String(length=100), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('is_healthy', sa.Boolean(), nullable=True),
        sa.Column('crop_type', sa.String(length=50), nullable=True),
        sa.Column('model_type', sa.String(length=50), nullable=True),
        sa.Column('top5', sa.JSON(), nullable=True),
        sa.Column('treatment', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['farm_id'], ['farms.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_disease_classifications_id'), 'disease_classifications', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_disease_classifications_id'), table_name='disease_classifications')
    op.drop_table('disease_classifications')
