"""add farm vegetation metrics table

Revision ID: f6b7c1a4d9e3
Revises: e4f8c9a1d5b3
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f6b7c1a4d9e3'
down_revision = 'e4f8c9a1d5b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'farm_vegetation_metrics',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('farm_id', sa.Integer(), sa.ForeignKey('farms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('observation_date', sa.Date(), nullable=False),
        sa.Column('ndvi_mean', sa.Float(), nullable=True),
        sa.Column('ndvi_min', sa.Float(), nullable=True),
        sa.Column('ndvi_max', sa.Float(), nullable=True),
        sa.Column('ndvi_std', sa.Float(), nullable=True),
        sa.Column('ndre_mean', sa.Float(), nullable=True),
        sa.Column('evi_mean', sa.Float(), nullable=True),
        sa.Column('savi_mean', sa.Float(), nullable=True),
        sa.Column('cloud_cover_percent', sa.Float(), nullable=True),
        sa.Column('health_score', sa.Float(), nullable=True),
        sa.Column('source', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index(
        'ix_farm_vegetation_metrics_farm_date',
        'farm_vegetation_metrics',
        ['farm_id', 'observation_date'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_farm_vegetation_metrics_farm_date', table_name='farm_vegetation_metrics')
    op.drop_table('farm_vegetation_metrics')
