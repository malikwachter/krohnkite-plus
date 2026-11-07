/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class ThreeColumnLayout implements ILayout {
  public static readonly MIN_MASTER_RATIO = 0.2;
  public static readonly MAX_MASTER_RATIO = 0.75;
  public static readonly id = "ThreeColumnLayout";
  public readonly capacity: number | null;

  public readonly classID = ThreeColumnLayout.id;

  public get description(): string {
    return "Three-Column [" + this.masterSize + "]";
  }

  private masterRatio: number;
  private masterSize: number;

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.masterRatio = 0.6;
    this.masterSize = 1;
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ): void {
    const basisIndex = tiles.indexOf(basis);
    if (basisIndex < 0) return;

    if (tiles.length === 0)
      /* no tiles */
      return;
    else if (tiles.length <= this.masterSize) {
      /* one column */
      LayoutUtils.adjustAreaWeightsProportional(
        area,
        tiles.map((tile) => tile.weight),
        gap,
        tiles.indexOf(basis),
        delta,
        false,
        this.verticalMinLengths(tiles, area.height, gap),
      ).forEach((newWeight, i) => (tiles[i].weight = newWeight * tiles.length));
    } else if (tiles.length === this.masterSize + 1) {
      /* two columns */
      const masterTiles = tiles.slice(0, this.masterSize);
      const stackTile = tiles[tiles.length - 1];

      /* adjust master-stack ratio */
      const ratioWeights = LayoutUtils.adjustAreaWeightsProportional(
        area,
        [this.masterRatio, 1 - this.masterRatio],
        gap,
        basisIndex < this.masterSize ? 0 : 1,
        delta,
        true,
        this.horizontalMinLengths([masterTiles, [stackTile]], area.width, gap),
      );
      this.masterRatio = ratioWeights[0];

      /* adjust master tile weights */
      if (basisIndex < this.masterSize) {
        LayoutUtils.adjustAreaWeightsProportional(
          area,
          masterTiles.map((tile) => tile.weight),
          gap,
          basisIndex,
          delta,
          false,
          this.verticalMinLengths(masterTiles, area.height, gap),
        ).forEach(
          (newWeight, i) =>
            (masterTiles[i].weight = newWeight * masterTiles.length),
        );
      }
    } else if (tiles.length > this.masterSize + 1) {
      /* three columns */
      let basisGroup;
      if (basisIndex < this.masterSize) basisGroup = 1; /* master */
      else if (basisIndex < Math.floor((this.masterSize + tiles.length) / 2))
        basisGroup = 2; /* R-stack */
      else basisGroup = 0; /* L-stack */

      const rstackNumTile = Math.floor((tiles.length - this.masterSize) / 2);
      const [masterTiles, rstackTiles, lstackTiles] =
        partitionArrayBySizes<WindowClass>(tiles, [
          this.masterSize,
          rstackNumTile,
        ]);

      /* adjust master-stack ratio */
      const stackRatio = 1 - this.masterRatio;
      const groupMinLengths = this.horizontalMinLengths(
        [lstackTiles, masterTiles, rstackTiles],
        area.width,
        gap,
      );
      /* both stacks share one ratio, so use the wider minimum for each */
      const stackMin = Math.max(
        groupMinLengths?.[0] ?? 0,
        groupMinLengths?.[2] ?? 0,
      );
      const ratioMinLengths = groupMinLengths
        ? [stackMin, groupMinLengths[1], stackMin]
        : undefined;
      const newRatios = LayoutUtils.adjustAreaWeightsProportional(
        area,
        [stackRatio, this.masterRatio, stackRatio],
        gap,
        basisGroup,
        delta,
        true,
        ratioMinLengths,
      );
      const newMasterRatio = newRatios[1];
      const newStackRatio = basisGroup === 0 ? newRatios[0] : newRatios[2];
      this.masterRatio = newMasterRatio / (newMasterRatio + newStackRatio);

      /* adjust tile weight */
      const groupTiles = [lstackTiles, masterTiles, rstackTiles][basisGroup];
      LayoutUtils.adjustAreaWeightsProportional(
        area /* we only need height */,
        groupTiles.map((tile) => tile.weight),
        gap,
        groupTiles.indexOf(basis),
        delta,
        false,
        this.verticalMinLengths(groupTiles, area.height, gap),
      ).forEach(
        (newWeight, i) =>
          (groupTiles[i].weight = newWeight * groupTiles.length),
      );
    }
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    /* Tile all tileables */
    tileables.forEach((tileable) => (tileable.state = WindowState.Tiled));
    const tiles = tileables;

    if (tiles.length <= this.masterSize) {
      /* only master */
      LayoutUtils.splitAreaWeighted(
        area,
        tiles.map((tile) => tile.weight),
        gap,
        false,
        this.verticalMinLengths(tiles, area.height, gap),
      ).forEach((tileArea, i) => (tiles[i].geometry = tileArea));
    } else if (tiles.length === this.masterSize + 1) {
      /* master & R-stack (only 1 window in stack) */
      const masterTiles = tiles.slice(0, this.masterSize);
      const stackTile = tiles[tiles.length - 1];
      const [masterArea, stackArea] = LayoutUtils.splitAreaWeighted(
        area,
        [this.masterRatio, 1 - this.masterRatio],
        gap,
        true,
        this.horizontalMinLengths([masterTiles, [stackTile]], area.width, gap),
      );

      LayoutUtils.splitAreaWeighted(
        masterArea,
        masterTiles.map((tile) => tile.weight),
        gap,
        false,
        this.verticalMinLengths(masterTiles, masterArea.height, gap),
      ).forEach((tileArea, i) => (masterTiles[i].geometry = tileArea));

      stackTile.geometry = stackArea;
    } else if (tiles.length > this.masterSize + 1) {
      /* L-stack & master & R-stack */
      const stackRatio = 1 - this.masterRatio;

      const rstackSize = Math.floor((tiles.length - this.masterSize) / 2);
      const [masterTiles, rstackTiles, lstackTiles] =
        partitionArrayBySizes<WindowClass>(tiles, [
          this.masterSize,
          rstackSize,
        ]);

      /** Areas allocated to L-stack, master, and R-stack */
      const groupAreas = LayoutUtils.splitAreaWeighted(
        area,
        [stackRatio, this.masterRatio, stackRatio],
        gap,
        true,
        this.horizontalMinLengths(
          [lstackTiles, masterTiles, rstackTiles],
          area.width,
          gap,
        ),
      );

      [lstackTiles, masterTiles, rstackTiles].forEach((groupTiles, group) => {
        LayoutUtils.splitAreaWeighted(
          groupAreas[group],
          groupTiles.map((tile) => tile.weight),
          gap,
          false,
          this.verticalMinLengths(groupTiles, groupAreas[group].height, gap),
        ).forEach((tileArea, i) => (groupTiles[i].geometry = tileArea));
      });
    }
  }

  public clone(): ILayout {
    const other = new ThreeColumnLayout();
    other.masterRatio = this.masterRatio;
    other.masterSize = this.masterSize;
    return other;
  }

  public handleShortcut(ctx: EngineContext, input: KrohnkiteAction): boolean {
    switch (input) {
      case KrohnkiteAction.Increase:
        this.resizeMaster(ctx, +1);
        return true;
      case KrohnkiteAction.Decrease:
        this.resizeMaster(ctx, -1);
        return true;
      case KrohnkiteAction.DWMLeft:
        this.masterRatio = clip(
          slide(this.masterRatio, -0.05),
          ThreeColumnLayout.MIN_MASTER_RATIO,
          ThreeColumnLayout.MAX_MASTER_RATIO,
        );
        return true;
      case KrohnkiteAction.DWMRight:
        this.masterRatio = clip(
          slide(this.masterRatio, +0.05),
          ThreeColumnLayout.MIN_MASTER_RATIO,
          ThreeColumnLayout.MAX_MASTER_RATIO,
        );
        return true;
      default:
        return false;
    }
  }

  public toString(): string {
    return "ThreeColumnLayout(nmaster=" + this.masterSize + ")";
  }

  /**
   * Minimum vertical length of each window in a stack, or undefined when the
   * minimums cannot fit in the given axis and the constraint must be ignored.
   */
  private verticalMinLengths(
    tiles: WindowClass[],
    axisLength: number,
    gap: number,
  ): number[] | undefined {
    const minLengths = tiles.map((tile) => tile.minSize.height);
    const available = axisLength - (tiles.length - 1) * gap;
    const totalMin = minLengths.reduce((sum, min) => sum + min, 0);
    return totalMin <= available ? minLengths : undefined;
  }

  /**
   * Minimum horizontal length of each column group (the widest window in the
   * group), or undefined when the minimums cannot fit in the given axis.
   */
  private horizontalMinLengths(
    groups: WindowClass[][],
    axisLength: number,
    gap: number,
  ): number[] | undefined {
    const minLengths = groups.map((group) =>
      group.reduce((max, tile) => Math.max(max, tile.minSize.width), 0),
    );
    const available = axisLength - (groups.length - 1) * gap;
    const totalMin = minLengths.reduce((sum, min) => sum + min, 0);
    return totalMin <= available ? minLengths : undefined;
  }

  private resizeMaster(ctx: EngineContext, step: -1 | 1): void {
    this.masterSize = clip(this.masterSize + step, 1, 10);
    ctx.showNotification(this.description);
  }
}
