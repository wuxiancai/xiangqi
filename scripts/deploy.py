"""Install and start the web app using the native service manager."""

import getpass
import hashlib
import json
import os
import platform
import plistlib
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PORT = os.environ.get("PORT", "8000")
SERVICE = "xiangqi"
WINDOWS_TASK = "ChuheXiangqi"
VERIFIED_ENGINE = {
    "commit": "6a59ee2f7b105bff64d9efc2692591107787e2b1",
    "net_sha256": "7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e",
}


def run(command, *, check=True):
    return subprocess.run(command, check=check, text=True)


def service_user():
    return os.environ.get("SUDO_USER") or getpass.getuser()


def validate_port():
    try:
        port = int(PORT)
    except ValueError as error:
        raise SystemExit("PORT 必须是 1–65535 范围内的整数。") from error
    if not 1 <= port <= 65535:
        raise SystemExit("PORT 必须是 1–65535 范围内的整数。")
    for candidate in range(port, 65536):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            # Match HTTPServer's reuse policy so Linux TIME_WAIT sockets do not
            # make a stopped service's port look occupied during deployment.
            if platform.system() != "Windows":
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("0.0.0.0", candidate))
            except OSError:
                continue
            return candidate
    raise SystemExit(f"从端口 {port} 起没有可用端口。")


def validate_engine_rescue():
    dist = ROOT / "engine" / "pikafish" / "dist"
    try:
        version = json.loads((dist / "version.json").read_text(encoding="utf-8"))
        if any(version.get(key) != value for key, value in VERIFIED_ENGINE.items()):
            raise ValueError("本机引擎版本不是已验证兼容版本")
        for filename in ("pikafish.js", "pikafish.wasm", "pikafish.nnue"):
            path = dist / filename
            if not path.is_file() or path.stat().st_size == 0:
                raise ValueError(f"缺少 {filename}")
        net_hash = hashlib.sha256((dist / "pikafish.nnue").read_bytes()).hexdigest()
        if net_hash != VERIFIED_ENGINE["net_sha256"]:
            raise ValueError("pikafish.nnue SHA-256 与已验证版本不符")
        if (dist / "pikafish.wasm").read_bytes()[:4] != b"\0asm":
            raise ValueError("pikafish.wasm 文件头无效")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"部署已停止：本机 Pikafish 救援资源缺失或校验失败（{error}）。请获取包含 engine/pikafish/dist 已验证资源的项目版本后重试。") from error


def deploy_linux():
    if not Path("/run/systemd/system").exists() or not shutil.which("systemctl"):
        raise SystemExit("Linux 部署要求 systemd；未检测到 systemd，请使用支持 systemd 的发行版。")
    if os.geteuid() != 0:
        raise SystemExit("请在项目目录执行：sudo python3 scripts/deploy.py")
    user = service_user()
    python = shutil.which("python3") or sys.executable
    template = (ROOT / "deploy" / "xiangqi.service").read_text(encoding="utf-8")
    unit = template.replace("__SERVICE_USER__", user)
    unit = unit.replace("__PROJECT_DIR__", str(ROOT)).replace("__PORT__", PORT)
    unit = unit.replace("__PYTHON__", python)
    Path(f"/etc/systemd/system/{SERVICE}.service").write_text(unit, encoding="utf-8")
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", f"{SERVICE}.service"])
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        active = subprocess.run(["systemctl", "is-active", "--quiet", f"{SERVICE}.service"], check=False).returncode == 0
        if active:
            try:
                with socket.create_connection(("127.0.0.1", int(PORT)), timeout=0.5):
                    break
            except OSError:
                pass
        time.sleep(0.25)
    else:
        subprocess.run(["systemctl", "status", "--no-pager", "-l", f"{SERVICE}.service"], check=False)
        raise SystemExit(f"{SERVICE}.service 未能在 10 秒内监听 127.0.0.1:{PORT}；请查看 systemd 日志。")
    print(f"已通过 systemd 部署并启动；端口 {PORT}，服务 {SERVICE}.service")


def deploy_macos():
    label = "com.chuhe.xiangqi"
    launch_agents = Path.home() / "Library" / "LaunchAgents"
    launch_agents.mkdir(parents=True, exist_ok=True)
    python = shutil.which("python3") or sys.executable
    plist = {
        "Label": label,
        "ProgramArguments": [python, str(ROOT / "scripts" / "run_server.py")],
        "WorkingDirectory": str(ROOT),
        "EnvironmentVariables": {"PORT": PORT},
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(ROOT / "server.log"),
        "StandardErrorPath": str(ROOT / "server.log"),
    }
    path = launch_agents / f"{label}.plist"
    with path.open("wb") as stream:
        plistlib.dump(plist, stream)
    uid = os.getuid()
    run(["launchctl", "enable", f"gui/{uid}/{label}"], check=False)
    run(["launchctl", "bootout", f"gui/{uid}/{label}"], check=False)
    run(["launchctl", "bootstrap", f"gui/{uid}", str(path)])
    print(f"已通过 launchd 部署并启动；端口 {PORT}，服务 {label}")


def deploy_windows():
    python = shutil.which("python") or sys.executable
    command = f'"{python}" "{ROOT / "scripts" / "run_server.py"}" --port {PORT}'
    run(["schtasks", "/Create", "/SC", "ONLOGON", "/TN", WINDOWS_TASK, "/TR", command, "/F"])
    run(["schtasks", "/Change", "/TN", WINDOWS_TASK, "/ENABLE"])
    run(["schtasks", "/Run", "/TN", WINDOWS_TASK])
    print(f"已通过 Windows 任务计划部署并启动；端口 {PORT}，任务 {WINDOWS_TASK}")


def main():
    global PORT
    validate_engine_rescue()
    PORT = str(validate_port())
    system = platform.system()
    if system == "Linux":
        deploy_linux()
    elif system == "Darwin":
        deploy_macos()
    elif system == "Windows":
        deploy_windows()
    else:
        raise SystemExit(f"不支持的操作系统：{system}")
    print(f"应用 HTTP 上游监听 0.0.0.0:{PORT}；公网请通过 HTTPS 反向代理访问（Pikafish 需要安全上下文）")


if __name__ == "__main__":
    main()
