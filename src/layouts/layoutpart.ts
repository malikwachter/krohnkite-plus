/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface ILayoutPart {
  adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
    transposed?: boolean
  ): RectDelta;
  apply(
    area: Rect,
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): Rect[];
  minLength(
    axis: "x" | "y",
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): number;
}

/**
 * The minimum screen extent of a tile along a part's local axis.
 * `transposed` means the part's local vertical axis maps to the screen
 * horizontal axis.
 */
function minComponent(
  axis: "x" | "y",
  tile: WindowClass,
  transposed: boolean
): number {
  if (axis === "y")
    return transposed ? tile.minSize.width : tile.minSize.height;
  return transposed ? tile.minSize.height : tile.minSize.width;
}

class FillLayoutPart implements ILayoutPart {
  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
    transposed?: boolean
  ): RectDelta {
    /* do nothing */
    return delta;
  }

  public apply(
    area: Rect,
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): Rect[] {
    return tiles.map((tile) => {
      return area;
    });
  }

  public minLength(
    axis: "x" | "y",
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): number {
    return tiles.reduce(
      (max, tile) =>
        Math.max(max, minComponent(axis, tile, transposed ?? false)),
      0
    );
  }

  public toString(): string {
    return `FillLayoutPart`;
  }
}

class HalfSplitLayoutPart<L extends ILayoutPart, R extends ILayoutPart>
  implements ILayoutPart
{
  /** the rotation angle for this part.
   *
   *    | angle | direction  | primary |
   *    | ----- | ---------- | ------- |
   *    |     0 | horizontal | left    |
   *    |    90 | vertical   | top     |
   *    |   180 | horizontal | right   |
   *    |   270 | vertical   | bottom  |
   */
  public angle: 0 | 90 | 180 | 270;

  public primarySize: number;
  public ratio: number;

  private get horizontal(): boolean {
    return this.angle === 0 || this.angle === 180;
  }

  private get reversed(): boolean {
    return this.angle === 180 || this.angle === 270;
  }

  constructor(public primary: L, public secondary: R) {
    this.angle = 0;
    this.primarySize = 1;
    this.ratio = 0.5;
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
    transposed?: boolean
  ): RectDelta {
    const basisIndex = tiles.indexOf(basis);
    if (basisIndex < 0) return delta;

    if (tiles.length <= this.primarySize) {
      /* primary only */
      return this.primary.adjust(area, tiles, basis, delta, gap, transposed);
    } else if (this.primarySize === 0) {
      /* secondary only */
      return this.secondary.adjust(area, tiles, basis, delta, gap, transposed);
    } else {
      /* both parts */

      /** which part to adjust. 0 = primary, 1 = secondary */
      const targetIndex = basisIndex < this.primarySize ? 0 : 1;

      if (targetIndex === /* primary */ 0) {
        delta = this.primary.adjust(
          area,
          tiles.slice(0, this.primarySize),
          basis,
          delta,
          gap,
          transposed
        );
      } else {
        delta = this.secondary.adjust(
          area,
          tiles.slice(this.primarySize),
          basis,
          delta,
          gap,
          transposed
        );
      }

      const [primaryMin, secondaryMin] = this.splitMinPair(
        tiles,
        gap,
        transposed
      );
      const axisLength = this.horizontal ? area.width : area.height;
      const minLengths =
        primaryMin + secondaryMin <= axisLength - gap
          ? this.reversed
            ? [secondaryMin, primaryMin]
            : [primaryMin, secondaryMin]
          : undefined;

      this.ratio = LayoutUtils.adjustAreaHalfWeights(
        area,
        this.reversed ? 1 - this.ratio : this.ratio,
        gap,
        this.reversed ? 1 - targetIndex : targetIndex,
        delta,
        this.horizontal,
        minLengths
      );
      if (this.reversed) this.ratio = 1 - this.ratio;

      switch (this.angle * 10 + targetIndex + 1) {
        case 1: /*   0, Primary */
        case 1802 /* 180, Secondary */:
          return new RectDelta(0, delta.west, delta.south, delta.north);
        case 2:
        case 1801:
          return new RectDelta(delta.east, 0, delta.south, delta.north);
        case 901:
        case 2702:
          return new RectDelta(delta.east, delta.west, 0, delta.north);
        case 902:
        case 2701:
          return new RectDelta(delta.east, delta.west, delta.south, 0);
      }
      return delta;
    }
  }
  public toString(): string {
    return `<HalfSplitLayout: angle:${this.angle},ratio:${this.ratio},pr_size:${this.primarySize}.<<<Primary:${this.primary}---Secondary:${this.secondary}>>>`;
  }

  public apply(
    area: Rect,
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): Rect[] {
    if (tiles.length <= this.primarySize) {
      /* primary only */
      return this.primary.apply(area, tiles, gap, transposed);
    } else if (this.primarySize === 0) {
      /* secondary only */
      return this.secondary.apply(area, tiles, gap, transposed);
    } else {
      /* both parts */
      const reversed = this.reversed;
      const ratio = reversed ? 1 - this.ratio : this.ratio;
      const [primaryMin, secondaryMin] = this.splitMinPair(
        tiles,
        gap,
        transposed
      );
      const minLengths = reversed
        ? [secondaryMin, primaryMin]
        : [primaryMin, secondaryMin];
      const [area1, area2] = LayoutUtils.splitAreaWeighted(
        area,
        [ratio, 1 - ratio],
        gap,
        this.horizontal,
        minLengths
      );
      const result1 = this.primary.apply(
        reversed ? area2 : area1,
        tiles.slice(0, this.primarySize),
        gap,
        transposed
      );
      const result2 = this.secondary.apply(
        reversed ? area1 : area2,
        tiles.slice(this.primarySize),
        gap,
        transposed
      );
      return result1.concat(result2);
    }
  }

  public minLength(
    axis: "x" | "y",
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): number {
    if (tiles.length <= this.primarySize) {
      /* primary only */
      return this.primary.minLength(axis, tiles, gap, transposed);
    } else if (this.primarySize === 0) {
      /* secondary only */
      return this.secondary.minLength(axis, tiles, gap, transposed);
    }

    const primaryMin = this.primary.minLength(
      axis,
      tiles.slice(0, this.primarySize),
      gap,
      transposed
    );
    const secondaryMin = this.secondary.minLength(
      axis,
      tiles.slice(this.primarySize),
      gap,
      transposed
    );
    const splitAxis: "x" | "y" = this.horizontal ? "x" : "y";
    return axis === splitAxis
      ? primaryMin + secondaryMin + gap
      : Math.max(primaryMin, secondaryMin);
  }

  /**
   * Minimum length of the primary and secondary areas along this part's split
   * axis, as `[primary, secondary]`.
   */
  private splitMinPair(
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): [number, number] {
    const splitAxis: "x" | "y" = this.horizontal ? "x" : "y";
    return [
      this.primary.minLength(
        splitAxis,
        tiles.slice(0, this.primarySize),
        gap,
        transposed
      ),
      this.secondary.minLength(
        splitAxis,
        tiles.slice(this.primarySize),
        gap,
        transposed
      ),
    ];
  }
}

