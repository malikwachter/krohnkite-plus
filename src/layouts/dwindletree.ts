/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/**
 * Dwindle layout tree.
 *
 * The tree keeps window *ids*, not window objects: the engine reorders its
 * window list on swap/master/new-window actions, and the layout must not
 * depend on that order. Leaves hold one window id; internal nodes split the
 * area of their subtree in two.
 *
 * A split follows the longer edge of its area on every layout pass, unless it
 * is locked (`RotatePart`, `Rotate`). This is what makes a subtree re-orient
 * when the area it occupies changes shape.
 *
 * A leaf whose window is currently absent from the tiled set (floating,
 * minimized, on another desktop, over capacity) takes no space: its sibling
 * expands, and the saved slot reappears when the window comes back.
 */

type DwindleDir = "h" | "v";
/** Minimum sizes of the windows that are currently part of the tiling. */
type DwindleMetrics = Map<string, ISize>;

class DwindleLeaf {
  public parent: DwindleSplit | null;

  constructor(public windowId: string) {
    this.parent = null;
  }
}

class DwindleSplit {
  public parent: DwindleSplit | null;

  constructor(
    public first: DwindleNode,
    public second: DwindleNode,
    public dir: DwindleDir,
    public ratio: number = 0.5,
    /** Locked splits keep their direction regardless of the area shape. */
    public locked: boolean = false,
  ) {
    this.parent = null;
    this.first.parent = this;
    this.second.parent = this;
  }

  public get horizontal(): boolean {
    return this.dir === "h";
  }
}

type DwindleNode = DwindleLeaf | DwindleSplit;

class DwindleTree {
  public root: DwindleNode | null;

  constructor() {
    this.root = null;
  }

  public get isEmpty(): boolean {
    return this.root === null;
  }

  /** Window ids in depth-first order: first subtree, then second. */
  public get order(): string[] {
    const order: string[] = [];
    const collect = (node: DwindleNode): void => {
      if (node instanceof DwindleLeaf) {
        order.push(node.windowId);
        return;
      }
      collect(node.first);
      collect(node.second);
    };
    if (this.root !== null) collect(this.root);
    return order;
  }

  public find(windowId: string): DwindleLeaf | null {
    return DwindleTree.findIn(this.root, windowId);
  }

  private static findIn(
    node: DwindleNode | null,
    windowId: string,
  ): DwindleLeaf | null {
    if (node === null) return null;
    if (node instanceof DwindleLeaf)
      return node.windowId === windowId ? node : null;
    return (
      DwindleTree.findIn(node.first, windowId) ??
      DwindleTree.findIn(node.second, windowId)
    );
  }

  /** Make the given window the only leaf of the tree. */
  public insertRoot(windowId: string): boolean {
    if (this.root !== null) return false;
    this.root = new DwindleLeaf(windowId);
    return true;
  }

  /**
   * Split the `anchorId` leaf and put the new window in one half of it.
   *
   * @param before when true the new window takes the first (left/top) half,
   *               otherwise the second (right/bottom) one.
   */
  public insert(
    windowId: string,
    anchorId: string,
    before: boolean,
    dir: DwindleDir,
    locked: boolean = false,
  ): boolean {
    if (this.find(windowId) !== null) return false;
    const anchor = this.find(anchorId);
    if (anchor === null) return this.insertRoot(windowId);

    const parent = anchor.parent;
    const leaf = new DwindleLeaf(windowId);
    const split = before
      ? new DwindleSplit(leaf, anchor, dir, 0.5, locked)
      : new DwindleSplit(anchor, leaf, dir, 0.5, locked);
    this.link(parent, anchor, split);
    return true;
  }

  /** Remove the leaf of the given window; its sibling takes over the slot. */
  public remove(windowId: string): boolean {
    const leaf = this.find(windowId);
    if (leaf === null) return false;

    const parent = leaf.parent;
    if (parent === null) {
      this.root = null;
      return true;
    }

    const sibling = parent.first === leaf ? parent.second : parent.first;
    this.link(parent.parent, parent, sibling);
    leaf.parent = null;
    parent.parent = null;
    return true;
  }

  /**
   * Structurally move a window next to another one: the moved window's slot
   * collapses and it is re-inserted by splitting the neighbor's slot along
   * `dir`.
   */
  public move(
    windowId: string,
    neighborId: string,
    before: boolean,
    dir: DwindleDir,
    locked: boolean = false,
  ): boolean {
    if (windowId === neighborId) return false;
    if (this.find(windowId) === null || this.find(neighborId) === null)
      return false;
    this.remove(windowId);
    return this.insert(windowId, neighborId, before, dir, locked);
  }

