/*
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/**
 * Dwindle ("BTree") layout.
 *
 * A new window splits the window that was focused before it appeared, and the
 * new window takes the second (right/bottom) half, or the first one when
 * `newWindowPosition` is "first". Split directions follow the longer edge of
 * the area unless a split was flipped manually (`RotatePart`, `Rotate`).
 *
 * Directional moves take the window out of its tile and split the tile it
 * enters along that tile's longer edge; a lone sibling across the parent's
 * split trades sides with the moving window.
 *
 * The tree itself lives in `DwindleTree`.
 */
class BinaryTreeLayout implements ILayout {
  public static readonly id = "BinaryTreeLayout";

  public readonly classID = BinaryTreeLayout.id;
  public readonly capacity?: number | null;

  public get description(): string {
    return "BTree";
  }

  private tree: DwindleTree;
  /** Geometry of the last applied pass, used by directional shortcuts. */
  private rendered: Map<string, Rect>;
  private lastArea: Rect | null;
  private lastGap: number;
  private lastMetrics: DwindleMetrics | null;
  private dragSession: DragAction | null;
  private dragKey: string | null;

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.tree = new DwindleTree();
    this.rendered = new Map();
    this.lastArea = null;
    this.lastGap = 0;
    this.lastMetrics = null;
    this.dragSession = null;
    this.dragKey = null;
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    tileables.forEach((tileable) => (tileable.state = WindowState.Tiled));

    this.synchronize(ctx, tileables, area, gap);

