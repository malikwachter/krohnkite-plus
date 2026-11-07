#!/usr/bin/env python3
"""Collect environment and Krohnkite configuration for a bug report.

The report is generated locally and is never uploaded anywhere. It intentionally
omits host names, user names, home paths, network addresses, UUIDs, monitor
serial numbers and EDID data, open windows, window titles, KWin window rules,
and journal contents. Values of user-defined title/desktop rules are hidden by
default; use --include-user-rules only when a maintainer asks for them.

Examples:

    python3 collect-diagnostics.py
    python3 collect-diagnostics.py --stdout
    python3 collect-diagnostics.py -o report.txt
    python3 collect-diagnostics.py --include-user-rules
"""

import argparse
import datetime as dt
import getpass
import ipaddress
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

COLLECTOR_VERSION = "1"
PROGRAM = "krohnkite"
CONFIG_GROUP = "Script-krohnkite"
KWINRC = "kwinrc"
SHORTCUTSRC = "kglobalshortcutsrc"

# Values that may contain window titles, virtual-desktop names, or other text a
# user typed for their own environment. They are hidden unless the caller opts
# in, and even then the generic token redaction below still applies.
HIDDEN_SETTINGS = (
    "ignoreTitle",
    "floatConfig",
    "screenDefaultLayout",
    "ignoreActivity",
    "ignoreVDesktop",
    "ignoreScreen",
    "logFilterStr",
)
HIDDEN_SETTINGS_LOWER = {name.lower() for name in HIDDEN_SETTINGS}

SESSION_VARIABLES = (
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "XDG_SESSION_CLASS",
    "DESKTOP_SESSION",
    "KDE_SESSION_VERSION",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_MESSAGES",
    "QT_SCALE_FACTOR",
    "QT_SCREEN_SCALE_FACTORS",
    "QT_AUTO_SCREEN_SCALE_FACTOR",
    "GDK_SCALE",
)

KWIN_OPTION_KEYS = (
    "focusPolicy",
    "separateScreenFocus",
    "nextFocusPrefersMouse",
    "placement",
    "borderlessMaximizedWindows",
)

ROTATION_NAMES = {
    "1": "normal",
    "2": "90 degrees",
    "3": "180 degrees",
    "4": "270 degrees",
}

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}"
    r"(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"
)
# A conservative IPv6 candidate: at least four colon-separated groups. This
# avoids matching clock times and version numbers; ipaddress validates the rest.
IPV6_RE = re.compile(r"(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}(?![\w:])")
HEX_RE = re.compile(r"\b[0-9a-fA-F]{16,}\b")


def strip_ansi(text):
    return ANSI_RE.sub("", text)


