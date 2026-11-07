#!/usr/bin/env python3
'''
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
'''
import logging
from logging import error, info, warning
import os
from pathlib import Path
import queue
import signal
import sys
import threading
import time
from subprocess import CompletedProcess

from watchdog.events import FileSystemEvent, PatternMatchingEventHandler
from watchdog.observers import Observer

import config
from lib import run_cmd

# A build is installed only after its file events go quiet for this long, so a
# partially written archive is never handed to kpackagetool6.
CLOSE_GRACE_SECONDS = 1.0

# Minimal pause between two installs, so a burst of events does not spawn a
# burst of kpackagetool6 processes. Events are delayed by it, never dropped.
INSTALL_INTERVAL_SECONDS = 1.0

# Events closer than this are one drop, not two: a single copy may close the
# same path more than once. A drop under another name ("X.kwinscript" and the
# "X (1).kwinscript" KDE creates for a conflicting copy) has its own path and
# is always installed.
DUPLICATE_EVENT_SECONDS = 1.0

# reload-script.py reports that nothing was done (the script is not loaded, so
# the installed files will be used on the next login) with this exit code.
RELOAD_SKIPPED_EXIT_CODE = 3
RELOAD_SCRIPT_NAME = "reload-script.py"
RELOADED = "reloaded"
RELOAD_SKIPPED = "skipped"
RELOAD_FAILED = "failed"

exit_event = threading.Event()
install_queue: queue.Queue[tuple[Path, bool, float]] = queue.Queue()


def kde_send_notification(message: str) -> None:
    if run_cmd([config.notify_program, message], is_stilly=True) is None:
        warning(f"cannot send notification: {message}")


def _installed_package_path() -> Path:
    data_home = os.environ.get("XDG_DATA_HOME") or "~/.local/share"
    return Path(data_home).expanduser() / "kwin" / "scripts" / config.kwin_script_name


def _stderr_text(result: CompletedProcess[bytes] | None) -> str:
    if result is None:
        return ""

    return result.stderr.decode("utf-8", "replace").strip()


def _is_installed() -> bool | None:
    """Return True/False, or None when kpackagetool6 cannot be run at all.

    The installed package is queried by its path, not by its name: the name is
    resolved relative to the current directory, so it breaks depending on where
    the daemon was started from. The return code is inspected instead of the
    message, which kpackagetool6 translates into the user's language.
    """
    result = run_cmd(
        [
            config.install_program,
            "-t",
            "KWin/Script",
            "-s",
            _installed_package_path().as_posix(),
        ],
        is_stilly=True,
    )
    if result is None:
        return None

    return result.returncode == 0


def _kpackagetool6(package: Path, mode: str) -> CompletedProcess[bytes] | None:
    return run_cmd(
        [
            config.install_program,
            "-t",
            "KWin/Script",
            mode,
            package.as_posix(),
        ],
        is_stilly=True,
    )


def _reload_script_path(base: Path | None = None) -> Path | None:
    """Find reload-script.py, or the path configured in config.py."""
    configured = getattr(config, "reload_script", "").strip()
    if configured:
        path = Path(configured).expanduser()
        return path if path.is_file() else None

    if base is None:
        base = Path(__file__).resolve().parent
    for candidate in (base / RELOAD_SCRIPT_NAME, base.parent / RELOAD_SCRIPT_NAME):
        if candidate.is_file():
            return candidate
    return None


def _reload_kwin_script(package: Path) -> str:
    helper = _reload_script_path()
    if helper is None:
        message = (
            f"{RELOAD_SCRIPT_NAME} not found next to autoinstalld.py or in its parent"
        )
        error(message)
        kde_send_notification(f"💀 {message}")
        return RELOAD_FAILED

    result = run_cmd(
        [
            sys.executable,
            helper.as_posix(),
            "--only-if-loaded",
            package.as_posix(),
        ],
        is_stilly=True,
    )
    if result is None:
        kde_send_notification(f"💀 reload failed: {package.name}")
        return RELOAD_FAILED

    if result.returncode == RELOAD_SKIPPED_EXIT_CODE:
        info(
            f"{config.kwin_script_name} is not loaded; "
            "the update applies at the next login"
        )
        return RELOAD_SKIPPED

    if result.returncode != 0:
        detail = _stderr_text(result) or f"{helper.name} exited with {result.returncode}"
        error(detail)
        kde_send_notification(f"💀 reload failed: {detail}")
        return RELOAD_FAILED

    info(f"reloaded: {package}")
    return RELOADED


def reload_kwin_script(package: Path) -> str:
    """Apply an installed package to the running KWin, keeping the worker alive."""
    try:
        return _reload_kwin_script(package)
    except Exception as exc:  # noqa: BLE001 - a reload bug must not stop installs
        error(f"reload failed: {exc}")
        kde_send_notification(f"💀 reload failed: {package.name}")
        return RELOAD_FAILED


