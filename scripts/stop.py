"""Stop and disable the app service installed by deploy.py."""

import os
import platform
import subprocess
from pathlib import Path


SERVICE = "xiangqi"
WINDOWS_TASK = "ChuheXiangqi"
LABEL = "com.chuhe.xiangqi"


def run(command, *, check=True):
    return subprocess.run(command, check=check, text=True)


def stop_linux():
    if not Path("/run/systemd/system").exists():
        raise SystemExit("Linux 停止操作要求 systemd；未检测到 systemd。")
    if os.geteuid() != 0:
        raise SystemExit("请执行：sudo python3 scripts/stop.py")
    run(["systemctl", "disable", "--now", f"{SERVICE}.service"], check=False)
    print(f"已停止并禁用 {SERVICE}.service")


def stop_macos():
    uid = os.getuid()
    run(["launchctl", "disable", f"gui/{uid}/{LABEL}"], check=False)
    run(["launchctl", "bootout", f"gui/{uid}/{LABEL}"], check=False)
    print(f"已停止并禁用 launchd 服务 {LABEL}")


def stop_windows():
    run(["schtasks", "/End", "/TN", WINDOWS_TASK], check=False)
    run(["schtasks", "/Change", "/TN", WINDOWS_TASK, "/DISABLE"], check=False)
    print(f"已停止并禁用 Windows 任务 {WINDOWS_TASK}")


def main():
    system = platform.system()
    if system == "Linux":
        stop_linux()
    elif system == "Darwin":
        stop_macos()
    elif system == "Windows":
        stop_windows()
    else:
        raise SystemExit(f"不支持的操作系统：{system}")


if __name__ == "__main__":
    main()