  /**
   * Pull a window out of the tree and put it in an outer split on the given
   * side of the whole layout.
   */
  public moveToRoot(
    windowId: string,
    before: boolean,
    dir: DwindleDir,
    locked: boolean = true,
  ): boolean {
    const leaf = this.find(windowId);
    if (leaf === null || leaf === this.root) return false;

    this.remove(windowId);
    const root = this.root;
    if (root === null) {
      this.root = new DwindleLeaf(windowId);
      return true;
    }

    const dragged = new DwindleLeaf(windowId);
    const split = before
      ? new DwindleSplit(dragged, root, dir, 0.5, locked)
      : new DwindleSplit(root, dragged, dir, 0.5, locked);
    split.parent = null;
    this.root = split;
    return true;
  }

  /** Flip the split direction of the parent of the given window. */
  public toggleSplit(windowId: string): boolean {
    const leaf = this.find(windowId);
    const parent = leaf !== null ? leaf.parent : null;
    if (parent === null) return false;
    parent.dir = parent.horizontal ? "v" : "h";
    parent.locked = true;
    return true;
  }

  /** Swap the two children of the parent of the given window. */
  public swapSides(windowId: string): boolean {
    const leaf = this.find(windowId);
    const parent = leaf !== null ? leaf.parent : null;
    if (parent === null) return false;
    const first = parent.first;
    parent.first = parent.second;
    parent.second = first;
    parent.ratio = 0.5;
    return true;
  }

  /** Exchange the windows held by two leaves, leaving every tile in place. */
  public swapContents(firstId: string, secondId: string): boolean {
    const first = this.find(firstId);
    const second = this.find(secondId);
    if (first === null || second === null || first === second) return false;
    const windowId = first.windowId;
    first.windowId = second.windowId;
    second.windowId = windowId;
    return true;
  }

  /** Rotate every split in the tree. */
  public rotateAll(): boolean {
    let changed = false;
    const rotate = (node: DwindleNode): void => {
      if (node instanceof DwindleLeaf) return;
      node.dir = node.horizontal ? "v" : "h";
      node.locked = true;
      changed = true;
      rotate(node.first);
      rotate(node.second);
    };
    if (this.root !== null) rotate(this.root);
    return changed;
  }

  /**
   * Compute the geometry of every present window.
   *
   * Windows missing from `metrics` keep their slot in the tree but take no
   * space, so a sibling of a floating or minimized window fills the area.
   */
  public geometry(
    area: Rect,
    gap: number,
    metrics: DwindleMetrics,
  ): Map<string, Rect> {
    const result = new Map<string, Rect>();
    if (this.root !== null)
      this.layoutNode(this.root, area, gap, metrics, result);
    return result;
  }

  /** Recalculate ratios after the given window was resized. */
  public adjust(
    area: Rect,
    gap: number,
    metrics: DwindleMetrics,
    basisId: string,
    delta: RectDelta,
  ): void {
    if (this.root === null) return;
    this.adjustNode(this.root, area, gap, metrics, basisId, delta);
  }

  private link(
    parent: DwindleSplit | null,
    node: DwindleNode,
    replacement: DwindleNode,
  ): void {
    replacement.parent = parent;
    if (parent === null) this.root = replacement;
    else if (parent.first === node) parent.first = replacement;
    else parent.second = replacement;
  }

  private layoutNode(
    node: DwindleNode,
    area: Rect,
    gap: number,
    metrics: DwindleMetrics,
    result: Map<string, Rect>,
  ): boolean {
    if (node instanceof DwindleLeaf) {
      if (!metrics.has(node.windowId)) return false;
      result.set(node.windowId, area);
      return true;
    }

    const firstPresent = this.hasPresent(node.first, metrics);
    const secondPresent = this.hasPresent(node.second, metrics);
    if (!firstPresent && !secondPresent) return false;
    if (!firstPresent)
      return this.layoutNode(node.second, area, gap, metrics, result);
    if (!secondPresent)
      return this.layoutNode(node.first, area, gap, metrics, result);

    /* An unlocked split follows the longer edge of its current area. */
    if (!node.locked)
      node.dir = area.width >= area.height ? "h" : "v";

    const splitAxis = node.horizontal ? "x" : "y";
    const minFirst = this.minLength(node.first, splitAxis, gap, metrics);
    const minSecond = this.minLength(node.second, splitAxis, gap, metrics);
    const [firstArea, secondArea] = LayoutUtils.splitAreaWeighted(
      area,
      [node.ratio, 1 - node.ratio],
      gap,
      node.horizontal,
      [minFirst, minSecond],
    );
    this.layoutNode(node.first, firstArea, gap, metrics, result);
    this.layoutNode(node.second, secondArea, gap, metrics, result);
    return true;
  }

