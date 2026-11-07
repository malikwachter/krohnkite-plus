/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface DockSurfaceCfg {
  srfLabel: string;
  cfg: IDockCfg;
}

type DockHitZone = "before" | "after" | "swap" | "append";

interface DockHit {
  position: DockPosition | null;
  window: WindowClass | null;
  index: number;
  zone: DockHitZone;
}

class DockStore implements IDockStore {
  private store: { [SurfaceId: string]: DockEntry };
  private defaultCfg: DefaultDockCfg | null;
  private surfacesCfg: DockSurfaceCfg[];
  private windowClassesCfg: { [windowClassName: string]: IDock };

  constructor() {
    this.store = {};
    this.defaultCfg = DefaultDockCfg.instance;
    this.surfacesCfg = parseDockUserSurfacesCfg();
    this.windowClassesCfg = parseDockUserWindowClassesCfg();
  }

  public render(
    srf: ISurface,
    visibles: WindowClass[],
    workingArea: Rect,
  ): Rect {
    const entry = this.getOrCreateEntry(srf);
    const dockedWindows = visibles.filter(
      (w) => w.state === WindowState.Docked,
    );
    if (dockedWindows.length === 0) {
      entry.clearSlots();
      entry.tilesArea = workingArea;
    } else {
      entry.tilesArea = entry.arrange(dockedWindows, workingArea);
    }
    return entry.tilesArea;
  }

  private getOrCreateEntry(srf: ISurface): DockEntry {
    let entry = this.store[srf.id];
    if (!entry) {
      entry = new DockEntry(this.getSurfaceCfg(srf), srf.id);
      this.store[srf.id] = entry;
    }
    return entry;
  }

  /**
   * Attach the configured dock template to the window, so that its `dock`
   * property can be instantiated lazily when it is actually docked.
   */
  public attachWindow(window: WindowClass): void {
    const cfg = this.windowClassesCfg[window.windowClassName];
    window.setDockTemplate(cfg ?? new Dock(this.getSurfaceCfg(window.surface)));
  }

  public drag(dragAction: DragAction): void {
    const window = dragAction.window;
    const result = dragAction.result;
    const wasDocked = dragAction.initialState === WindowState.Docked;
    const entry = this.getOrCreateEntry(dragAction.srf);
    dragAction.tilesArea = entry.tilesArea;

    if (wasDocked) {
      const source = this.findWindow(window);
      if (source !== null) this.ensureSnapshot(dragAction, source.entry);
    }
    this.ensureSnapshot(dragAction, entry);
    this.restoreSnapshots(dragAction);
    const wasPreviewDocked = window.state === WindowState.Docked;
    if (!wasDocked) window.setTransientState(dragAction.initialState);

    const dockHit = this.getDockPosition(dragAction, entry);

    if (dockHit.position === null) {
      dragAction.dockTarget = null;
      if (!wasDocked) {
        if (wasPreviewDocked) {
          result.isProcessed = true;
          result.isArrangeNeeded = true;
        } else {
          result.isProcessed = false;
          result.isArrangeNeeded = false;
        }
        return;
      }
      this.remove(window);
      window.setTransientState(WindowState.Tiled);
      result.isProcessed = true;
      result.isArrangeNeeded = true;
      return;
    }

    dragAction.dockTarget = dockHit.position;

    if (dockHit.window === window) {
      result.isProcessed = true;
      result.isArrangeNeeded = true;
      return;
    }

    if (dockHit.window !== null && dockHit.zone === "swap") {
      this.swapWith(dragAction, entry, dockHit, wasDocked);
    } else {
      this.insertAt(dragAction, entry, dockHit);
    }
    result.isProcessed = true;
    result.isArrangeNeeded = true;
  }

  public finishDrag(dragAction: DragAction): void {
    for (const id in dragAction.dockSnapshots) {
      const snapshot = dragAction.dockSnapshots[id];
      for (const saved of snapshot.states) {
        if (
          saved.state === WindowState.Docked &&
          saved.window.state !== WindowState.Docked
        )
          saved.window.previousState = WindowState.Docked;
      }
    }
    dragAction.dockSnapshots = {};
  }