def kwin_script_install(package: Path) -> bool:
    is_installed = _is_installed()
    if is_installed is None:
        kde_send_notification(f"💀 {config.install_program} is not available")
        return False

    info(f"{config.kwin_script_name} isInstalled: {is_installed}")

    result = _kpackagetool6(package, "-u" if is_installed else "-i")
    if result is None:
        kde_send_notification(f"💀 {config.install_program} is not available")
        return False

    if result.returncode != 0 and is_installed and _is_installed() is False:
        # The installed copy is gone (for example deleted by hand), so there is
        # nothing to update: install the package from scratch.
        warning(f"{config.kwin_script_name} is gone, installing it from scratch")
        result = _kpackagetool6(package, "-i")
        if result is None:
            kde_send_notification(f"💀 {config.install_program} is not available")
            return False

    message = _stderr_text(result)
    if result.returncode != 0:
        error(message or f"{config.install_program} exited with {result.returncode}")
        kde_send_notification(f"💀 {message or package.name}")
        return False

    if message:
        # kpackagetool6 warns about the locale and about missing optional files
        # on stderr even when the installation succeeded.
        warning(message)

    info(f"installed: {package}")
    if getattr(config, "reload_after_install", True):
        outcome = reload_kwin_script(package)
        # A failed reload is already reported and must not turn a successful
        # installation into a failure: the new files are on disk and KWin will
        # use them on the next login.
        if outcome == RELOAD_FAILED:
            return True
        suffix = " (reloaded)" if outcome == RELOADED else " (next login)"
        kde_send_notification(f"✅ {package.name}{suffix}")
    else:
        kde_send_notification(f"✅ {package.name}")
    return True


class FileEventHandler(PatternMatchingEventHandler):
    def __init__(
        self,
        *,
        patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
        ignore_directories: bool = False,
        case_sensitive: bool = False,
    ):
        super().__init__(
            patterns=patterns,
            ignore_patterns=ignore_patterns,
            ignore_directories=ignore_directories,
            case_sensitive=case_sensitive,
        )

    @staticmethod
    def _event_path(event: FileSystemEvent) -> Path | None:
        # For a move watchdog reports the file in dest_path; for a move out of
        # the watched folder dest_path is empty and src_path is irrelevant.
        if event.event_type == "moved":
            raw = getattr(event, "dest_path", "")
        else:
            raw = event.src_path
        if not raw:
            return None
        return Path(os.fsdecode(raw))

    def on_any_event(self, event: FileSystemEvent) -> None:
        path = self._event_path(event)
        if path is None:
            return

        # "closed" means the writer is done: it is the only event that starts
        # an installation. "created", "modified" and "moved" only extend the
        # grace period, because a build dragged into the folder can be reported
        # as a creation that is never followed by a close event.
        #
        # "opened" and "closed_no_write" are deliberately ignored: the file
        # manager, the file indexer and kpackagetool6 itself read the archive,
        # and a read must never be taken for a finished write. Installing on
        # those closes made every installation trigger the next one.
        if event.event_type in ("created", "modified", "moved"):
            install_queue.put((path, False, time.monotonic()))
        elif event.event_type == "closed":
            install_queue.put((path, True, time.monotonic()))


def install_worker() -> None:
    pending: dict[Path, float] = {}
    last_install = 0.0
    install_started_at: dict[Path, float] = {}

    while not exit_event.is_set():
        try:
            path, is_final, observed_at = install_queue.get(timeout=0.2)
        except queue.Empty:
            pass
        else:
            deadline = (
                observed_at if is_final else observed_at + CLOSE_GRACE_SECONDS
            )
            # A single drop may close the same path more than once. Compare the
            # event time with the installation it belongs to, not with the
            # current time: an installation takes seconds, and a duplicate
            # event queued during it must still be recognised as a duplicate.
            duplicates_until = (
                install_started_at.get(path, float("-inf")) + DUPLICATE_EVENT_SECONDS
            )
            if observed_at < duplicates_until:
                info(f"ignoring a repeated event for {path}")
                continue
            pending[path] = max(pending.get(path, 0.0), deadline)

        now = time.monotonic()
        due = [path for path, deadline in pending.items() if deadline <= now]
        if not due:
            continue
        package = min(due, key=lambda path: pending[path])

        remaining = INSTALL_INTERVAL_SECONDS - (now - last_install)
        if remaining > 0:
            exit_event.wait(remaining)
            continue

        del pending[package]
        if not package.is_file():
            warning(f"file {package} doesn't exist anymore")
            continue

        install_started_at[package] = now
        info(f"install: {package}")
        kwin_script_install(package)
        last_install = time.monotonic()


def run_daemon() -> None:
    folder = Path(config.folder_path).expanduser().resolve()
    if not folder.is_dir():
        raise NotADirectoryError(f"watch folder doesn't exist: {folder}")

    event_handler = FileEventHandler(
        patterns=[
            "krohnkite*.kwinscript",
        ],
        ignore_directories=True,
    )
    observer = Observer()
    observer.schedule(event_handler, folder.as_posix(), recursive=True)
    observer.start()

    worker = threading.Thread(target=install_worker, name="install-worker", daemon=True)
    worker.start()
    try:
        exit_event.wait()
    finally:
        info("Stopping daemon...")
        observer.stop()
        observer.join()
        exit_event.set()
        worker.join(timeout=5)


def exit_hdl(signum: int, frame: object) -> None:
    exit_event.set()


def main() -> int:
    logging.basicConfig(level=logging.INFO)

    path_entries = [
        entry for entry in os.environ.get("PATH", "").split(os.pathsep) if entry
    ]
    if "/usr/bin" not in path_entries:
        os.environ["PATH"] = os.pathsep.join(["/usr/bin", *path_entries])

    signal.signal(signal.SIGTERM, exit_hdl)
    signal.signal(signal.SIGINT, exit_hdl)

    try:
        run_daemon()
    except Exception as exc:  # noqa: BLE001 - the daemon must report, not die
        error(f"autoinstall failed: {exc}")
        kde_send_notification(f"💀 {config.kwin_script_name} autoinstall: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
