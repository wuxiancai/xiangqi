"""Create a project-local virtualenv and serve the static application."""

import os
import subprocess
import sys
import venv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".venv"
PYTHON = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PORT = os.environ.get("PORT", "8000")


def main():
    if not PYTHON.exists():
        venv.EnvBuilder(with_pip=False).create(ENV)
    subprocess.run(
        [str(PYTHON), "-m", "http.server", PORT, "--bind", "0.0.0.0", "--directory", str(ROOT)],
        check=True,
    )


if __name__ == "__main__":
    main()
