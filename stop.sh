#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM="$(uname -s)"

case "$SYSTEM" in
  Linux)
    if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
      if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
        python3 "$ROOT/scripts/stop.py" || true
      elif command -v sudo >/dev/null 2>&1; then
        sudo python3 "$ROOT/scripts/stop.py" || true
      else
        echo "未能停止 systemd 服务：请使用 sudo 执行 stop.sh。" >&2
      fi
    else
      echo "未检测到 systemd，将停止由本项目脚本直接启动的进程。"
    fi
    ;;
  Darwin)
    python3 "$ROOT/scripts/stop.py" || true
    ;;
  *)
    echo "stop.sh 支持 Linux 和 macOS；当前系统为 $SYSTEM。Windows 请运行 python scripts/stop.py。" >&2
    exit 2
    ;;
esac

python3 - "$ROOT" <<'PY'
import os
import platform
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path

root = Path(sys.argv[1]).resolve()
targets = {
    (root / "scripts" / "app_server.py").resolve(),
    (root / "scripts" / "run_server.py").resolve(),
}
system = platform.system()
command = ["ps", "-axo", "pid=,command="] if system == "Darwin" else ["ps", "-eo", "pid=,args="]
listing = subprocess.run(command, check=True, capture_output=True, text=True).stdout


def process_cwd(pid):
    proc_cwd = Path(f"/proc/{pid}/cwd")
    if proc_cwd.exists():
        try:
            return proc_cwd.resolve()
        except OSError:
            pass
    if system == "Darwin" and subprocess.run(["which", "lsof"], capture_output=True).returncode == 0:
        result = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True)
        for line in result.stdout.splitlines():
            if line.startswith("n"):
                return Path(line[1:]).resolve()
    return None


matches = []
for line in listing.splitlines():
    parts = line.strip().split(maxsplit=1)
    if len(parts) != 2 or not parts[0].isdigit():
        continue
    pid = int(parts[0])
    if pid == os.getpid():
        continue
    try:
        arguments = shlex.split(parts[1])
    except ValueError:
        continue
    cwd = None
    for argument in arguments:
        path = Path(argument)
        candidate = path.resolve() if path.is_absolute() else None
        if candidate in targets:
            matches.append(pid)
            break
        if not path.is_absolute() and str(path) in {"scripts/app_server.py", "scripts/run_server.py"}:
            cwd = cwd or process_cwd(pid)
            if cwd and (cwd / path).resolve() in targets:
                matches.append(pid)
                break

matches = sorted(set(matches))
if not matches:
    print("未发现由此项目直接启动的服务进程。")
    raise SystemExit(0)

for pid in matches:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        continue
    except PermissionError:
        print(f"无权停止进程 {pid}；若由其他用户启动，请使用 sudo。", file=sys.stderr)

deadline = time.monotonic() + 8
remaining = set(matches)
while remaining and time.monotonic() < deadline:
    for pid in tuple(remaining):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            remaining.discard(pid)
    if remaining:
        time.sleep(0.2)

for pid in remaining:
    try:
        os.kill(pid, signal.SIGKILL)
        print(f"进程 {pid} 未响应正常停止，已强制结束。")
    except (ProcessLookupError, PermissionError):
        pass

print(f"已停止本项目服务进程：{', '.join(map(str, matches))}")
PY
