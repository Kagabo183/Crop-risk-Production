#!/usr/bin/env python3
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin


def main():
    out_dir = Path('data/sentinel2_test')
    out_dir.mkdir(parents=True, exist_ok=True)

    data = (np.random.rand(10, 10) * 10000).astype('int16')
    transform = from_origin(0, 0, 10, 10)

    out_path = out_dir / 'test_20260101_region.tif'
    with rasterio.open(
        str(out_path),
        'w',
        driver='GTiff',
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype='int16',
        crs='EPSG:4326',
        transform=transform,
    ) as dst:
        dst.write(data, 1)

    print('wrote', out_path)


if __name__ == '__main__':
    main()
