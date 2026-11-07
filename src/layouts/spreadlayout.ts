/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class SpreadLayout implements ILayout {
  public static readonly id = "SpreadLayout";

  public readonly classID = SpreadLayout.id;
  public readonly description = "Spread";
  public readonly capacity: number | null;

  private space: number; /* in ratio */
  /* Guards against re-entering restack(): raising a window emits
   * stackingOrderChanged, which can call back into the layout. */
  private restacking: boolean;

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.space = KWINCONFIG.spreadLayoutSpace / 100;
    this.restacking = false;
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    /* Tile all tileables */
    tileables.forEach((tileable) => (tileable.state = WindowState.Tiled));
    /* The window order is the stable WindowStore order. Geometry must not
     * depend on the stacking order: a raise must not move any window. */
    const tiles = tileables;

    let numTiles = tiles.length;
    const spaceWidth = Math.floor(area.width * this.space);
    let cardWidth = area.width - spaceWidth * (numTiles - 1);

    // TODO: define arbitrary constants
    const miniumCardWidth = area.width * 0.4;
    while (cardWidth < miniumCardWidth) {
      cardWidth += spaceWidth;
      numTiles -= 1;
    }

    for (let i = 0; i < tiles.length; i++)
      tiles[i].geometry = new Rect(
        area.x + (i < numTiles ? spaceWidth * (numTiles - i - 1) : 0),
        area.y,
        cardWidth,
        area.height,
      );

    this.restack(ctx, tiles, ctx.currentWindow);
  }

  /**
   * Stack the spread windows as a pyramid around the focused one, without
   * changing any geometry.
   *
   * The focused window is on top and its neighbors are above windows farther
   * away on both sides. Every window then keeps an exposed strip on the side
   * facing the focused one, while the focused window stays fully visible,
   * no matter which slot it occupies.
   */
  public restack(
    ctx: EngineContext,
    tiles: WindowClass[],
    focused: WindowClass | null,
  ): void {
    if (this.restacking || tiles.length === 0) return;

    const focusedIndex = focused !== null ? tiles.indexOf(focused) : -1;
    /* Without a focused tile (e.g. a floating window is active) keep the
     * front slot on top, which is the order produced by a fresh apply(). */
    const anchor = focusedIndex >= 0 ? focusedIndex : tiles.length - 1;
    const distances = new Map<WindowClass, number>();
    tiles.forEach((tile, index) =>
      distances.set(tile, Math.abs(index - anchor)),
    );

    const bottomToTop = [...tiles].sort(
      (a, b) => a.window.stackingOrder - b.window.stackingOrder,
    );
    /* Bottom-to-top distance must not grow towards the top. Equal distances
     * are the two sides of the focused window, whose relative order does not
     * matter. */
    let isPyramid = true;
    for (let i = 1; i < bottomToTop.length; i++) {
      const below = distances.get(bottomToTop[i - 1])!;
      const above = distances.get(bottomToTop[i])!;
      if (below < above) {
        isPyramid = false;
        break;
      }
    }
    if (isPyramid) return;

    const desired = tiles
      .map((tile, index) => ({ tile, index, distance: distances.get(tile)! }))
      .sort((a, b) => b.distance - a.distance || a.index - b.index)
      .map((entry) => entry.tile);

    this.restacking = true;
    try {
      /* Raising in this order leaves the focused window on top and the other
       * windows in their pyramid layers. */
      desired.forEach((tile) => ctx.raiseWindow(tile));
    } finally {
      this.restacking = false;
    }
  }

  public clone(): ILayout {
    const other = new SpreadLayout();
    other.space = this.space;
    return other;
  }

  public handleShortcut(ctx: EngineContext, input: KrohnkiteAction) {
    switch (input) {
      case KrohnkiteAction.Decrease:
        // TODO: define arbitrary constants
        this.space = Math.max(0.04, this.space - 0.01);
        break;
      case KrohnkiteAction.Increase:
        // TODO: define arbitrary constants
        this.space = Math.min(0.1, this.space + 0.01);
        break;
      default:
        return false;
    }
    return true;
  }

  public toString(): string {
    return "SpreadLayout(" + this.space + ")";
  }
}
