"""Download files from Radiant MLHub public S3 bucket (unsigned).

Examples:
  python scripts/radiant_download_from_s3.py \
    --prefix african-crops-01/ \
    --needle ref_african_crops_uganda_01 \
    --out-dir data/radiant/ref_african_crops_uganda_01

Notes:
- No AWS credentials required.
- Uses boto3 unsigned access.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import boto3
from botocore import UNSIGNED
from botocore.client import Config


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--bucket", default="radiant-mlhub")
    p.add_argument("--region", default="us-west-2")
    p.add_argument("--prefix", required=True)
    p.add_argument("--needle", required=True)
    p.add_argument("--suffix", default=None, help="Optional suffix filter like .geojson")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--max-scan", type=int, default=300000)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    s3 = boto3.client("s3", region_name=args.region, config=Config(signature_version=UNSIGNED))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    token = None
    scanned = 0
    matches: list[str] = []

    while True:
        kwargs = {"Bucket": args.bucket, "Prefix": args.prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)

        for obj in resp.get("Contents", []):
            k = obj["Key"]
            scanned += 1
            if args.needle not in k:
                continue
            if args.suffix and not k.lower().endswith(args.suffix.lower()):
                continue
            matches.append(k)

        if scanned >= args.max_scan:
            break
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")

    if not matches:
        raise SystemExit("No matches found")

    print(f"Found {len(matches)} matching keys (scanned {scanned}). Downloading...")

    for k in matches:
        dst = out_dir / Path(k).name
        if dst.exists() and dst.stat().st_size > 0:
            continue
        s3.download_file(args.bucket, k, str(dst))
        print("downloaded", k, "->", dst)

    print(f"Done. Files in {out_dir}")


if __name__ == "__main__":
    main()
