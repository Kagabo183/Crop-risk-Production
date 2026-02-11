"""
Disease Image Classifier using CNN
Pre-trained on PlantVillage + Mendeley dataset for plant disease detection

Supported: 30 plant species, 56 diseases, 80 classes total

Dataset: "Data for Identification of Plant Leaf Diseases Using a 9-layer Deep CNN"
Sources:
  [1] PlantVillage - Mendeley Data V1 (doi: 10.17632/tywbtsjrjv.1)
  [2] Mendeley A Database of Leaf Images (doi: 10.17632/hb74ynkjcn.1)
"""
import os
import logging
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import json

import numpy as np

logger = logging.getLogger(__name__)

# ============================================================
# All 80 classes from the dataset, grouped by plant
# Format: "FolderName" -> (plant, disease, is_healthy)
# ============================================================
CLASS_INFO = {
    # Alstonia Scholaris (2)
    "Alstonia Scholaris___diseased": ("Alstonia Scholaris", "General Disease", False),
    "Alstonia Scholaris___healthy": ("Alstonia Scholaris", "Healthy", True),
    # Apple (4)
    "Apple___Apple_scab": ("Apple", "Apple Scab", False),
    "Apple___Black_rot": ("Apple", "Black Rot", False),
    "Apple___Cedar_apple_rust": ("Apple", "Cedar Apple Rust", False),
    "Apple___healthy": ("Apple", "Healthy", True),
    # Arjun (2)
    "Arjun___diseased": ("Arjun", "General Disease", False),
    "Arjun___healthy": ("Arjun", "Healthy", True),
    # Bael (1)
    "Bael___diseased": ("Bael", "General Disease", False),
    # Basil (1)
    "Basil___healthy": ("Basil", "Healthy", True),
    # Blueberry (1)
    "Blueberry___healthy": ("Blueberry", "Healthy", True),
    # Cherry (2)
    "Cherry_(including_sour)___Powdery_mildew": ("Cherry", "Powdery Mildew", False),
    "Cherry_(including_sour)___healthy": ("Cherry", "Healthy", True),
    # Chinar (2) - note trailing space in folder name
    "Chinar ___diseased": ("Chinar", "General Disease", False),
    "Chinar ___healthy": ("Chinar", "Healthy", True),
    # Coffee (3)
    "coffee___healthy": ("Coffee", "Healthy", True),
    "coffee___red_spider_mite": ("Coffee", "Red Spider Mite", False),
    "coffee___Rust": ("Coffee", "Coffee Rust", False),
    # Corn/Maize (4)
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": ("Corn (Maize)", "Gray Leaf Spot", False),
    "Corn_(maize)___Common_rust_": ("Corn (Maize)", "Common Rust", False),
    "Corn_(maize)___healthy": ("Corn (Maize)", "Healthy", True),
    "Corn_(maize)___Northern_Leaf_Blight": ("Corn (Maize)", "Northern Leaf Blight", False),
    # Cotton (5)
    "Cotton___Aphids": ("Cotton", "Aphids", False),
    "Cotton___Bacterial blight": ("Cotton", "Bacterial Blight", False),
    "Cotton___Healthy": ("Cotton", "Healthy", True),
    "Cotton___Powdery mildew": ("Cotton", "Powdery Mildew", False),
    "Cotton___Target spot": ("Cotton", "Target Spot", False),
    # Guava (2)
    "Gauva___diseased": ("Guava", "General Disease", False),
    "Gauva___healthy": ("Guava", "Healthy", True),
    # Grape (4)
    "Grape___Black_rot": ("Grape", "Black Rot", False),
    "Grape___Esca_(Black_Measles)": ("Grape", "Esca (Black Measles)", False),
    "Grape___healthy": ("Grape", "Healthy", True),
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": ("Grape", "Leaf Blight", False),
    # Jamun (2)
    "Jamun___diseased": ("Jamun", "General Disease", False),
    "Jamun___healthy": ("Jamun", "Healthy", True),
    # Jatropha (2)
    "Jatropha___diseased": ("Jatropha", "General Disease", False),
    "Jatropha___healthy": ("Jatropha", "Healthy", True),
    # Lemon (2)
    "Lemon___diseased": ("Lemon", "General Disease", False),
    "Lemon___healthy": ("Lemon", "Healthy", True),
    # Mango (10)
    "Mango ___healthy": ("Mango", "Healthy", True),
    "Mango___Anthracnose": ("Mango", "Anthracnose", False),
    "Mango___Bacterial Canker": ("Mango", "Bacterial Canker", False),
    "Mango___Cutting Weevil": ("Mango", "Cutting Weevil", False),
    "Mango___Die Back": ("Mango", "Die Back", False),
    "Mango___diseased": ("Mango", "General Disease", False),
    "Mango___Gall Midge": ("Mango", "Gall Midge", False),
    "Mango___Healthy": ("Mango", "Healthy", True),
    "Mango___Powdery Mildew": ("Mango", "Powdery Mildew", False),
    "Mango___Sooty Mould": ("Mango", "Sooty Mould", False),
    # Orange (1)
    "Orange___Haunglongbing_(Citrus_greening)": ("Orange", "Citrus Greening (HLB)", False),
    # Peach (2)
    "Peach___Bacterial_spot": ("Peach", "Bacterial Spot", False),
    "Peach___healthy": ("Peach", "Healthy", True),
    # Pepper (2)
    "Pepper,_bell___Bacterial_spot": ("Pepper", "Bacterial Spot", False),
    "Pepper,_bell___healthy": ("Pepper", "Healthy", True),
    # Pomegranate (2)
    "Pomegranate___diseased": ("Pomegranate", "General Disease", False),
    "Pomegranate___healthy": ("Pomegranate", "Healthy", True),
    # Pongamia Pinnata (2)
    "PongamiaPinnata___diseased": ("Pongamia Pinnata", "General Disease", False),
    "PongamiaPinnata___healthy": ("Pongamia Pinnata", "Healthy", True),
    # Potato (3)
    "Potato___Early_blight": ("Potato", "Early Blight", False),
    "Potato___healthy": ("Potato", "Healthy", True),
    "Potato___Late_blight": ("Potato", "Late Blight", False),
    # Raspberry (1)
    "Raspberry___healthy": ("Raspberry", "Healthy", True),
    # Rice (4)
    "rice___BrownSpot": ("Rice", "Brown Spot", False),
    "rice___Healthy": ("Rice", "Healthy", True),
    "rice___Hispa": ("Rice", "Hispa", False),
    "rice___LeafBlast": ("Rice", "Leaf Blast", False),
    # Soybean (1)
    "Soybean___healthy": ("Soybean", "Healthy", True),
    # Squash (1)
    "Squash___Powdery_mildew": ("Squash", "Powdery Mildew", False),
    # Strawberry (2)
    "Strawberry___healthy": ("Strawberry", "Healthy", True),
    "Strawberry___Leaf_scorch": ("Strawberry", "Leaf Scorch", False),
    # Tomato (10)
    "Tomato___Bacterial_spot": ("Tomato", "Bacterial Spot", False),
    "Tomato___Early_blight": ("Tomato", "Early Blight", False),
    "Tomato___healthy": ("Tomato", "Healthy", True),
    "Tomato___Late_blight": ("Tomato", "Late Blight", False),
    "Tomato___Leaf_Mold": ("Tomato", "Leaf Mold", False),
    "Tomato___Septoria_leaf_spot": ("Tomato", "Septoria Leaf Spot", False),
    "Tomato___Spider_mites Two-spotted_spider_mite": ("Tomato", "Spider Mites", False),
    "Tomato___Target_Spot": ("Tomato", "Target Spot", False),
    "Tomato___Tomato_mosaic_virus": ("Tomato", "Mosaic Virus", False),
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus": ("Tomato", "Yellow Leaf Curl Virus", False),
}

