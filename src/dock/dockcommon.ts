/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

const DockPosition = {
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
} as const;
type DockPosition = (typeof DockPosition)[keyof typeof DockPosition];

const HDockAlignment = {
  center: 1,
  left: 2,
  right: 3,
} as const;
type HDockAlignment = (typeof HDockAlignment)[keyof typeof HDockAlignment];

const VDockAlignment = {
  center: 1,
  top: 2,
  bottom: 3,
} as const;
type VDockAlignment = (typeof VDockAlignment)[keyof typeof VDockAlignment];

const EdgeAlignment = {
  outside: 1,
  middle: 2,
  inside: 3,
} as const;
type EdgeAlignment = (typeof EdgeAlignment)[keyof typeof EdgeAlignment];

interface IDockCfg {
  hHeight: number;
  hWide: number;
  hEdgeGap: number;
  hGap: number;
  hAlignment: HDockAlignment;
  hEdgeAlignment: EdgeAlignment;
  vHeight: number;
  vWide: number;
  vEdgeGap: number;
  vGap: number;
  vEdgeAlignment: VDockAlignment;
  vAlignment: VDockAlignment;
}

interface IDock {
  renderedOutputId: string;
  renderedTime: number | null;
  priority: number;
  position: DockPosition | null;
  caption: string | null;
  autoDock: boolean;
  cfg: IDockCfg;
  clone(): IDock;
}

interface IDockEntry {
  tilesArea: Rect | null;
  id: string;
  slots: DockSlot[];
  remove(window: WindowClass): void;
  clearSlots(): void;
  arrange(dockedWindows: WindowClass[], workingArea: Rect): Rect;
  handleShortcut(window: WindowClass, shortcut: KrohnkiteAction): boolean;
}

interface IDockStore {
  render(srf: ISurface, win: WindowClass[], workingArea: Rect): Rect;
  attachWindow(window: WindowClass): void;
}

interface DockDragSnapshot {
  srfId: string;
  slots: { position: DockPosition; windows: WindowClass[] }[];
  states: {
    window: WindowClass;
    state: WindowState;
    dockPosition: DockPosition | null;
    geometry: Rect;
  }[];
}