class StackLayoutPart implements ILayoutPart {
  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
    transposed?: boolean
  ): RectDelta {
    const weights = LayoutUtils.adjustAreaWeightsProportional(
      area,
      tiles.map((tile) => tile.weight),
      gap,
      tiles.indexOf(basis),
      delta,
      false,
      StackLayoutPart.minLengths(tiles, transposed)
    );

    weights.forEach((weight, i) => {
      tiles[i].weight = weight * tiles.length;
    });

    const idx = tiles.indexOf(basis);
    return new RectDelta(
      delta.east,
      delta.west,
      idx === tiles.length - 1 ? delta.south : 0,
      idx === 0 ? delta.north : 0
    );
  }

  public apply(
    area: Rect,
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): Rect[] {
    const weights = tiles.map((tile) => tile.weight);
    return LayoutUtils.splitAreaWeighted(
      area,
      weights,
      gap,
      false,
      StackLayoutPart.minLengths(tiles, transposed)
    );
  }

  public minLength(
    axis: "x" | "y",
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): number {
    const flag = transposed ?? false;
    if (axis === "y") {
      const sum = tiles.reduce(
        (acc, tile) => acc + minComponent("y", tile, flag),
        0
      );
      return sum + Math.max(0, tiles.length - 1) * gap;
    }
    return tiles.reduce(
      (max, tile) => Math.max(max, minComponent("x", tile, flag)),
      0
    );
  }

  private static minLengths(
    tiles: WindowClass[],
    transposed?: boolean
  ): number[] {
    return tiles.map((tile) =>
      transposed ? tile.minSize.width : tile.minSize.height
    );
  }
}

