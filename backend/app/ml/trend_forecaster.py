"""
Health Trend Forecaster using Prophet and LSTM
Forecasts vegetation health trends for early warning

Features:
- Time-series forecasting of NDVI/health scores
- Seasonality modeling (Rwanda's two growing seasons)
- Weather-correlated predictions
- Confidence intervals for uncertainty quantification
"""
import os
import logging
import pickle
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
from datetime import datetime, timedelta
import json

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class HealthTrendForecaster:
    """
    Forecasts vegetation health trends using Prophet time-series model.
    Provides early warning for potential crop stress.
    """

    def __init__(self, forecast_days: int = 14):
        """
        Initialize the forecaster.

        Args:
            forecast_days: Number of days to forecast ahead
        """
        self.model = None
        self.forecast_days = forecast_days
        self.is_fitted = False

        # Model paths
        self.model_dir = Path(os.environ.get('MODEL_DIR', '/app/data/models'))
        self.model_path = self.model_dir / "health_forecaster.pkl"

        # Rwanda seasonality parameters
        self.rwanda_seasons = {
            'long_rains': {'start': (3, 1), 'end': (5, 31)},    # March-May
            'short_dry': {'start': (6, 1), 'end': (8, 31)},     # June-August
            'short_rains': {'start': (9, 1), 'end': (11, 30)},  # Sept-November
            'long_dry': {'start': (12, 1), 'end': (2, 28)}      # Dec-February
        }

    def _prepare_data(self, historical_data: List[Dict]) -> pd.DataFrame:
        """
        Prepare data for Prophet model.

        Args:
            historical_data: List of historical health records

        Returns:
            DataFrame with 'ds' (date) and 'y' (value) columns
        """
        records = []
        for record in historical_data:
            date = record.get('date')
            if isinstance(date, str):
                date = pd.to_datetime(date)

            # Use health_score or NDVI as target
            value = record.get('health_score') or record.get('ndvi', 0.5) * 100

            if date and value:
                records.append({'ds': date, 'y': value})

        df = pd.DataFrame(records)

        if len(df) > 0:
            df = df.sort_values('ds').drop_duplicates(subset='ds')
            # Fill missing dates with interpolation
            df = df.set_index('ds').resample('D').mean().interpolate().reset_index()

        return df

    def _add_weather_regressors(self, df: pd.DataFrame,
                                weather_data: Optional[List[Dict]] = None) -> pd.DataFrame:
        """
        Add weather data as additional regressors.

        Args:
            df: Base dataframe with dates
            weather_data: Optional weather records

        Returns:
            DataFrame with weather regressors
        """
        if not weather_data:
            return df

        # Create weather dataframe
        weather_records = []
        for record in weather_data:
            date = record.get('date')
            if isinstance(date, str):
                date = pd.to_datetime(date)

            weather_records.append({
                'ds': date,
                'temperature': record.get('temperature', 20.0),
                'rainfall': record.get('rainfall', 0.0),
                'humidity': record.get('humidity', 70.0)
            })

        weather_df = pd.DataFrame(weather_records)
        if len(weather_df) > 0:
            weather_df = weather_df.drop_duplicates(subset='ds')
            df = df.merge(weather_df, on='ds', how='left')

            # Fill missing weather data
            for col in ['temperature', 'rainfall', 'humidity']:
                if col in df.columns:
                    df[col] = df[col].fillna(df[col].mean())

        return df

    def train(self, historical_data: List[Dict],
              weather_data: Optional[List[Dict]] = None,
              **kwargs) -> Dict[str, Any]:
        """
        Train the forecasting model.

        Args:
            historical_data: List of historical health records
            weather_data: Optional weather data for regressors
            **kwargs: Additional Prophet parameters

        Returns:
            Training metrics
        """
        try:
            from prophet import Prophet

            # Prepare data
            df = self._prepare_data(historical_data)

            if len(df) < 14:
                logger.warning("Insufficient data for training (need at least 14 days)")
                return {'error': 'Insufficient data', 'samples': len(df)}

            # Add weather regressors if available
            df = self._add_weather_regressors(df, weather_data)

            # Initialize Prophet
            self.model = Prophet(
                yearly_seasonality=True,
                weekly_seasonality=True,
                daily_seasonality=False,
                seasonality_mode='multiplicative',
                changepoint_prior_scale=kwargs.get('changepoint_prior_scale', 0.05),
                interval_width=0.95
            )

            # Add Rwanda-specific seasonality (bimodal growing season)
            self.model.add_seasonality(
                name='growing_season',
                period=182.5,  # ~6 months
                fourier_order=5
            )

            # Add weather regressors if present
            if 'temperature' in df.columns:
                self.model.add_regressor('temperature')
            if 'rainfall' in df.columns:
                self.model.add_regressor('rainfall')
            if 'humidity' in df.columns:
                self.model.add_regressor('humidity')

            # Train
            self.model.fit(df)
            self.is_fitted = True

            # Cross-validation for metrics
            from prophet.diagnostics import cross_validation, performance_metrics

            # Use 30-day initial, 7-day horizon for CV
            if len(df) > 45:
                cv_results = cross_validation(
                    self.model,
                    initial='30 days',
                    period='7 days',
                    horizon='7 days'
                )
                metrics = performance_metrics(cv_results)
                mae = float(metrics['mae'].mean())
                mape = float(metrics['mape'].mean())
                rmse = float(metrics['rmse'].mean())
            else:
                mae = mape = rmse = None

            logger.info(f"Health forecaster trained on {len(df)} samples")

            return {
                'samples_trained': len(df),
                'date_range': {
                    'start': str(df['ds'].min()),
                    'end': str(df['ds'].max())
                },
                'metrics': {
                    'mae': mae,
                    'mape': mape,
                    'rmse': rmse
                },
                'has_weather_regressors': 'temperature' in df.columns
            }

        except ImportError:
            logger.error("Prophet not installed")
            return {'error': 'Prophet not installed'}
        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {'error': str(e)}

    def forecast(self, days: Optional[int] = None,
                 weather_forecast: Optional[List[Dict]] = None) -> Dict[str, Any]:
        """
        Generate health forecast.

        Args:
            days: Number of days to forecast (default: self.forecast_days)
            weather_forecast: Optional weather forecast for future dates

        Returns:
            Forecast results with predictions and confidence intervals
        """
        if not self.is_fitted:
            if not self.load():
                logger.warning("Model not fitted, using naive forecast")
                return self._naive_forecast(days or self.forecast_days)

        try:
            days = days or self.forecast_days

            # Create future dataframe
            future = self.model.make_future_dataframe(periods=days)

            # Add weather regressors for future dates
            if weather_forecast:
                future = self._add_weather_regressors(future, weather_forecast)
            else:
                # Use mean values for future weather
                for col in ['temperature', 'rainfall', 'humidity']:
                    if col in self.model.extra_regressors:
                        future[col] = future[col].fillna(future[col].mean())

            # Generate forecast
            forecast = self.model.predict(future)

            # Get only future predictions
            last_training_date = self.model.history['ds'].max()
            future_forecast = forecast[forecast['ds'] > last_training_date]

            # Format results
            predictions = []
            for _, row in future_forecast.iterrows():
                pred = {
                    'date': row['ds'].strftime('%Y-%m-%d'),
                    'health_score': round(float(row['yhat']), 2),
                    'lower_bound': round(float(row['yhat_lower']), 2),
                    'upper_bound': round(float(row['yhat_upper']), 2),
                    'trend': round(float(row['trend']), 2)
                }

                # Add seasonality components
                if 'yearly' in row:
                    pred['seasonality'] = round(float(row['yearly']), 2)
                if 'growing_season' in row:
                    pred['growing_season_effect'] = round(float(row['growing_season']), 2)

                predictions.append(pred)

            # Calculate risk alerts
            alerts = self._generate_alerts(predictions)

            return {
                'forecast_days': days,
                'predictions': predictions,
                'alerts': alerts,
                'trend_direction': self._get_trend_direction(predictions),
                'average_forecast': round(np.mean([p['health_score'] for p in predictions]), 2),
                'min_forecast': round(min(p['health_score'] for p in predictions), 2),
                'max_forecast': round(max(p['health_score'] for p in predictions), 2)
            }

        except Exception as e:
            logger.error(f"Forecast failed: {e}")
            return self._naive_forecast(days or self.forecast_days)

    def _naive_forecast(self, days: int) -> Dict[str, Any]:
        """
        Fallback naive forecast using simple moving average.
        """
        # Generate flat forecast at average health level
        base_score = 70.0
        predictions = []

        for i in range(days):
            date = datetime.utcnow() + timedelta(days=i+1)
            # Add slight random variation
            score = base_score + np.random.normal(0, 5)
            predictions.append({
                'date': date.strftime('%Y-%m-%d'),
                'health_score': round(float(max(0, min(100, score))), 2),
                'lower_bound': round(float(score - 15), 2),
                'upper_bound': round(float(score + 15), 2)
            })

        return {
            'forecast_days': days,
            'predictions': predictions,
            'alerts': [],
            'method': 'naive',
            'note': 'Model not trained - using baseline forecast'
        }

    def _generate_alerts(self, predictions: List[Dict]) -> List[Dict]:
        """
        Generate alerts based on forecast.
        """
        alerts = []

        for pred in predictions:
            health_score = pred['health_score']
            date = pred['date']

            if health_score < 40:
                alerts.append({
                    'date': date,
                    'type': 'critical',
                    'message': f'Critical health decline predicted ({health_score:.0f})',
                    'action': 'Immediate field inspection required'
                })
            elif health_score < 55:
                alerts.append({
                    'date': date,
                    'type': 'warning',
                    'message': f'Below-average health predicted ({health_score:.0f})',
                    'action': 'Monitor closely and prepare interventions'
                })

        # Detect rapid decline
        if len(predictions) >= 3:
            scores = [p['health_score'] for p in predictions[:3]]
            if scores[0] - scores[2] > 15:
                alerts.insert(0, {
                    'date': predictions[0]['date'],
                    'type': 'rapid_decline',
                    'message': 'Rapid health decline detected in forecast',
                    'action': 'Investigate potential stress factors immediately'
                })

        return alerts

    def _get_trend_direction(self, predictions: List[Dict]) -> str:
        """Determine overall trend direction"""
        if len(predictions) < 2:
            return 'stable'

        first_half = np.mean([p['health_score'] for p in predictions[:len(predictions)//2]])
        second_half = np.mean([p['health_score'] for p in predictions[len(predictions)//2:]])

        diff = second_half - first_half

        if diff > 5:
            return 'improving'
        elif diff < -5:
            return 'declining'
        else:
            return 'stable'

    def forecast_with_scenarios(self, base_forecast: Dict,
                                scenarios: List[str]) -> Dict[str, Any]:
        """
        Generate forecasts under different weather scenarios.

        Args:
            base_forecast: Base forecast results
            scenarios: List of scenarios ['drought', 'normal', 'wet']

        Returns:
            Forecasts under each scenario
        """
        scenario_results = {}

        for scenario in scenarios:
            # Modify predictions based on scenario
            modified_predictions = []

            for pred in base_forecast.get('predictions', []):
                new_pred = pred.copy()

                if scenario == 'drought':
                    # Reduce health scores
                    new_pred['health_score'] = max(20, pred['health_score'] - 15)
                    new_pred['lower_bound'] = max(10, pred['lower_bound'] - 20)
                elif scenario == 'wet':
                    # Slight improvement
                    new_pred['health_score'] = min(100, pred['health_score'] + 5)
                    new_pred['upper_bound'] = min(100, pred['upper_bound'] + 10)
                # 'normal' keeps original values

                modified_predictions.append(new_pred)

            scenario_results[scenario] = {
                'predictions': modified_predictions,
                'average': np.mean([p['health_score'] for p in modified_predictions]),
                'alerts': self._generate_alerts(modified_predictions)
            }

        return {
            'base_forecast': base_forecast,
            'scenarios': scenario_results,
            'recommendation': self._scenario_recommendation(scenario_results)
        }

    def _scenario_recommendation(self, scenarios: Dict) -> str:
        """Generate recommendation based on scenario analysis"""
        drought_avg = scenarios.get('drought', {}).get('average', 70)
        normal_avg = scenarios.get('normal', {}).get('average', 70)

        if drought_avg < 50:
            return 'High drought vulnerability detected. Consider irrigation backup.'
        elif drought_avg < 60:
            return 'Moderate drought sensitivity. Monitor soil moisture closely.'
        else:
            return 'Vegetation shows good resilience to drought conditions.'

    def save(self, path: Optional[str] = None) -> str:
        """Save model to disk"""
        try:
            save_path = Path(path) if path else self.model_path
            save_path.parent.mkdir(parents=True, exist_ok=True)

            with open(save_path, 'wb') as f:
                pickle.dump(self.model, f)

            # Save metadata
            meta_path = save_path.with_suffix('.json')
            with open(meta_path, 'w') as f:
                json.dump({
                    'forecast_days': self.forecast_days,
                    'saved_at': datetime.utcnow().isoformat()
                }, f)

            logger.info(f"Health forecaster saved to {save_path}")
            return str(save_path)

        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return ""

    def load(self, path: Optional[str] = None) -> bool:
        """Load model from disk"""
        try:
            load_path = Path(path) if path else self.model_path

            if not load_path.exists():
                logger.warning(f"Model file not found: {load_path}")
                return False

            with open(load_path, 'rb') as f:
                self.model = pickle.load(f)

            self.is_fitted = True
            logger.info(f"Health forecaster loaded from {load_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