# Build sorted class list (alphabetical by folder name = how ImageFolder loads them)
ALL_CLASSES = sorted(CLASS_INFO.keys())
CLASS_TO_IDX = {name: idx for idx, name in enumerate(ALL_CLASSES)}
IDX_TO_CLASS = {idx: name for name, idx in CLASS_TO_IDX.items()}
NUM_CLASSES = len(ALL_CLASSES)

# Build plant -> diseases lookup
PLANT_DISEASES: Dict[str, List[str]] = {}
for folder, (plant, disease, is_healthy) in CLASS_INFO.items():
    plant_lower = plant.lower()
    if plant_lower not in PLANT_DISEASES:
        PLANT_DISEASES[plant_lower] = []
    PLANT_DISEASES[plant_lower].append(disease)


# ============================================================
# Treatment recommendations by disease
# ============================================================
TREATMENT_RECOMMENDATIONS = {
    # Fungal diseases
    "Late Blight": {
        "fungicides": ["Mancozeb", "Chlorothalonil", "Copper-based fungicides"],
        "cultural": ["Remove infected plants", "Improve air circulation", "Avoid overhead irrigation"],
        "urgency": "high",
        "spread_risk": "very_high"
    },
    "Early Blight": {
        "fungicides": ["Chlorothalonil", "Mancozeb", "Azoxystrobin"],
        "cultural": ["Remove lower infected leaves", "Crop rotation", "Mulching"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Apple Scab": {
        "fungicides": ["Captan", "Mancozeb", "Myclobutanil"],
        "cultural": ["Remove fallen leaves", "Prune for air circulation", "Resistant varieties"],
        "urgency": "medium",
        "spread_risk": "high"
    },
    "Black Rot": {
        "fungicides": ["Captan", "Mancozeb", "Thiophanate-methyl"],
        "cultural": ["Remove mummified fruit", "Prune dead wood", "Clean pruning tools"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Cedar Apple Rust": {
        "fungicides": ["Myclobutanil", "Triadimefon", "Mancozeb"],
        "cultural": ["Remove nearby juniper hosts", "Resistant varieties", "Timely fungicide application"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Powdery Mildew": {
        "fungicides": ["Sulfur", "Neem oil", "Potassium bicarbonate"],
        "cultural": ["Improve air circulation", "Avoid overhead watering", "Remove infected leaves"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Coffee Rust": {
        "fungicides": ["Copper-based fungicides", "Triazole fungicides", "Strobilurin"],
        "cultural": ["Shade management", "Resistant varieties", "Proper spacing"],
        "urgency": "high",
        "spread_risk": "very_high"
    },
    "Gray Leaf Spot": {
        "fungicides": ["Strobilurin fungicides", "Triazole fungicides"],
        "cultural": ["Tillage to bury residue", "Crop rotation", "Resistant hybrids"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Common Rust": {
        "fungicides": ["Propiconazole", "Azoxystrobin", "Trifloxystrobin"],
        "cultural": ["Plant resistant varieties", "Timely planting", "Remove volunteer plants"],
        "urgency": "medium",
        "spread_risk": "high"
    },
    "Northern Leaf Blight": {
        "fungicides": ["Propiconazole", "Azoxystrobin"],
        "cultural": ["Resistant varieties", "Crop rotation", "Residue management"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Bacterial Spot": {
        "fungicides": ["Copper-based sprays", "Streptomycin (where permitted)"],
        "cultural": ["Use disease-free seed", "Avoid overhead irrigation", "Crop rotation"],
        "urgency": "high",
        "spread_risk": "high"
    },
    "Bacterial Blight": {
        "fungicides": ["Copper hydroxide", "Streptomycin"],
        "cultural": ["Use certified seed", "Remove crop debris", "Avoid working in wet fields"],
        "urgency": "high",
        "spread_risk": "high"
    },
    "Bacterial Canker": {
        "fungicides": ["Copper oxychloride", "Bordeaux mixture"],
        "cultural": ["Prune infected branches", "Sterilize tools", "Avoid injury to trees"],
        "urgency": "high",
        "spread_risk": "high"
    },
    "Leaf Mold": {
        "fungicides": ["Chlorothalonil", "Mancozeb"],
        "cultural": ["Improve ventilation", "Reduce humidity", "Prune lower leaves"],
        "urgency": "low",
        "spread_risk": "low"
    },
    "Septoria Leaf Spot": {
        "fungicides": ["Chlorothalonil", "Mancozeb", "Copper fungicides"],
        "cultural": ["Remove infected debris", "Avoid working in wet fields", "Stake plants"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Spider Mites": {
        "fungicides": ["Abamectin", "Bifenthrin", "Neem oil"],
        "cultural": ["Increase humidity", "Remove heavily infested leaves", "Introduce predatory mites"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Red Spider Mite": {
        "fungicides": ["Dicofol", "Wettable sulfur", "Neem oil"],
        "cultural": ["Maintain shade trees", "Water management", "Biological control"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Target Spot": {
        "fungicides": ["Chlorothalonil", "Azoxystrobin"],
        "cultural": ["Remove infected debris", "Improve air circulation", "Avoid wetting leaves"],
        "urgency": "low",
        "spread_risk": "low"
    },
    "Yellow Leaf Curl Virus": {
        "fungicides": ["Control whitefly vectors with insecticides"],
        "cultural": ["Remove infected plants", "Control whiteflies", "Use resistant varieties"],
        "urgency": "high",
        "spread_risk": "very_high"
    },
    "Mosaic Virus": {
        "fungicides": ["No chemical control available"],
        "cultural": ["Remove infected plants", "Control aphids", "Use virus-free seeds"],
        "urgency": "high",
        "spread_risk": "high"
    },
    "Citrus Greening (HLB)": {
        "fungicides": ["Control psyllid vectors with insecticides"],
        "cultural": ["Remove infected trees", "Control Asian citrus psyllid", "Use certified nursery stock"],
        "urgency": "critical",
        "spread_risk": "very_high"
    },
    "Anthracnose": {
        "fungicides": ["Copper-based fungicides", "Mancozeb", "Carbendazim"],
        "cultural": ["Prune dead branches", "Remove fallen fruits", "Improve drainage"],
        "urgency": "high",
        "spread_risk": "high"
    },
    "Die Back": {
        "fungicides": ["Copper oxychloride", "Carbendazim"],
        "cultural": ["Prune affected branches", "Apply wound dressing", "Improve tree vigor"],
        "urgency": "high",
        "spread_risk": "medium"
    },
    "Sooty Mould": {
        "fungicides": ["Control sap-sucking insects first", "Neem oil"],
        "cultural": ["Control mealybugs/aphids", "Wash leaves", "Improve air circulation"],
        "urgency": "low",
        "spread_risk": "low"
    },
    "Gall Midge": {
        "fungicides": ["Imidacloprid", "Lambda-cyhalothrin"],
        "cultural": ["Collect and destroy fallen buds", "Deep ploughing", "Timely spraying at bud stage"],
        "urgency": "high",
        "spread_risk": "medium"
    },
    "Cutting Weevil": {
        "fungicides": ["Carbaryl", "Quinalphos"],
        "cultural": ["Collect and destroy affected parts", "Clean cultivation", "Biological control"],
        "urgency": "medium",
        "spread_risk": "low"
    },
    "Aphids": {
        "fungicides": ["Imidacloprid", "Thiamethoxam", "Neem oil"],
        "cultural": ["Encourage natural predators", "Spray water to dislodge", "Remove weeds"],
        "urgency": "medium",
        "spread_risk": "high"
    },
    "Esca (Black Measles)": {
        "fungicides": ["No effective chemical control"],
        "cultural": ["Prune infected wood", "Protect pruning wounds", "Remove severely affected vines"],
        "urgency": "high",
        "spread_risk": "medium"
    },
    "Leaf Blight": {
        "fungicides": ["Mancozeb", "Copper-based fungicides"],
        "cultural": ["Remove infected leaves", "Improve air circulation", "Avoid overhead watering"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Leaf Scorch": {
        "fungicides": ["Captan", "Copper fungicides"],
        "cultural": ["Remove infected leaves", "Renovate beds after harvest", "Proper spacing"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Brown Spot": {
        "fungicides": ["Mancozeb", "Propiconazole", "Carbendazim"],
        "cultural": ["Use resistant varieties", "Balanced fertilization", "Proper water management"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Hispa": {
        "fungicides": ["Chlorpyrifos", "Quinalphos"],
        "cultural": ["Remove leaf tips with eggs", "Avoid excess nitrogen", "Encourage natural enemies"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Leaf Blast": {
        "fungicides": ["Tricyclazole", "Isoprothiolane", "Carbendazim"],
        "cultural": ["Use resistant varieties", "Balanced nitrogen", "Proper water management"],
        "urgency": "high",
        "spread_risk": "very_high"
    },
    "General Disease": {
        "fungicides": ["Broad-spectrum fungicide (consult local agronomist)"],
        "cultural": ["Remove infected parts", "Improve sanitation", "Consult plant pathologist"],
        "urgency": "medium",
        "spread_risk": "medium"
    },
    "Healthy": {
        "fungicides": [],
        "cultural": ["Continue monitoring", "Maintain good practices"],
        "urgency": "none",
        "spread_risk": "none"
    }
}


class DiseaseClassifier:
    """
    CNN-based plant disease classifier using transfer learning.
    Uses EfficientNet-B0 pre-trained on ImageNet, fine-tuned on
    PlantVillage + Mendeley dataset (80 classes, 30 plants, 56 diseases).
    """

    def __init__(self, crop_type: Optional[str] = None):
        """
        Args:
            crop_type: Optional filter for a specific crop (e.g. 'potato').
                       If None, classifies across all 80 classes.
        """
        self.crop_type = crop_type.lower() if crop_type else None
        self.model = None
        self.device = None
        self.transforms = None
        self.model_loaded = False

        # Use class mapping from dataset or saved mapping
        self.classes = IDX_TO_CLASS
        self.num_classes = NUM_CLASSES
        self.class_to_idx = CLASS_TO_IDX

        # Model paths
        self.model_dir = Path(os.environ.get('MODEL_DIR', '/app/data/models'))
        self.model_path = self.model_dir / "disease_classifier_80class.pth"
        self.class_map_path = self.model_dir / "disease_classifier_80class.json"

    def _setup_device(self):
        """Setup compute device (GPU/CPU)"""
        try:
            import torch
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            logger.info(f"Using device: {self.device}")
        except ImportError:
            logger.warning("PyTorch not installed, using CPU fallback mode")
            self.device = 'cpu'

    def _setup_transforms(self):
        """Setup image preprocessing transforms"""
        try:
            from torchvision import transforms
            self.transforms = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
            ])
        except ImportError:
            logger.warning("torchvision not installed")
            self.transforms = None

    def _create_model(self):
        """Create EfficientNet-B0 model architecture"""
        try:
            import torch.nn as nn
            from torchvision.models import efficientnet_b0, EfficientNet_B0_Weights

            model = efficientnet_b0(weights=EfficientNet_B0_Weights.DEFAULT)

            # Modify classifier for 80 classes
            num_features = model.classifier[1].in_features
            model.classifier = nn.Sequential(
                nn.Dropout(p=0.3, inplace=True),
                nn.Linear(num_features, self.num_classes)
            )

            return model
        except ImportError:
            logger.error("PyTorch/torchvision not installed")
            return None

    def load_model(self, model_path: Optional[str] = None) -> bool:
        """Load pre-trained model weights."""
        try:
            import torch

            self._setup_device()
            self._setup_transforms()

            path = Path(model_path) if model_path else self.model_path

            # Try to load saved class mapping
            class_map = self.class_map_path if not model_path else Path(model_path).with_suffix('.json')
            if class_map.exists():
                with open(class_map, 'r') as f:
                    saved = json.load(f)
                    if 'classes' in saved:
                        cls = saved['classes']
                        if isinstance(cls, list):
                            self.classes = {i: v for i, v in enumerate(cls)}
                        else:
                            self.classes = {int(k): v for k, v in cls.items()}
                        self.num_classes = len(self.classes)
                        self.class_to_idx = {v: k for k, v in self.classes.items()}

            if not path.exists():
                logger.warning(f"Model file not found at {path}, creating new model")
                self.model = self._create_model()
                if self.model:
                    self.model.to(self.device)
                    self.model.eval()
                    self.model_loaded = True
                    return True
                return False

            self.model = self._create_model()
            if self.model is None:
                return False

            state_dict = torch.load(path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state_dict)
            self.model.to(self.device)
            self.model.eval()

            self.model_loaded = True
            logger.info(f"Disease classifier loaded from {path} ({self.num_classes} classes)")
            return True

        except Exception as e:
            logger.error(f"Failed to load disease classifier: {e}")
            return False

    def preprocess_image(self, image_path: str) -> Optional[Any]:
        """Preprocess image for model input."""
        try:
            from PIL import Image
            import torch

            image = Image.open(image_path).convert('RGB')

            if self.transforms:
                image = self.transforms(image)
                image = image.unsqueeze(0)
                return image.to(self.device)

            return None

        except Exception as e:
            logger.error(f"Failed to preprocess image: {e}")
            return None

    def predict(self, image_path: str) -> Dict[str, Any]:
        """
        Classify plant disease from image.

        Returns:
            Dictionary with disease, confidence, plant, treatment, etc.
        """
        if not self.model_loaded:
            if not self.load_model():
                return self._fallback_prediction()

        try:
            import torch
            import torch.nn.functional as F

            image = self.preprocess_image(image_path)
            if image is None:
                return self._fallback_prediction()

            with torch.no_grad():
                outputs = self.model(image)
                # Temperature scaling to reduce overconfidence
                # (T>1 softens probabilities, T=1 is standard softmax)
                temperature = 2.5
                probabilities = F.softmax(outputs / temperature, dim=1)

                # Get top-5 predictions
                top5_probs, top5_indices = torch.topk(probabilities, min(5, self.num_classes), dim=1)

            # Best prediction
            predicted_idx = top5_indices[0][0].item()
            confidence_score = top5_probs[0][0].item()

            # Get class folder name
            class_folder = self.classes.get(predicted_idx, 'Unknown')

            # Get plant and disease info
            info = CLASS_INFO.get(class_folder, ("Unknown", "Unknown", False))
            plant_name, disease_name, is_healthy = info

            # If crop_type filter is set, find best match for that crop
            if self.crop_type:
                crop_match = self._find_crop_match(probabilities[0], self.crop_type)
                if crop_match:
                    predicted_idx, confidence_score, class_folder, plant_name, disease_name, is_healthy = crop_match

            # Top-5 results
            top5_results = []
            for i in range(min(5, self.num_classes)):
                idx = top5_indices[0][i].item()
                prob = top5_probs[0][i].item()
                folder = self.classes.get(idx, 'Unknown')
                cls_info = CLASS_INFO.get(folder, ("Unknown", "Unknown", False))
                top5_results.append({
                    'class': folder,
                    'plant': cls_info[0],
                    'disease': cls_info[1],
                    'confidence': round(prob, 4)
                })

            # Get treatment
            treatment = TREATMENT_RECOMMENDATIONS.get(
                disease_name,
                TREATMENT_RECOMMENDATIONS.get('General Disease', TREATMENT_RECOMMENDATIONS['Healthy'])
            )

            return {
                'plant': plant_name,
                'disease': disease_name,
                'confidence': round(confidence_score, 4),
                'is_healthy': is_healthy,
                'class_name': class_folder,
                'top5': top5_results,
                'treatment': treatment,
                'crop_type': plant_name.lower(),
                'model_version': '2.0.0'
            }

        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return self._fallback_prediction()

    def _find_crop_match(self, probs, crop_type: str):
        """Find the best prediction matching a specific crop type."""
        crop_type = crop_type.lower()
        # Map common names to folder prefixes
        crop_aliases = {
            'potato': 'potato', 'tomato': 'tomato', 'maize': 'corn_(maize)',
            'corn': 'corn_(maize)', 'rice': 'rice', 'coffee': 'coffee',
            'cotton': 'cotton', 'mango': 'mango', 'apple': 'apple',
            'grape': 'grape', 'cherry': 'cherry', 'peach': 'peach',
            'pepper': 'pepper', 'strawberry': 'strawberry', 'orange': 'orange',
            'soybean': 'soybean', 'blueberry': 'blueberry', 'raspberry': 'raspberry',
            'squash': 'squash', 'lemon': 'lemon', 'guava': 'gauva',
            'pomegranate': 'pomegranate',
        }
        prefix = crop_aliases.get(crop_type, crop_type)

        best_idx = None
        best_prob = 0.0

        for idx, folder in self.classes.items():
            if folder.lower().startswith(prefix):
                prob = probs[idx].item()
                if prob > best_prob:
                    best_prob = prob
                    best_idx = idx

        if best_idx is not None:
            folder = self.classes[best_idx]
            info = CLASS_INFO.get(folder, ("Unknown", "Unknown", False))
            return (best_idx, best_prob, folder, info[0], info[1], info[2])

        return None

    def predict_batch(self, image_paths: List[str]) -> List[Dict[str, Any]]:
        """Classify multiple images."""
        results = []
        for path in image_paths:
            result = self.predict(path)
            result['image_path'] = path
            results.append(result)
        return results

    def _fallback_prediction(self) -> Dict[str, Any]:
        """Return fallback prediction when model is unavailable"""
        return {
            'plant': 'Unknown',
            'disease': 'Unknown',
            'confidence': 0.0,
            'is_healthy': None,
            'class_name': '',
            'top5': [],
            'treatment': TREATMENT_RECOMMENDATIONS['Healthy'],
            'crop_type': self.crop_type or 'unknown',
            'model_version': 'fallback',
            'error': 'Model not available - train first with: python -m app.scripts.train_disease_model'
        }

    def train(self, train_data_dir: str, val_data_dir: str,
              epochs: int = 10, batch_size: int = 32,
              learning_rate: float = 0.001) -> Dict[str, Any]:
        """
        Train/fine-tune the disease classifier on the full 80-class dataset.

        Args:
            train_data_dir: Directory with training images organized by class folders
            val_data_dir: Directory with validation images organized by class folders
            epochs: Number of training epochs
            batch_size: Batch size for training
            learning_rate: Learning rate for optimizer

        Returns:
            Training metrics and history
        """
        try:
            import torch
            import torch.nn as nn
            import torch.optim as optim
            from torch.utils.data import DataLoader
            from torchvision import datasets, transforms

            self._setup_device()

            # Data augmentation for training
            train_transforms = transforms.Compose([
                transforms.RandomResizedCrop(224),
                transforms.RandomHorizontalFlip(),
                transforms.RandomVerticalFlip(),
                transforms.RandomRotation(20),
                transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])

            val_transforms = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])

            # Load datasets
            logger.info(f"Loading training data from {train_data_dir}")
            train_dataset = datasets.ImageFolder(train_data_dir, transform=train_transforms)
            val_dataset = datasets.ImageFolder(val_data_dir, transform=val_transforms)

            logger.info(f"Training samples: {len(train_dataset)}")
            logger.info(f"Validation samples: {len(val_dataset)}")
            logger.info(f"Classes found: {len(train_dataset.classes)}")

            # Use num_workers=0 on Windows to avoid multiprocessing issues
            num_workers = 0 if os.name == 'nt' else 4
            train_loader = DataLoader(
                train_dataset, batch_size=batch_size, shuffle=True,
                num_workers=num_workers, pin_memory=True
            )
            val_loader = DataLoader(
                val_dataset, batch_size=batch_size, shuffle=False,
                num_workers=num_workers, pin_memory=True
            )

            # Update class mapping from actual dataset folders
            self.classes = {i: name for i, name in enumerate(train_dataset.classes)}
            self.class_to_idx = train_dataset.class_to_idx
            self.num_classes = len(self.classes)

            logger.info(f"Training with {self.num_classes} classes")

            # Create model
            self.model = self._create_model()
            self.model.to(self.device)

            # Loss and optimizer
            criterion = nn.CrossEntropyLoss()
            optimizer = optim.Adam(self.model.parameters(), lr=learning_rate)
            scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)

            # Training history
            history = {'train_loss': [], 'train_acc': [], 'val_loss': [], 'val_acc': []}
            best_val_acc = 0.0

            for epoch in range(epochs):
                # Training phase
                self.model.train()
                train_loss = 0.0
                train_correct = 0
                train_total = 0

                for batch_idx, (images, labels) in enumerate(train_loader):
                    images, labels = images.to(self.device), labels.to(self.device)

                    optimizer.zero_grad()
                    outputs = self.model(images)
                    loss = criterion(outputs, labels)
                    loss.backward()
                    optimizer.step()

                    train_loss += loss.item()
                    _, predicted = torch.max(outputs, 1)
                    train_total += labels.size(0)
                    train_correct += (predicted == labels).sum().item()

                    # Log progress every 100 batches
                    if (batch_idx + 1) % 100 == 0:
                        logger.info(f"  Epoch {epoch+1} - Batch {batch_idx+1}/{len(train_loader)} "
                                    f"- Loss: {loss.item():.4f}")

                train_acc = train_correct / train_total
                train_loss = train_loss / len(train_loader)

                # Validation phase
                self.model.eval()
                val_loss = 0.0
                val_correct = 0
                val_total = 0

                with torch.no_grad():
                    for images, labels in val_loader:
                        images, labels = images.to(self.device), labels.to(self.device)
                        outputs = self.model(images)
                        loss = criterion(outputs, labels)

                        val_loss += loss.item()
                        _, predicted = torch.max(outputs, 1)
                        val_total += labels.size(0)
                        val_correct += (predicted == labels).sum().item()

                val_acc = val_correct / val_total
                val_loss = val_loss / len(val_loader)

                # Update history
                history['train_loss'].append(train_loss)
                history['train_acc'].append(train_acc)
                history['val_loss'].append(val_loss)
                history['val_acc'].append(val_acc)

                # Save best model
                if val_acc > best_val_acc:
                    best_val_acc = val_acc
                    self.save_model()
                    logger.info(f"  New best model saved (val_acc: {val_acc:.4f})")

                scheduler.step()

                logger.info(f"Epoch {epoch+1}/{epochs} - "
                           f"Train Loss: {train_loss:.4f}, Train Acc: {train_acc:.4f}, "
                           f"Val Loss: {val_loss:.4f}, Val Acc: {val_acc:.4f}")

            self.model_loaded = True

            return {
                'final_train_acc': train_acc,
                'final_val_acc': val_acc,
                'best_val_acc': best_val_acc,
                'epochs_trained': epochs,
                'num_classes': self.num_classes,
                'classes': self.classes,
                'history': history
            }

        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {'error': str(e)}

    def save_model(self, path: Optional[str] = None) -> str:
        """Save model weights and class mapping to disk"""
        try:
            import torch

            save_path = Path(path) if path else self.model_path
            save_path.parent.mkdir(parents=True, exist_ok=True)

            torch.save(self.model.state_dict(), save_path)
            logger.info(f"Model saved to {save_path}")

            # Save class mapping
            class_path = save_path.with_suffix('.json')
            with open(class_path, 'w') as f:
                json.dump({
                    'classes': self.classes,
                    'class_to_idx': self.class_to_idx,
                    'num_classes': self.num_classes,
                    'version': '2.0.0',
                    'dataset': 'PlantVillage+Mendeley (80 classes)'
                }, f, indent=2)

            return str(save_path)

        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return ""

    def get_supported_diseases(self) -> Dict[str, List[str]]:
        """Get list of supported diseases grouped by plant"""
        return {
            plant: sorted(set(diseases))
            for plant, diseases in PLANT_DISEASES.items()
        }

    def get_supported_plants(self) -> List[str]:
        """Get list of all supported plant species"""
        return sorted(PLANT_DISEASES.keys())
