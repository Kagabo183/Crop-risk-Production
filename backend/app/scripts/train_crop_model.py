"""
Train per-crop disease classification models.

Usage:
    # Train a specific crop model
    python -m app.scripts.train_crop_model --crop tomato --data-dir /path/to/data

    # Train all Rwanda priority crops
    python -m app.scripts.train_crop_model --all --data-dir /path/to/data

    # Extract crop-specific data from the full 80-class dataset, then train
    python -m app.scripts.train_crop_model --crop potato --extract-from /path/to/full_dataset

    # List available crop configs
    python -m app.scripts.train_crop_model --list

Data directory structure (per-crop):
    data-dir/
    ├── train/
    │   ├── Tomato___Bacterial_spot/
    │   ├── Tomato___Early_blight/
    │   └── ...
    └── val/
        ├── Tomato___Bacterial_spot/
        └── ...

When using --extract-from, the script copies matching class folders
from the full dataset into a crop-specific directory automatically.
"""
import argparse
import os
import sys
import shutil
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def extract_crop_data(full_data_dir: Path, config, output_dir: Path) -> Path:
    """
    Extract crop-specific folders from the full 80-class dataset.

    Args:
        full_data_dir: Path to full dataset with train/ and val/ subdirs
        config: CropDiseaseConfig for the target crop
        output_dir: Where to create the crop-specific dataset

    Returns:
        Path to the created dataset directory
    """
    logger.info(f"Extracting {config.crop_key} data from {full_data_dir}")

    for split in ['train', 'val']:
        src_split = full_data_dir / split
        if not src_split.exists():
            # Try without split dirs (flat structure)
            src_split = full_data_dir
            logger.warning(f"No '{split}' directory found, using root: {full_data_dir}")

        dst_split = output_dir / split
        dst_split.mkdir(parents=True, exist_ok=True)

        found = 0
        for class_name in sorted(config.class_names):
            src_class = src_split / class_name
            dst_class = dst_split / class_name

            if src_class.exists():
                if dst_class.exists():
                    shutil.rmtree(dst_class)
                shutil.copytree(src_class, dst_class)
                num_images = len(list(dst_class.glob('*')))
                logger.info(f"  {split}/{class_name}: {num_images} images")
                found += 1
            else:
                logger.warning(f"  {split}/{class_name}: NOT FOUND in {src_split}")

        logger.info(f"  {split}: {found}/{len(config.class_names)} classes found")

    return output_dir


