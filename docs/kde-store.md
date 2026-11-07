# KDE Store listing

Store page: <https://store.kde.org/p/2144146>

Pling/OpenDesktop parses product descriptions and changelogs as **Markdown**:
descriptions of recently published products come back from the API with
`<strong>`, `<code>` and `<a>` for Markdown input, while BBCode tags stay
literal. Lists and headings are not rendered reliably, so the text below uses
bold labels and plain bullet lines that stay readable even when the parser
leaves them alone. The summary field is plain text.

## Summary

```text
A dynamic tiling extension for KWin 6, inspired by dwm.
```

## Product description

```markdown
**Kröhnkite — dynamic tiling for KWin**

Kröhnkite is a dynamic tiling extension for KWin, the window manager of KDE Plasma 6. It tiles windows automatically according to the layout you choose, instead of making you place and resize every window by hand, while still integrating with KWin: multiple monitors, activities, virtual desktops, panels and native shortcuts keep working.

Kröhnkite is inspired by **dwm** from the suckless community and aims to stay simple in both development and usage.

**Layouts**

- Tile, Monocle, Three Column, Spiral, Quarter, Stacked, Columns, Spread, Floating, Stair, Cascade and Binary Tree (dwindle)
- Choose the layout per screen, activity and virtual desktop, or open the interactive layout chooser
- Enable only the layouts you need and set their rotation order
- Live drag and drop: move a window onto another tile, a screen edge or a dock slot

**Window management**

- Surface capacity: limit how many windows a layout or a custom surface can hold; extra windows are minimized (default) or floated, and can be moved to other screens or virtual desktops
- Docks: stack several windows on the same screen side, insert, swap and reorder them
- Floating windows with configurable size, placement and move/resize step
- Optional pointer following: move the cursor to the focused window or screen centre on focus or resize
- Shortcut sequences: bind any action to a key sequence and override actions in register (meta) mode

**Fit and finish**

- Layout change OSD and interactive chooser using the same SVG pictograms as the settings page
- Per-surface overrides for gaps, capacity and overcapacity handling
- Russian and Chinese translations
- MIT licensed

**Installation**

1. Download `krohnkite.kwinscript`
2. Open System Settings, Window Management, KWin Scripts
3. Use "Import KWin script..." in the top-right corner and select the file
4. Enable Krohnkite, press Apply, then log out and back in

Or from a terminal, run `kpackagetool6 -t KWin/Script -i krohnkite.kwinscript`, then log out and back in so KWin loads the new package.

After changing the configuration, ask KWin to reload it with `qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure`.

**Compatibility**

KWin 6 (KDE Plasma 6). Per-screen virtual desktops require KWin 6.7 or later. Existing configurations are preserved when upgrading.

**Links**

- [Source code and issue tracker](https://codeberg.org/anametologin/Krohnkite)
- [Documentation and tips](https://codeberg.org/anametologin/Krohnkite/wiki)
```

## Changelog 0.9.11.0

```markdown
**Kröhnkite 0.9.11.0**

An interactive layout chooser, a new overcapacity policy, multi-window docks and a dwindle mode for the Binary Tree layout.

- New LayoutChooser action: click a layout or pick it with the focus shortcuts; the pointer moves to the screen centre
- Overcapacity windows are minimized by default and restored when a slot frees up; the eviction policy is configurable (last focused or oldest)
- Optional shortcut moves to a full surface: the moved window stays and another window is evicted
- New ShowCurrentCapacity action, bound as the register action of RaiseSurfaceCapacity
- Docks can hold several windows per side, with drag insertion, swapping and shortcut reordering
- Binary Tree layout: dwindle behaviour, drag and drop, outer tiles and SwapUp/SwapDown
- Pointer options: centre on the focused window when it resizes, and follow focus only on Krohnkite shortcuts
- Per-layout enable checkboxes and layout order starting at 1
- The configuration dialog floats in System Settings; KDE system windows are always ignored
- Reload Kröhnkite without logging out (go-task reload)
- Updated Russian and Chinese translations
```
