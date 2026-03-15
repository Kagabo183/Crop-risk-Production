"""
Add precision agriculture tables

Revision ID: b2c3d4e5f6a7
Revises: a1f2e3d4c5b6
Create Date: 2026-03-15 12:00:00
"""
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geometry

revision = 'b2c3d4e5f6a7'
down_revision = 'a1f2e3d4c5b6'
branch_labels = None
depends_on = None


def upgrade():
    # ── seasons ────────────────────────────────────────────────────────────
    op.create_table(
        'seasons',
        sa.Column('id',               sa.Integer(),     primary_key=True),
        sa.Column('farm_id',          sa.Integer(),     sa.ForeignKey('farms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name',             sa.String(100),   nullable=False),
        sa.Column('year',             sa.Integer(),     nullable=False),
        sa.Column('crop_type',        sa.String(100),   nullable=False),
        sa.Column('planting_date',    sa.Date(),        nullable=True),
        sa.Column('harvest_date',     sa.Date(),        nullable=True),
        sa.Column('target_yield_tha', sa.Float(),       nullable=True),
        sa.Column('area_planted_ha',  sa.Float(),       nullable=True),
        sa.Column('status',           sa.Enum('planning', 'active', 'completed', 'cancelled', name='seasonstatus'), nullable=False, server_default='planning'),
        sa.Column('notes',            sa.Text(),        nullable=True),
        sa.Column('created_at',       sa.DateTime(),    nullable=True),
        sa.Column('updated_at',       sa.DateTime(),    nullable=True),
    )
    op.create_index('ix_seasons_farm_id', 'seasons', ['farm_id'])

    # ── crop_rotations ─────────────────────────────────────────────────────
    op.create_table(
        'crop_rotations',
        sa.Column('id',                       sa.Integer(),   primary_key=True),
        sa.Column('farm_id',                  sa.Integer(),   sa.ForeignKey('farms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('season_id',                sa.Integer(),   sa.ForeignKey('seasons.id', ondelete='CASCADE'), nullable=False),
        sa.Column('previous_crop',            sa.String(100), nullable=True),
        sa.Column('current_crop',             sa.String(100), nullable=False),
        sa.Column('next_crop_recommendation', sa.String(100), nullable=True),
        sa.Column('rotation_score',           sa.Float(),     nullable=True),
        sa.Column('nitrogen_fixation',        sa.Boolean(),   nullable=True),
        sa.Column('rest_period_weeks',        sa.Integer(),   nullable=True),
        sa.Column('notes',                    sa.Text(),      nullable=True),
        sa.Column('recommendations',          sa.JSON(),      nullable=True),
        sa.Column('created_at',               sa.DateTime(),  nullable=True),
    )
    op.create_index('ix_crop_rotations_farm_id', 'crop_rotations', ['farm_id'])

    # ── soil_samples ────────────────────────────────────────────────────────
    op.create_table(
        'soil_samples',
        sa.Column('id',               sa.Integer(),  primary_key=True),
        sa.Column('farm_id',          sa.Integer(),  sa.ForeignKey('farms.id', ondelete='CASCADE'),  nullable=False),
        sa.Column('sampling_method',  sa.Enum('grid', 'zone', 'random', name='samplingmethod'), nullable=False, server_default='grid'),
        sa.Column('grid_size_m',      sa.Integer(),  nullable=True),
        sa.Column('sampled_at',       sa.Date(),     nullable=True),
        sa.Column('agronomist_id',    sa.Integer(),  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('total_zones',      sa.Integer(),  nullable=True),
        sa.Column('sampling_geojson', sa.JSON(),     nullable=True),
        sa.Column('notes',            sa.Text(),     nullable=True),
        sa.Column('created_at',       sa.DateTime(), nullable=True),
        sa.Column('updated_at',       sa.DateTime(), nullable=True),
    )
    op.create_index('ix_soil_samples_farm_id', 'soil_samples', ['farm_id'])

    # ── soil_nutrient_results ──────────────────────────────────────────────
    op.create_table(
        'soil_nutrient_results',
        sa.Column('id',             sa.Integer(), primary_key=True),
        sa.Column('soil_sample_id', sa.Integer(), sa.ForeignKey('soil_samples.id', ondelete='CASCADE'), nullable=False),
        sa.Column('zone_label',     sa.String(50), nullable=True),
        sa.Column('latitude',       sa.Float(),    nullable=True),
        sa.Column('longitude',      sa.Float(),    nullable=True),
        sa.Column('point',          Geometry('POINT', srid=4326), nullable=True),
        sa.Column('nitrogen',       sa.Float(),    nullable=True),
        sa.Column('phosphorus',     sa.Float(),    nullable=True),
        sa.Column('potassium',      sa.Float(),    nullable=True),
        sa.Column('organic_matter', sa.Float(),    nullable=True),
        sa.Column('ph',             sa.Float(),    nullable=True),
        sa.Column('moisture',       sa.Float(),    nullable=True),
        sa.Column('raw_data',       sa.JSON(),     nullable=True),
        sa.Column('created_at',     sa.DateTime(), nullable=True),
    )
    op.create_index('ix_soil_nutrient_results_sample_id', 'soil_nutrient_results', ['soil_sample_id'])

    # ── yield_maps ─────────────────────────────────────────────────────────
    op.create_table(
        'yield_maps',
        sa.Column('id',                 sa.Integer(),  primary_key=True),
        sa.Column('farm_id',            sa.Integer(),  sa.ForeignKey('farms.id', ondelete='CASCADE'),    nullable=False),
        sa.Column('season_id',          sa.Integer(),  sa.ForeignKey('seasons.id', ondelete='SET NULL'), nullable=True),
        sa.Column('crop_type',          sa.String(100), nullable=True),
        sa.Column('harvest_date',       sa.Date(),     nullable=True),
        sa.Column('file_path',          sa.String(),   nullable=True),
        sa.Column('geojson_data',       sa.JSON(),     nullable=True),
        sa.Column('mean_yield_tha',     sa.Float(),    nullable=True),
        sa.Column('max_yield_tha',      sa.Float(),    nullable=True),
        sa.Column('min_yield_tha',      sa.Float(),    nullable=True),
        sa.Column('total_yield_kg',     sa.Float(),    nullable=True),
        sa.Column('area_harvested_ha',  sa.Float(),    nullable=True),
        sa.Column('variability_cv',     sa.Float(),    nullable=True),
        sa.Column('high_yield_area_ha', sa.Float(),    nullable=True),
        sa.Column('low_yield_area_ha',  sa.Float(),    nullable=True),
        sa.Column('zone_comparison',    sa.JSON(),     nullable=True),
        sa.Column('created_at',         sa.DateTime(), nullable=True),
    )
    op.create_index('ix_yield_maps_farm_id', 'yield_maps', ['farm_id'])

    # ── vra_maps ────────────────────────────────────────────────────────────
    op.create_table(
        'vra_maps',
        sa.Column('id',                sa.Integer(),  primary_key=True),
        sa.Column('farm_id',           sa.Integer(),  sa.ForeignKey('farms.id', ondelete='CASCADE'),    nullable=False),
        sa.Column('season_id',         sa.Integer(),  sa.ForeignKey('seasons.id', ondelete='SET NULL'), nullable=True),
        sa.Column('prescription_type', sa.Enum('seeding', 'fertilizer', 'chemical', name='prescriptiontype'), nullable=False),
        sa.Column('zones_geojson',     sa.JSON(),     nullable=False),
        sa.Column('rates_json',        sa.JSON(),     nullable=True),
        sa.Column('product_name',      sa.String(200), nullable=True),
        sa.Column('base_rate',         sa.Float(),    nullable=True),
        sa.Column('high_zone_rate',    sa.Float(),    nullable=True),
        sa.Column('medium_zone_rate',  sa.Float(),    nullable=True),
        sa.Column('low_zone_rate',     sa.Float(),    nullable=True),
        sa.Column('total_product_kg',  sa.Float(),    nullable=True),
        sa.Column('savings_pct',       sa.Float(),    nullable=True),
        sa.Column('generated_at',      sa.DateTime(), nullable=True),
    )
    op.create_index('ix_vra_maps_farm_id', 'vra_maps', ['farm_id'])


def downgrade():
    op.drop_index('ix_vra_maps_farm_id',   table_name='vra_maps')
    op.drop_table('vra_maps')
    op.drop_index('ix_yield_maps_farm_id', table_name='yield_maps')
    op.drop_table('yield_maps')
    op.drop_index('ix_soil_nutrient_results_sample_id', table_name='soil_nutrient_results')
    op.drop_table('soil_nutrient_results')
    op.drop_index('ix_soil_samples_farm_id', table_name='soil_samples')
    op.drop_table('soil_samples')
    op.drop_index('ix_crop_rotations_farm_id', table_name='crop_rotations')
    op.drop_table('crop_rotations')
    op.drop_index('ix_seasons_farm_id', table_name='seasons')
    op.drop_table('seasons')
    op.execute("DROP TYPE IF EXISTS prescriptiontype")
    op.execute("DROP TYPE IF EXISTS samplingmethod")
    op.execute("DROP TYPE IF EXISTS seasonstatus")