  public adjust(
    basis: WindowClass,
    widthDiff: number,
    heightDiff: number,
  ): void {
    const cfg = basis.dock.cfg;
    const workingArea = basis.surface.workingArea;
    const entry = this.store[basis.surface.id];
    switch (basis.dock.position) {
      case DockPosition.left:
      case DockPosition.right:
        cfg.vHeight =
          cfg.vHeight + (100 * heightDiff) / workingArea.height;
        {
          const size = cfg.vWide + (100 * widthDiff) / workingArea.width;
          if (entry === undefined || !entry.setCrossSize(basis, size))
            cfg.vWide = size;
        }
        break;
      case DockPosition.top:
      case DockPosition.bottom:
        cfg.hWide = cfg.hWide + (100 * widthDiff) / workingArea.width;
        {
          const size = cfg.hHeight + (100 * heightDiff) / workingArea.height;
          if (entry === undefined || !entry.setCrossSize(basis, size))
            cfg.hHeight = size;
        }
        break;
    }
  }

  private swapWith(
    dragAction: DragAction,
    entry: DockEntry,
    dockHit: DockHit,
    wasDocked: boolean,
  ): void {
    const window = dragAction.window;
    const target = dockHit.window!;
    const targetSlot = entry.slots.find(
      (slot) => slot.position === dockHit.position,
    );
    if (targetSlot === undefined) return;
    const targetIndex = targetSlot.indexOf(target);

    if (!wasDocked) {
      targetSlot.remove(target);
      target.setTransientState(WindowState.Tiled);
      this.remove(window);
      targetSlot.add(window, targetIndex);
      window.setTransientState(WindowState.Docked);
      window.dock.position = targetSlot.position;
      return;
    }

    const source = this.findWindow(window);
    if (source === null) {
      this.insertAt(dragAction, entry, {
        position: targetSlot.position,
        window: null,
        index: targetIndex,
        zone: "append",
      });
      return;
    }

    if (source.entry === entry && source.slot === targetSlot) {
      const sourceIndex = source.index;
      const temporary = source.slot.windows[sourceIndex];
      source.slot.windows[sourceIndex] = target;
      source.slot.windows[targetIndex] = temporary;
      return;
    }

    source.slot.remove(window);
    targetSlot.remove(target);
    source.slot.add(target, source.index);
    targetSlot.add(window, targetIndex);
    target.setTransientState(WindowState.Docked);
    window.setTransientState(WindowState.Docked);
    target.dock.position = source.slot.position;
    window.dock.position = targetSlot.position;
  }

  private insertAt(
    dragAction: DragAction,
    entry: DockEntry,
    dockHit: DockHit,
  ): void {
    if (dockHit.position === null) return;
    const targetSlot = entry.slots.find(
      (slot) => slot.position === dockHit.position,
    );
    if (targetSlot === undefined) return;
    let index =
      dockHit.zone === "after" ? dockHit.index + 1 : dockHit.index;
    const source = this.findWindow(dragAction.window);
    if (
      source !== null &&
      source.entry === entry &&
      source.slot === targetSlot &&
      source.index < index
    )
      index = index - 1;

    this.remove(dragAction.window);
    targetSlot.add(dragAction.window, index);
    dragAction.window.setTransientState(WindowState.Docked);
    dragAction.window.dock.position = targetSlot.position;
  }

  private ensureSnapshot(dragAction: DragAction, entry: DockEntry): void {
    if (dragAction.dockSnapshots[entry.id] !== undefined) return;
    const states: {
      window: WindowClass;
      state: WindowState;
      dockPosition: DockPosition | null;
      geometry: Rect;
    }[] = [];
    for (const slot of entry.slots) {
      for (const window of slot.windows)
        states.push({
          window,
          state: window.state,
          dockPosition: window.dock.position,
          geometry: window.geometry.clone(),
        });
    }
    dragAction.dockSnapshots[entry.id] = {
      srfId: entry.id,
      slots: entry.slots.map((slot) => ({
        position: slot.position,
        windows: slot.windows.slice(),
      })),
      states,
    };
  }

