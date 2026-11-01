"""Create a project-local virtualenv and serve the static application."""

import os
import sys
import venv
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".venv"
PYTHON = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PORT = os.environ.get("PORT", "8000")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(PORT))
    os.environ["PORT"] = str(parser.parse_args().port)
    if not PYTHON.exists():
        # A copied or interrupted venv can leave a dangling interpreter link
        # (for example, one pointing to the machine that created the archive).
        # Rebuild the disposable environment instead of copying over stale links.
        venv.EnvBuilder(with_pip=False, clear=ENV.exists()).create(ENV)
    os.execv(str(PYTHON), [str(PYTHON), str(ROOT / "scripts" / "app_server.py")])


if __name__ == "__main__":
    main()
