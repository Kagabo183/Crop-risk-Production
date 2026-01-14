"""Script helpers package.

This repository's backend FastAPI package is located in `backend/app` and is
imported as `app.*`.

When running scripts from the repository root via `python -m scripts.<name>`,
we need to ensure `backend/` is on `sys.path` so `import app...` succeeds.
"""

from __future__ import annotations

import sys
from pathlib import Path

_backend_dir = Path(__file__).resolve().parents[1] / "backend"
_backend_str = str(_backend_dir)

if _backend_dir.exists() and _backend_str not in sys.path:
    sys.path.insert(0, _backend_str)
