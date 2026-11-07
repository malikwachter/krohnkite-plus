#!/usr/bin/env python3
"""Reload a complete Krohnkite bundle without restarting KWin or logging out.

The package can be a build directory (pkg) or a .kwinscript archive.
"""

import argparse
import fcntl
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import zipfile

SERVICE = "org.kde.KWin"
INTERFACE = "org.kde.kwin.Scripting"
PLUGIN = "krohnkite"
RELOAD_ERRORS = (ValueError, RuntimeError, OSError, subprocess.CalledProcessError)
REQUIRED_FILES = ("contents/ui/main.qml", "contents/code/script.js", "metadata.json")
# A daemon asks for a reload of every build it installs, but a script that KWin
# has not loaded yet needs no reload: it starts with the new files on the next
# login. This code tells the caller that nothing was done, as opposed to a
# failure.
SKIPPED_EXIT_CODE = 3


def invoke(method, *args, path="/Scripting", interface=INTERFACE):
    return subprocess.run(
        ["qdbus6", SERVICE, path, f"{interface}.{method}", *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def validate_package(package):
    for relative in REQUIRED_FILES:
        if not (package / relative).is_file():
            raise ValueError(f"Missing {package / relative}; run 'go-task package' first.")


def archive_names(archive):
    try:
        with zipfile.ZipFile(archive) as archive_file:
            names = archive_file.namelist()
    except zipfile.BadZipFile as error:
        raise ValueError(f"{archive} is not a valid .kwinscript archive") from error
    for name in names:
        # Zip members may try to escape the bundle. Reject them before
        # anything is written instead of trusting the Python version to
        # sanitize the paths during extraction.
        if name.startswith("/") or ".." in Path(name).parts:
            raise ValueError(f"Refusing unsafe path in {archive}: {name}")
    return names


def validate_archive(archive):
    names = {name.rstrip("/") for name in archive_names(archive)}
    for relative in REQUIRED_FILES:
        if relative not in names:
            raise ValueError(
                f"Missing {relative} in {archive}; run 'go-task package' first."
            )


def validate_source(source):
    # Keep the package-directory diagnostics for a path that does not exist:
    # "Missing .../contents/ui/main.qml" is more useful than a raw ENOENT.
    if source.is_file():
        validate_archive(source)
    else:
        validate_package(source)


def extract_archive(archive, bundle):
    # Check again: the archive can change between validation and extraction.
    archive_names(archive)
    with zipfile.ZipFile(archive) as archive_file:
        archive_file.extractall(bundle)


def stage_package(source, cache):
    validate_source(source)
    cache.mkdir(parents=True, exist_ok=True)
    # Every dependency gets a new URL, including imported JS, popup QML, and SVGs.
    # Renaming main.qml alone does not invalidate KWin's shared component cache.
    bundle = Path(tempfile.mkdtemp(prefix="reload-", dir=cache))
    try:
        if source.is_dir():
            shutil.copytree(source, bundle, dirs_exist_ok=True)
        else:
            extract_archive(source, bundle)
    except (OSError, ValueError, zipfile.BadZipFile):
        shutil.rmtree(bundle, ignore_errors=True)
        raise
    return bundle / "contents/ui/main.qml"


def bundle_root(main_qml):
    """Return the staged bundle a `contents/ui/main.qml` belongs to."""
    return main_qml.parent.parent.parent


def prune_bundles(cache, *keep):
    """Delete staged bundles that nothing references any more.

    A loaded script can still pull QML and images from its bundle lazily, so the
    bundle it runs from has to survive until the script is replaced.
    """
    kept = {bundle_root(main_qml).resolve() for main_qml in keep if main_qml is not None}
    for bundle in cache.glob("reload-*"):
        if bundle.is_dir() and bundle.resolve() not in kept:
            shutil.rmtree(bundle, ignore_errors=True)


def read_last_good(last_good_file):
    if last_good_file is None:
        return None
    try:
        main_qml = Path(last_good_file.read_text().strip())
    except OSError:
        return None
    return main_qml if main_qml.is_file() else None


def remember_last_good(last_good_file, main_qml):
    if last_good_file is None:
        return
    last_good_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = last_good_file.with_suffix(f".tmp-{os.getpid()}")
    try:
        temporary.write_text(str(main_qml))
        os.replace(temporary, last_good_file)
    finally:
        temporary.unlink(missing_ok=True)


def load_and_run(main_qml, plugin=PLUGIN):
    script_id = invoke("loadDeclarativeScript", str(main_qml), plugin)
    if not script_id.isdecimal():
        raise RuntimeError(f"KWin refused to load {main_qml}: {script_id}")
    # KWin 6.8 keeps a declarative script loaded under a plugin name pending:
    # Script.run() on /Scripting/Script<id> does not start it, Scripting.start()
    # does. A reload unloads the old script first, so the only pending script is
    # the one just loaded. KWin reports QML errors of this script in its own
    # journal only, so a broken bundle is not detected here.
    invoke("start")


def reload_script(main_qml, last_good_file=None, plugin=PLUGIN, was_loaded=None):
    if was_loaded is None:
        was_loaded = invoke("isScriptLoaded", plugin) == "true"
    previous_main_qml = read_last_good(last_good_file) if was_loaded else None
    if was_loaded and invoke("unloadScript", plugin) != "true":
        raise RuntimeError("KWin refused to unload Krohnkite; no replacement loaded.")
    try:
        load_and_run(main_qml, plugin)
    except RELOAD_ERRORS as primary_error:
        if not was_loaded:
            raise
        if previous_main_qml is None:
            recovery = "No known prior working bundle is available for recovery."
        else:
            try:
                load_and_run(previous_main_qml, plugin)
                recovery = f"Recovered using prior bundle {previous_main_qml}."
            except RELOAD_ERRORS as recovery_error:
                detail = getattr(recovery_error, "stderr", None) or str(recovery_error)
                recovery = f"Recovery from {previous_main_qml} failed: {detail}"
        detail = getattr(primary_error, "stderr", None) or str(primary_error)
        raise RuntimeError(f"Replacement reload failed: {detail} {recovery}") from primary_error
    try:
        remember_last_good(last_good_file, main_qml)
    except OSError as error:
        print(f"Warning: could not record last working bundle: {error}", file=sys.stderr)


def reload_package(source, cache, plugin=PLUGIN, only_if_loaded=False):
    """Reload a package directory or a .kwinscript archive.

    With only_if_loaded, a script that is not loaded is left alone and False is
    returned. KWin starts such a script with the installed files on the next
    login, so staging a bundle and loading it now would change when Krohnkite
    starts, not just which files it uses.
    """
    if only_if_loaded and invoke("isScriptLoaded", plugin) != "true":
        return False
    last_good_file = cache / "last-good-main-qml"
    main_qml = stage_package(source, cache)
    try:
        reload_script(
            main_qml,
            last_good_file,
            plugin=plugin,
            was_loaded=True if only_if_loaded else None,
        )
    except RELOAD_ERRORS:
        # The rejected bundle never replaced the running script, so drop it.
        prune_bundles(cache, read_last_good(last_good_file))
        raise
    prune_bundles(cache, main_qml, read_last_good(last_good_file))
    # Keep the loaded bundle: QML and images can be loaded lazily while the script runs.
    print(f"Krohnkite reloaded without logout: {main_qml}")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "package",
        nargs="?",
        type=Path,
        default=Path("pkg"),
        help="package directory or .kwinscript archive (default: pkg)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show commands without touching KWin or files",
    )
    parser.add_argument(
        "--only-if-loaded",
        action="store_true",
        help=(
            "reload only when the script is already loaded; exit with "
            f"{SKIPPED_EXIT_CODE} when it is not"
        ),
    )
    args = parser.parse_args()
    package = args.package.resolve()
    validate_source(package)
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "krohnkite"
    if args.dry_run:
        for path, interface, method, values in [
            ("/Scripting", INTERFACE, "isScriptLoaded", [PLUGIN]),
            ("/Scripting", INTERFACE, "unloadScript", [PLUGIN]),
            ("/Scripting", INTERFACE, "loadDeclarativeScript",
             [str(cache / "<fresh-bundle>/contents/ui/main.qml"), PLUGIN]),
            ("/Scripting", INTERFACE, "start", []),
        ]:
            print(shlex.join(["qdbus6", SERVICE, path, f"{interface}.{method}", *values]))
        return 0
    cache.mkdir(parents=True, exist_ok=True)
    # Pruning removes every bundle but the caller's own, so overlapping runs have
    # to be serialized before one of them can delete a bundle the other is loading.
    with open(cache / "reload.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        reloaded = reload_package(
            package, cache, only_if_loaded=args.only_if_loaded
        )
    if not reloaded:
        print("Skipped: Krohnkite is not loaded.")
        return SKIPPED_EXIT_CODE
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RELOAD_ERRORS as error:
        detail = getattr(error, "stderr", None) or str(error)
        raise SystemExit(f"Reload failed: {detail}") from error