  private restoreSnapshots(dragAction: DragAction): void {
    for (const id in dragAction.dockSnapshots) {
      const entry = this.store[id];
      if (entry === undefined) continue;
      const snapshot = dragAction.dockSnapshots[id];
      for (const slot of entry.slots) {
        const saved = snapshot.slots.find(
          (savedSlot) => savedSlot.position === slot.position,
        );
        slot.windows = saved === undefined ? [] : saved.windows.slice();
      }
      for (const saved of snapshot.states) {
        saved.window.setTransientState(saved.state);
        saved.window.dock.position = saved.dockPosition;
        saved.window.geometry = saved.geometry.clone();
      }
    }
  }

  private findWindow(
    window: WindowClass,
  ): { entry: DockEntry; slot: DockSlot; index: number } | null {
    for (const id in this.store) {
      const entry = this.store[id];
      const found = entry.findWindow(window);
      if (found !== null) return { entry, ...found };
    }
    return null;
  }

  private getDockPosition(dragAction: DragAction, entry: DockEntry): DockHit {
    const {
      mousePointer,
      middlePointer,
      neighbors,
      workingArea,
      window,
    } = dragAction;
    const canSwap = entry.id === dragAction.initialSrfId;

    for (const dockSlot of entry.slots) {
      for (const target of dockSlot.windows) {
        if (target.state !== WindowState.Docked) continue;
        if (target.geometry === null) continue;
        const point = target.geometry.includesPoint(mousePointer)
          ? mousePointer
          : target.geometry.includesPoint(middlePointer)
            ? middlePointer
            : null;
        if (point === null) continue;
        const index = dockSlot.indexOf(target);
        if (target === window)
          return {
            position: dockSlot.position,
            window: target,
            index,
            zone: "swap",
          };
        let zone: DockHitZone = "swap";
        if (
          dockSlot.position === DockPosition.left ||
          dockSlot.position === DockPosition.right
        ) {
          if (target.geometry.height > 0) {
            const relative =
              (point.y - target.geometry.y) / target.geometry.height;
            if (relative < 0.25) zone = "before";
            else if (relative > 0.75) zone = "after";
          }
        } else if (target.geometry.width > 0) {
          const relative =
            (point.x - target.geometry.x) / target.geometry.width;
          if (relative < 0.25) zone = "before";
          else if (relative > 0.75) zone = "after";
        }
        /* Swapping across outputs is not supported: a middle-zone hit on
         * another output inserts before the target instead. */
        if (!canSwap && zone === "swap") zone = "before";
        return {
          position: dockSlot.position,
          window: target,
          index,
          zone,
        };
      }
    }

    for (const dockSlot of entry.slots) {
      const dragZone =
        dockSlot.position === DockPosition.top
          ? CONFIG.dockTopDragZone
          : dockSlot.position === DockPosition.bottom
            ? CONFIG.dockBottomDragZone
            : dockSlot.position === DockPosition.left
              ? CONFIG.dockLeftDragZone
              : CONFIG.dockRightDragZone;
      if (!this.isSideZoneHit(dragAction, dockSlot.position, dragZone))
        continue;
      const point = this.getSidePoint(dragAction, dockSlot.position);
      return {
        position: dockSlot.position,
        window: null,
        index: this.getInsertionIndex(dockSlot, point, dockSlot.position),
        zone: "append",
      };
    }

    return { position: null, window: null, index: 0, zone: "append" };
  }

  private getSidePoint(
    dragAction: DragAction,
    position: DockPosition,
  ): QPoint {
    const { mousePointer, middlePointer, neighbors } = dragAction;
    switch (position) {
      case DockPosition.top:
        return neighbors.up ? middlePointer : mousePointer;
      case DockPosition.bottom:
        return neighbors.down ? middlePointer : mousePointer;
      case DockPosition.left:
        return neighbors.left ? middlePointer : mousePointer;
      case DockPosition.right:
        return neighbors.right ? middlePointer : mousePointer;
    }
  }

