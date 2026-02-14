"""
Per-crop disease classifier using EfficientNet-B0.

Each crop has its own model with fewer output classes for higher accuracy.
Falls back to the general 80-class DiseaseClassifier when no
crop-specific model weights are available.

Supported crops: tomato (10), coffee (3), pepper (2), potato (3), cassava (5)
"""
import os
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path
import json

import numpy as np

from app.ml.crop_disease_config import CropDiseaseConfig
from app.ml.disease_classifier import CLASS_INFO, TREATMENT_RECOMMENDATIONS, apply_jet_colormap

logger = logging.getLogger(__name__)


class CropDiseaseClassifier:
    """
    Per-crop CNN disease classifier using EfficientNet-B0.

    Unlike DiseaseClassifier (80 classes across 30 plants), this loads
    a crop-specific model with only that crop's disease classes.
    """

    def __init__(self, config: CropDiseaseConfig):
        self.config = config
        self.model = None
        self.device = None
        self.transforms = None
        self.model_loaded = False

        # Build class mappings — sorted alphabetically to match ImageFolder
        sorted_classes = sorted(config.class_names)
        self.classes = {i: name for i, name in enumerate(sorted_classes)}
        self.class_to_idx = {name: i for i, name in enumerate(sorted_classes)}
        self.num_classes = config.num_classes

        # Model paths
        self.model_dir = Path(os.environ.get('MODEL_DIR', '/app/data/models'))
        self.model_path = self.model_dir / config.model_filename
        self.class_map_path = self.model_dir / config.class_map_filename

    def _setup_device(self):
        """Setup compute device (GPU/CPU)."""
        try:
            import torch
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            logger.info(f"[{self.config.crop_key}] Using device: {self.device}")
        except ImportError:
            logger.warning("PyTorch not installed, using CPU fallback mode")
            self.device = 'cpu'

    def _setup_transforms(self):
        """Setup image preprocessing transforms — must match training transforms."""
        try:
            from torchvision import transforms
            # MUST include ImageNet normalization to match training pipeline
            self.transforms = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])
        except ImportError:
            logger.warning("torchvision not installed")
            self.transforms = None

    def _create_model(self):
        """Create EfficientNet-B0 with crop-specific num_classes."""
        try:
            import torch.nn as nn
            from torchvision.models import efficientnet_b0, EfficientNet_B0_Weights

            model = efficientnet_b0(weights=EfficientNet_B0_Weights.DEFAULT)
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
        """Load crop-specific model weights."""
        try:
            import torch

            self._setup_device()
            self._setup_transforms()

            path = Path(model_path) if model_path else self.model_path

            # Load saved class mapping if it exists
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
                        logger.info(f"[{self.config.crop_key}] Loaded {self.num_classes} classes from {class_map.name}")

            if not path.exists():
                logger.warning(f"[{self.config.crop_key}] Model not found at {path}")
                return False

            self.model = self._create_model()
            if self.model is None:
                return False

            state_dict = torch.load(path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state_dict)
            self.model.to(self.device)
            self.model.eval()

            self.model_loaded = True
            logger.info(f"[{self.config.crop_key}] Loaded {self.num_classes}-class model from {path.name}")
            return True

        except Exception as e:
            logger.error(f"[{self.config.crop_key}] Failed to load model: {e}")
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
        Classify plant disease from image using crop-specific model.

        All classes belong to this crop — no cross-crop confusion.
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
                probabilities = F.softmax(outputs, dim=1)

                top_k = min(5, self.num_classes)
                top5_probs, top5_indices = torch.topk(probabilities, top_k, dim=1)

            predicted_idx = top5_indices[0][0].item()
            confidence_score = top5_probs[0][0].item()

            class_folder = self.classes.get(predicted_idx, 'Unknown')
            info = CLASS_INFO.get(class_folder, ("Unknown", "Unknown", False))
            plant_name, disease_name, is_healthy = info

            # Top results
            top5_results = []
            for i in range(top_k):
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
                'crop_type': self.config.crop_key,
                'model_version': f'{self.config.crop_key}_v1.0',
            }

        except Exception as e:
            logger.error(f"[{self.config.crop_key}] Prediction failed: {e}")
            return self._fallback_prediction()

    def predict_with_gradcam(self, image_path: str) -> Dict[str, Any]:
        """Classify disease AND generate Grad-CAM heatmap."""
        result = self.predict(image_path)
        if not self.model_loaded or self.model is None:
            return result

        try:
            import torch
            from PIL import Image, ImageFilter
            import io
            import base64

            orig = Image.open(image_path).convert('RGB')
            inp = self.transforms(orig).unsqueeze(0).to(self.device)

            target_layer = self.model.features[-1]
            activations = []
            gradients = []

            def fwd_hook(module, input, output):
                activations.append(output.detach())

            def bwd_hook(module, grad_in, grad_out):
                gradients.append(grad_out[0].detach())

            fh = target_layer.register_forward_hook(fwd_hook)
            bh = target_layer.register_full_backward_hook(bwd_hook)

            self.model.eval()
            output = self.model(inp)
            pred_idx = output.argmax(dim=1).item()

            self.model.zero_grad()
            output[0, pred_idx].backward()

            fh.remove()
            bh.remove()

            grads = gradients[0][0]
            acts = activations[0][0]
            weights = grads.mean(dim=(1, 2))
            cam = torch.relu((weights[:, None, None] * acts).sum(dim=0))

            cam = cam - cam.min()
            if cam.max() > 0:
                cam = cam / cam.max()
            cam_np = cam.cpu().numpy()

            # Upscale with LANCZOS for smoother result (7x7 -> original size)
            cam_pil = Image.fromarray((cam_np * 255).astype(np.uint8))
            cam_resized = cam_pil.resize(orig.size, Image.LANCZOS)

            # Gaussian blur to smooth the blocky 7x7 activation map
            blur_radius = max(min(orig.size) // 25, 5)
            cam_resized = cam_resized.filter(ImageFilter.GaussianBlur(radius=blur_radius))

            cam_arr = np.array(cam_resized).astype(np.float32) / 255.0

            # Re-normalize after blur
            if cam_arr.max() > 0:
                cam_arr = (cam_arr - cam_arr.min()) / (cam_arr.max() - cam_arr.min())

            # Threshold: suppress low activations (noise) below 15% of max
            cam_arr[cam_arr < 0.15] = 0.0
            if cam_arr.max() > 0:
                cam_arr = cam_arr / cam_arr.max()

            # Apply standard JET colormap (blue=low -> red=high)
            heatmap = apply_jet_colormap(cam_arr)

            # Activation-weighted alpha: stronger overlay where disease is detected,
            # original image preserved where activation is zero
            alpha = cam_arr[..., np.newaxis] * 0.6
            orig_np = np.array(orig).astype(np.float32)
            overlay = orig_np * (1.0 - alpha) + heatmap.astype(np.float32) * alpha
            overlay = np.clip(overlay, 0, 255).astype(np.uint8)

            overlay_img = Image.fromarray(overlay)
            buf = io.BytesIO()
            overlay_img.save(buf, format='PNG')
            b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

            result['gradcam_base64'] = b64

        except Exception as e:
            logger.warning(f"[{self.config.crop_key}] Grad-CAM failed (prediction still valid): {e}")
            result['gradcam_base64'] = None

        return result

    def train(self, train_data_dir: str, val_data_dir: str,
              epochs: int = 15, batch_size: int = 32,
              learning_rate: float = 0.001) -> Dict[str, Any]:
        """
        Train crop-specific model on data directory.

        Data dir should contain only this crop's class folders:
            train_data_dir/
                Tomato___Bacterial_spot/
                Tomato___Early_blight/
                ...
        """
        try:
            import torch
            import torch.nn as nn
            import torch.optim as optim
            from torch.utils.data import DataLoader
            from torchvision import datasets, transforms

            self._setup_device()

            # Aggressive augmentation to simulate field conditions:
            # - GaussianBlur: simulates camera blur / shaky hands
            # - Strong ColorJitter: simulates outdoor lighting variation
            # - RandomPerspective: simulates different shooting angles
            # - RandomRotation(30): leaves photographed at various angles
            train_transforms = transforms.Compose([
                transforms.RandomResizedCrop(224, scale=(0.7, 1.0)),
                transforms.RandomHorizontalFlip(),
                transforms.RandomVerticalFlip(),
                transforms.RandomRotation(30),
                transforms.ColorJitter(brightness=0.4, contrast=0.4, saturation=0.3, hue=0.1),
                transforms.RandomPerspective(distortion_scale=0.2, p=0.3),
                transforms.GaussianBlur(kernel_size=3, sigma=(0.1, 2.0)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])

            val_transforms = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])

            logger.info(f"[{self.config.crop_key}] Loading training data from {train_data_dir}")
            train_dataset = datasets.ImageFolder(train_data_dir, transform=train_transforms)
            val_dataset = datasets.ImageFolder(val_data_dir, transform=val_transforms)

            logger.info(f"[{self.config.crop_key}] Training: {len(train_dataset)} samples, "
                        f"Validation: {len(val_dataset)} samples, "
                        f"Classes: {len(train_dataset.classes)}")

            num_workers = 0 if os.name == 'nt' else 4
            train_loader = DataLoader(
                train_dataset, batch_size=batch_size, shuffle=True,
                num_workers=num_workers, pin_memory=True
            )
            val_loader = DataLoader(
                val_dataset, batch_size=batch_size, shuffle=False,
                num_workers=num_workers, pin_memory=True
            )

            # Update class mapping from actual dataset
            self.classes = {i: name for i, name in enumerate(train_dataset.classes)}
            self.class_to_idx = train_dataset.class_to_idx
            self.num_classes = len(self.classes)

            self.model = self._create_model()
            self.model.to(self.device)

            criterion = nn.CrossEntropyLoss()
            optimizer = optim.Adam(self.model.parameters(), lr=learning_rate)
            scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)

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

                    if (batch_idx + 1) % 100 == 0:
                        logger.info(f"  [{self.config.crop_key}] Epoch {epoch+1} - "
                                    f"Batch {batch_idx+1}/{len(train_loader)} - "
                                    f"Loss: {loss.item():.4f}")

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

                history['train_loss'].append(train_loss)
                history['train_acc'].append(train_acc)
                history['val_loss'].append(val_loss)
                history['val_acc'].append(val_acc)

                if val_acc > best_val_acc:
                    best_val_acc = val_acc
                    self.save_model()
                    logger.info(f"  [{self.config.crop_key}] New best model saved (val_acc: {val_acc:.4f})")

                scheduler.step()

                logger.info(f"[{self.config.crop_key}] Epoch {epoch+1}/{epochs} - "
                            f"Train Loss: {train_loss:.4f}, Train Acc: {train_acc:.4f}, "
                            f"Val Loss: {val_loss:.4f}, Val Acc: {val_acc:.4f}")

            self.model_loaded = True

            # Run full evaluation on validation set
            logger.info(f"[{self.config.crop_key}] Running evaluation on validation set...")
            eval_metrics = self.evaluate(val_data_dir, batch_size=batch_size)

            result = {
                'crop': self.config.crop_key,
                'final_train_acc': train_acc,
                'final_val_acc': val_acc,
                'best_val_acc': best_val_acc,
                'epochs_trained': epochs,
                'num_classes': self.num_classes,
                'classes': self.classes,
                'history': history,
            }

            if 'error' not in eval_metrics:
                result['evaluation'] = eval_metrics

            return result

        except Exception as e:
            logger.error(f"[{self.config.crop_key}] Training failed: {e}")
            return {'error': str(e)}

    def evaluate(self, data_dir: str, batch_size: int = 32) -> Dict[str, Any]:
        """
        Evaluate model on a dataset and return full metrics.

        Returns:
            Dict with accuracy, precision, recall, f1 (per-class and overall),
            confusion matrix, and classification report.
        """
        if not self.model_loaded:
            if not self.load_model():
                return {'error': 'Model not loaded'}

        try:
            import torch
            from torch.utils.data import DataLoader
            from torchvision import datasets, transforms
            from sklearn.metrics import (
                accuracy_score, precision_score, recall_score, f1_score,
                confusion_matrix, classification_report
            )

            eval_transforms = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])

            dataset = datasets.ImageFolder(data_dir, transform=eval_transforms)
            num_workers = 0 if os.name == 'nt' else 4
            loader = DataLoader(dataset, batch_size=batch_size, shuffle=False,
                                num_workers=num_workers, pin_memory=True)

            class_names = [self.classes.get(i, f"class_{i}") for i in range(self.num_classes)]
            # Use disease display names for readability
            display_names = []
            for name in class_names:
                info = CLASS_INFO.get(name, (name, name, False))
                display_names.append(info[1])  # disease name

            all_preds = []
            all_labels = []
            all_probs = []

            self.model.eval()
            with torch.no_grad():
                for images, labels in loader:
                    images = images.to(self.device)
                    outputs = self.model(images)
                    probs = torch.nn.functional.softmax(outputs, dim=1)
                    _, predicted = torch.max(outputs, 1)

                    all_preds.extend(predicted.cpu().numpy())
                    all_labels.extend(labels.numpy())
                    all_probs.extend(probs.cpu().numpy())

            all_preds = np.array(all_preds)
            all_labels = np.array(all_labels)
            all_probs = np.array(all_probs)

            # Overall metrics
            accuracy = accuracy_score(all_labels, all_preds)
            precision_weighted = precision_score(all_labels, all_preds, average='weighted', zero_division=0)
            recall_weighted = recall_score(all_labels, all_preds, average='weighted', zero_division=0)
            f1_weighted = f1_score(all_labels, all_preds, average='weighted', zero_division=0)
            precision_macro = precision_score(all_labels, all_preds, average='macro', zero_division=0)
            recall_macro = recall_score(all_labels, all_preds, average='macro', zero_division=0)
            f1_macro = f1_score(all_labels, all_preds, average='macro', zero_division=0)

            # Per-class metrics
            precision_per_class = precision_score(all_labels, all_preds, average=None, zero_division=0)
            recall_per_class = recall_score(all_labels, all_preds, average=None, zero_division=0)
            f1_per_class = f1_score(all_labels, all_preds, average=None, zero_division=0)

            # Confusion matrix
            cm = confusion_matrix(all_labels, all_preds)

            # Classification report (text)
            report = classification_report(
                all_labels, all_preds,
                target_names=display_names,
                zero_division=0
            )

            # Per-class detail
            per_class = {}
            for i, name in enumerate(display_names):
                per_class[name] = {
                    'precision': round(float(precision_per_class[i]), 4),
                    'recall': round(float(recall_per_class[i]), 4),
                    'f1_score': round(float(f1_per_class[i]), 4),
                    'support': int(np.sum(all_labels == i)),
                }

            logger.info(f"[{self.config.crop_key}] Evaluation Results:")
            logger.info(f"\n{report}")

            return {
                'crop': self.config.crop_key,
                'total_samples': len(all_labels),
                'accuracy': round(accuracy, 4),
                'precision_weighted': round(precision_weighted, 4),
                'recall_weighted': round(recall_weighted, 4),
                'f1_weighted': round(f1_weighted, 4),
                'precision_macro': round(precision_macro, 4),
                'recall_macro': round(recall_macro, 4),
                'f1_macro': round(f1_macro, 4),
                'per_class': per_class,
                'confusion_matrix': cm.tolist(),
                'class_names': display_names,
                'classification_report': report,
            }

        except Exception as e:
            logger.error(f"[{self.config.crop_key}] Evaluation failed: {e}")
            return {'error': str(e)}

    def save_model(self, path: Optional[str] = None) -> str:
        """Save crop-specific model weights and class mapping."""
        try:
            import torch

            save_path = Path(path) if path else self.model_path
            save_path.parent.mkdir(parents=True, exist_ok=True)

            torch.save(self.model.state_dict(), save_path)
            logger.info(f"[{self.config.crop_key}] Model saved to {save_path}")

            class_path = save_path.with_suffix('.json')
            with open(class_path, 'w') as f:
                json.dump({
                    'classes': self.classes,
                    'class_to_idx': self.class_to_idx,
                    'num_classes': self.num_classes,
                    'crop_key': self.config.crop_key,
                    'display_name': self.config.display_name,
                    'version': f'{self.config.crop_key}_v1.0',
                }, f, indent=2)

            return str(save_path)

        except Exception as e:
            logger.error(f"[{self.config.crop_key}] Failed to save model: {e}")
            return ""

    def _fallback_prediction(self) -> Dict[str, Any]:
        """Return fallback when model is unavailable."""
        return {
            'plant': self.config.display_name,
            'disease': 'Unknown',
            'confidence': 0.0,
            'is_healthy': None,
            'class_name': '',
            'top5': [],
            'treatment': TREATMENT_RECOMMENDATIONS['Healthy'],
            'crop_type': self.config.crop_key,
            'model_version': 'fallback',
            'error': f'Per-crop model for {self.config.crop_key} not found. '
                     f'Train with: python -m app.scripts.train_crop_model --crop {self.config.crop_key}'
        }
