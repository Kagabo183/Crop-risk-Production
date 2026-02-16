"""
Centralized alert message templates for both technical (agronomist) and farmer-friendly messages.
Each message type has both versions plus action recommendations.
"""
from typing import Dict, Tuple

class AlertMessageTemplates:
    """Centralized alert message templates with role-based variations"""

    # Stress Level Messages
    STRESS_MESSAGES = {
        'severe': {
            'technical': 'Farm health: {health_score:.1f}/100 (Severe stress). Primary issue: {primary_stress}. Immediate intervention required.',
            'farmer': '🚨 Your crops need urgent attention! Health score: {health_score:.0f}/100. Main problem: {primary_stress_simple}. Act within 1-3 days.',
            'action': 'Take action within 1-3 days to prevent crop damage'
        },
        'high': {
            'technical': 'Farm health: {health_score:.1f}/100 (High stress). Primary issue: {primary_stress}. Action needed within 24-48 hours.',
            'farmer': '⚠️ Your crops need care soon. Health score: {health_score:.0f}/100. Main problem: {primary_stress_simple}. Plan to act in 2-5 days.',
            'action': 'Plan to take action within 2-5 days'
        },
        'moderate': {
            'technical': 'Farm health: {health_score:.1f}/100 (Moderate stress). Primary issue: {primary_stress}. Enhanced monitoring recommended.',
            'farmer': '👀 Keep a close watch on your crops. Health score: {health_score:.0f}/100. Watch for: {primary_stress_simple}. Check daily.',
            'action': 'Monitor closely and prepare to act within 5-10 days if needed'
        },
        'low': {
            'technical': 'Farm health: {health_score:.1f}/100 (Low stress). Continue routine management.',
            'farmer': '✅ Your crops are doing well! Health score: {health_score:.0f}/100. Keep up your good work.',
            'action': 'Continue regular farm management'
        },
        'healthy': {
            'technical': 'Farm health: {health_score:.1f}/100 (Healthy). No significant stress detected.',
            'farmer': '🌱 Excellent! Your crops are healthy. Health score: {health_score:.0f}/100. Everything looks great!',
            'action': 'No action needed - crops are thriving'
        }
    }

    # Drought Stress Messages
    DROUGHT_MESSAGES = {
        'severe': {
            'technical': 'Severe drought stress detected (score: {score:.1f}). Immediate irrigation recommended.',
            'farmer': '💧 Your crops are very dry and need water NOW! Irrigate immediately to save your crops.',
            'action': 'Irrigate immediately - your crops need water urgently',
            'days': (1, 3)
        },
        'high': {
            'technical': 'High drought stress (score: {score:.1f}). Consider irrigation within 24-48 hours.',
            'farmer': '🌵 Your soil is getting too dry. Water your crops in the next 1-2 days.',
            'action': 'Plan to irrigate within the next 1-2 days',
            'days': (2, 5)
        },
        'moderate': {
            'technical': 'Moderate drought stress (score: {score:.1f}). Monitor closely and prepare for irrigation.',
            'farmer': '☀️ Your crops might need water soon. Check soil moisture daily and be ready to irrigate.',
            'action': 'Check soil moisture daily, prepare irrigation equipment',
            'days': (5, 10)
        },
        'low': {
            'technical': 'Low drought stress (score: {score:.1f}). Continue routine monitoring.',
            'farmer': '✓ Soil moisture is okay for now. Keep checking regularly.',
            'action': 'Continue normal watering schedule',
            'days': None
        },
        'none': {
            'technical': 'No significant drought stress (score: {score:.1f}).',
            'farmer': '✓ Good news - your crops have enough water!',
            'action': 'No irrigation needed currently',
            'days': None
        }
    }

    # Water Stress Messages
    WATER_STRESS_MESSAGES = {
        'severe': {
            'technical': 'Severe water stress detected (score: {score:.1f}). Immediate action required.',
            'farmer': '💧 Your plants are suffering from lack of water! Water them right away.',
            'action': 'Irrigate immediately and check for drainage issues',
            'days': (1, 3)
        },
        'high': {
            'technical': 'High water stress (score: {score:.1f}). Increase irrigation frequency.',
            'farmer': '🌊 Your crops need more water. Increase watering in the next 2-3 days.',
            'action': 'Increase watering frequency starting within 2-3 days',
            'days': (2, 5)
        },
        'moderate': {
            'technical': 'Moderate water stress (score: {score:.1f}). Monitor soil moisture.',
            'farmer': '👁️ Watch your crops closely - they might need more water soon.',
            'action': 'Check soil moisture daily, adjust watering as needed',
            'days': (5, 10)
        },
        'low': {
            'technical': 'Low water stress (score: {score:.1f}). Normal irrigation schedule.',
            'farmer': '✓ Water levels look good. Continue normal watering.',
            'action': 'Maintain current watering schedule',
            'days': None
        },
        'none': {
            'technical': 'No significant water stress (score: {score:.1f}).',
            'farmer': '✓ Perfect! Your crops have the water they need.',
            'action': 'No changes needed to irrigation',
            'days': None
        }
    }

    # Heat Stress Messages
    HEAT_STRESS_MESSAGES = {
        'severe': {
            'technical': 'Severe heat stress ({heat_days} days >35°C, score: {score:.1f}). Provide shade or cooling if possible.',
            'farmer': '🔥 Very hot weather is hurting your crops! ({heat_days} hot days). Add shade or water more if you can.',
            'action': 'Provide shade, increase irrigation, or apply mulch to cool soil',
            'days': (1, 3)
        },
        'high': {
            'technical': 'High heat stress ({heat_days} days >35°C, score: {score:.1f}). Monitor crop closely.',
            'farmer': '☀️ Hot weather is stressing your crops ({heat_days} hot days). Water extra and watch for wilting.',
            'action': 'Increase watering during hot periods, monitor for heat damage',
            'days': (2, 5)
        },
        'moderate': {
            'technical': 'Moderate heat stress ({heat_days} days >35°C, score: {score:.1f}). Watch for heat damage.',
            'farmer': '🌡️ It\'s been hot lately ({heat_days} days). Keep an eye on your crops for signs of stress.',
            'action': 'Monitor daily, consider early morning/evening irrigation',
            'days': (5, 10)
        },
        'low': {
            'technical': 'Low heat stress ({heat_days} days >35°C, score: {score:.1f}). Normal monitoring.',
            'farmer': '✓ Temperature is manageable. Your crops are handling the heat okay.',
            'action': 'Continue regular monitoring',
            'days': None
        },
        'none': {
            'technical': 'No significant heat stress (score: {score:.1f}).',
            'farmer': '✓ Temperature is good for your crops!',
            'action': 'No heat-related concerns',
            'days': None
        }
    }

    # Nutrient Deficiency Messages
    NUTRIENT_MESSAGES = {
        'severe': {
            'technical': 'Severe nutrient deficiency suspected (score: {score:.1f}). Soil testing and fertilization recommended.',
            'farmer': '🌱 Your crops are very hungry! They need fertilizer urgently. Consider soil testing.',
            'action': 'Apply fertilizer within 1-3 days, consider professional soil testing',
            'days': (1, 3)
        },
        'high': {
            'technical': 'High nutrient deficiency (score: {score:.1f}). Consider fertilizer application.',
            'farmer': '🍃 Your crops need food (fertilizer) soon to grow well. Plan to fertilize in 3-5 days.',
            'action': 'Plan fertilizer application within 3-5 days',
            'days': (3, 7)
        },
        'moderate': {
            'technical': 'Moderate nutrient deficiency (score: {score:.1f}). Monitor growth and consider supplementation.',
            'farmer': '👀 Your crops might need some fertilizer soon. Watch leaf color and growth.',
            'action': 'Monitor plant growth, prepare to apply fertilizer within 1-2 weeks',
            'days': (7, 14)
        },
        'low': {
            'technical': 'Low nutrient deficiency (score: {score:.1f}). Routine fertilization schedule.',
            'farmer': '✓ Crop nutrition looks okay. Stick to your regular fertilizing plan.',
            'action': 'Continue normal fertilization schedule',
            'days': None
        },
        'none': {
            'technical': 'No significant nutrient deficiency (score: {score:.1f}).',
            'farmer': '✓ Great! Your crops have all the nutrients they need.',
            'action': 'No additional fertilization needed',
            'days': None
        }
    }

    # ML Risk Assessment Messages
    ML_RISK_MESSAGES = {
        'critical': {
            'technical': '[ML] CRITICAL risk detected (score: {score:.0f}). Primary driver: {driver}',
            'farmer': '⚠️ URGENT: High risk detected by AI (score: {score:.0f}). Main cause: {driver_simple}. Act fast!',
            'action': 'Take immediate action within 1-3 days',
            'days': (1, 3)
        },
        'high': {
            'technical': '[ML] HIGH risk detected (score: {score:.0f}). Primary driver: {driver}',
            'farmer': '⚠️ Warning: AI detected risk (score: {score:.0f}). Main cause: {driver_simple}. Take action soon.',
            'action': 'Plan action within 2-5 days',
            'days': (2, 5)
        },
        'moderate': {
            'technical': '[ML] MODERATE risk detected (score: {score:.0f}). Primary driver: {driver}',
            'farmer': '👁️ Watch out: AI found some risk (score: {score:.0f}). Cause: {driver_simple}. Monitor closely.',
            'action': 'Monitor closely, prepare to act if worsens',
            'days': (5, 10)
        }
    }

    # Simplified stress type names for farmers
    STRESS_TYPE_SIMPLE = {
        'Drought': 'needs water (dry soil)',
        'Water stress': 'needs water',
        'Heat': 'too hot weather',
        'Nutrient deficiency': 'needs fertilizer',
        'General': 'general stress',
        'Unknown': 'unknown issue'
    }

    @classmethod
    def get_message(cls, message_dict: Dict, level: str, is_farmer: bool, **kwargs) -> Tuple[str, str, tuple]:
        """
        Get appropriate message based on user role

        Args:
            message_dict: Dictionary of messages (e.g., DROUGHT_MESSAGES)
            level: Stress level (severe, high, moderate, low, none)
            is_farmer: True for farmer-friendly, False for technical
            **kwargs: Format parameters (score, heat_days, etc.)

        Returns:
            Tuple of (message, action, action_days)
        """
        template = message_dict.get(level, message_dict.get('none', {}))

        # Add simple stress type if primary_stress is in kwargs
        if 'primary_stress' in kwargs:
            kwargs['primary_stress_simple'] = cls.STRESS_TYPE_SIMPLE.get(
                kwargs['primary_stress'],
                kwargs['primary_stress'].lower()
            )

        # Add simple driver if driver is in kwargs
        if 'driver' in kwargs:
            kwargs['driver_simple'] = kwargs['driver'].lower().replace('_', ' ')

        message_key = 'farmer' if is_farmer else 'technical'
        message = template.get(message_key, template.get('technical', 'Status unknown'))
        action = template.get('action', 'Monitor situation')
        days = template.get('days')

        try:
            message = message.format(**kwargs)
        except (KeyError, ValueError):
            pass  # Return unformatted if missing parameters

        return message, action, days

    @classmethod
    def get_stress_message(cls, health_score: float, stress_level: str, primary_stress: str, is_farmer: bool = False) -> Tuple[str, str, tuple]:
        """Get composite stress message based on user role"""
        return cls.get_message(
            cls.STRESS_MESSAGES,
            stress_level,
            is_farmer,
            health_score=health_score,
            primary_stress=primary_stress
        )

    @classmethod
    def get_drought_message(cls, level: str, score: float, is_farmer: bool = False) -> Tuple[str, str, tuple]:
        """Get drought-specific message based on user role"""
        return cls.get_message(
            cls.DROUGHT_MESSAGES,
            level,
            is_farmer,
            score=score
        )

    @classmethod
    def get_water_stress_message(cls, level: str, score: float, is_farmer: bool = False) -> Tuple[str, str, tuple]:
        """Get water stress message based on user role"""
        return cls.get_message(
            cls.WATER_STRESS_MESSAGES,
            level,
            is_farmer,
            score=score
        )

    @classmethod
    def get_heat_stress_message(cls, level: str, score: float, heat_days: int, is_farmer: bool = False) -> Tuple[str, str, tuple]:
        """Get heat stress message based on user role"""
        return cls.get_message(
            cls.HEAT_STRESS_MESSAGES,
            level,
            is_farmer,
            score=score,
            heat_days=heat_days
        )

    @classmethod
    def get_nutrient_message(cls, level: str, score: float, is_farmer: bool = False) -> Tuple[str, str, tuple]:
        """Get nutrient deficiency message based on user role"""
        return cls.get_message(
            cls.NUTRIENT_MESSAGES,
            level,
            is_farmer,
            score=score
        )

    @classmethod
    def get_ml_risk_message(cls, risk_level: str, score: float, driver: str, is_farmer: bool = False) -> Tuple[str, str, tuple]:
        """Get ML risk assessment message based on user role"""
        return cls.get_message(
            cls.ML_RISK_MESSAGES,
            risk_level,
            is_farmer,
            score=score,
            driver=driver
        )