  private isSideZoneHit(
    dragAction: DragAction,
    position: DockPosition,
    dragZone: number,
  ): boolean {
    if (dragZone <= 0) return false;
    const { workingArea, neighbors } = dragAction;
    const point = this.getSidePoint(dragAction, position);
    switch (position) {
      case DockPosition.top:
        return workingArea.isTopZone(
          point,
          dragZone,
          "pixels",
          !neighbors.up,
        );
      case DockPosition.left:
        return workingArea.isLeftZone(
          point,
          dragZone,
          "pixels",
          !neighbors.left,
        );
      case DockPosition.right:
        return workingArea.isRightZone(
          point,
          dragZone,
          "pixels",
          !neighbors.right,
        );
      case DockPosition.bottom:
        return workingArea.isBottomZone(
          point,
          dragZone,
          "pixels",
          !neighbors.down,
        );
    }
  }

  private getInsertionIndex(
    slot: DockSlot,
    point: QPoint,
    position: DockPosition,
  ): number {
    for (let index = 0; index < slot.windows.length; index++) {
      const geometry = slot.windows[index].geometry;
      if (geometry === null) continue;
      if (
        position === DockPosition.left ||
        position === DockPosition.right
      ) {
        const center = geometry.y + geometry.height / 2;
        if (point.y < center) return index;
      } else {
        const center = geometry.x + geometry.width / 2;
        if (point.x < center) return index;
      }
    }
    return slot.windows.length;
  }

  public remove(window: WindowClass) {
    for (let key in this.store) {
      this.store[key].remove(window);
    }
  }

  public handleShortcut(
    ctx: IDriverContext,
    window: WindowClass,
    action: KrohnkiteAction,
  ): boolean {
    let result = false;
    const entry = this.store[ctx.currentSurface.id];
    switch (action) {
      case KrohnkiteAction.GrowWidth:
      case KrohnkiteAction.ShrinkWidth: {
        const increment = action === KrohnkiteAction.GrowWidth ? 1 : -1;
        if (
          window.dock.position === DockPosition.left ||
          window.dock.position === DockPosition.right
        ) {
          const size = window.dock.cfg.vWide + increment;
          if (entry === undefined || !entry.setCrossSize(window, size))
            window.dock.cfg.vWide = size;
        } else {
          window.dock.cfg.hWide += increment;
        }
        result = true;
        break;
      }
      case KrohnkiteAction.GrowHeight:
      case KrohnkiteAction.ShrinkHeight: {
        const increment = action === KrohnkiteAction.GrowHeight ? 1 : -1;
        if (
          window.dock.position === DockPosition.left ||
          window.dock.position === DockPosition.right
        ) {
          window.dock.cfg.vHeight += increment;
        } else {
          const size = window.dock.cfg.hHeight + increment;
          if (entry === undefined || !entry.setCrossSize(window, size))
            window.dock.cfg.hHeight = size;
        }
        result = true;
        break;
      }
      case KrohnkiteAction.MoveLeft:
      case KrohnkiteAction.MoveUp:
      case KrohnkiteAction.MoveRight:
      case KrohnkiteAction.MoveDown:
        if (entry !== undefined) {
          result = entry.handleShortcut(window, action);
        }
        break;
    }
    return result;
  }

  public isNewWindowHaveDocked(window: WindowClass): boolean {
    if (
      window.windowClassName in this.windowClassesCfg &&
      (this.windowClassesCfg[window.windowClassName].caption === null ||
        DriverWindow.isContain(
          [this.windowClassesCfg[window.windowClassName].caption!],
          window.window.windowCaption,
        )) &&
      this.windowClassesCfg[window.windowClassName].autoDock === true
    )
      return true;
    return false;
  }

  private getSurfaceCfg(srf: ISurface): IDockCfg {
    let dockCfg: IDockCfg | null = null;
    for (let surfaceCfg of this.surfacesCfg) {
      if (srf.isFit(surfaceCfg.srfLabel)) {
        dockCfg = { ...surfaceCfg.cfg };
        break;
      }
    }
    if (dockCfg === null) dockCfg = this.defaultCfg!.cloneAndUpdate({});

    return dockCfg;
  }
}