def run(argv, timeout=10, cwd=None):
    """Run a command and return stripped stdout, or None when it is unavailable."""
    if not shutil.which(argv[0]):
        return None
    try:
        completed = subprocess.run(
            argv,
            cwd=str(cwd) if cwd is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return None
    if completed.returncode != 0:
        return None
    return strip_ansi(completed.stdout).strip()


def config_home():
    return Path(os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config"))


def data_home():
    return Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local/share"))


def data_dirs():
    value = os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share")
    return [Path(item) for item in value.split(":") if item]


def data_locations():
    """Return (directory, scope) pairs, most specific first, without duplicates."""
    seen = set()
    locations = []
    candidates = [(data_home(), "user")]
    candidates.extend((directory, "system") for directory in data_dirs())
    for directory, scope in candidates:
        try:
            key = str(directory.resolve())
        except OSError:
            key = str(directory)
        if key in seen:
            continue
        seen.add(key)
        locations.append((directory, scope))
    return locations


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def find_script_metadata(script_id):
    for directory, scope in data_locations():
        path = directory / "kwin" / "scripts" / script_id / "metadata.json"
        if path.is_file():
            return path, scope
    return None


def kconfig_unescape(value):
    """Decode KConfig file-level escapes, leaving list escapes (\\,) intact."""
    escapes = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", ";": ";"}
    return re.sub(
        r"\\(.)",
        lambda match: escapes.get(match.group(1), match.group(0)),
        value,
    )


def read_kconfig(path):
    """Read a simple KConfig INI file into {group: {key: decoded value}}."""
    groups = {}
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return groups

    current = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            current = line[1:-1].strip()
            groups.setdefault(current, {})
            continue
        if current is None or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        groups[current][key.strip()] = kconfig_unescape(value)
    return groups


def parse_kcfg(path):
    """Return the entry declarations of a KConfig XT XML file."""
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError):
        return []

    entries = []

    def local_name(tag):
        return tag.rsplit("}", 1)[-1]

    def walk(element, group):
        for child in element:
            tag = local_name(child.tag)
            if tag == "group":
                name = child.get("name") or ""
                next_group = f"{group}/{name}" if group and name else (name or group)
                walk(child, next_group)
            elif tag == "entry":
                name = child.get("name")
                if not name:
                    continue
                default = child.get("default")
                if default is None:
                    default_element = None
                    for sub in child:
                        if local_name(sub.tag) == "default":
                            default_element = sub
                            break
                    default = (
                        (default_element.text or "")
                        if default_element is not None
                        else ""
                    )
                entries.append(
                    {
                        "name": name,
                        "type": child.get("type") or "String",
                        "default": default,
                        "group": group,
                    }
                )

    walk(root, "")
    return entries


def find_schema(script_dir):
    candidates = [
        script_dir.parent / "config" / "main.xml",  # installed package
        script_dir.parent / "res" / "config.xml",  # source checkout
        script_dir.parent.parent / "res" / "config.xml",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def read_os_release():
    for candidate in (Path("/etc/os-release"), Path("/usr/lib/os-release")):
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        values = {}
        for line in text.splitlines():
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
        return values
    return {}


def git_value(arguments, cwd):
    return run(["git"] + arguments, timeout=5, cwd=cwd)


def find_krohnkite_metadata(script_dir):
    found = find_script_metadata(PROGRAM)
    if found is not None:
        path, scope = found
        data = load_json(path) or {}
        plugin = data.get("KPlugin") or {}
        version = str(plugin.get("Version") or "")
        description = str(plugin.get("Description") or "")
        match = re.search(r"\(([0-9a-fA-F]{7,40})\)", description)
        return {
            "scope": scope,
            "version": version or "unknown",
            "revision": match.group(1) if match else "unknown",
        }

    repo_root = None
    for ancestor in script_dir.parents:
        if (ancestor / "res" / "metadata.json").is_file():
            repo_root = ancestor
            break
        if (ancestor / "package.json").is_file() and (
            ancestor / "taskfile.yaml"
        ).is_file():
            repo_root = ancestor
            break
    if repo_root is None:
        return None

    metadata_path = repo_root / "res" / "metadata.json"
    package_path = repo_root / "package.json"

    metadata = load_json(metadata_path) if metadata_path.is_file() else {}
    plugin = (metadata or {}).get("KPlugin") or {}
    version = str(plugin.get("Version") or "")
    description = str(plugin.get("Description") or "")

    if version in ("", "$VER"):
        package = load_json(package_path) if package_path.is_file() else {}
        version = str((package or {}).get("version") or "")

    revision = ""
    match = re.search(r"\(([0-9a-fA-F]{7,40})\)", description)
    if match:
        revision = match.group(1)
    if revision in ("", "$REV"):
        revision = git_value(["rev-parse", "--short", "HEAD"], repo_root) or ""
    if version in ("", "$VER"):
        version = (
            git_value(["describe", "--tags", "--always", "--dirty"], repo_root)
            or "development"
        )

    return {
        "scope": "source",
        "version": version or "unknown",
        "revision": revision or "unknown",
    }


def loaded_state():
    output = run(
        [
            "qdbus6",
            "org.kde.KWin",
            "/Scripting",
            "org.kde.kwin.Scripting.isScriptLoaded",
            PROGRAM,
        ],
        timeout=5,
    )
    if output is None:
        return "unknown"
    return "yes" if output.strip().lower() == "true" else "no"


def parse_support_sections(text):
    lines = text.splitlines()
    sections = {}
    current = None
    index = 0
    while index < len(lines):
        line = lines[index]
        if (
            index + 1 < len(lines)
            and line.strip()
            and re.fullmatch(r"=+", lines[index + 1].strip())
        ):
            current = line.strip()
            sections[current] = []
            index += 2
            continue
        if current is not None:
            sections[current].append(line.rstrip())
        index += 1

    for name in list(sections):
        while sections[name] and not sections[name][-1].strip():
            sections[name].pop()
        while sections[name] and not sections[name][0].strip():
            sections[name].pop(0)
    return sections


def support_information():
    output = run(
        [
            "qdbus6",
            "org.kde.KWin",
            "/KWin",
            "org.kde.KWin.supportInformation",
        ],
        timeout=20,
    )
    return parse_support_sections(output) if output else {}


def version_lines(sections, warnings):
    lines = list(sections.get("Version", []))
    if not lines:
        warnings.append(
            "KWin support information is unavailable; versions fall back to commands."
        )
        kwin = run(["kwin_wayland", "--version"], timeout=5) or run(
            ["kwin_x11", "--version"], timeout=5
        )
        qt = run(["qmake6", "-query", "QT_VERSION"], timeout=5) or run(
            ["qmake", "-query", "QT_VERSION"], timeout=5
        )
        if kwin:
            lines.append(f"KWin: {kwin}")
        if qt:
            lines.append(f"Qt: {qt}")
        lines.append(f"Operation Mode: {os.environ.get('XDG_SESSION_TYPE', 'unknown')}")

    plasma = run(["plasmashell", "--version"], timeout=5)
    if plasma:
        lines.append(f"Plasma: {plasma}")
    return lines


COMPOSITING_PREFIXES = (
    "Compositing is active",
    "Compositing is suspended",
    "Compositing Type:",
    "OpenGL vendor string:",
    "OpenGL renderer string:",
    "OpenGL version string:",
    "OpenGL platform interface:",
    "OpenGL shading language version string:",
    "Driver:",
    "GPU class:",
    "OpenGL version:",
    "GLSL version:",
    "Mesa version:",
    "X server version:",
    "Linux kernel version:",
    "Direct rendering:",
    "Virtual Machine:",
    "OpenGL 2 Shaders are used",
)


def compositor_lines(sections):
    lines = []
    for raw_line in sections.get("Compositing", []):
        text = raw_line.strip()
        if not text:
            continue
        if any(text.startswith(prefix) for prefix in COMPOSITING_PREFIXES):
            lines.append(text)
    backend = list(sections.get("Output backend", []))
    if backend:
        if lines:
            lines.append("")
        lines.append("Output backend:")
        lines.extend(backend)
    return lines


def kwin_option_lines(sections):
    selected = []
    for line in sections.get("Options", []):
        if ":" not in line:
            continue
        key = line.split(":", 1)[0].strip()
        if key in KWIN_OPTION_KEYS:
            selected.append(line.strip())
    return selected


def format_display(display):
    parts = []
    if display.get("connected") is False:
        parts.append("disconnected")
    elif display.get("connected") is True:
        parts.append("connected")

    if display.get("enabled") is False:
        parts.append("disabled")
    elif display.get("enabled") is True:
        parts.append("enabled")

    if "priority" in display:
        parts.append(f"priority {display['priority']}")
    if "mode" in display:
        parts.append(f"mode {display['mode']}")
    if "geometry" in display:
        parts.append(f"geometry {display['geometry']}")
    if "scale" in display:
        parts.append(f"scale {display['scale']}")
    if "rotation" in display:
        rotation = display["rotation"]
        parts.append(f"rotation {ROTATION_NAMES.get(rotation, rotation)}")
    if "replication" in display:
        parts.append(f"mirrors output {display['replication']}")

    detail = ", ".join(parts)
    return f"{display['name']}: {detail}" if detail else display["name"]


def kscreen_displays(warnings):
    output = run(["kscreen-doctor", "-o"], timeout=15)
    if output is None:
        warnings.append(
            "kscreen-doctor is unavailable; display details use KWin support information."
        )
        return []

    displays = []
    current = None
    for line in output.splitlines():
        text = line.strip()
        match = re.match(r"Output:\s+\d+\s+(\S+)", text)
        if match:
            current = {"name": match.group(1)}
            displays.append(current)
            continue
        if current is None:
            continue

        if text in ("enabled", "disabled"):
            current["enabled"] = text == "enabled"
        elif text in ("connected", "disconnected"):
            current["connected"] = text == "connected"
        elif text.startswith("priority "):
            current["priority"] = text.split(None, 1)[1]
        elif text.startswith("Geometry:"):
            current["geometry"] = text.split(":", 1)[1].strip()
        elif text.startswith("Scale:"):
            current["scale"] = text.split(":", 1)[1].strip()
        elif text.startswith("Rotation:"):
            current["rotation"] = text.split(":", 1)[1].strip()
        elif text.startswith("Modes:"):
            for token in text.split():
                if "*" in token:
                    current["mode"] = token.split(":", 1)[-1].rstrip("*!")
                    break
        elif text.startswith("replication source:"):
            source = text.split(":", 1)[1].strip()
            if source and source != "0":
                current["replication"] = source

    return [format_display(display) for display in displays]


def support_displays(sections):
    lines = []
    screens = []
    current = None
    for raw_line in sections.get("Screens", []):
        text = raw_line.strip()
        if text.startswith("Number of Screens:"):
            lines.append(text)
            continue
        match = re.match(r"Screen (\d+):", text)
        if match:
            current = {}
            screens.append(current)
            continue
        if current is None:
            continue
        if text.startswith("Name:"):
            current["name"] = text.split(":", 1)[1].strip()
        elif text.startswith("Geometry:"):
            current["geometry"] = text.split(":", 1)[1].strip()
        elif text.startswith("Scale:"):
            current["scale"] = text.split(":", 1)[1].strip()
        elif text.startswith("Refresh Rate:"):
            current["refresh"] = text.split(":", 1)[1].strip()

    for screen in screens:
        parts = []
        if "geometry" in screen:
            parts.append(f"geometry {screen['geometry']}")
        if "scale" in screen:
            parts.append(f"scale {screen['scale']}")
        if "refresh" in screen:
            parts.append(f"refresh {screen['refresh']} mHz")
        detail = ", ".join(parts)
        name = screen.get("name", "unknown")
        lines.append(f"{name}: {detail}" if detail else name)
    return lines


def plugin_lines(plugins):
    if not plugins:
        return [], [], True

    scripts = []
    other = []
    for key, value in plugins.items():
        if not key.endswith("Enabled"):
            continue
        if value.strip().lower() != "true":
            continue
        plugin_id = key[: -len("Enabled")]
        found = find_script_metadata(plugin_id)
        if found is None:
            other.append(plugin_id)
            continue
        path, scope = found
        data = load_json(path) or {}
        version = str((data.get("KPlugin") or {}).get("Version") or "").strip()
        label = f"{plugin_id} {version}".strip()
        scripts.append(f"{label} ({scope})")

    return sorted(scripts), sorted(other), False


def split_kconfig_list(value):
    """Split a KConfig list value, honoring escaped commas and backslashes."""
    items = []
    current = []
    index = 0
    while index < len(value):
        char = value[index]
        if char == "\\" and index + 1 < len(value):
            current.append(value[index + 1])
            index += 2
            continue
        if char == ",":
            items.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    items.append("".join(current))
    return items


def parse_shortcut_value(value):
    fields = split_kconfig_list(value)
    if len(fields) < 3:
        return None
    current = fields[0]
    name = ",".join(fields[2:]).strip()
    sequences = [
        sequence.strip()
        for sequence in current.split("\t")
        if sequence.strip() and sequence.strip().lower() != "none"
    ]
    return sequences, name


def shortcut_lines(groups, warnings):
    group = groups.get("kwin")
    if group is None:
        warnings.append(
            "kglobalshortcutsrc has no [kwin] group; shortcut assignments are unavailable."
        )
        return []

    entries = []
    all_actions = []
    for key, value in group.items():
        parsed = parse_shortcut_value(value)
        if parsed is None:
            continue
        sequences, name = parsed
        all_actions.append((key, name, sequences))
        if key.startswith("Krohnkite") or name.startswith("Krohnkite:"):
            entries.append((key, name, sequences))

    lines = []
    if entries:
        for key, name, sequences in sorted(entries):
            assigned = ", ".join(sequences) if sequences else "(unassigned)"
            lines.append(
                f"{key} = {json.dumps(redact_value(assigned), ensure_ascii=False)} "
                f"({redact_value(name)})"
            )
    else:
        lines.append(
            "No Krohnkite shortcut overrides are stored in kglobalshortcutsrc."
        )
        lines.append("Krohnkite may still use its built-in default shortcuts.")

    by_sequence = {}
    for key, name, sequences in all_actions:
        for sequence in sequences:
            by_sequence.setdefault(sequence, []).append((key, name))

    conflicts = []
    for sequence, actions in sorted(by_sequence.items()):
        unique = []
        seen = set()
        for key, name in actions:
            if (key, name) in seen:
                continue
            seen.add((key, name))
            unique.append((key, name))
        if len(unique) > 1 and any(key.startswith("Krohnkite") for key, _ in unique):
            conflicts.append((sequence, unique))

    if conflicts:
        lines.append("")
        lines.append("Conflicts with other KWin shortcuts:")
        for sequence, actions in conflicts:
            labels = ", ".join(f"{key} ({redact_value(name)})" for key, name in actions)
            lines.append(f"  {sequence}: {labels}")

    return lines


def is_sensitive_setting(name):
    lower = name.lower()
    return lower in HIDDEN_SETTINGS_LOWER or "title" in lower or "caption" in lower


def format_setting(name, value, status, include_user_rules):
    value = "" if value is None else value
    if is_sensitive_setting(name) and not include_user_rules and value:
        display = f"<hidden: {len(value)} chars>"
    else:
        display = redact_value(value)
    return f"{name} = {json.dumps(display, ensure_ascii=False)} [{status}]"


def settings_lines(schema, values, include_user_rules):
    if not schema:
        lines = [
            "Krohnkite config schema was not found; defaults are unavailable.",
            "",
        ]
        for name in sorted(values):
            lines.append(format_setting(name, values[name], "set", include_user_rules))
        return lines

    lines = []
    known = set()
    for entry in schema:
        name = entry["name"]
        known.add(name)
        if name in values:
            value = values[name]
            status = "set"
        else:
            value = entry["default"] or ""
            status = "default"
        lines.append(format_setting(name, value, status, include_user_rules))

    unknown = sorted(set(values) - known)
    if unknown:
        lines.append("")
        lines.append("Unknown/legacy keys in [Script-krohnkite]:")
        for name in unknown:
            lines.append(
                format_setting(name, values[name], "unknown/legacy", include_user_rules)
            )
    return lines


@lru_cache(maxsize=1)
def redaction_values():
    try:
        username = getpass.getuser()
    except (AttributeError, ImportError, KeyError, OSError):
        username = os.environ.get("USER") or os.environ.get("LOGNAME") or ""

    try:
        hostname = socket.gethostname()
    except OSError:
        hostname = ""

    try:
        home = str(Path.home())
    except RuntimeError:
        home = os.environ.get("HOME") or ""

    return username, hostname, home


def redact_ipv6(match):
    candidate = match.group(0)
    try:
        ipaddress.IPv6Address(candidate)
    except ValueError:
        return candidate
    return "<ip>"


def redact(text):
    """Redact tokens that are safe to remove from the whole report."""
    _, _, home = redaction_values()

    if home:
        text = text.replace(home, "$HOME")
        try:
            text = text.replace(str(Path(home).resolve()), "$HOME")
        except OSError:
            pass
    text = re.sub(r"/home/[^/\s\"']+", "/home/<user>", text)

    text = UUID_RE.sub("<uuid>", text)
    text = EMAIL_RE.sub("<email>", text)
    text = MAC_RE.sub("<mac>", text)
    text = HEX_RE.sub("<hex>", text)
    return text


def redact_value(value):
    """Redact a value that came from the user's environment or configuration.

    Address and name redaction is limited to these values: applying an IPv4
    pattern to the whole report would turn a four-part version like 0.9.11.0
    into <ip>, and a short user name such as "user" occurs in ordinary prose.
    """
    value = redact(value)
    username, hostname, _ = redaction_values()

    if username and len(username) >= 3:
        value = re.sub(rf"(?<![\w.-]){re.escape(username)}(?![\w.-])", "$USER", value)
    if hostname and len(hostname) >= 3:
        # Allow a dot after the host name so a fully qualified name keeps its
        # domain but loses the identifying machine part.
        value = re.sub(rf"(?<![\w.-]){re.escape(hostname)}(?![\w-])", "$HOST", value)

    value = IPV4_RE.sub("<ip>", value)
    value = IPV6_RE.sub(redact_ipv6, value)
    return value


def append_section(lines, title, body):
    lines.append(title)
    lines.append("=" * len(title))
    if body:
        lines.extend(body)
    else:
        lines.append("(none)")
    lines.append("")


def privacy_lines(include_user_rules):
    lines = [
        "This report was generated locally and is not uploaded anywhere.",
        "It does not include the host name, user name, home directory paths,",
        "IP or MAC addresses, UUIDs, monitor model/serial/EDID data, open",
        "windows, window titles, KWin window rules, or journal contents.",
        "",
        "Values of these user-defined settings are hidden by default:",
        "  " + ", ".join(HIDDEN_SETTINGS),
    ]
    if include_user_rules:
        lines.append(
            "They were included because --include-user-rules was used; generic"
        )
        lines.append("token redaction above still applies to the whole report.")
    else:
        lines.append("Use --include-user-rules only when a maintainer asks for them.")
    return lines


def default_filename():
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"krohnkite-diagnostics-{stamp}.txt"


def unique_path(path):
    if not path.exists():
        return path
    for index in range(1, 1000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise OSError(f"Could not find a free filename for {path}")


def write_report(report, output):
    if output is not None:
        path = Path(output).expanduser()
        if path.is_dir():
            path = path / default_filename()
    else:
        path = Path.cwd() / default_filename()

    path = unique_path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(report, encoding="utf-8")
    except OSError:
        path = unique_path(Path(tempfile.gettempdir()) / path.name)
        path.write_text(report, encoding="utf-8")
    return path


def build_report(include_user_rules):
    script_dir = Path(__file__).resolve().parent
    warnings = []

    lines = ["Krohnkite diagnostics", "=" * len("Krohnkite diagnostics")]
    lines.append(f"Collector: {COLLECTOR_VERSION}")
    lines.append(
        f"Generated: {dt.datetime.now().astimezone().isoformat(timespec='seconds')}"
    )
    lines.append(f"Collector Python: {platform.python_version()}")
    lines.append("")

    append_section(lines, "Privacy", privacy_lines(include_user_rules))

    kwinrc_path = config_home() / KWINRC
    if not kwinrc_path.is_file():
        warnings.append(
            "kwinrc was not found; Krohnkite settings are shown with their defaults."
        )
    kwinrc_groups = read_kconfig(kwinrc_path)
    plugins = kwinrc_groups.get("Plugins", {})
    krohnkite_values = kwinrc_groups.get(CONFIG_GROUP, {})

    schema_path = find_schema(script_dir)
    schema = parse_kcfg(schema_path) if schema_path is not None else []

    metadata = find_krohnkite_metadata(script_dir)
    sections = support_information()
    loaded = loaded_state()

    krohnkite_body = []
    if metadata is None:
        warnings.append("Krohnkite package metadata was not found.")
        krohnkite_body.append("Package: not found")
    else:
        scope = {
            "user": "user install",
            "system": "system install",
            "source": "source checkout",
        }.get(metadata["scope"], metadata["scope"])
        krohnkite_body.append(f"Package: {scope}")
        krohnkite_body.append(f"Version: {metadata['version']}")
        krohnkite_body.append(f"Revision: {metadata['revision']}")

    enabled_value = plugins.get("krohnkiteEnabled")
    if enabled_value is None:
        krohnkite_body.append("Enabled in kwinrc: not set")
    elif enabled_value.strip().lower() == "true":
        krohnkite_body.append("Enabled in kwinrc: yes")
    else:
        krohnkite_body.append("Enabled in kwinrc: no")
    krohnkite_body.append(f"Loaded in KWin: {loaded}")
    append_section(lines, "Krohnkite", krohnkite_body)

    os_release = read_os_release()
    system_body = []
    for key in (
        "PRETTY_NAME",
        "NAME",
        "ID",
        "ID_LIKE",
        "VERSION_ID",
        "BUILD_ID",
        "VARIANT_ID",
    ):
        if os_release.get(key):
            system_body.append(f"{key}: {os_release[key]}")
    if not os_release:
        system_body.append("OS release: unavailable")
    system_body.append(f"Kernel: {platform.release()} ({platform.machine()})")
    append_section(lines, "System", system_body)

    session_body = []
    for key in SESSION_VARIABLES:
        value = os.environ.get(key)
        if value:
            session_body.append(f"{key}: {value}")
    if not session_body:
        session_body.append("(no session variables found)")
    append_section(lines, "Session environment", session_body)

    append_section(
        lines,
        "Versions",
        version_lines(sections, warnings) or ["(unavailable)"],
    )
    append_section(
        lines,
        "Compositor",
        compositor_lines(sections) or ["(unavailable)"],
    )

    options = kwin_option_lines(sections)
    if options:
        append_section(lines, "KWin options relevant to focus and placement", options)

    displays = kscreen_displays(warnings)
    if not displays:
        displays = support_displays(sections)
    append_section(
        lines,
        "Displays",
        displays or ["(no display information available)"],
    )

    scripts, other, no_plugins = plugin_lines(plugins)
    script_body = []
    if no_plugins:
        script_body.append("(kwinrc has no [Plugins] group)")
    else:
        if scripts:
            script_body.extend(scripts)
        if other:
            script_body.append("Other enabled plugins/effects:")
            script_body.extend(f"  {item}" for item in other)
        if not scripts and not other:
            script_body.append("(no enabled plugins found)")
        elif not scripts:
            script_body.append("(no script metadata found for enabled plugins)")
    append_section(lines, "KWin scripts and plugins", script_body)

    config_body = [
        f"Source: kwinrc [{CONFIG_GROUP}]",
        "Values are effective: [set] from kwinrc, [default] from the packaged schema.",
        "Newlines and tabs are escaped in the displayed values.",
        "",
    ]
    config_body.extend(settings_lines(schema, krohnkite_values, include_user_rules))
    append_section(lines, "Krohnkite configuration", config_body)

    shortcuts_path = config_home() / SHORTCUTSRC
    if not shortcuts_path.is_file():
        warnings.append(
            "kglobalshortcutsrc was not found; shortcut assignments are unavailable."
        )
    shortcut_body = shortcut_lines(read_kconfig(shortcuts_path), warnings)
    append_section(
        lines,
        "Krohnkite shortcuts",
        shortcut_body or ["(no shortcut information available)"],
    )

    if warnings:
        append_section(
            lines,
            "Collector notes",
            [f"- {warning}" for warning in dict.fromkeys(warnings)],
        )

    return redact("\n".join(lines).rstrip() + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "The report is written next to the current directory by default.\n"
            "Review it before attaching it to an issue."
        ),
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="write the report to PATH (a directory keeps the default filename)",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="print the report to stdout instead of writing a file",
    )
    parser.add_argument(
        "--include-user-rules",
        action="store_true",
        help=(
            "include user-defined title and desktop settings; only use this "
            "when a maintainer asks for them"
        ),
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {COLLECTOR_VERSION}",
    )
    args = parser.parse_args(argv)

    if args.stdout and args.output is not None:
        parser.error("--stdout and --output are mutually exclusive")

    if args.include_user_rules:
        print(
            "Warning: user-defined title/desktop rules are included. "
            "Review the report before sharing it.",
            file=sys.stderr,
        )

    report = build_report(args.include_user_rules)

    if args.stdout or (args.output is not None and str(args.output) == "-"):
        sys.stdout.write(report)
        return 0

    path = write_report(report, args.output)
    try:
        display_path = path.relative_to(Path.cwd())
    except ValueError:
        display_path = path
    print(f"Wrote: {display_path}")
    print("Review the file before attaching it to an issue.")
    if not args.include_user_rules:
        print(
            "User-defined title/desktop rules are hidden. Use "
            "--include-user-rules only if a maintainer asks for them."
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except OSError as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