  private adjustNode(
    node: DwindleNode,
    area: Rect,
    gap: number,
    metrics: DwindleMetrics,
    basisId: string,
    delta: RectDelta,
  ): RectDelta {
    if (node instanceof DwindleLeaf) return delta;

    const firstContains = this.contains(node.first, basisId);
    const secondContains = this.contains(node.second, basisId);
    if (!firstContains && !secondContains) return delta;

    const firstPresent = this.hasPresent(node.first, metrics);
    const secondPresent = this.hasPresent(node.second, metrics);
    if (!firstPresent || !secondPresent) {
      /* The split is collapsed: the delta can only be consumed higher up. */
      const child = firstContains ? node.first : node.second;
      return this.adjustNode(child, area, gap, metrics, basisId, delta);
    }

    /* An unlocked split follows the longer edge of its current area. */
    if (!node.locked)
      node.dir = area.width >= area.height ? "h" : "v";

    const splitAxis = node.horizontal ? "x" : "y";
    const minFirst = this.minLength(node.first, splitAxis, gap, metrics);
    const minSecond = this.minLength(node.second, splitAxis, gap, metrics);
    const [firstArea, secondArea] = LayoutUtils.splitAreaWeighted(
      area,
      [node.ratio, 1 - node.ratio],
      gap,
      node.horizontal,
      [minFirst, minSecond],
    );

    const target = firstContains ? 0 : 1;
    const child = firstContains ? node.first : node.second;
    const childArea = firstContains ? firstArea : secondArea;
    const remainder = this.adjustNode(
      child,
      childArea,
      gap,
      metrics,
      basisId,
      delta,
    );

    const alongAxis = node.horizontal
      ? remainder.east !== 0 || remainder.west !== 0
      : remainder.south !== 0 || remainder.north !== 0;
    if (!alongAxis) return remainder;

    const axisLength = node.horizontal ? area.width : area.height;
    const minLengths =
      minFirst + minSecond <= axisLength - gap
        ? [minFirst, minSecond]
        : undefined;
    node.ratio = LayoutUtils.adjustAreaHalfWeights(
      area,
      node.ratio,
      gap,
      target,
      remainder,
      node.horizontal,
      minLengths,
    );

    return node.horizontal
      ? new RectDelta(0, 0, remainder.south, remainder.north)
      : new RectDelta(remainder.east, remainder.west, 0, 0);
  }

  private hasPresent(node: DwindleNode, metrics: DwindleMetrics): boolean {
    if (node instanceof DwindleLeaf) return metrics.has(node.windowId);
    return (
      this.hasPresent(node.first, metrics) ||
      this.hasPresent(node.second, metrics)
    );
  }

  private contains(node: DwindleNode, windowId: string): boolean {
    if (node instanceof DwindleLeaf) return node.windowId === windowId;
    return (
      this.contains(node.first, windowId) ||
      this.contains(node.second, windowId)
    );
  }

  /** Minimum length of the subtree along the given screen axis. */
  private minLength(
    node: DwindleNode,
    axis: "x" | "y",
    gap: number,
    metrics: DwindleMetrics,
  ): number {
    if (node instanceof DwindleLeaf) {
      const size = metrics.get(node.windowId);
      if (size === undefined) return 0;
      return axis === "x" ? size.width : size.height;
    }

    const firstPresent = this.hasPresent(node.first, metrics);
    const secondPresent = this.hasPresent(node.second, metrics);
    const first = this.minLength(node.first, axis, gap, metrics);
    const second = this.minLength(node.second, axis, gap, metrics);

    const splitAxis = node.horizontal ? "x" : "y";
    if (axis !== splitAxis) return Math.max(first, second);
    if (!firstPresent) return second;
    if (!secondPresent) return first;
    return first + second + gap;
  }
}
