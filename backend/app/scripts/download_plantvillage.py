#!/usr/bin/env python3
"""
PlantVillage + Mendeley Disease Dataset Trainer

Trains disease classification models using the 80-class dataset
(PlantVillage + Mendeley A Database of Leaf Images).

Usage:
    # Train on full dataset (80 classes)
    python -m app.scripts.download_plantvillage train --data-dir "D:\\Data Of Crops"

    # Train with custom parameters
    python -m app.scripts.download_plantvillage train --data-dir "D:\\Data Of Crops" --epochs 20 --batch-size 64

    # List available classes in dataset
    python -m app.scripts.download_plantvillage list --data-dir "D:\\Data Of Crops"

    # Verify dataset integrity
    python -m app.scripts.download_plantvillage verify --data-dir "D:\\Data Of Crops"
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from typing import List, Dict, Optional

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Default data and model directories
DATA_DIR = Path(os.environ.get('DATA_DIR', '/app/data'))
MODEL_DIR = DATA_DIR / 'models'


def verify_dataset(data_dir: Path) -> Dict[str, any]:
    """
    Verify dataset structure and report statistics.

    Expected structure:
        data_dir/
        ├── train/   (80 class subfolders with images)
        ├── val/     (80 class subfolders with images)
        └── test/    (flat files OR class subfolders)
    """
    result = {'valid': True, 'issues': [], 'stats': {}}

    if not data_dir.exists():
        result['valid'] = False
        result['issues'].append(f"Data directory not found: {data_dir}")
        return result

    for split in ['train', 'val', 'test']:
        split_dir = data_dir / split
        if not split_dir.exists():
            result['issues'].append(f"Missing split: {split}")
            if split in ('train', 'val'):
                result['valid'] = False
            continue

        # Check if subfolders or flat files
        subdirs = [d for d in split_dir.iterdir() if d.is_dir()]
        files = [f for f in split_dir.iterdir() if f.is_file()]

        if subdirs:
            # Subfolder structure (train/val)
            total_images = 0
            class_counts = {}
            for d in sorted(subdirs):
                count = len([f for f in d.iterdir() if f.is_file()])
                class_counts[d.name] = count
                total_images += count

            result['stats'][split] = {
                'type': 'folders',
                'classes': len(subdirs),
                'total_images': total_images,
                'class_counts': class_counts
            }
        else:
            # Flat file structure (test)
            result['stats'][split] = {
                'type': 'flat',
                'total_images': len(files)
            }

    # Validate train has enough classes
    train_stats = result['stats'].get('train', {})
    if train_stats.get('classes', 0) < 2:
        result['valid'] = False
        result['issues'].append("Train set needs at least 2 classes")

    # Check train and val have matching classes
    if 'train' in result['stats'] and 'val' in result['stats']:
        train_classes = set(result['stats']['train'].get('class_counts', {}).keys())
        val_classes = set(result['stats']['val'].get('class_counts', {}).keys())
        missing_in_val = train_classes - val_classes
        if missing_in_val:
            result['issues'].append(f"Classes in train but not val: {missing_in_val}")

    return result


def train_model(data_dir: Path, epochs: int = 10, batch_size: int = 32,
                learning_rate: float = 0.001) -> Dict:
    """
    Train the disease classification model on the full dataset.

    Args:
        data_dir: Path to dataset root (containing train/ and val/ folders)
        epochs: Number of training epochs
        batch_size: Batch size
        learning_rate: Learning rate

    Returns:
        Training metrics
    """
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))

    from app.ml.disease_classifier import DiseaseClassifier

    train_dir = data_dir / 'train'
    val_dir = data_dir / 'val'

    if not train_dir.exists():
        raise FileNotFoundError(f"Training directory not found: {train_dir}")
    if not val_dir.exists():
        raise FileNotFoundError(f"Validation directory not found: {val_dir}")

    # Verify dataset
    logger.info("Verifying dataset...")
    verification = verify_dataset(data_dir)
    if not verification['valid']:
        raise ValueError(f"Dataset validation failed: {verification['issues']}")

    train_stats = verification['stats'].get('train', {})
    val_stats = verification['stats'].get('val', {})
    logger.info(f"Train: {train_stats.get('total_images', 0)} images, {train_stats.get('classes', 0)} classes")
    logger.info(f"Val: {val_stats.get('total_images', 0)} images, {val_stats.get('classes', 0)} classes")

    # Create and train classifier
    classifier = DiseaseClassifier()

    logger.info(f"Starting training...")
    logger.info(f"  Epochs: {epochs}")
    logger.info(f"  Batch size: {batch_size}")
    logger.info(f"  Learning rate: {learning_rate}")

    metrics = classifier.train(
        train_data_dir=str(train_dir),
        val_data_dir=str(val_dir),
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate
    )

    if 'error' not in metrics:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        model_path = classifier.save_model()
        metrics['model_path'] = model_path
        logger.info(f"Model saved to {model_path}")
    else:
        logger.error(f"Training failed: {metrics['error']}")

    return metrics


def list_classes(data_dir: Path) -> None:
    """List all disease classes in the dataset."""
    from app.ml.disease_classifier import CLASS_INFO

    train_dir = data_dir / 'train'
    if not train_dir.exists():
        print(f"Train directory not found: {train_dir}")
        return

    folders = sorted([d.name for d in train_dir.iterdir() if d.is_dir()])

    # Group by plant
    plants = {}
    for folder in folders:
        info = CLASS_INFO.get(folder)
        if info:
            plant, disease, is_healthy = info
        else:
            # Unknown class - parse from folder name
            parts = folder.split('___')
            plant = parts[0].strip() if parts else folder
            disease = parts[1].strip() if len(parts) > 1 else 'Unknown'
            is_healthy = 'healthy' in disease.lower()

        if plant not in plants:
            plants[plant] = []
        count = len(list((train_dir / folder).glob('*')))
        plants[plant].append((disease, count, is_healthy))

    print(f"\nDataset: {data_dir}")
    print(f"Total classes: {len(folders)}")
    print(f"Total plants: {len(plants)}")
    print(f"\n{'Plant':<25} {'Disease':<30} {'Images':>8} {'Status'}")
    print('-' * 80)

    total_images = 0
    for plant in sorted(plants.keys()):
        for i, (disease, count, is_healthy) in enumerate(sorted(plants[plant])):
            status = "Healthy" if is_healthy else "Diseased"
            plant_col = plant if i == 0 else ""
            print(f"{plant_col:<25} {disease:<30} {count:>8} {status}")
            total_images += count
        print()

    print(f"{'TOTAL':<25} {'':<30} {total_images:>8}")


def main():
    parser = argparse.ArgumentParser(
        description='Plant Disease Dataset Trainer (80 classes)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Train on your dataset
  python -m app.scripts.download_plantvillage train --data-dir "D:\\Data Of Crops"

  # Train with more epochs
  python -m app.scripts.download_plantvillage train --data-dir "D:\\Data Of Crops" --epochs 20

  # List classes
  python -m app.scripts.download_plantvillage list --data-dir "D:\\Data Of Crops"

  # Verify dataset
  python -m app.scripts.download_plantvillage verify --data-dir "D:\\Data Of Crops"
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Train command
    train_parser = subparsers.add_parser('train', help='Train disease classification model')
    train_parser.add_argument('--data-dir', type=Path, required=True,
                              help='Path to dataset root (containing train/, val/ folders)')
    train_parser.add_argument('--epochs', type=int, default=10,
                              help='Number of epochs (default: 10)')
    train_parser.add_argument('--batch-size', type=int, default=32,
                              help='Batch size (default: 32)')
    train_parser.add_argument('--learning-rate', type=float, default=0.001,
                              help='Learning rate (default: 0.001)')

    # List command
    list_parser = subparsers.add_parser('list', help='List available classes')
    list_parser.add_argument('--data-dir', type=Path, required=True,
                             help='Path to dataset root')

    # Verify command
    verify_parser = subparsers.add_parser('verify', help='Verify dataset integrity')
    verify_parser.add_argument('--data-dir', type=Path, required=True,
                               help='Path to dataset root')

    args = parser.parse_args()

    if args.command == 'train':
        print(f"\n{'='*60}")
        print(f"Training Disease Classifier (80 classes)")
        print(f"Dataset: {args.data_dir}")
        print('='*60)

        try:
            metrics = train_model(
                data_dir=args.data_dir,
                epochs=args.epochs,
                batch_size=args.batch_size,
                learning_rate=args.learning_rate
            )

            if 'error' not in metrics:
                print(f"\nTraining complete!")
                print(f"  Classes: {metrics.get('num_classes', 'N/A')}")
                print(f"  Best Val Accuracy: {metrics.get('best_val_acc', 0):.2%}")
                print(f"  Final Train Accuracy: {metrics.get('final_train_acc', 0):.2%}")
                print(f"  Final Val Accuracy: {metrics.get('final_val_acc', 0):.2%}")
                print(f"  Model saved: {metrics.get('model_path', 'N/A')}")
            else:
                print(f"\nTraining failed: {metrics['error']}")
                sys.exit(1)

        except Exception as e:
            print(f"\nTraining error: {e}")
            sys.exit(1)

    elif args.command == 'list':
        list_classes(args.data_dir)

    elif args.command == 'verify':
        print(f"\nVerifying dataset at: {args.data_dir}")
        result = verify_dataset(args.data_dir)

        if result['valid']:
            print("Dataset is VALID")
        else:
            print("Dataset has ISSUES")

        for split, stats in result['stats'].items():
            print(f"\n  {split.upper()}:")
            print(f"    Type: {stats['type']}")
            if stats['type'] == 'folders':
                print(f"    Classes: {stats['classes']}")
            print(f"    Images: {stats['total_images']}")

        if result['issues']:
            print(f"\n  Issues:")
            for issue in result['issues']:
                print(f"    - {issue}")

    else:
        parser.print_help()


if __name__ == '__main__':
    main()
