/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class TileLayout implements ILayout {
  public static readonly MIN_MASTER_RATIO = 0.2;
  public static readonly MAX_MASTER_RATIO = 0.8;
  public static readonly id = "TileLayout";

  public readonly classID = TileLayout.id;
  public readonly capacity?: number | null;

  public get description(): string {
    return "Tile [" + this.numMaster + "]";
  }

  private parts: RotateLayoutPart<
    HalfSplitLayoutPart<RotateLayoutPart<StackLayoutPart>, StackLayoutPart>
  >;

  private master: WindowClass | null = null;

  private get numMaster(): number {
    return this.parts.inner.primarySize;
  }

  private set numMaster(value: number) {
    this.parts.inner.primarySize = value;
  }

  private get masterRatio(): number {
    return this.parts.inner.ratio;
  }

  private set masterRatio(value: number) {
    this.parts.inner.ratio = value;
  }

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.parts = new RotateLayoutPart(
      new HalfSplitLayoutPart(
        new RotateLayoutPart(new StackLayoutPart()),
        new StackLayoutPart(),
      ),
    );
    switch (CONFIG.tileLayoutInitialAngle) {
      case "1": {
        this.parts.angle = 90;
        break;
      }
      case "2": {
        this.parts.angle = 180;
        break;
      }
      case "3": {
        this.parts.angle = 270;
        break;
      }
    }
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ) {
    this.parts.adjust(area, tiles, basis, delta, gap);
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    const master = tileables.length > 0 ? tileables[0] : null;
    if (
      master !== null &&
      this.master !== null &&
      this.master !== master &&
      this.master.isAlive()
    ) {
      ctx.setPrevMaster(master, this.master);
    }
    if (master !== null && tileables.length > 1) {
      const prev = ctx.getPrevMaster(master);
      if (prev === null || tileables.indexOf(prev) === -1) {
        ctx.setPrevMaster(master, tileables[1]);
      }
    }
    this.master = master;

    tileables.forEach((tileable) => (tileable.state = WindowState.Tiled));

    this.parts.apply(area, tileables, gap).forEach((geometry, i) => {
      tileables[i].geometry = geometry;
    });
  }

  public clone(): ILayout {
    const other = new TileLayout();
    other.masterRatio = this.masterRatio;
    other.numMaster = this.numMaster;
    return other;
  }

  public handleShortcut(ctx: EngineContext, input: KrohnkiteAction) {
    switch (input) {
      case KrohnkiteAction.DWMLeft:
        this.masterRatio = clip(
          slide(this.masterRatio, -0.05),
          TileLayout.MIN_MASTER_RATIO,
          TileLayout.MAX_MASTER_RATIO,
        );
        break;
      case KrohnkiteAction.DWMRight:
        this.masterRatio = clip(
          slide(this.masterRatio, +0.05),
          TileLayout.MIN_MASTER_RATIO,
          TileLayout.MAX_MASTER_RATIO,
        );
        break;
      case KrohnkiteAction.Increase:
        // TODO: define arbitrary constant
        if (this.numMaster < 10) this.numMaster += 1;
        ctx.showNotification(this.description);
        break;
      case KrohnkiteAction.Decrease:
        if (this.numMaster > 0) this.numMaster -= 1;
        ctx.showNotification(this.description);
        break;
      case KrohnkiteAction.Rotate:
        this.parts.rotate(90);
        break;
      case KrohnkiteAction.RotatePart:
        this.parts.inner.primary.rotate(90);
        break;
      default:
        return false;
    }
    return true;
  }

  public toString(): string {
    return (
      "TileLayout(nmaster=" +
      this.numMaster +
      ", ratio=" +
      this.masterRatio +
      ")"
    );
  }
}
