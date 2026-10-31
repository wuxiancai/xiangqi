"""Check upstream Pikafish releases and publish browser assets to the raw GitHub CDN."""

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "engine" / "pikafish" / "dist"
API = "https://api.github.com/repos"
HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "Chuhe-Pikafish-Release-Builder"}
ASSETS = ("worker.js", "pikafish.js", "pikafish.wasm", "pikafish.nnue", "COPYING.txt", "NNUE-License.md", "version.json")
BUILD_PROFILE = "adaptive-resources-2gb-v1"


def request_bytes(url, headers=None):
    request = urllib.request.Request(url, headers={**HEADERS, **(headers or {})})
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except Exception as error:
            last_error = error
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise last_error


def json_url(url):
    return json.loads(request_bytes(url))


def current_manifest(repository):
    url = f"https://raw.githubusercontent.com/{repository}/engine-updates/manifest.json"
    try:
        return json_url(url)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {}
        raise


def resolve_tag_commit(repository, tag):
    quoted = urllib.parse.quote(tag, safe="")
    obj = json_url(f"{API}/{repository}/git/ref/tags/{quoted}").get("object", {})
    while obj.get("type") == "tag":
        obj = json_url(f"{API}/{repository}/git/tags/{obj['sha']}").get("object", {})
    if obj.get("type") != "commit" or not obj.get("sha"):
        raise RuntimeError(f"无法解析 Pikafish 发行标签：{tag}")
    return obj["sha"]


def check(repository):
    upstream = "official-pikafish"
    release = json_url(f"{API}/{upstream}/Pikafish/releases/latest")
    network = json_url(f"{API}/{upstream}/Networks/releases/tags/master-net")
    net = next((item for item in network.get("assets", []) if item.get("name") == "pikafish.nnue"), None)
    digest = (net or {}).get("digest", "")
    tag = release.get("tag_name")
    if not tag or not net or not digest.startswith("sha256:"):
        raise RuntimeError("官方发行信息缺少 Pikafish 标签、NNUE 下载地址或 SHA-256")
    commit = resolve_tag_commit(f"{upstream}/Pikafish", tag)
    manifest = current_manifest(repository)
    changed = not (
        manifest.get("version") == tag
        and manifest.get("commit") == commit
        and manifest.get("net_sha256") == digest[7:]
        and manifest.get("build_profile") == BUILD_PROFILE
    )
    outputs = {
        "update": str(changed).lower(),
        "version": tag,
        "commit": commit,
        "net_url": net["browser_download_url"],
        "net_sha256": digest[7:],
    }
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as stream:
            for key, value in outputs.items():
                if "\n" in value or "\r" in value:
                    raise RuntimeError(f"发行字段 {key} 包含非法换行")
                stream.write(f"{key}={value}\n")
    print(f"Pikafish 上游：{tag}，NNUE SHA-256 {digest[7:]}")
    print("检测到更新。" if changed else "引擎资源已是最新版本。")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_manifest(repository):
    metadata = json.loads((DIST / "version.json").read_text(encoding="utf-8"))
    assets = {}
    for filename in ASSETS:
        path = DIST / filename
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"构建产物缺失或为空：{filename}")
        assets[filename] = {"sha256": sha256_file(path), "size": path.stat().st_size}
    if assets["pikafish.nnue"]["sha256"] != metadata.get("net_sha256"):
        raise RuntimeError("NNUE SHA-256 与版本信息不一致")
    wasm = (DIST / "pikafish.wasm").read_bytes()[:4]
    if wasm != b"\0asm":
        raise RuntimeError("WASM 文件头无效")
    manifest = {
        "schema": "chuhe-pikafish/v1",
        "engine_api": 1,
        "build_profile": BUILD_PROFILE,
        "version": metadata["version"],
        "release_id": f"{metadata['version']}-{metadata['commit'][:12]}-{metadata['net_sha256'][:12]}-{BUILD_PROFILE}",
        "commit": metadata["commit"],
        "net_sha256": metadata["net_sha256"],
        "minimum_app_version": "1.0.0",
        "assets": assets,
    }
    (DIST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_previous_release(repository, publish_root):
    manifest = current_manifest(repository)
    version = manifest.get("version")
    if not version or not isinstance(manifest.get("assets"), dict):
        return
    release_id = manifest.get("release_id", version)
    release_dir = publish_root / "releases" / release_id
    release_dir.mkdir(parents=True, exist_ok=True)
    base = f"https://raw.githubusercontent.com/{repository}/engine-updates/releases/{urllib.parse.quote(release_id, safe='')}/"
    for filename, descriptor in manifest["assets"].items():
        if filename not in ASSETS:
            continue
        data = request_bytes(urllib.parse.urljoin(base, urllib.parse.quote(filename)))
        digest = hashlib.sha256(data).hexdigest()
        if digest != descriptor.get("sha256"):
            raise RuntimeError(f"旧版资源校验失败，停止覆盖更新分支：{filename}")
        (release_dir / filename).write_bytes(data)
    (release_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def publish(repository, token):
    manifest = json.loads((DIST / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    release_id = manifest["release_id"]
    base = f"https://raw.githubusercontent.com/{repository}/engine-updates/releases/{urllib.parse.quote(release_id, safe='')}/"
    manifest["base_url"] = base
    with tempfile.TemporaryDirectory(prefix="pikafish-publish-") as temp:
        root = Path(temp)
        previous = fetch_previous_release(repository, root)
        release_dir = root / "releases" / release_id
        release_dir.mkdir(parents=True, exist_ok=True)
        for filename in ASSETS:
            shutil.copy2(DIST / filename, release_dir / filename)
        (release_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if previous:
            manifest["fallback"] = {key: value for key, value in previous.items() if key != "fallback"}
        (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (root / ".nojekyll").write_text("\n", encoding="utf-8")
        subprocess.run(["git", "init", "-b", "engine-updates", str(root)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(root), "config", "user.name", "github-actions[bot]"], check=True)
        subprocess.run(["git", "-C", str(root), "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True)
        subprocess.run(["git", "-C", str(root), "remote", "add", "origin", f"https://github.com/{repository}.git"], check=True)
        subprocess.run(["git", "-C", str(root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(root), "commit", "-m", f"Publish Pikafish {version}"], check=True, capture_output=True)
        auth = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        subprocess.run([
            "git", "-C", str(root), "-c", f"http.extraheader=AUTHORIZATION: basic {auth}",
            "push", "--force", "origin", "HEAD:engine-updates",
        ], check=True)
    print(f"Published Pikafish {version} to engine-updates.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "manifest", "publish"))
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", "wuxiancai/xiangqi"))
    args = parser.parse_args()
    if args.action == "check":
        check(args.repository)
    elif args.action == "manifest":
        make_manifest(args.repository)
    else:
        token = os.environ.get("GITHUB_TOKEN")
        if not token:
            raise SystemExit("发布引擎需要 GITHUB_TOKEN")
        publish(args.repository, token)


if __name__ == "__main__":
    main()
