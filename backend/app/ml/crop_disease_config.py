"""
Per-crop disease classification configurations.

Defines crop-specific class mappings for Rwanda's priority crops.
Each crop gets its own model with fewer classes for higher accuracy.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class CropDiseaseConfig:
    """Configuration for a single crop's disease classifier."""
    crop_key: str
    display_name: str
    num_classes: int
    class_names: List[str]          # Exact folder names from the dataset
    model_filename: str             # e.g., "disease_tomato.pth"
    class_map_filename: str         # e.g., "disease_tomato.json"
    rwanda_priority: bool = True
    description: str = ""


# ============================================================
# Rwanda priority crops — 4 separate expert models
# class_names must match exact folder names from CLASS_INFO
# in disease_classifier.py (used by torchvision.ImageFolder)
# ============================================================

CROP_DISEASE_CONFIGS: Dict[str, CropDiseaseConfig] = {
    "tomato": CropDiseaseConfig(
        crop_key="tomato",
        display_name="Tomato",
        num_classes=10,
        class_names=[
            "Tomato___Bacterial_spot",
            "Tomato___Early_blight",
            "Tomato___healthy",
            "Tomato___Late_blight",
            "Tomato___Leaf_Mold",
            "Tomato___Septoria_leaf_spot",
            "Tomato___Spider_mites Two-spotted_spider_mite",
            "Tomato___Target_Spot",
            "Tomato___Tomato_mosaic_virus",
            "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
        ],
        model_filename="disease_tomato.pth",
        class_map_filename="disease_tomato.json",
        description="Tomato diseases common in Rwanda",
    ),
    "coffee": CropDiseaseConfig(
        crop_key="coffee",
        display_name="Coffee",
        num_classes=3,
        class_names=[
            "coffee___healthy",
            "coffee___red_spider_mite",
            "coffee___Rust",
        ],
        model_filename="disease_coffee.pth",
        class_map_filename="disease_coffee.json",
        description="Coffee diseases — Rwanda's primary export crop",
    ),
    "pepper": CropDiseaseConfig(
        crop_key="pepper",
        display_name="Chilli / Pepper",
        num_classes=2,
        class_names=[
            "Pepper,_bell___Bacterial_spot",
            "Pepper,_bell___healthy",
        ],
        model_filename="disease_pepper.pth",
        class_map_filename="disease_pepper.json",
        description="Chilli and pepper diseases",
    ),
    "potato": CropDiseaseConfig(
        crop_key="potato",
        display_name="Irish Potato (Urusenda)",
        num_classes=3,
        class_names=[
            "Potato___Early_blight",
            "Potato___healthy",
            "Potato___Late_blight",
        ],
        model_filename="disease_potato.pth",
        class_map_filename="disease_potato.json",
        description="Irish potato (urusenda) diseases common in Rwanda",
    ),
    "cassava": CropDiseaseConfig(
        crop_key="cassava",
        display_name="Cassava (Imyumbati)",
        num_classes=5,
        class_names=[
            "Cassava___bacterial_blight",
            "Cassava___brown_streak_disease",
            "Cassava___green_mottle",
            "Cassava___healthy",
            "Cassava___mosaic_disease",
        ],
        model_filename="disease_cassava.pth",
        class_map_filename="disease_cassava.json",
        description="Cassava diseases — staple crop in Rwanda",
    ),
}

# Aliases for user-friendly crop names
CROP_ALIASES: Dict[str, str] = {
    "chilli": "pepper",
    "chili": "pepper",
    "bell_pepper": "pepper",
    "urusenda": "potato",
    "irish_potato": "potato",
    "imyumbati": "cassava",
    "manioc": "cassava",
}


def get_crop_config(crop_key: str) -> Optional[CropDiseaseConfig]:
    """Get config for a crop by key or alias."""
    key = crop_key.lower().strip()
    key = CROP_ALIASES.get(key, key)
    return CROP_DISEASE_CONFIGS.get(key)


def list_available_crops() -> List[str]:
    """List all crop keys with per-crop models."""
    return sorted(CROP_DISEASE_CONFIGS.keys())
