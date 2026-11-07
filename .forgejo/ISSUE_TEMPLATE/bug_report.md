---
name: Bug report
about: Report something that does not work as expected
title: ''
labels:
  - bug
---

<!--
Please search existing issues before filing a new one.
Questions are welcome as issues with the "question" label.
-->

## Checklist

- [ ] I searched the existing issues and did not find a duplicate.
- [ ] I logged out and back in after installing or updating Krohnkite.
- [ ] The problem disappears when Krohnkite is disabled.
- [ ] I attached the diagnostics file described below.

## Symptom

A short description of the problem.

## Steps to reproduce

1. ...
2. ...
3. ...

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened.

## Frequency and regression

- Always / intermittent / happened once:
- Worked before version / started after updating to:

## Diagnostics

Run the collector (Python 3 is required):

```sh
python3 ~/.local/share/kwin/scripts/krohnkite/contents/code/collect-diagnostics.py
```

If that file does not exist (for example, with a system-wide install or an
older Krohnkite), download and run the latest collector:

```sh
curl -fsSLO https://codeberg.org/anametologin/Krohnkite/raw/branch/master/tools/collect-diagnostics.py
python3 collect-diagnostics.py
```

Attach the generated `krohnkite-diagnostics-*.txt` file to this issue.

The report is generated locally and is never uploaded automatically. It does
not include your host name, user name, home directory paths, IP or MAC
addresses, UUIDs, monitor model/serial/EDID data, open windows, window titles,
KWin window rules, or journal contents. User-defined window-title and desktop
rules are hidden by default. Review the file before posting it. If a maintainer
asks for those hidden values, rerun the collector with
`--include-user-rules` and review the file again.

## Environment (only if the diagnostics file is unavailable)

- Distribution:
- Plasma version:
- KWin version:
- Krohnkite version:
- Session type (Wayland/X11):

## Logs (only when a maintainer asks)

Do not attach logs by default: KWin logs can contain window titles and other
private data. If a maintainer asks for logs, enable Krohnkite logging, reproduce
the problem, attach only the relevant lines, and remove anything private first.

## Notes

Anything else that may help. Screenshots or a short screen recording are useful
for visual problems.
