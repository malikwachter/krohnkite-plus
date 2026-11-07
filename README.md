# Kröhnkite-Plus

> [!CAUTION]
> **This is completely vibe-coded garbage, written entirely with AI (Claude Code).**
>
> I adapted it for my own personal workflow, for me and nobody else. It is not meant to be a stable solution.
>
> - **No support.** Issues and requests will not be handled.
> - **No warranty** of any kind.
> - **No guarantee** that features stay, keep working or behave consistently. Things can change drastically at any time, because I bend it to fit my own workflow.
>
> **Please use the original instead:** [Kröhnkite on Codeberg](https://codeberg.org/anametologin/Krohnkite).

Kröhnkite-Plus is a fork of [Kröhnkite](https://codeberg.org/anametologin/Krohnkite) (the dynamic tiling script for KWin 6) with smarter window handling: a Smart layout, per-app window rules, smart floating, gaming mode, a live drag preview, smooth animations, zoom, undo/redo and a memory across restarts. It follows the upstream releases; everything upstream offers is still there (see below). The new options live on the **Smart** tab in the script settings.

Internally the script keeps the id `krohnkite`, so existing settings and shortcuts carry over.

## Keys added by Kröhnkite-Plus

| Key              | Action                    |
| ---------------- | ------------------------- |
| Meta + Z         | Zoom (toggle)             |
| Meta + Ctrl + Z  | Undo                      |
| Meta + Ctrl + Y  | Redo                      |
| _unbound_        | Use Smart Layout          |

All keys can be changed in System Settings > Shortcuts > KWin. The upstream keys are listed in the [upstream documentation](https://codeberg.org/anametologin/Krohnkite/wiki).

## Smart layout

A new layout (enabled and first in the order by default) that picks the arrangement that fits the current windows best:

| windows | 16:9 / 16:10        | 21:9 ultrawide         | portrait              |
|---------|---------------------|------------------------|-----------------------|
| 2       | halves              | halves                 | top / bottom          |
| 3       | master + 2 stacked  | master + 2 stacked     | 3 rows                |
| 4       | 2×2 (Quarter)       | 3 columns, last split  | rows                  |
| 5–8     | 3 columns grid      | 3–4 columns grid       | rows grid             |

* **Respects minimal window sizes**: windows no longer overlap their neighbours; if an app (Steam, Discord, settings dialogs…) needs more space, the split moves or a different arrangement is chosen.
* **Remembers your sizes per window count**: resize to 3 windows, open a 4th, close it again – the 3-window sizes are back.
* Windows that can't grow to their tile (max size) are centered instead of sticking to the top-left corner.
* **Focus grow**: the focused window gets extra room (default +50 %, i.e. 60/40 instead of 50/50); neighbours never shrink below their minimal size.
* Shortcuts: *Increase/Decrease* = more/fewer columns, *Rotate* = rows ↔ columns, *Rotate part* = reset sizes, *DWM Left/Right* = move the first split.
* *Preferred tile aspect* (default 130 = 1.3) tunes how eager it is to add columns (lower = more columns).

## Window rules

One rule per line, `<matchers> : <actions>`:

```
class=firefox : master, weight=2
class=mpv : float, size=1280x720, pos=center
class=discord : minwidth=940
class~steam title~"Friends List" : float, size=22%x70%, pos=right
title/^Picture.in.Picture$/ : float, size=30%x30%, pos=bottom-right
class=org.kde.dolphin : tile
```

Matchers: `class`, `title`, `role` with `=` (exact), `~` (substring) or `/regex/`, case-insensitive; `class` also matches resource name and desktop file name.
Actions: `tile` | `float` | `ignore`, `master`, `last`, `weight=N`, `minwidth=` / `minheight=` (px or %), `size=WxH` (px or %), `pos=center|left|right|top|bottom|top-left|top-right|bottom-left|bottom-right`.
Later lines refine earlier ones. Find the class of a window with `qdbus org.kde.KWin /KWin queryWindowInfo` (then click the window).

## Smart floating

* Picture-in-picture windows, fixed-size windows and overlays (hidden from taskbar and pager) float automatically.
* Floating windows remember their position and size per app until KWin restarts.
* Dialogs (settings, file pickers, message boxes) open at their minimal size, centered on the screen instead of on top of their parent window.

## Gaming mode

* Games (window classes containing `steam_app_`, `gamescope`, `steam_proton` – configurable) are never tiled.
* While a fullscreen window is active (game, video), Kröhnkite-Plus pauses: no window is moved or resized and no notification pops up. Everything that happened meanwhile is arranged once you leave fullscreen.

## Drag preview

While dragging a tiled window (layouts without their own dragging, such as Smart, Tile or Columns), the drop is previewed live – on every monitor: a soft silhouette in the accent color shows exactly where the window lands, and the other windows already move to where they will be (the target monitor makes room, the old one closes the gap). Every tile under the cursor is a drop place; dropping does exactly what the preview showed. Dock zones and the Binary Tree layout keep the upstream drag behaviour. The preview is switched with *Show where a dragged window will land* on the Options tab.

## Smooth animations (companion effect "Kröhnkite-Plus Smooth")

KWin scripts can only move windows instantly, so animations live in a small desktop effect that ships with this fork (`krohnkite-smooth-*.zip`, installed by `install.sh`, listed under System Settings → Desktop Effects):

* windows glide and scale smoothly whenever Kröhnkite-Plus changes their size or position – focus grow, the drag preview making room, the dropped window settling into its place, windows opening/closing;
* nothing is animated while you drag or resize a window with the mouse; maximize/fullscreen are left to KDE's own effects;
* the drag preview box grows out of the middle of the space that is being freed, in sync with the windows moving away.

Speed: *Animation speed* on the Smart tab (default 150 ms, 0 = off). Kröhnkite-Plus passes the value to the effect when the script starts.

## Zoom

*Meta+Z* lifts the focused tile into a centered, almost fullscreen view (a bit more free space left/right than top/bottom, see *Zoom margin* on the Smart tab). It never really floats: its place in the layout stays reserved, and it goes back as soon as you press *Meta+Z* again or focus another window (dialogs of the zoomed app do not end the zoom).

## Undo / Redo

*Meta+Ctrl+Z* undoes, *Meta+Ctrl+Y* redoes the last change you made: window order (keys, drag & drop), floating/tiling, moving to another monitor, layout switches and split sizes. Windows opening or closing are no steps. Plain Ctrl+Z is not used on purpose, it would take undo away from every application. All keys can be changed in System Settings > Shortcuts > KWin.

## Memory across restarts

Split ratios of the Smart layout, the selected layout per screen/desktop, learned minimal sizes and floating window positions are saved to `~/.local/share/krohnkite/state.json` (written a few seconds after a change) and restored after login and after a settings change. Delete the file to start fresh.

## Releases

Ready-made files are on the [releases page](https://github.com/malikwachter/krohnkite-plus/releases). Download the `.kwinscript`, the `krohnkite-smooth-*.zip` and `install.sh` into one folder and run `bash install.sh`.

Development happens in branches. Every merge into `master` builds a new release (`plus19`, `plus20`, …) with a changelog of everything since the previous one (`.github/workflows/release.yml`, notes from `tools/release-notes.sh`).

## Build & install

```
make package        # krohnkite-*.kwinscript + krohnkite-smooth-*.zip (needs node/npm, zip or 7z)
./install.sh        # installs both and enables the effect
npm test            # upstream tests + the Kröhnkite-Plus tests in node
```

---

# Kröhnkite

[Documentation](https://codeberg.org/anametologin/Krohnkite/wiki) | [Tips](https://codeberg.org/anametologin/Krohnkite/wiki/Tips)

Author of [Kröhnkite](https://github.com/esjeon/krohnkite). A dynamic tiling extension for KWin 6 only.
Kröhnkite is mainly inspired by [dwm][] from suckless folks, and aims to
provide rock solid stability while fully integrating into KWin.

The name of the script is from mineral [Kröhnkite][wikipedia]; it starts with
K and looks cool.

[dwm]: https://dwm.suckless.org/
[wikipedia]: https://en.wikipedia.org/wiki/Kr%C3%B6hnkite

![Kröhnkite binary tree layout](img/demo.gif)

## Features

- DWM-like window tiling
  - Dynamically tile windows, rather than manually placing each
  - Floating windows
- Fully integrates into KWin features, including:
  - **Multi-screen**
  - **Activities & Virtual desktop**
  - Basic window management (minimize, fullscreen, switching, etc.)
- Multiple Layout Support
  - Tiling layout
  - Monocle layout
  - Desktop-friendly layouts (Spread, Stair)

## Development Requirements

- Typescript (see package.json)
- [go-task](https://github.com/go-task/task)
- p7zip (7z)
- python3 (reload helper and its tests)

`go-task reload`, `go-task reload-file`, and the development autoinstall daemon
(`tools/autoinstall`) also need a running KWin session with `qdbus6` reachable on
the session bus; nothing else in the project uses it.

Run the automated tests with `go-task test` (or `npm run check`). The reload
helper tests use an isolated fake `qdbus6`; they do not contact KWin.

## Look at me
### Reload Krohnkite configuration
&emsp;<b>Important:</b> After changing the configuration, simply clicking `Apply` is not enough, ask KWin to reload its configuration
   ```sh
   qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
   ```

### Apply code changes without logout

```sh
go-task reload
```

This builds, installs, and reloads Kröhnkite through KWin's scripting interface.
Every reload copies the complete bundle to a fresh cache directory, bypassing
cached QML and JavaScript, and starts the reloaded script through KWin's scripting
interface. KWin starts every script that is still pending at that point; a reload
leaves the reloaded script as the pending one. No logout or compositor restart is
required. The copied bundle stays available for lazy
resource loading, and superseded bundles are deleted. After each successful
reload, the helper records that bundle path under the cache directory. If a later
replacement is refused by KWin, it best-effort reloads the last known working
bundle; recovery is unavailable when no prior bundle is recorded or its files are
gone, and does not guarantee exact restoration. QML errors inside a bundle appear
in KWin's journal only, so a bundle that loads but fails to run is not rolled back.
For a command preview: `python3 tools/reload-script.py pkg --dry-run`.

A package that is already built or downloaded needs no rebuild:

```sh
go-task reload-file -- path/to/krohnkite-*.kwinscript
```

The helper accepts a build directory or a `.kwinscript` archive.

`go-task reload` and `go-task reload-file` are the paths that take effect without
a restart. A package installed or upgraded any other way - `go-task install` or
`kpackagetool6` - is picked up only after KWin starts again, so log out and back
in (or restart the compositor). The autoinstall daemon runs the same helper after
every successful install, but only when Krohnkite is already loaded; a package
installed by it while the script is not loaded is used on the next login.

### Enable Krohnkite
```
kwriteconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled true && qdbus6 org.kde.KWin /KWin reconfigure
```
### Disable Krohnkite
```
kwriteconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled false && qdbus6 org.kde.KWin /KWin reconfigure
```
### Troubleshooting

1. Delete unused KWin shortcuts. You can use any D-Bus program which can invoke D-Bus methods. Service name -`org.kde.kglobalaccel` path - `/component/kwin` method - `org.kde.kglobalaccel.Component.cleanUp`. Arch Linux example:

   ```sh
   qdbus6 org.kde.kglobalaccel /component/kwin org.kde.kglobalaccel.Component.cleanUp
   ```

2. If you have a gap or you have gray rectangle (or white, etc.), that means that there is a program with size 1x1 that has to be filtered by title or other ways. Make sure that the following programs, if you have them, have been added to the filter:

   ```
   xwaylandvideobridge,plasmashell,ksplashqml
   ```

### Collect diagnostics for a bug report

Krohnkite ships a read-only diagnostics collector (Python 3 is required):

```sh
python3 ~/.local/share/kwin/scripts/krohnkite/contents/code/collect-diagnostics.py
```

It writes `krohnkite-diagnostics-*.txt` with the Plasma, KWin and Qt versions,
the display layout, enabled KWin scripts, every Krohnkite setting, and shortcut
conflicts. Values of user-defined title and desktop rules are hidden by default;
the collector can include them only when a maintainer asks for them. The report
is generated locally and is never uploaded. It does not contain your host name,
user name, home directory paths, IP or MAC addresses, UUIDs, monitor serial
numbers or EDID data, open windows, window titles, KWin window rules, or journal
contents.

If Krohnkite is installed system-wide or the path above does not exist, download
the latest collector:

```sh
curl -fsSLO https://codeberg.org/anametologin/Krohnkite/raw/branch/master/tools/collect-diagnostics.py
python3 collect-diagnostics.py
```

Review the generated file before attaching it to an issue. If a maintainer asks
for the hidden user-defined values, rerun with `--include-user-rules` and review
the result again before sharing it.

## Installation

You can install Kröhnkite in multiple ways.

### Using .kwinscript package file

You can download `krohnkite-x.x.x.x.kwinscript` file, and install it through
_System Settings_.

1. Download the kwinscript file
2. Open `System Settings` > `Window Management` > `KWin Scripts`
3. Press `Import KWin script...` on the top-right corner
4. Select the downloaded file

Alternatively, through command-line:
get info about package:

```
kpackagetool6 -t KWin/Script -s krohnkite
```

install:

```
kpackagetool6 -t KWin/Script -i krohnkite-x.x.x.x.kwinscript
```

upgrade:

```
kpackagetool6 -t KWin/Script -u krohnkite-x.x.x.x.kwinscript
```

uninstall:

```
kpackagetool6 -t KWin/Script -r krohnkite
```

### Installing from Git repository

Make sure you have [go-task](https://taskfile.dev/installation/), [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), [7-zip](https://www.7-zip.org/download.html) and Python 3 packages installed. All packages after building will be in `builds` folder.
The simplest method to automatically build and install kwinscript package would be:

```
go-task install
```

The new code is used after the next login; use `go-task reload` to switch without
logging out.

You can also build `.kwinscript` package file using:

```
go-task package
```

uninstall package:

```
go-task uninstall
```

## Tests

Run the full test suite with `go-task test` (or `npm run check`). The layout
icon tests run against the real installer in isolated temporary XDG data
directories. The native Qt UI rendering check runs when PySide6 is installed
and otherwise reports an explicit skip. `npm test` runs only the layout icon
tests.

## Settings

### Add a class name, a resource name or a window caption to ignore or float

1. to find window's className, resourcename, or caption, see [readme](https://github.com/anametologin/krohnkite#search-a-window-parameters-to-filter-float-etc)
2. you can use the name of class in square brackets: `[myNamE]` will float or ignore all windows with class or resource names such: 'myname1', 'Myname2', 'Notmyname555' etc...

### Choose layout for screen by default

1. Open Krohnkite options: ![options](img/conf.png)
2. Tab `Rules->Screen default layout`. Layout configuration has format `OutputName:ActivityId:VirtualDesktopName:layoutName`.

Multi monitor example:

`HDMI-A-1:99a12h44-e9a6-1142-55eedaa7-3a922a15ab08::columns,DP-2:spread,DP-3:Desktop 3:tile,:threecolumn`

The result will be:

- set `columns` layout as default on monitor `HDMI-A-1`, only on activity with id:`99a12h44-e9a6-1142-55eedaa7-3a922a15ab08`, every virtual desktop on this activity. If you specify `activity id`, you have to specify the virtual desktop name or leave it blank;
- set `spreadlayout` layout as default on monitor `DP-2`, on every Activity, on every virtual desktop;
- set `tilelayout` layout as default on monitor `DP-3`, on every activity, only on virtual desktop with name `Desktop 3`;
- set `threecolumnlayout` layout as default on all monitors, all activities, and all virtual desktops not covered by the previous rules.

2. How to find `outputName`, `activityId`, `VirtualDesktopName`, `layoutName`: Right after system boot, run `KSystemLog`

   - Push ignore button
   - Type in filter string: `krohnkite`
   - Right after `KROHNKITE: starting the script` string you will see one if you have one monitor or multiple lines: Screen(output):`Screen Name`,Desktop(name):`Virtual Desktop Name`,Activity:`Activity Id`,layouts: `numbered layouts` (the case doesn't matter,`layout` ending can be omitted): `tilelayout`, `monoclelayout`, `columns`, `threecolumnlayout,` `spreadlayout`, `stairlayout`, `spirallayout`, `stackedlayout`, `floatinglayout`, `btreelayout`

3. Press `Apply`, then run
   `qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure`.

### Search a window parameters to filter, float etc.

1. Krohnkite options: ![options](img/conf.png)
2. Options->Debug new Windows
3. Press `Apply`, then run `qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure`
4. Run KSystemLog
5. Push `Ignore` button
6. Type in filter string: `krohnkite`
7. All created windows krohnkite working with will be there.
8. Every debug entry contains parameters except those that are false and empty.

## Icons

Kröhnkite ships its artwork as shared SVGs: layout pictograms in `res/layouts/`
and the application icon in `res/appicon/`. Install registers
`krohnkite-layout-*` under `$XDG_DATA_HOME/icons/hicolor/scalable/actions` and
`krohnkite.svg` under `$XDG_DATA_HOME/icons/hicolor/scalable/apps` (normally
`~/.local/share/icons`). `res/metadata.json` refers to the application icon by
its theme name, so KWin, System Settings and the KDE Store entry all use the
same artwork without any raster copy. Python 3 is required. `xdg-icon-resource`
refreshes the icon cache; if it is unavailable, the icons are still installed
and the refresh is retried on the next start.

Direct `.kwinscript` installs register the icons at KWin startup when the
optional `org.kde.plasma.plasma5support` QML module is available (some Plasma 6
systems ship it separately). Without that module the script still runs, KWin
logs a warning, and the icons are not installed automatically; run the
package's `contents/code/install-icons.py` manually, for example:

```
python3 ~/.local/share/kwin/scripts/krohnkite/contents/code/install-icons.py
```

Repository installs (`go-task install`) are not affected. Reopen settings after
installation. `go-task uninstall` removes only these icons.

The application icon is resolved by its theme name only: if it was never
installed, KWin shows a blank icon for the script instead of falling back to
another one. Running the installer once is enough to fix that.

## Useful Development Resources

- [KWin Scripting Tutorial](https://develop.kde.org/docs/plasma/kwin/)
- [KWin Scripting API](https://develop.kde.org/docs/plasma/kwin/api/)
- Adding configuration dialog
  - [Development/Tutorials/Plasma/JavaScript/ConfigDialog](https://techbase.kde.org/Development/Tutorials/Plasma/JavaScript/ConfigDialog)
  - [Development/Tutorials/Using KConfig XT](https://techbase.kde.org/Development/Tutorials/Using_KConfig_XT)
- `*.ui` files can be edited with [Qt Designer](http://doc.qt.io/qt-5/qtdesigner-manual.html).
  It's very straight-forward if you're used to UI programming.
