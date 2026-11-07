/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class DockEntry implements IDockEntry {
  public tilesArea: Rect | null;
  private _slots: DockSlot[];
  private dockCfg: IDockCfg;
  private _id: string;

  constructor(cfg: IDockCfg, id: string) {
    this.tilesArea = null;
    this.dockCfg = cfg;
    this._slots = this.parseSlots();
    this._id = id;
  }

  public get id(): string {
    return this._id;
  }

  public get slots(): DockSlot[] {
    return this._slots;
  }

  public remove(window: WindowClass) {
    for (let slot of this.slots) {
      slot.remove(window);
    }
  }

  public clearSlots(): void {
    for (const slot of this.slots) {
      slot.windows = [];
    }
  }

  public arrange(dockedWindows: WindowClass[], workingArea: Rect): Rect {
    const IS_WIDE = workingArea.width > workingArea.height;
    const renderedTime = getTime();
    const renderedOutputId = this.id;

    this.arrangeSlots(dockedWindows);
    this.assignSizes(workingArea);

    const leftSlot = this.getSlot(DockPosition.left);
    const rightSlot = this.getSlot(DockPosition.right);
    const topSlot = this.getSlot(DockPosition.top);
    const bottomSlot = this.getSlot(DockPosition.bottom);

    let leftBorder = workingArea.x;
    let width = workingArea.width;
    let topBorder = workingArea.y;
    let height = workingArea.height;

    const mark = (window: WindowClass) => {
      window.dock.renderedTime = renderedTime;
      window.dock.renderedOutputId = renderedOutputId;
    };

    const leftSlotArrange = () => {
      if (leftSlot === null) return;
      const windows = leftSlot.windows;
      if (windows.length === 1) {
        const cfg = windows[0].dock.cfg;
        const leftSlotHeight = Math.min(
          (workingArea.height * cfg.vHeight) / 100,
          height,
        );
        const initRect = new Rect(
          leftBorder,
          topBorder,
          (workingArea.width * cfg.vWide) / 100,
          leftSlotHeight,
        );
        leftBorder = leftBorder + initRect.width;
        width = width - initRect.width;
        windows[0].geometry = DockEntry.align(
          initRect,
          leftSlot.position,
          cfg,
          height,
        );
        mark(windows[0]);
        return;
      }
      const cfg = windows[0].dock.cfg;
      const stripWidth = Math.min(
        (workingArea.width * cfg.vWide) / 100,
        width,
      );
      const [alignedWidth, alignedLeft] = DockEntry.alignEdge(
        stripWidth,
        leftBorder,
        cfg.vEdgeGap,
        leftSlot.position,
        cfg.vEdgeAlignment,
      );
      this.layoutVertical(
        windows,
        alignedLeft,
        topBorder,
        alignedWidth,
        height,
        cfg,
        mark,
      );
      leftBorder = leftBorder + stripWidth;
      width = width - stripWidth;
    };
    const rightSlotArrange = () => {
      if (rightSlot === null) return;
      const windows = rightSlot.windows;
      if (windows.length === 1) {
        const cfg = windows[0].dock.cfg;
        const rightSlotHeight = Math.min(
          (workingArea.height * cfg.vHeight) / 100,
          height,
        );
        const initRect = new Rect(
          workingArea.x +
            workingArea.width -
            (workingArea.width * cfg.vWide) / 100,
          topBorder,
          (workingArea.width * cfg.vWide) / 100,
          rightSlotHeight,
        );
        width = width - initRect.width;
        windows[0].geometry = DockEntry.align(
          initRect,
          rightSlot.position,
          cfg,
          height,
        );
        mark(windows[0]);
        return;
      }
      const cfg = windows[0].dock.cfg;
      const stripWidth = Math.min(
        (workingArea.width * cfg.vWide) / 100,
        width,
      );
      const [alignedWidth, alignedLeft] = DockEntry.alignEdge(
        stripWidth,
        workingArea.x + workingArea.width - stripWidth,
        cfg.vEdgeGap,
        rightSlot.position,
        cfg.vEdgeAlignment,
      );
      this.layoutVertical(
        windows,
        alignedLeft,
        topBorder,
        alignedWidth,
        height,
        cfg,
        mark,
      );
      width = width - stripWidth;
    };
    const topSlotArrange = () => {
      if (topSlot === null) return;
      const windows = topSlot.windows;
      if (windows.length === 1) {
        const cfg = windows[0].dock.cfg;
        const topSlotWidth = Math.min(
          (workingArea.width * cfg.hWide) / 100,
          width,
        );
        const initRect = new Rect(
          leftBorder,
          topBorder,
          topSlotWidth,
          (workingArea.height * cfg.hHeight) / 100,
        );
        topBorder = topBorder + initRect.height;
        height = height - initRect.height;
        windows[0].geometry = DockEntry.align(
          initRect,
          topSlot.position,
          cfg,
          width,
        );
        mark(windows[0]);
        return;
      }
      const cfg = windows[0].dock.cfg;
      const stripHeight = Math.min(
        (workingArea.height * cfg.hHeight) / 100,
        height,
      );
      const [alignedHeight, alignedTop] = DockEntry.alignEdge(
        stripHeight,
        topBorder,
        cfg.hEdgeGap,
        topSlot.position,
        cfg.hEdgeAlignment,
      );
      this.layoutHorizontal(
        windows,
        leftBorder,
        alignedTop,
        width,
        alignedHeight,
        cfg,
        mark,
      );
      topBorder = topBorder + stripHeight;
      height = height - stripHeight;
    };
    const bottomSlotArrange = () => {
      if (bottomSlot === null) return;
      const windows = bottomSlot.windows;
      if (windows.length === 1) {
        const cfg = windows[0].dock.cfg;
        const bottomSlotWidth = Math.min(
          (workingArea.width * cfg.hWide) / 100,
          width,
        );
        const initRect = new Rect(
          leftBorder,
          workingArea.y +
            workingArea.height -
            (workingArea.height * cfg.hHeight) / 100,
          bottomSlotWidth,
          (workingArea.height * cfg.hHeight) / 100,
        );
        height = height - initRect.height;
        windows[0].geometry = DockEntry.align(
          initRect,
          bottomSlot.position,
          cfg,
          width,
        );
        mark(windows[0]);
        return;
      }
      const cfg = windows[0].dock.cfg;
      const stripHeight = Math.min(
        (workingArea.height * cfg.hHeight) / 100,
        height,
      );
      const [alignedHeight, alignedTop] = DockEntry.alignEdge(
        stripHeight,
        workingArea.y + workingArea.height - stripHeight,
        cfg.hEdgeGap,
        bottomSlot.position,
        cfg.hEdgeAlignment,
      );
      this.layoutHorizontal(
        windows,
        leftBorder,
        alignedTop,
        width,
        alignedHeight,
        cfg,
        mark,
      );
      height = height - stripHeight;
    };

    if (IS_WIDE) {
      leftSlotArrange();
      rightSlotArrange();
      topSlotArrange();
      bottomSlotArrange();
    } else {
      topSlotArrange();
      bottomSlotArrange();
      leftSlotArrange();
      rightSlotArrange();
    }
    this.tilesArea = new Rect(leftBorder, topBorder, width, height);
    return this.tilesArea;
  }

  public handleShortcut(
    window: WindowClass,
    shortcut: KrohnkiteAction,
  ): boolean {
    const found = this.findWindow(window);
    if (found === null) return false;
    const { slot, index } = found;
    const isVertical =
      slot.position === DockPosition.left ||
      slot.position === DockPosition.right;

    if (isVertical) {
      switch (shortcut) {
        case KrohnkiteAction.MoveUp:
        case KrohnkiteAction.MoveDown: {
          const delta = shortcut === KrohnkiteAction.MoveUp ? -1 : 1;
          if (this.moveWithinSlot(slot, index, delta)) return true;
          return this.moveToSide(
            window,
            slot,
            shortcut === KrohnkiteAction.MoveUp
              ? DockPosition.top
              : DockPosition.bottom,
          );
        }
        case KrohnkiteAction.MoveLeft:
          if (slot.position === DockPosition.left) return false;
          return this.moveToSide(window, slot, DockPosition.left);
        case KrohnkiteAction.MoveRight:
          if (slot.position === DockPosition.right) return false;
          return this.moveToSide(window, slot, DockPosition.right);
        default:
          return false;
      }
    }

    switch (shortcut) {
      case KrohnkiteAction.MoveLeft:
      case KrohnkiteAction.MoveRight: {
        const delta = shortcut === KrohnkiteAction.MoveLeft ? -1 : 1;
        if (this.moveWithinSlot(slot, index, delta)) return true;
        return this.moveToSide(
          window,
          slot,
          shortcut === KrohnkiteAction.MoveLeft
            ? DockPosition.left
            : DockPosition.right,
        );
      }
      case KrohnkiteAction.MoveUp:
        if (slot.position === DockPosition.top) return false;
        return this.moveToSide(window, slot, DockPosition.top);
      case KrohnkiteAction.MoveDown:
        if (slot.position === DockPosition.bottom) return false;
        return this.moveToSide(window, slot, DockPosition.bottom);
      default:
        return false;
    }
  }

  private moveWithinSlot(
    slot: DockSlot,
    index: number,
    delta: -1 | 1,
  ): boolean {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= slot.windows.length) return false;
    const window = slot.windows[index];
    slot.windows[index] = slot.windows[targetIndex];
    slot.windows[targetIndex] = window;
    return true;
  }

  private moveToSide(
    window: WindowClass,
    source: DockSlot,
    position: DockPosition,
  ): boolean {
    const target = this.getSlotByPosition(position);
    if (target === null || target === source) return false;
    if (!source.remove(window)) return false;
    target.windows.push(window);
    window.dock.position = position;
    return true;
  }

  public setCrossSize(window: WindowClass, size: number): boolean {
    const found = this.findWindow(window);
    if (found === null) return false;
    const key: "vWide" | "hHeight" =
      found.slot.position === DockPosition.left ||
      found.slot.position === DockPosition.right
        ? "vWide"
        : "hHeight";
    for (const member of found.slot.windows) member.dock.cfg[key] = size;
    return true;
  }

  public findWindow(
    window: WindowClass,
  ): { slot: DockSlot; index: number } | null {
    for (const slot of this.slots) {
      const index = slot.windows.indexOf(window);
      if (index >= 0) return { slot, index };
    }
    return null;
  }

  private static align(
    initRect: Rect,
    position: DockPosition,
    cfg: IDockCfg,
    wholeSize: number,
  ): Rect {
    let leftBorder = initRect.x;
    let topBorder = initRect.y;
    let width = initRect.width;
    let height = initRect.height;

    switch (position) {
      case DockPosition.left:
      case DockPosition.right:
        [width, leftBorder] = DockEntry.alignEdge(
          width,
          leftBorder,
          cfg.vEdgeGap,
          position,
          cfg.vEdgeAlignment,
        );

        if (2 * cfg.vGap < height) {
          if (wholeSize - height < 2 * cfg.vGap) {
            topBorder = topBorder + cfg.vGap;
            height = height - 2 * cfg.vGap;
          } else if (cfg.vAlignment === VDockAlignment.top) {
            topBorder = topBorder + cfg.vGap;
          } else if (cfg.vAlignment === VDockAlignment.center) {
            topBorder = topBorder + (wholeSize - height) / 2;
          } else if (cfg.vAlignment === VDockAlignment.bottom) {
            topBorder = topBorder + (wholeSize - height - cfg.vGap);
          }
        }
        return new Rect(leftBorder, topBorder, width, height);

      case DockPosition.top:
      case DockPosition.bottom:
        [height, topBorder] = DockEntry.alignEdge(
          height,
          topBorder,
          cfg.hEdgeGap,
          position,
          cfg.hEdgeAlignment,
        );

        if (2 * cfg.hGap < width) {
          if (wholeSize - width < 2 * cfg.hGap) {
            leftBorder = leftBorder + cfg.hGap;
            width = width - 2 * cfg.hGap;
          } else if (cfg.hAlignment === HDockAlignment.left) {
            leftBorder = leftBorder + cfg.hGap;
          } else if (cfg.hAlignment === HDockAlignment.center) {
            leftBorder = leftBorder + (wholeSize - width) / 2;
          } else if (cfg.hAlignment === HDockAlignment.right) {
            leftBorder = leftBorder + (wholeSize - width - cfg.hGap);
          }
        }

        return new Rect(leftBorder, topBorder, width, height);
    }
  }

  private static alignEdge(
    dimension: number,
    sideBorder: number,
    gap: number,
    position: DockPosition,
    alignment: EdgeAlignment,
  ): [number, number] {
    if (2 * gap > dimension) return [dimension, sideBorder];
    switch (alignment) {
      case EdgeAlignment.outside:
        if (position === DockPosition.right || position === DockPosition.bottom)
          sideBorder = sideBorder + gap;
        return [dimension - gap, sideBorder];
      case EdgeAlignment.middle:
        return [dimension - 2 * gap, sideBorder + gap];
      case EdgeAlignment.inside:
        if (position === DockPosition.left || position === DockPosition.top)
          sideBorder = sideBorder + gap;
        return [dimension - gap, sideBorder];
    }
  }

  private layoutVertical(
    windows: WindowClass[],
    x: number,
    y: number,
    width: number,
    height: number,
    cfg: IDockCfg,
    mark: (window: WindowClass) => void,
  ) {
    let gap = Math.max(0, cfg.vGap);
    if (gap * (windows.length + 1) > height)
      gap = Math.max(0, height / (windows.length + 1));
    const available = Math.max(
      0,
      height - gap * (windows.length + 1),
    );
    const sizes = DockEntry.distribute(
      windows.map((window) => window.dock.cfg.vHeight),
      available,
      windows.map((window) => window.minSize.height),
    );
    let cursor = y + gap;
    windows.forEach((window, index) => {
      window.geometry = new Rect(x, cursor, width, sizes[index]);
      cursor = cursor + sizes[index] + gap;
      mark(window);
    });
  }

  private layoutHorizontal(
    windows: WindowClass[],
    x: number,
    y: number,
    width: number,
    height: number,
    cfg: IDockCfg,
    mark: (window: WindowClass) => void,
  ) {
    let gap = Math.max(0, cfg.hGap);
    if (gap * (windows.length + 1) > width)
      gap = Math.max(0, width / (windows.length + 1));
    const available = Math.max(
      0,
      width - gap * (windows.length + 1),
    );
    const sizes = DockEntry.distribute(
      windows.map((window) => window.dock.cfg.hWide),
      available,
      windows.map((window) => window.minSize.width),
    );
    let cursor = x + gap;
    windows.forEach((window, index) => {
      window.geometry = new Rect(cursor, y, sizes[index], height);
      cursor = cursor + sizes[index] + gap;
      mark(window);
    });
  }

  private static distribute(
    weights: number[],
    available: number,
    minimums: number[],
  ): number[] {
    const count = weights.length;
    if (count === 0) return [];
    const positive = weights.map((weight) => Math.max(0, weight));
    const sum = positive.reduce((total, weight) => total + weight, 0);
    const sizes =
      sum > 0
        ? positive.map((weight) => (available * weight) / sum)
        : positive.map(() => available / count);
    const totalMinimum = minimums.reduce(
      (total, minimum) => total + Math.max(0, minimum),
      0,
    );
    if (totalMinimum > available) return sizes;

    for (let pass = 0; pass < count; pass++) {
      let deficit = 0;
      let flexible = 0;
      for (let i = 0; i < count; i++) {
        if (sizes[i] < minimums[i]) {
          deficit += minimums[i] - sizes[i];
          sizes[i] = minimums[i];
        } else {
          flexible += sizes[i] - minimums[i];
        }
      }
      if (deficit <= 0 || flexible <= 0) break;
      for (let i = 0; i < count; i++) {
        const extra = sizes[i] - minimums[i];
        if (extra > 0) sizes[i] -= (deficit * extra) / flexible;
      }
    }
    return sizes;
  }

  private getSlot(position: DockPosition): DockSlot | null {
    const slot = this.getSlotByPosition(position);
    if (slot === null) return null;
    this.getValidWindows(slot);
    return slot.windows.length > 0 ? slot : null;
  }

  private getValidWindows(slot: DockSlot): WindowClass[] {
    slot.windows = slot.windows.filter(
      (window) =>
        window.state === WindowState.Docked &&
        window.dock.position === slot.position,
    );
    return slot.windows;
  }

  private getSlotByPosition(position: DockPosition): DockSlot | null {
    return this.slots.find((slot) => slot.position === position) || null;
  }

  private arrangeSlots(dockedWindows: WindowClass[]) {
    const dockedSet = new Set(dockedWindows);
    const placed = new Set<WindowClass>();

    for (const slot of this.slots) {
      slot.windows = slot.windows.filter((window) => {
        if (!dockedSet.has(window) || window.state !== WindowState.Docked)
          return false;
        if (
          window.dock.position !== null &&
          window.dock.position !== slot.position
        )
          return false;
        window.dock.position = slot.position;
        placed.add(window);
        return true;
      });
    }

    const remaining = dockedWindows.filter((window) => !placed.has(window));
    for (const window of remaining) {
      if (
        window.dock.position !== null &&
        this.getSlotByPosition(window.dock.position) === null
      )
        window.dock.position = null;
    }
    remaining.sort((a, b) => this.compareDockPriority(a, b));

    for (const window of remaining) {
      let slot: DockSlot | null =
        window.dock.position !== null
          ? this.getSlotByPosition(window.dock.position)
          : null;
      if (slot === null) {
        slot = this.slots.length > 0 ? this.slots[0] : null;
        if (slot === null) {
          window.state = WindowState.Tiled;
          continue;
        }
        window.dock.position = slot.position;
      }
      slot.windows.push(window);
    }
  }

  private compareDockPriority(a: WindowClass, b: WindowClass): number {
    if (a.dock.priority !== b.dock.priority)
      return b.dock.priority - a.dock.priority;
    const aTime = a.dock.renderedTime;
    const bTime = b.dock.renderedTime;
    if (aTime === null && bTime !== null) return -1;
    if (bTime === null && aTime !== null) return 1;
    if (aTime !== null && bTime !== null && aTime !== bTime)
      return aTime - bTime;
    if (a.dock.renderedOutputId === this.id && b.dock.renderedOutputId !== this.id)
      return -1;
    if (b.dock.renderedOutputId === this.id && a.dock.renderedOutputId !== this.id)
      return 1;
    return 0;
  }

  private assignSizes(workingArea: Rect) {
    const MAX_SIDE_SIZE = 70;
    const MAX_OPPOSITE_SIDES_SIZE = 70;
    const MAX_GAPS = {
      width: workingArea.width * 0.05,
      height: workingArea.height * 0.05,
    };

    interface Group {
      windows: WindowClass[];
      crossKey: "vWide" | "hHeight";
      crossSize: number;
    }

    const groups = new Map<DockPosition, Group>();

    for (const slot of this.slots) {
      const windows = this.getValidWindows(slot);
      if (windows.length === 0) continue;
      const isVertical =
        slot.position === DockPosition.left ||
        slot.position === DockPosition.right;
      const crossKey: "vWide" | "hHeight" = isVertical ? "vWide" : "hHeight";
      const alongKey: "vHeight" | "hWide" = isVertical ? "vHeight" : "hWide";
      const gapKey: "vGap" | "hGap" = isVertical ? "vGap" : "hGap";
      const edgeGapKey: "vEdgeGap" | "hEdgeGap" = isVertical
        ? "vEdgeGap"
        : "hEdgeGap";
      const edgeAlignment: EdgeAlignment = isVertical
        ? windows[0].dock.cfg.vEdgeAlignment
        : windows[0].dock.cfg.hEdgeAlignment;
      const crossDimension = Math.max(
        1,
        isVertical ? workingArea.width : workingArea.height,
      );
      const alongDimension = Math.max(
        1,
        isVertical ? workingArea.height : workingArea.width,
      );

      let crossSize = 0;
      let gap = 0;
      let edgeGap = 0;
      for (const window of windows) {
        const cfg = window.dock.cfg;
        crossSize = Math.max(crossSize, cfg[crossKey]);
        gap = Math.max(gap, cfg[gapKey]);
        edgeGap = Math.max(edgeGap, cfg[edgeGapKey]);
      }
      gap = Math.max(
        0,
        Math.min(gap, isVertical ? MAX_GAPS.height : MAX_GAPS.width),
      );
      edgeGap = Math.max(0, edgeGap);
      const edgeReserve =
        edgeAlignment === EdgeAlignment.middle ? 2 * edgeGap : edgeGap;

      for (const window of windows) {
        const cfg = window.dock.cfg;
        const minCross = Math.max(
          ((isVertical ? window.minSize.width : window.minSize.height) * 100) /
            crossDimension,
          5,
        );
        const minAlong = Math.max(
          ((isVertical ? window.minSize.height : window.minSize.width) * 100) /
            alongDimension,
          5,
        );
        if (cfg[alongKey] < minAlong) cfg[alongKey] = minAlong;
        /* A single window uses an absolute percentage; several windows use
         * weights that may exceed 100 and are normalized during layout. */
        if (windows.length === 1 && cfg[alongKey] > 100) cfg[alongKey] = 100;
        cfg[gapKey] = gap;
        cfg[edgeGapKey] = edgeGap;
        crossSize = Math.max(
          crossSize,
          minCross + (100 * edgeReserve) / crossDimension,
        );
      }

      // A dock strip is capped at 70% of the work area. When both opposite
      // strips are present they share the same 70% budget.
      crossSize = Math.min(crossSize, MAX_SIDE_SIZE);
      for (const window of windows) window.dock.cfg[crossKey] = crossSize;
      groups.set(slot.position, {
        windows,
        crossKey,
        crossSize,
      });
    }

    const clampPair = (
      firstPosition: DockPosition,
      secondPosition: DockPosition,
    ) => {
      const first = groups.get(firstPosition);
      const second = groups.get(secondPosition);
      if (first === undefined || second === undefined) return;
      let firstSize = first.crossSize;
      let secondSize = second.crossSize;
      if (firstSize + secondSize <= MAX_OPPOSITE_SIDES_SIZE) return;
      if (
        firstSize > MAX_OPPOSITE_SIDES_SIZE / 2 &&
        secondSize > MAX_OPPOSITE_SIDES_SIZE / 2
      ) {
        firstSize = MAX_OPPOSITE_SIDES_SIZE / 2;
        secondSize = MAX_OPPOSITE_SIDES_SIZE / 2;
      } else if (firstSize > MAX_OPPOSITE_SIDES_SIZE / 2) {
        firstSize = MAX_OPPOSITE_SIDES_SIZE - secondSize;
      } else {
        secondSize = MAX_OPPOSITE_SIDES_SIZE - firstSize;
      }
      first.crossSize = firstSize;
      second.crossSize = secondSize;
      for (const window of first.windows)
        window.dock.cfg[first.crossKey] = firstSize;
      for (const window of second.windows)
        window.dock.cfg[second.crossKey] = secondSize;
    };

    clampPair(DockPosition.left, DockPosition.right);
    clampPair(DockPosition.top, DockPosition.bottom);
  }

  private parseSlots(): DockSlot[] {
    const slots = [];
    // Left
    if (CONFIG.dockOrder[0] !== 0)
      slots.push(new DockSlot(DockPosition.left, CONFIG.dockOrder[0]));
    // Top
    if (CONFIG.dockOrder[1] !== 0)
      slots.push(new DockSlot(DockPosition.top, CONFIG.dockOrder[1]));
    // Right
    if (CONFIG.dockOrder[2] !== 0)
      slots.push(new DockSlot(DockPosition.right, CONFIG.dockOrder[2]));
    // Bottom
    if (CONFIG.dockOrder[3] !== 0)
      slots.push(new DockSlot(DockPosition.bottom, CONFIG.dockOrder[3]));

    slots.sort((a, b) => a.order - b.order);
    return slots;
  }
}