class RotateLayoutPart<T extends ILayoutPart> implements ILayoutPart {
  constructor(public inner: T, public angle: 0 | 90 | 180 | 270 = 0) {}

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
    transposed?: boolean
  ): RectDelta {
    // let area = area, delta = delta;
    switch (this.angle) {
      case 0:
        break;
      case 90:
        area = new Rect(area.y, area.x, area.height, area.width);
        delta = new RectDelta(delta.south, delta.north, delta.east, delta.west);
        break;
      case 180:
        delta = new RectDelta(delta.west, delta.east, delta.south, delta.north);
        break;
      case 270:
        area = new Rect(area.y, area.x, area.height, area.width);
        delta = new RectDelta(delta.north, delta.south, delta.east, delta.west);
        break;
    }

    delta = this.inner.adjust(
      area,
      tiles,
      basis,
      delta,
      gap,
      this.innerTransposed(transposed)
    );

    switch (this.angle) {
      case 0:
        delta = delta;
        break;
      case 90:
        delta = new RectDelta(delta.south, delta.north, delta.east, delta.west);
        break;
      case 180:
        delta = new RectDelta(delta.west, delta.east, delta.south, delta.north);
        break;
      case 270:
        delta = new RectDelta(delta.north, delta.south, delta.east, delta.west);
        break;
    }
    return delta;
  }

  public apply(
    area: Rect,
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): Rect[] {
    switch (this.angle) {
      case 0:
        break;
      case 90:
        area = new Rect(area.y, area.x, area.height, area.width);
        break;
      case 180:
        break;
      case 270:
        area = new Rect(area.y, area.x, area.height, area.width);
        break;
    }

    const innerResult = this.inner.apply(
      area,
      tiles,
      gap,
      this.innerTransposed(transposed)
    );

    switch (this.angle) {
      case 0:
        return innerResult;
      case 90:
        return innerResult.map((g) => new Rect(g.y, g.x, g.height, g.width));
      case 180:
        return innerResult.map((g) => {
          const rx = g.x - area.x;
          const newX = area.x + area.width - (rx + g.width);
          return new Rect(newX, g.y, g.width, g.height);
        });
      case 270:
        return innerResult.map((g) => {
          const rx = g.x - area.x;
          const newY = area.x + area.width - (rx + g.width);
          return new Rect(g.y, newY, g.height, g.width);
        });
    }
  }

  /**
   * The inner part's local vertical maps to the screen horizontal axis when
   * this rotation swaps the axes (90/270), toggling the incoming flag.
   */
  private innerTransposed(transposed?: boolean): boolean {
    const swapsAxes = this.angle === 90 || this.angle === 270;
    return (transposed ?? false) !== swapsAxes;
  }

  public minLength(
    axis: "x" | "y",
    tiles: WindowClass[],
    gap: number,
    transposed?: boolean
  ): number {
    const swapsAxes = this.angle === 90 || this.angle === 270;
    const innerAxis: "x" | "y" = swapsAxes
      ? axis === "x"
        ? "y"
        : "x"
      : axis;
    return this.inner.minLength(
      innerAxis,
      tiles,
      gap,
      this.innerTransposed(transposed)
    );
  }

  public rotate(amount: -90 | 90): void {
    // -90 | 0 | 90 | 180 | 270 | 360
    let angle = this.angle + amount;
    if (angle < 0) angle = 270;
    else if (angle >= 360) angle = 0;

    this.angle = angle as 0 | 90 | 180 | 270;
  }
}
