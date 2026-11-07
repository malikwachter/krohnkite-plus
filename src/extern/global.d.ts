/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

/* KWin global objects */
// declare var workspace: Workspace;
declare var KWIN: KWin;
// declare var shortcuts: IShortcuts;
declare function print(s: string): void;
// declare function readConfig(params: any): void;

interface Api {
  workspace: Workspace;
  kwin: KWin;
  shortcuts: ShortcutsQml;
  dbus: IDBusQml;
  shell?: IShellQml | null;
  /** getter: the Loader may switch to the fallback file after start */
  preview?: (() => IDropPreviewQml | null) | null;
}
interface IDropPreviewQml {
  show(
    key: string,
    ox: number, oy: number, ow: number, oh: number,
    x: number, y: number, w: number, h: number,
    swap: boolean,
    ms: number,
  ): void;
  hide(): void;
}
declare var KWINCONFIG: KWinConfig;
/* QML objects */
declare var activityInfo: Plasma.TaskManager.ActivityInfo;
declare var mousePoller: Plasma.PlasmaCore.DataSource;
declare var scriptRoot: object;

interface LayoutOSDEntry {
  id: string;
  name: string;
  icon: string;
}

interface PopupDialog {
  showNotification(text: string, duration: number): void;
  showLayouts(
    entries: LayoutOSDEntry[],
    selected: string,
    duration: number,
  ): void;
  showLayoutShortcut(entry: LayoutOSDEntry, duration: number): void;
}
declare var popupDialog: PopupDialog;

interface LayoutChooserDialog {
  showLayouts(
    entries: LayoutOSDEntry[],
    selected: string,
    duration: number,
  ): void;
  isOpen(): boolean;
  hide(): void;
  navigate(dx: number, dy: number): void;
}
declare var layoutChooserDialog: LayoutChooserDialog;

interface DragPreview {
  showRect(
    areaX: number,
    areaY: number,
    areaWidth: number,
    areaHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
    frameColor: string,
    borderColor: string,
  ): void;
  hide(): void;
}
declare var dragPreview: DragPreview;

/* Common Javascript globals */
declare let console: any;
declare let setTimeout: any;
