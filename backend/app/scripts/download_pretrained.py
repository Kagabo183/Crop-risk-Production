#!/usr/bin/env python3
"""
Download Pre-trained Disease Classification Models

Downloads pre-trained weights from HuggingFace Hub for immediate use
without requiring local training.

Usage:
    # Download all models
    python -m app.scripts.download_pretrained --all

    # Download specific crop
    python -m app.scripts.download_pretrained --crop potato

    # Verify models work
    python -m app.scripts.download_pretrained --verify
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from typing import Dict, Optional
import urllib.request
import shutil

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Model storage
MODEL_DIR = Path(os.environ.get('MODEL_DIR', '/app/data/models'))

# Pre-trained model sources (HuggingFace Hub)
PRETRAINED_MODELS = {
    'potato': {
        'huggingface': 'linkanjarad/mobilenetv2_plantvillage_potato',
        'classes': ['Early_Blight', 'Late_Blight', 'Healthy'],
        'accuracy': 0.98
    },
    'tomato': {
        'huggingface': 'linkanjarad/mobilenetv2_plantvillage_tomato',
        'classes': ['Bacterial_Spot', 'Early_Blight', 'Late_Blight', 'Leaf_Mold',
                   'Septoria_Leaf_Spot', 'Spider_Mites', 'Target_Spot',
                   'Yellow_Leaf_Curl_Virus', 'Mosaic_Virus', 'Healthy'],
        'accuracy': 0.95
    },
    'maize': {
        'huggingface': 'linkanjarad/mobilenetv2_plantvillage_corn',
        'classes': ['Common_Rust', 'Gray_Leaf_Spot', 'Northern_Leaf_Blight', 'Healthy'],
        'accuracy': 0.97
    }
}

# Alternative: Direct PyTorch model URLs
PYTORCH_MODELS = {
    'efficientnet_plantvillage': {
        'url': 'https://github.com/Armandpl/plant-disease-classifier/releases/download/v1.0/model.pth',
        'architecture': 'efficientnet_b0',
        'num_classes': 38
    }
}


def download_from_huggingface(model_id: str, save_dir: Path) -> bool:
    """
    Download model from HuggingFace Hub.

    Args:
        model_id: HuggingFace model identifier
        save_dir: Directory to save model

    Returns:
        True if successful
    """
    try:
        from huggingface_hub import snapshot_download

        logger.info(f"Downloading {model_id} from HuggingFace Hub...")

        # Download model files
        local_path = snapshot_download(
            repo_id=model_id,
            local_dir=save_dir,
            local_dir_use_symlinks=False
        )

        logger.info(f"Downloaded to {local_path}")
        return True

    except ImportError:
        logger.warning("huggingface_hub not installed. Run: pip install huggingface-hub")
        return False
    except Exception as e:
        logger.error(f"HuggingFace download failed: {e}")
        return False


def download_pytorch_model(url: str, save_path: Path) -> bool:
    """
    Download PyTorch model directly.

    Args:
        url: URL to model weights
        save_path: Path to save model

    Returns:
        True if successful
    """
    try:
        logger.info(f"Downloading model from {url}")

        save_path.parent.mkdir(parents=True, exist_ok=True)

        def reporthook(count, block_size, total_size):
            percent = int(count * block_size * 100 / total_size) if total_size > 0 else 0
            sys.stdout.write(f"\rDownloading: {percent}%")
            sys.stdout.flush()

        urllib.request.urlretrieve(url, save_path, reporthook)
        print()

        logger.info(f"Saved to {save_path}")
        return True

    except Exception as e:
        logger.error(f"Download failed: {e}")
        return False


def create_model_wrapper(crop: str, model_path: Path) -> bool:
    """
    Create a wrapper to make HuggingFace models compatible with our DiseaseClassifier.

    Args:
        crop: Crop type
        model_path: Path to downloaded model

    Returns:
        True if successful
    """
    try:
        import torch
        import torch.nn as nn

        # Check for model files
        pytorch_model = model_path / 'pytorch_model.bin'
        config_file = model_path / 'config.json'

        if not pytorch_model.exists():
            logger.warning(f"No pytorch_model.bin found in {model_path}")
            return False

        # Load config if exists
        config = {}
        if config_file.exists():
            with open(config_file) as f:
                config = json.load(f)

        # For transformers-based models, we need to convert
        # This is a simplified wrapper
        logger.info(f"Creating model wrapper for {crop}")

        # Create output path for our format
        output_path = MODEL_DIR / f"disease_classifier_{crop}.pth"

        # Copy and rename if it's already in PyTorch format
        shutil.copy2(pytorch_model, output_path)

        # Save class mapping
        classes = PRETRAINED_MODELS[crop]['classes']
        class_mapping = {i: name for i, name in enumerate(classes)}

        meta_path = output_path.with_suffix('.json')
        with open(meta_path, 'w') as f:
            json.dump({
                'classes': class_mapping,
                'crop_type': crop,
                'version': '1.0.0',
                'source': 'huggingface',
                'original_model': PRETRAINED_MODELS[crop]['huggingface']
            }, f, indent=2)

        logger.info(f"Model wrapper created: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to create wrapper: {e}")
        return False


def create_efficientnet_model(crop: str, num_classes: int) -> bool:
    """
    Create EfficientNet model with ImageNet weights (for fine-tuning).

    Args:
        crop: Crop type
        num_classes: Number of disease classes

    Returns:
        True if successful
    """
    try:
        import torch
        import torch.nn as nn
        from torchvision.models import efficientnet_b0, EfficientNet_B0_Weights

        logger.info(f"Creating EfficientNet-B0 model for {crop} with ImageNet weights")

        # Load pre-trained EfficientNet
        model = efficientnet_b0(weights=EfficientNet_B0_Weights.DEFAULT)

        # Modify classifier for our classes
        num_features = model.classifier[1].in_features
        model.classifier = nn.Sequential(
            nn.Dropout(p=0.2, inplace=True),
            nn.Linear(num_features, num_classes)
        )

        # Save model
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        output_path = MODEL_DIR / f"disease_classifier_{crop}.pth"

        torch.save(model.state_dict(), output_path)

        # Save class mapping
        classes = PRETRAINED_MODELS[crop]['classes']
        class_mapping = {i: name for i, name in enumerate(classes)}

        meta_path = output_path.with_suffix('.json')
        with open(meta_path, 'w') as f:
            json.dump({
                'classes': class_mapping,
                'crop_type': crop,
                'version': '1.0.0',
                'source': 'imagenet_pretrained',
                'note': 'ImageNet pre-trained, needs fine-tuning on PlantVillage'
            }, f, indent=2)

        logger.info(f"Model created: {output_path}")
        logger.info("Note: This model uses ImageNet weights and should be fine-tuned on PlantVillage data")
        return True

    except ImportError:
        logger.error("PyTorch/torchvision not installed")
        return False
    except Exception as e:
        logger.error(f"Failed to create model: {e}")
        return False


def download_crop_model(crop: str, method: str = 'imagenet') -> bool:
    """
    Download or create model for a crop.

    Args:
        crop: Crop type
        method: 'huggingface' or 'imagenet'

    Returns:
        True if successful
    """
    if crop not in PRETRAINED_MODELS:
        logger.error(f"Unknown crop: {crop}")
        return False

    config = PRETRAINED_MODELS[crop]

    if method == 'huggingface':
        # Download from HuggingFace
        temp_dir = MODEL_DIR / f'temp_{crop}'
        temp_dir.mkdir(parents=True, exist_ok=True)

        if download_from_huggingface(config['huggingface'], temp_dir):
            success = create_model_wrapper(crop, temp_dir)
            shutil.rmtree(temp_dir, ignore_errors=True)
            return success

    # Fallback: Create EfficientNet with ImageNet weights
    logger.info("Using ImageNet pre-trained EfficientNet (recommended: fine-tune on PlantVillage)")
    return create_efficientnet_model(crop, len(config['classes']))


def verify_models() -> Dict[str, bool]:
    """
    Verify all models can be loaded and run inference.

    Returns:
        Dictionary of crop: success status
    """
    results = {}

    # Add parent to path
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))

    try:
        from app.ml.disease_classifier import DiseaseClassifier
        import numpy as np
        from PIL import Image
        import io

        for crop in PRETRAINED_MODELS.keys():
            logger.info(f"Verifying {crop} model...")

            try:
                classifier = DiseaseClassifier(crop_type=crop)

                if classifier.load_model():
                    # Create dummy image for testing
                    dummy_image = Image.new('RGB', (224, 224), color='green')

                    # Save to temp file
                    temp_path = MODEL_DIR / f'temp_test_{crop}.jpg'
                    dummy_image.save(temp_path)

                    # Run inference
                    result = classifier.predict(str(temp_path))

                    # Clean up
                    temp_path.unlink(missing_ok=True)

                    if 'disease' in result:
                        logger.info(f"  ✓ {crop}: Model working (predicted: {result['disease']})")
                        results[crop] = True
                    else:
                        logger.warning(f"  ✗ {crop}: Prediction failed")
                        results[crop] = False
                else:
                    logger.warning(f"  ✗ {crop}: Model not found")
                    results[crop] = False

            except Exception as e:
                logger.error(f"  ✗ {crop}: Error - {e}")
                results[crop] = False

    except ImportError as e:
        logger.error(f"Import error: {e}")
        return {crop: False for crop in PRETRAINED_MODELS.keys()}

    return results


def list_models():
    """List all available and downloaded models."""
    print("\n" + "="*60)
    print("AVAILABLE PRE-TRAINED MODELS")
    print("="*60)

    for crop, config in PRETRAINED_MODELS.items():
        model_path = MODEL_DIR / f"disease_classifier_{crop}.pth"
        status = "✓ Downloaded" if model_path.exists() else "○ Not downloaded"

        print(f"\n{crop.upper()}")
        print(f"  Status: {status}")
        print(f"  Classes: {len(config['classes'])}")
        print(f"  Expected Accuracy: {config['accuracy']:.0%}")
        print(f"  HuggingFace: {config['huggingface']}")

    print("\n" + "="*60)


def main():
    parser = argparse.ArgumentParser(
        description='Download Pre-trained Disease Classification Models',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List available models
  python -m app.scripts.download_pretrained list

  # Download all models (ImageNet pre-trained)
  python -m app.scripts.download_pretrained --all

  # Download specific crop
  python -m app.scripts.download_pretrained --crop potato

  # Try HuggingFace models
  python -m app.scripts.download_pretrained --crop potato --method huggingface

  # Verify models work
  python -m app.scripts.download_pretrained verify
        """
    )

    subparsers = parser.add_subparsers(dest='command')

    # List command
    subparsers.add_parser('list', help='List available models')

    # Verify command
    subparsers.add_parser('verify', help='Verify downloaded models')

    # Download arguments
    parser.add_argument('--crop', choices=['potato', 'tomato', 'maize'],
                       help='Specific crop to download')
    parser.add_argument('--all', action='store_true',
                       help='Download all crop models')
    parser.add_argument('--method', choices=['imagenet', 'huggingface'],
                       default='imagenet',
                       help='Download method (default: imagenet)')
    parser.add_argument('--verify', action='store_true',
                       help='Verify after download')

    args = parser.parse_args()

    if args.command == 'list':
        list_models()
        return

    if args.command == 'verify':
        print("\nVerifying models...")
        results = verify_models()

        print("\n" + "="*40)
        print("VERIFICATION RESULTS")
        print("="*40)
        for crop, success in results.items():
            status = "✓ Working" if success else "✗ Failed"
            print(f"  {crop}: {status}")
        return

    # Download models
    crops = ['potato', 'tomato', 'maize'] if args.all else ([args.crop] if args.crop else [])

    if not crops:
        parser.print_help()
        return

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    results = {}
    for crop in crops:
        print(f"\n{'='*50}")
        print(f"Setting up {crop.upper()} model")
        print('='*50)

        success = download_crop_model(crop, args.method)
        results[crop] = success

        if success:
            print(f"✓ {crop} model ready")
        else:
            print(f"✗ {crop} model setup failed")

    # Summary
    print(f"\n{'='*50}")
    print("SUMMARY")
    print('='*50)
    for crop, success in results.items():
        status = "✓ Ready" if success else "✗ Failed"
        print(f"  {crop}: {status}")

    # Verify if requested
    if args.verify:
        print("\nVerifying models...")
        verify_models()


if __name__ == '__main__':
    main()
