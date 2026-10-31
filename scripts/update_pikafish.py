"""Check official Pikafish releases and atomically install a verified WASM build."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine" / "pikafish"
WORK = ROOT / ".build" / "pikafish" / "src"
DIST = ENGINE / "dist"
API_HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "Chuhe-Xiangqi-Pikafish-Updater"}


def github_json(url):
    request = urllib.request.Request(url, headers=API_HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_release_assets():
    release = github_json("https://api.github.com/repos/official-pikafish/Pikafish/releases/latest")
    network = github_json("https://api.github.com/repos/official-pikafish/Networks/releases/tags/master-net")
    net_asset = next((asset for asset in network.get("assets", []) if asset.get("name") == "pikafish.nnue"), None)
    digest = (net_asset or {}).get("digest", "")
    if not release.get("tag_name") or not net_asset or not digest.startswith("sha256:"):
        raise RuntimeError("官方发行信息缺少版本标签或 NNUE SHA-256 校验值")
    return release["tag_name"], net_asset["browser_download_url"], digest.removeprefix("sha256:")


def resolve_release_commit(tag):
    WORK.parent.mkdir(parents=True, exist_ok=True)
    if not (WORK / ".git").is_dir():
        subprocess.run(["git", "clone", "--filter=blob:none", "https://github.com/official-pikafish/Pikafish.git", str(WORK)], check=True)
    ref = f"refs/tags/{tag}"
    subprocess.run(["git", "-C", str(WORK), "fetch", "--depth", "1", "origin", f"{ref}:{ref}"], check=True)
    result = subprocess.run(["git", "-C", str(WORK), "rev-parse", f"{ref}^{{commit}}"], check=True, text=True, capture_output=True)
    return result.stdout.strip()


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def installed_version():
    try:
        return json.loads((DIST / "version.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def build_and_install(tag, commit, net_url, net_sha256):
    staging = ENGINE / f".dist-update-{os.getpid()}"
    backup = ENGINE / f".dist-previous-{os.getpid()}"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(backup, ignore_errors=True)
    env = os.environ.copy()
    env.update({
        "PIKAFISH_REV": commit,
        "PIKAFISH_VERSION": tag,
        "PIKAFISH_OUT": str(staging),
        "PIKAFISH_NET_URL": net_url,
        "PIKAFISH_NET_SHA256": net_sha256,
    })
    subprocess.run(["bash", str(ENGINE / "build.sh")], cwd=ROOT, env=env, check=True)
    required = ["worker.js", "pikafish.js", "pikafish.wasm", "pikafish.nnue", "version.json"]
    if any(not (staging / name).is_file() or (staging / name).stat().st_size == 0 for name in required):
        raise RuntimeError("构建产物缺失或为空，保留当前引擎")
    if file_sha256(staging / "pikafish.nnue") != net_sha256:
        raise RuntimeError("NNUE SHA-256 校验失败，保留当前引擎")
    metadata = json.loads((staging / "version.json").read_text(encoding="utf-8"))
    if metadata.get("version") != tag or metadata.get("commit") != commit:
        raise RuntimeError("构建版本信息与官方发行版本不符，保留当前引擎")

    moved_current = False
    try:
        if DIST.exists():
            os.replace(DIST, backup)
            moved_current = True
        os.replace(staging, DIST)
    except Exception:
        if moved_current and not DIST.exists():
            os.replace(backup, DIST)
        raise
    shutil.rmtree(backup, ignore_errors=True)
    print(f"Pikafish 已自动更新至 {tag}（{commit[:12]}）", flush=True)


def update_once():
    tag, net_url, net_sha256 = fetch_release_assets()
    commit = resolve_release_commit(tag)
    current = installed_version()
    if current.get("version") == tag and current.get("commit") == commit and current.get("net_sha256") == net_sha256:
        print(f"Pikafish 已是最新版本：{tag}", flush=True)
        return
    build_and_install(tag, commit, net_url, net_sha256)


def main():
    try:
        update_once()
    except Exception as error:
        print(f"Pikafish 自动更新未完成，继续使用当前版本：{error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
