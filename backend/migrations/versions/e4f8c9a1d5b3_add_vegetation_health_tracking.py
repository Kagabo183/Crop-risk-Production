"""add vegetation health tracking

Revision ID: e4f8c9a1d5b3
Revises: disease_prediction_v1
Create Date: 2026-01-26 16:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e4f8c9a1d5b3'
down_revision: Union[str, Sequence[str], None] = 'disease_prediction_v1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema - Add vegetation health tracking."""
    
    # Enhance satellite_images table with additional vegetation indices
    op.add_column('satellite_images', sa.Column('farm_id', sa.Integer(), nullable=True))
    op.add_column('satellite_images', sa.Column('acquisition_date', sa.DateTime(), nullable=True))
    op.add_column('satellite_images', sa.Column('cloud_cover_percent', sa.Float(), nullable=True))
    op.add_column('satellite_images', sa.Column('mean_ndvi', sa.Float(), nullable=True))
    op.add_column('satellite_images', sa.Column('mean_ndre', sa.Float(), nullable=True))
    op.add_column('satellite_images', sa.Column('mean_ndwi', sa.Float(), nullable=True))
    op.add_column('satellite_images', sa.Column('mean_evi', sa.Float(), nullable=True))
    op.add_column('satellite_images', sa.Column('mean_savi', sa.Float(), nullable=True))
    op.add_column('satellite_images', sa.Column('processing_status', sa.String(50), nullable=True))
    op.add_column('satellite_images', sa.Column('source', sa.String(50), nullable=True))
    
    # Add foreign key to farms
    op.create_foreign_key('fk_satellite_images_farm', 'satellite_images', 'farms', ['farm_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_satellite_images_farm_date', 'satellite_images', ['farm_id', 'acquisition_date'])
    
    # Create vegetation_health table
    op.create_table('vegetation_health',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('farm_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('ndvi', sa.Float(), nullable=True),
        sa.Column('ndvi_anomaly', sa.Float(), nullable=True, comment='Deviation from historical baseline'),
        sa.Column('ndre', sa.Float(), nullable=True),
        sa.Column('ndwi', sa.Float(), nullable=True),
        sa.Column('evi', sa.Float(), nullable=True),
        sa.Column('savi', sa.Float(), nullable=True),
        sa.Column('health_score', sa.Float(), nullable=True, comment='Composite health score 0-100'),
        sa.Column('stress_level', sa.String(20), nullable=True, comment='none, low, moderate, high, severe'),
        sa.Column('stress_type', sa.String(50), nullable=True, comment='drought, heat, water, nutrient, multiple'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['farm_id'], ['farms.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('farm_id', 'date', name='uq_vegetation_health_farm_date')
    )
    op.create_index('ix_vegetation_health_id', 'vegetation_health', ['id'])
    op.create_index('ix_vegetation_health_farm_date', 'vegetation_health', ['farm_id', 'date'])
    op.create_index('ix_vegetation_health_stress_level', 'vegetation_health', ['stress_level'])


def downgrade() -> None:
    """Downgrade schema - Remove vegetation health tracking."""
    
    # Drop vegetation_health table
    op.drop_index('ix_vegetation_health_stress_level', table_name='vegetation_health')
    op.drop_index('ix_vegetation_health_farm_date', table_name='vegetation_health')
    op.drop_index('ix_vegetation_health_id', table_name='vegetation_health')
    op.drop_table('vegetation_health')
    
    # Remove added columns from satellite_images
    op.drop_index('ix_satellite_images_farm_date', table_name='satellite_images')
    op.drop_constraint('fk_satellite_images_farm', 'satellite_images', type_='foreignkey')
    op.drop_column('satellite_images', 'source')
    op.drop_column('satellite_images', 'processing_status')
    op.drop_column('satellite_images', 'mean_savi')
    op.drop_column('satellite_images', 'mean_evi')
    op.drop_column('satellite_images', 'mean_ndwi')
    op.drop_column('satellite_images', 'mean_ndre')
    op.drop_column('satellite_images', 'mean_ndvi')
    op.drop_column('satellite_images', 'cloud_cover_percent')
    op.drop_column('satellite_images', 'acquisition_date')
    op.drop_column('satellite_images', 'farm_id')
