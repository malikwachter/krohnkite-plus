#!/usr/bin/python3

import argparse
import getpass
from logging import error
import os
from pathlib import Path
import sys

from lib import run_cmd, bcolors, success, fail

def make_directory(p: Path) -> bool:
    try:
        p.mkdir(parents=True, exist_ok=True)
    except FileExistsError:
        # print(f"Directory '{p}' already exists.")
        return True
    except PermissionError:
        error(f"Permission denied: Unable to create '{p}'.")
        return False
    except Exception as e:
        print(f"An error occurred: {e}")
        return False

    return True


def find_reload_script(current_dir: Path, explicit: Path | None) -> Path | None:
    if explicit is not None:
        path = explicit.expanduser().resolve()
        return path if path.is_file() else None

    for candidate in (
        current_dir / "reload-script.py",
        current_dir.parent / "reload-script.py",
    ):
        if candidate.is_file():
            return candidate
    return None


def generate_cfg(p: Path, reload_script: str = "") -> bool:
    cfg = f"""
folder_path: str = "{p}"

kwin_script_name: str = "krohnkite"
reload_after_install: bool = True
reload_script: str = "{reload_script}"
install_program = "kpackagetool6"
notify_program = "notify-send"
"""

    with open("config.py", "w") as file:
        file.write(cfg)

    return True


def render_systemd_service(project_dir: Path) -> str:
    return f"""
[Unit]
Description=Krohnkite autoinstall

[Service]
Type=simple
User={getpass.getuser()}
WorkingDirectory={project_dir}
ExecStart={Path.joinpath(project_dir, '.venv', 'bin', 'python')} {Path.joinpath(project_dir, 'autoinstalld.py')}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Environment variables (optional)
Environment=PATH={Path.joinpath(project_dir, '.venv', 'bin')}:/usr/local/bin:/usr/bin

[Install]
WantedBy=default.target

    """


def generate_systemd_service(
    systemd_service_folder: Path, systemd_service_name: str, service_text: str
) -> bool:
    if not make_directory(systemd_service_folder):
        return False

    service_path = Path.joinpath(systemd_service_folder, systemd_service_name)
    with open(service_path.as_posix(), "w", encoding="utf-8") as file:
        file.write(service_text)

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        prog="install",
        description="Install `autoinstall`.Create virtualenv and config.py",
        usage="%(prog)s [options]",
    )
    parser.add_argument(
        "dirpath",
        help="Absolute or relative path to directory where will appear krohnkite packages",
    )
    parser.add_argument(
        "--reload-script",
        type=Path,
        default=None,
        help="Path to reload-script.py (default: look in this directory, then its parent)",
    )
    args = parser.parse_args()

    current_dir = Path(os.getcwd())
    print(bcolors.OKBLUE + f"Current directory: {current_dir}" + bcolors.ENDC)

    if not current_dir.joinpath("autoinstalld.py").is_file():
        fail("1.Check if 'autoinstalld.py' exist:")
        exit(-1)
    else:
        success("1.Check if 'autoinstalld.py' exist:")

    watch_dir = Path(args.dirpath).expanduser().resolve()

    if not watch_dir.is_dir():
        fail(f"2.Check if '{watch_dir}' exist")
        exit(-1)
    success(f"2.Check if '{watch_dir}' exist")

    reload_script = find_reload_script(current_dir, args.reload_script)
    if reload_script is None:
        fail(
            "2.1.Check if 'reload-script.py' exist: put it next to "
            "'autoinstalld.py' or in the parent directory, or pass --reload-script"
        )
        exit(1)
    success(f"2.1.Check if 'reload-script.py' exist: {reload_script}")

    config_backup_file = current_dir.joinpath("config.py.backup")
    if config_backup_file.is_file():
        config_backup_file.unlink()
    config_file = current_dir.joinpath("config.py")
    if config_file.is_file():
        os.rename(config_file, config_backup_file)

    # An explicit path is recorded; otherwise the daemon searches again at
    # runtime, so moving the checkout does not break the service.
    configured_reload = (
        reload_script.as_posix() if args.reload_script is not None else ""
    )
    if generate_cfg(watch_dir, configured_reload):
        success("3.Generate 'config.py'")

    virtualenv_path = current_dir.joinpath(".venv")
    virtualenv_python = virtualenv_path.joinpath("bin", "python")

    if virtualenv_path.is_dir():
        probe = run_cmd(
            [virtualenv_python.as_posix(), "-c", "import watchdog"], is_stilly=True
        )
        if probe is None or probe.returncode != 0:
            fail(
                f"4.Virtual environment '{virtualenv_path}' is not usable, "
                f"remove it and run the script again"
            )
            exit(1)

    if not virtualenv_path.is_dir():
        result = run_cmd([sys.executable, "-m", "venv", virtualenv_path.as_posix()])
        if result is None:
            fail(f"4.1 Create Virtual environment[{virtualenv_path}]")
            exit(1)
        success(f"4.1 Create Virtual environment[{virtualenv_path}]")

        result = run_cmd(
            [virtualenv_python.as_posix(), "-m", "pip", "install", "--upgrade", "pip"]
        )
        if result is None:
            fail("4.2 Update pip")
            exit(1)
        success("4.2 Update pip")

        result = run_cmd(
            [virtualenv_python.as_posix(), "-m", "pip", "install", "watchdog"]
        )
        if result is None:
            fail("4.3 Install 'watchdog'")
            exit(1)
        success("4.3 Install 'watchdog'")
    else:
        success(f"4.Virtual environment '{virtualenv_path}' already exist")

    # systemd
    systemd_service_folder = Path.joinpath(Path.home(), ".config/systemd/user")
    systemd_service_name = "krohnkite_autoinstall.service"
    systemd_service_path = Path.joinpath(systemd_service_folder, systemd_service_name)
    service_text = render_systemd_service(current_dir)
    if (
        systemd_service_path.is_file()
        and systemd_service_path.read_text(encoding="utf-8") == service_text
    ):
        success(f"5. Systemd service'{systemd_service_path}' is up to date")
    elif generate_systemd_service(
        systemd_service_folder, systemd_service_name, service_text
    ):
        success(f"5. Create systemd service'{systemd_service_path}'")
    else:
        fail(f"5. Create systemd service'{systemd_service_path}'")

    result = run_cmd(["systemctl", "--user", "daemon-reload"], is_stilly=True)
    if result is None:
        fail("6 Reload systemd units")
        exit(1)
    success("6 Reload systemd units")

    result = run_cmd(["systemctl", "--user", "start", "krohnkite_autoinstall.service"])
    if result is None:
        fail("7 Start service [krohnkite_autoinstall]")
        exit(1)
    success("7 Start service [krohnkite_autoinstall]")

    run_cmd(["systemctl", "--user", "enable", "krohnkite_autoinstall.service"], is_stilly=True)
    result_bin = run_cmd(["systemctl", "--user", "is-enabled", "krohnkite_autoinstall.service"])

    result = result_bin.stdout.decode('utf-8') if result_bin is not None else None

    if result is None or "enabled" not in result :
        fail(f"8 Enable service '{result}' [krohnkite_autoinstall]")
        exit(1)
    success("8 Enable service [krohnkite_autoinstall]")