    const metrics = this.metrics(tileables);
    this.lastArea = area;
    this.lastGap = gap;
    this.lastMetrics = metrics;
    this.rendered = this.tree.geometry(area, gap, metrics);
    tileables.forEach((tileable) => {
      const geometry = this.rendered.get(tileable.id);
      if (geometry !== undefined) tileable.geometry = geometry;
    });
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ): void {
    if (this.tree.find(basis.id) === null) return;
    this.tree.adjust(area, gap, this.metrics(tiles), basis.id, delta);
  }

  /**
   * Rearrange the tree while a tiled window is dragged, following the pointer.
   *
   * The outer working-area edges create a new top-level split. Otherwise the
   * window under the pointer is split along the half the pointer is in, and
   * the dropped split is locked so the automatic longer-edge rule does not
   * undo the user's choice.
   */
  public drag(_ctx: EngineContext, dragAction: DragAction): void {
    if (!dragAction.window.isTiled) return;
    if (this.dragSession !== dragAction) {
      this.dragSession = dragAction;
      this.dragKey = null;
    }
    if (this.rendered.size === 0) return;

    const windowId = dragAction.window.id;
    const area = dragAction.tilesArea ?? dragAction.workingArea;
    const edge = this.edgeAt(area, dragAction.mousePointer);
    if (edge !== null) {
      const key = `edge:${edge}`;
      if (key === this.dragKey) return;
      const dir: DwindleDir = edge === "left" || edge === "right" ? "h" : "v";
      const before = edge === "left" || edge === "up";
      if (this.tree.moveToRoot(windowId, before, dir, true)) {
        this.dragKey = key;
        dragAction.result.isArrangeNeeded = true;
      }
      return;
    }

    const target = this.dropTarget(windowId, dragAction.mousePointer);
    if (target === null) return;
    const side = this.sideAt(target.rect, dragAction.mousePointer);
    const key = `target:${target.id}:${side}`;
    if (key === this.dragKey) return;
    const dir: DwindleDir = side === "left" || side === "right" ? "h" : "v";
    const before = side === "left" || side === "up";
    if (this.tree.move(windowId, target.id, before, dir, true)) {
      this.dragKey = key;
      dragAction.result.isArrangeNeeded = true;
    }
  }

  public handleShortcut(ctx: EngineContext, input: KrohnkiteAction): boolean {
    const window = ctx.currentWindow;
    if (window === null || !window.isTiled) return false;

    switch (input) {
      case KrohnkiteAction.MoveLeft:
        return this.moveToNeighbor(ctx, window, "left");
      case KrohnkiteAction.MoveRight:
        return this.moveToNeighbor(ctx, window, "right");
      case KrohnkiteAction.MoveUp:
        return this.moveToNeighbor(ctx, window, "up");
      case KrohnkiteAction.MoveDown:
        return this.moveToNeighbor(ctx, window, "down");
      case KrohnkiteAction.SwapUp:
        return this.moveInOrder(window, -1);
      case KrohnkiteAction.SwapDown:
        return this.moveInOrder(window, +1);
      case KrohnkiteAction.Rotate:
        this.tree.rotateAll();
        return true;
      case KrohnkiteAction.RotatePart:
        return this.tree.toggleSplit(window.id);
      case KrohnkiteAction.SetMaster:
        /* Dwindle has no master window; keep the focus where it is. */
        ctx.showNotification("BTree: no master");
        return true;
      default:
        return false;
    }
  }

  public clone(): ILayout {
    return new BinaryTreeLayout(
      this.capacity !== undefined ? this.capacity : null,
    );
  }

  public toString(): string {
    return "BTreeLayout()";
  }

  /**
   * Bring the tree in sync with the tiled windows.
   *
   * Leaves of windows that are gone from the engine are removed. Leaves of
   * windows that still exist but are not tiled right now (floating,
   * minimized, on another desktop) are kept, so their slot can be restored
   * later. Every tiled window missing from the tree is inserted next to the
   * window that was focused before it appeared.
   */
  private synchronize(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    for (const windowId of this.tree.order) {
      if (ctx.getWindowById(windowId) === null) this.tree.remove(windowId);
    }

    const missing = tileables.filter(
      (tileable) => this.tree.find(tileable.id) === null,
    );
    if (missing.length === 0) return;

    /* A new session or a fresh layout instance has no tree yet: start from
     * the focused window and chain the rest, which is what opening windows
     * one by one would have produced. */
    let lastInserted: string | null = null;
    if (this.tree.isEmpty) {
      const rootWindow = this.pickAnchor(tileables, null);
      if (rootWindow === null) return;
      this.tree.insertRoot(rootWindow.id);
      lastInserted = rootWindow.id;
    }

    for (const tileable of missing) {
      /* The root above may already be one of `missing`. */
      if (this.tree.find(tileable.id) !== null) continue;

      const metrics = this.metrics(tileables);
      let anchorId = lastInserted;
      if (anchorId === null || !metrics.has(anchorId)) {
        const anchor = this.pickAnchor(tileables, metrics);
        anchorId = anchor !== null ? anchor.id : null;
      }

      if (anchorId === null) {
        /* The tree only holds temporarily absent windows: split the first of
         * them so their slots survive, even though the new window gets the
         * whole area for now. */
        const firstLeaf = this.tree.order[0];
        if (firstLeaf === undefined) {
          this.tree.insertRoot(tileable.id);
        } else {
          this.tree.insert(
            tileable.id,
            firstLeaf,
            this.newWindowGoesFirst(),
            "h",
          );
        }
        lastInserted = tileable.id;
        continue;
      }

      const anchorRect = this.tree.geometry(area, gap, metrics).get(anchorId);
      if (anchorRect === undefined) {
        /* Defensive: the anchor is not laid out right now. */
        const fallbackId = this.tree.order.find((id) => metrics.has(id));
        if (fallbackId === undefined) this.tree.insertRoot(tileable.id);
        else
          this.tree.insert(
            tileable.id,
            fallbackId,
            this.newWindowGoesFirst(),
            "h",
          );
        lastInserted = tileable.id;
        continue;
      }

      /* Split along the longer side of the window being split. */
      const dir: DwindleDir =
        anchorRect.width >= anchorRect.height ? "h" : "v";
      this.tree.insert(
        tileable.id,
        anchorId,
        this.newWindowGoesFirst(),
        dir,
      );
      lastInserted = tileable.id;
    }
  }

  private newWindowGoesFirst(): boolean {
    return CONFIG.newWindowPosition === "first";
  }

  /**
   * The window a new one should split: the most recently focused tiled window
   * already present in the tree. `metrics === null` means the tree is empty,
   * so any tiled window qualifies.
   */
  private pickAnchor(
    tileables: WindowClass[],
    metrics: DwindleMetrics | null,
  ): WindowClass | null {
    let best: WindowClass | null = null;
    for (const tileable of tileables) {
      if (metrics !== null) {
        if (!metrics.has(tileable.id)) continue;
        if (this.tree.find(tileable.id) === null) continue;
      }
      if (best === null || tileable.focusTime > best.focusTime)
        best = tileable;
    }
    return best;
  }

  private metrics(tileables: WindowClass[]): DwindleMetrics {
    const metrics: DwindleMetrics = new Map();
    for (const tileable of tileables)
      metrics.set(tileable.id, tileable.minSize);
    return metrics;
  }

  /** The working-area edge the pointer is near, if any. */
  private edgeAt(area: Rect, pointer: QPoint): Direction | null {
    const marginX = Math.max(1, Math.floor(area.width * 0.1));
    const marginY = Math.max(1, Math.floor(area.height * 0.1));
    const edges: Array<[Direction, number, number]> = [
      ["left", pointer.x - area.x, marginX],
      ["right", area.maxX - pointer.x, marginX],
      ["up", pointer.y - area.y, marginY],
      ["down", area.maxY - pointer.y, marginY],
    ];

    let best: Direction | null = null;
    let bestDistance = Infinity;
    for (const [direction, distance, margin] of edges) {
      if (distance < 0 || distance > margin) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = direction;
      }
    }
    return best;
  }

  /** The half of the target tile the pointer is in. */
  private sideAt(rect: Rect, pointer: QPoint): Direction {
    const relX = (pointer.x - rect.x) / Math.max(1, rect.width);
    const relY = (pointer.y - rect.y) / Math.max(1, rect.height);
    if (Math.abs(relX - 0.5) >= Math.abs(relY - 0.5))
      return relX < 0.5 ? "left" : "right";
    return relY < 0.5 ? "up" : "down";
  }

  /** The laid-out tile under the pointer, excluding the dragged window. */
  private dropTarget(
    windowId: string,
    pointer: QPoint,
  ): { id: string; rect: Rect } | null {
    for (const [id, rect] of this.rendered) {
      if (id === windowId) continue;
      if (rect.includesPoint(pointer)) return { id, rect };
    }
    return null;
  }

  /**
   * Move the window into the tile it enters, following Umbriel's dwindle
   * rules: the entered tile splits along its longer edge and the window takes
   * the half nearer the point it comes from. Moving toward a lone sibling
   * across the parent's split trades sides instead.
   */
  private moveToNeighbor(
    ctx: EngineContext,
    window: WindowClass,
    direction: Direction,
  ): boolean {
    const area = this.lastArea;
    const metrics = this.lastMetrics;
    const basis = this.rendered.get(window.id);
    if (area === null || metrics === null || basis === undefined) return false;

    const horizontal = direction === "left" || direction === "right";
    const forward = direction === "right" || direction === "down";
    const gap = this.lastGap;

    /* The first pixel across the gap from the middle of the edge the window
     * leaves through. */
    let focalX = basis.x + basis.width / 2;
    let focalY = basis.y + basis.height / 2;
    if (horizontal)
      focalX = forward ? basis.maxX + gap : basis.x - gap - 1;
    else focalY = forward ? basis.maxY + gap : basis.y - gap - 1;

    if (
      focalX < area.x ||
      focalX >= area.maxX ||
      focalY < area.y ||
      focalY >= area.maxY
    ) {
      /* There is no tile beyond the edge: make the window an outer tile, just
       * like a drag to that edge. An outer tile that already fills the side
       * falls through, so the engine can move it to another output/desktop. */
      const dir: DwindleDir = horizontal ? "h" : "v";
      const before = direction === "left" || direction === "up";
      const leaf = this.tree.find(window.id);
      const root = this.tree.root;
      if (leaf === null || !(root instanceof DwindleSplit)) return false;
      const outer = before ? root.first : root.second;
      if (outer === leaf && root.horizontal === horizontal) return false;
      return this.tree.moveToRoot(window.id, before, dir, true);
    }

    /* A lone sibling across the parent's own split trades sides. */
    const leaf = this.tree.find(window.id);
    const parent = leaf !== null ? leaf.parent : null;
    if (leaf !== null && parent !== null && parent.horizontal === horizontal) {
      const first = parent.first === leaf;
      const sibling = first ? parent.second : parent.first;
      if (
        first === forward &&
        sibling instanceof DwindleLeaf &&
        metrics.has(sibling.windowId)
      )
        return this.tree.swapSides(window.id);
    }

    /* Choose the tile to enter from the layout the user currently sees. Using
     * the reflowed layout instead would let a large window jump over the group
     * next to it: removing it reflows the tree and moves that group away. */
    const neighborId = this.neighbor(ctx, window.id, direction);
    if (neighborId === null) return false;
    const target = this.rendered.get(neighborId);
    if (target === undefined) return false;
    const targetHorizontal = target.width >= target.height;
    const first = targetHorizontal
      ? focalX < target.x + target.width / 2
      : focalY < target.y + target.height / 2;
    return this.tree.move(
      window.id,
      neighborId,
      first,
      targetHorizontal ? "h" : "v",
    );
  }

  /** Exchange the window with the previous or next leaf, leaving tiles intact. */
  private moveInOrder(window: WindowClass, step: -1 | 1): boolean {
    const order = this.tree.order.filter((id) => this.rendered.has(id));
    const index = order.indexOf(window.id);
    if (index < 0) return false;
    const targetIndex = index + step;
    if (targetIndex < 0 || targetIndex >= order.length) return false;
    return this.tree.swapContents(window.id, order[targetIndex]);
  }

  /** Geometric neighbor in the layout the user currently sees. */
  private neighbor(
    ctx: EngineContext,
    windowId: string,
    direction: Direction,
  ): string | null {
    const basis = this.rendered.get(windowId);
    if (basis === undefined) return null;

    const vertical = direction === "up" || direction === "down";
    const sign = direction === "up" || direction === "left" ? -1 : 1;
    const candidates: Array<{ id: string; rect: Rect }> = [];

    for (const [id, rect] of this.rendered) {
      if (id === windowId) continue;
      const beyond = vertical
        ? rect.y * sign > basis.y * sign
        : rect.x * sign > basis.x * sign;
      if (!beyond) continue;
      const overlaps = vertical
        ? overlap(basis.x, basis.maxX, rect.x, rect.maxX)
        : overlap(basis.y, basis.maxY, rect.y, rect.maxY);
      if (!overlaps) continue;
      candidates.push({ id, rect });
    }
    if (candidates.length === 0) return null;

    const min = candidates.reduce(
      (acc, candidate) =>
        Math.min(acc, (vertical ? candidate.rect.y : candidate.rect.x) * sign),
      Infinity,
    );
    const closest = candidates.filter(
      (candidate) =>
        (vertical ? candidate.rect.y : candidate.rect.x) * sign === min,
    );
    closest.sort((a, b) => {
      const aFocus = ctx.getWindowById(a.id)?.focusTime ?? 0;
      const bFocus = ctx.getWindowById(b.id)?.focusTime ?? 0;
      return bFocus - aFocus;
    });
    return closest[0].id;
  }
}