def train_crop(crop_key: str, data_dir: str, extract_from: str = None,
               epochs: int = 15, batch_size: int = 32, lr: float = 0.001):
    """Train a single crop model."""
    from app.ml.crop_disease_config import get_crop_config
    from app.ml.crop_disease_classifier import CropDiseaseClassifier

    config = get_crop_config(crop_key)
    if config is None:
        logger.error(f"Unknown crop: {crop_key}")
        logger.info(f"Available: {', '.join(['tomato', 'coffee', 'pepper', 'potato'])}")
        return False

    logger.info(f"{'='*60}")
    logger.info(f"Training {config.display_name} model ({config.num_classes} classes)")
    logger.info(f"{'='*60}")

    # Extract crop data if requested
    if extract_from:
        extract_dir = Path(data_dir) / f"crop_{crop_key}"
        extract_crop_data(Path(extract_from), config, extract_dir)
        train_dir = str(extract_dir / 'train')
        val_dir = str(extract_dir / 'val')
    else:
        train_dir = os.path.join(data_dir, 'train')
        val_dir = os.path.join(data_dir, 'val')

    # Verify directories
    if not os.path.exists(train_dir):
        logger.error(f"Training directory not found: {train_dir}")
        return False
    if not os.path.exists(val_dir):
        logger.error(f"Validation directory not found: {val_dir}")
        return False

    # Count images
    train_count = sum(len(files) for _, _, files in os.walk(train_dir))
    val_count = sum(len(files) for _, _, files in os.walk(val_dir))
    logger.info(f"Training images: {train_count}")
    logger.info(f"Validation images: {val_count}")

    if train_count == 0:
        logger.error("No training images found!")
        return False

    # Train
    classifier = CropDiseaseClassifier(config=config)
    result = classifier.train(
        train_data_dir=train_dir,
        val_data_dir=val_dir,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=lr,
    )

    if 'error' in result:
        logger.error(f"Training failed: {result['error']}")
        return False

    logger.info(f"\nTraining complete for {config.display_name}!")
    logger.info(f"  Best validation accuracy: {result['best_val_acc']:.4f}")
    logger.info(f"  Final train accuracy:     {result['final_train_acc']:.4f}")
    logger.info(f"  Final val accuracy:       {result['final_val_acc']:.4f}")
    logger.info(f"  Model saved to:           {config.model_filename}")

    # Print evaluation metrics
    if 'evaluation' in result:
        ev = result['evaluation']
        logger.info(f"\n{'='*60}")
        logger.info(f"EVALUATION METRICS — {config.display_name}")
        logger.info(f"{'='*60}")
        logger.info(f"  Accuracy:            {ev['accuracy']:.4f}")
        logger.info(f"  Precision (weighted): {ev['precision_weighted']:.4f}")
        logger.info(f"  Recall (weighted):    {ev['recall_weighted']:.4f}")
        logger.info(f"  F1 Score (weighted):  {ev['f1_weighted']:.4f}")
        logger.info(f"  Precision (macro):    {ev['precision_macro']:.4f}")
        logger.info(f"  Recall (macro):       {ev['recall_macro']:.4f}")
        logger.info(f"  F1 Score (macro):     {ev['f1_macro']:.4f}")

        logger.info(f"\nPer-class metrics:")
        logger.info(f"  {'Class':<30} {'Precision':>10} {'Recall':>10} {'F1':>10} {'Support':>10}")
        logger.info(f"  {'-'*70}")
        for name, metrics in ev['per_class'].items():
            logger.info(f"  {name:<30} {metrics['precision']:>10.4f} {metrics['recall']:>10.4f} "
                        f"{metrics['f1_score']:>10.4f} {metrics['support']:>10}")

        if 'classification_report' in ev:
            logger.info(f"\nFull Classification Report:\n{ev['classification_report']}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Train per-crop disease classification models"
    )
    parser.add_argument('--crop', type=str,
                        help='Crop to train (tomato, coffee, pepper, potato)')
    parser.add_argument('--all', action='store_true',
                        help='Train all Rwanda priority crops')
    parser.add_argument('--list', action='store_true',
                        help='List available crop configurations')
    parser.add_argument('--data-dir', type=str, default='./data/crops',
                        help='Data directory with train/ and val/ subdirs')
    parser.add_argument('--extract-from', type=str, default=None,
                        help='Full 80-class dataset to extract crop data from')
    parser.add_argument('--epochs', type=int, default=15,
                        help='Number of training epochs (default: 15)')
    parser.add_argument('--batch-size', type=int, default=32,
                        help='Batch size (default: 32)')
    parser.add_argument('--lr', type=float, default=0.001,
                        help='Learning rate (default: 0.001)')

    args = parser.parse_args()

    if args.list:
        from app.ml.crop_disease_config import CROP_DISEASE_CONFIGS
        print("\nAvailable crop configurations:")
        print(f"{'Crop':<12} {'Display Name':<20} {'Classes':<10} {'Description'}")
        print("-" * 70)
        for key, config in CROP_DISEASE_CONFIGS.items():
            print(f"{key:<12} {config.display_name:<20} {config.num_classes:<10} {config.description}")
        print()
        return

    if args.all:
        from app.ml.crop_disease_config import CROP_DISEASE_CONFIGS
        results = {}
        for crop_key in CROP_DISEASE_CONFIGS:
            success = train_crop(
                crop_key, args.data_dir, args.extract_from,
                args.epochs, args.batch_size, args.lr
            )
            results[crop_key] = success

        print("\n" + "=" * 40)
        print("Training Summary:")
        for crop, success in results.items():
            status = "OK" if success else "FAILED"
            print(f"  {crop}: {status}")
        return

    if args.crop:
        train_crop(
            args.crop, args.data_dir, args.extract_from,
            args.epochs, args.batch_size, args.lr
        )
        return

    parser.print_help()


if __name__ == '__main__':
    main()
