"""
Startup entrypoint for production deployments.
Creates database tables then starts uvicorn.
"""
import subprocess
import sys


def main():
    # Step 1: Initialize database
    print("=== Initializing database tables ===", flush=True)
    try:
        from app.scripts.init_db import init_db
        init_db()
        print("=== Database initialized ===", flush=True)
    except Exception as e:
        print(f"Warning: DB init failed: {e}", flush=True)
        print("Continuing to start server anyway...", flush=True)

    # Step 2: Start uvicorn
    print("=== Starting server ===", flush=True)
    sys.exit(
        subprocess.call([
            sys.executable, "-m", "uvicorn",
            "app.main:app",
            "--host", "0.0.0.0",
            "--port", "8000",
        ])
    )


if __name__ == "__main__":
    main()
