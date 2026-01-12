"""Find Radiant MLHub dataset files in the public AWS Open Data bucket.

Uses unsigned S3 access (no AWS credentials required).

Examples:
  python scripts/radiant_find_in_s3.py --needle ref_african_crops_uganda_01
  python scripts/radiant_find_in_s3.py --needle ref_african_crops_uganda_01 --prefix mlhub/
  python scripts/radiant_find_in_s3.py --needle ref_african_crops_uganda_01 --prefix mlhub/collections/ --max-scan 200000

Tip:
- First run without --prefix to see top-level prefixes.
"""

from __future__ import annotations

import argparse
from typing import Iterable

import boto3
from botocore import UNSIGNED
from botocore.client import Config


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--bucket", default="radiant-mlhub")
    p.add_argument("--region", default="us-west-2")
    p.add_argument("--needle", required=True, help="Substring to search for in object keys")
    p.add_argument(
        "--prefix",
        default=None,
        help="If provided, search only within this prefix. If omitted, prints top-level prefixes.",
    )
    p.add_argument(
        "--max-scan",
        type=int,
        default=50000,
        help="Max objects to scan within the given prefix (per run)",
    )
    return p.parse_args()


def unsigned_client(region: str):
    return boto3.client("s3", region_name=region, config=Config(signature_version=UNSIGNED))


def list_top_prefixes(s3, bucket: str) -> list[str]:
    resp = s3.list_objects_v2(Bucket=bucket, Delimiter="/", MaxKeys=1000)
    return [p["Prefix"] for p in resp.get("CommonPrefixes", [])]


def iter_keys(s3, bucket: str, prefix: str) -> Iterable[str]:
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            yield obj["Key"]
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")


def main() -> None:
    args = parse_args()
    s3 = unsigned_client(args.region)

    if not args.prefix:
        prefixes = list_top_prefixes(s3, args.bucket)
        print("Top-level prefixes:")
        for p in prefixes:
            print(" -", p)
        print("\nRe-run with --prefix <one-of-the-above> to search inside it.")
        return

    needle = args.needle
    prefix = args.prefix

    scanned = 0
    matches: list[str] = []

    for k in iter_keys(s3, args.bucket, prefix):
        scanned += 1
        if needle in k:
            matches.append(k)
        if scanned >= args.max_scan:
            break

    print(f"Scanned {scanned} objects under prefix={prefix!r}")
    print(f"Matches containing {needle!r}: {len(matches)}")
    for k in matches[:200]:
        print(k)

    if len(matches) > 200:
        print(f"(showing first 200 of {len(matches)})")


if __name__ == "__main__":
    main()
