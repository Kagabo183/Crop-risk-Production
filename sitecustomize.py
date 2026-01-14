"""Repo-local Python path bootstrap.

This project keeps the FastAPI package named `app` under `backend/app`.
When running commands from the repository root (scripts, tests, one-off tools),
Python may not find `app` unless `backend/` is on `sys.path`.

Python automatically imports `sitecustomize` (if present on `sys.path`) on
startup via the standard `site` module, so this keeps local workflows working
without requiring manual `PYTHONPATH` exports.

This file is intentionally tiny and safe: it only prepends the backend folder
when it exists and isn't already present.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _ensure_backend_on_path() -> None:
    repo_root = Path(__file__).resolve().parent
    backend_dir = repo_root / "backend"
    if not backend_dir.exists() or not backend_dir.is_dir():
        return

    backend_str = str(backend_dir)
    if backend_str in sys.path:
        return

    sys.path.insert(0, backend_str)


_ensure_backend_on_path()
