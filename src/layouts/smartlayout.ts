/*
    SPDX-License-Identifier: MIT

    SmartLayout - picks the arrangement that fits the current set of windows best.

    Every arrangement is a set of columns, each column stacking one or more
    windows (or, "transposed", a set of rows each holding one or more windows).
    For each window count the layout enumerates candidate arrangements, solves
    the geometry with respect to window minimal sizes and weights and scores the
    result:

      - tiles close to a comfortable aspect ratio (CONFIG.smartTargetAspect)
        score better,
      - arrangements that can not satisfy a window's minimal size are heavily
        penalised (so windows do not overlap neighbours any more).

    With 1..4 windows on a 16:9 screen this yields exactly the Quarter layout
    (full, halves, master + 2 stacked, 2x2 grid); with more windows it grows
    into a 3-column grid instead of floating the rest, and on ultrawide or
    portrait screens it adapts accordingly.

    Ratios changed by the user (mouse resize or keyboard) are remembered per
    arrangement, so going from 3 -> 4 -> 3 windows restores the 3-window sizes.

    Shortcuts:
      Increase / Decrease : more / fewer columns than the automatic choice
      Rotate              : toggle columns <-> rows (auto -> rows -> columns -> auto)
      RotatePart          : forget remembered sizes of the current arrangement
      DWMLeft / DWMRight  : move the first split
*/

interface ISmartPlan {
  /** number of windows per column (plan space) */
  cols: number[];
  /** plan space is rotated by 90deg (columns become rows) */
  transposed: boolean;
  key: string;
}

interface ISmartRatios {
  cols: number[];
  rows: number[][];
}

interface ISmartItem {
  minW: number;
  minH: number;
  weight: number;
}

interface ISmartSolved {
  rects: Rect[]; // plan space, gaps applied
  violation: number; // normalised amount of unsatisfiable minimal size
}

class SmartLayout implements ILayout {
  public static readonly id = "SmartLayout";
  public static readonly MIN_RATIO = 0.08;
  public static readonly MAX_COLUMNS = 5;

  public readonly classID = SmartLayout.id;
  public readonly capacity: number | null;

  public get description(): string {
    let d = "Smart";
    if (this.columnOffset !== 0)
      d += ` (${this.columnOffset > 0 ? "+" : ""}${this.columnOffset} col)`;
    if (this.orientation !== "auto") d += ` (${this.orientation})`;
    return d;
  }

  private memory: { [key: string]: ISmartRatios };
  private lastPlans: { [count: number]: ISmartPlan };
  private columnOffset: number;
  private orientation: "auto" | "columns" | "rows";
  private lastCount: number;

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.memory = {};
    this.lastPlans = {};
    this.columnOffset = 0;
    this.orientation = "auto";
    this.lastCount = 0;
  }

  /* ================================================================ apply */

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    tileables.forEach((tile) => (tile.state = WindowState.Tiled));
    const n = tileables.length;
    this.lastCount = n;
    if (n === 0) return;
    if (n === 1) {
      tileables[0].geometry = area;
      this.lastPlans[1] = { cols: [1], transposed: false, key: "N:1" };
      return;
    }

    const rects = this.compute(tileables, area, gap);
    tileables.forEach((tile, i) => (tile.geometry = rects[i]));
  }

  /** Pure geometry computation; exposed separately to keep apply() trivial. */
  public compute(tiles: WindowClass[], area: Rect, gap: number): Rect[] {
    const items: ISmartItem[] = tiles.map((t) => ({
      minW: Math.max(0, t.minSize.width || 0),
      minH: Math.max(0, t.minSize.height || 0),
      weight: t.weight > 0 ? t.weight : 1,
    }));
    const plan = this.choosePlan(items, area, gap);
    this.lastPlans[tiles.length] = plan;

    const ratios =
      this.memory[plan.key] || SmartLayout.defaultRatios(plan, items);
    const solved = SmartLayout.solve(plan, ratios, items, area, gap);
    return solved.rects.map((r) =>
      plan.transposed ? SmartLayout.fromPlanSpace(r, area) : r,
    );
  }

  /* ================================================================ plan */

  private choosePlan(items: ISmartItem[], area: Rect, gap: number): ISmartPlan {
    const n = items.length;
    const target = CONFIG.smartTargetAspect > 0 ? CONFIG.smartTargetAspect : 1.3;
    const landscape = area.width >= area.height;

    let best: ISmartPlan | null = null;
    let bestScore = Infinity;
    let autoBest: { plan: ISmartPlan; score: number }[] = [];

    [false, true].forEach((transposed) => {
      if (this.orientation === "columns" && transposed) return;
      if (this.orientation === "rows" && !transposed) return;
      SmartLayout.candidates(n).forEach((cols) => {
        const plan: ISmartPlan = {
          cols,
          transposed,
          key: `${transposed ? "T" : "N"}:${cols.join("-")}`,
        };
        const solved = SmartLayout.solve(
          plan,
          SmartLayout.defaultRatios(plan, items),
          items,
          area,
          gap,
        );
        let score = 0;
        solved.rects.forEach((r) => {
          // aspect is evaluated in real (not plan) space
          const w = transposed ? r.height : r.width;
          const h = transposed ? r.width : r.height;
          score += Math.abs(Math.log(Math.max(w, 1) / Math.max(h, 1) / target));
        });
        score += 100 * solved.violation;
        // preference for columns on landscape and rows on portrait screens;
        // the other orientation only wins when minimal sizes force it
        if (transposed === landscape) score += 0.2 * n;
        // gentle preference for fewer splits when everything else is equal
        score += 0.01 * cols.length;
        autoBest.push({ plan, score });
        if (score < bestScore) {
          bestScore = score;
          best = plan;
        }
      });
    });

    if (this.columnOffset !== 0 && best !== null) {
      const wanted = clip(
        (best as ISmartPlan).cols.length + this.columnOffset,
        1,
        Math.min(n, SmartLayout.MAX_COLUMNS),
      );
      let offsetBest: ISmartPlan | null = null;
      let offsetScore = Infinity;
      autoBest.forEach(({ plan, score }) => {
        if (
          plan.cols.length === wanted &&
          plan.transposed === (best as ISmartPlan).transposed &&
          score < offsetScore
        ) {
          offsetScore = score;
          offsetBest = plan;
        }
      });
      if (offsetBest !== null) best = offsetBest;
    }
    return best!;
  }

  /**
   * Distributions of n windows into columns. The first (master) column holds
   * `m <= n / c` windows, the rest is spread evenly over the other
   * columns, extra windows going to the rightmost columns.
   */
  public static candidates(n: number): number[][] {
    const result: number[][] = [];
    const seen: { [k: string]: boolean } = {};
    const maxCols = Math.min(n, SmartLayout.MAX_COLUMNS);
    for (let c = 1; c <= maxCols; c++) {
      if (c === 1) {
        result.push([n]);
        continue;
      }
      // the master column never holds more windows than the others
      for (let m = 1; m <= Math.max(1, Math.floor(n / c)); m++) {
        const rest = n - m;
        const others = c - 1;
        if (rest < others) continue;
        const cols = [m];
        const base = Math.floor(rest / others);
        const extra = rest % others;
        for (let i = 0; i < others; i++)
          cols.push(base + (i >= others - extra ? 1 : 0));
        const k = cols.join("-");
        if (!seen[k]) {
          seen[k] = true;
          result.push(cols);
        }
      }
    }
    return result;
  }

  public static defaultRatios(plan: ISmartPlan, items: ISmartItem[]): ISmartRatios {
    const cols: number[] = [];
    const rows: number[][] = [];
    let idx = 0;
    plan.cols.forEach((count) => {
      const ws = items.slice(idx, idx + count).map((it) => it.weight);
      idx += count;
      cols.push(Math.max(...ws));
      rows.push(SmartLayout.normalize(ws));
    });
    return { cols: SmartLayout.normalize(cols), rows };
  }

  /* ================================================================ solve */

  /**
   * Compute rects in plan space (x = along columns). For transposed plans the
   * area is swapped, so callers have to convert with fromPlanSpace().
   */
  public static solve(
    plan: ISmartPlan,
    ratios: ISmartRatios,
    items: ISmartItem[],
    area: Rect,
    gap: number,
  ): ISmartSolved {
    const t = plan.transposed;
    const W = t ? area.height : area.width;
    const H = t ? area.width : area.height;
    const X = t ? area.y : area.x;
    const Y = t ? area.x : area.y;
    const mins = items.map((it) => ({
      w: t ? it.minH : it.minW,
      h: t ? it.minW : it.minH,
    }));

    const C = plan.cols.length;
    let idx = 0;
    const colMin: number[] = [];
    const colItems: number[][] = [];
    plan.cols.forEach((count) => {
      const ids: number[] = [];
      for (let i = 0; i < count; i++) ids.push(idx++);
      colItems.push(ids);
      colMin.push(Math.max(0, ...ids.map((i) => mins[i].w)));
    });

    let violation = 0;
    const availW = W - gap * (C - 1);
    const widths = SmartLayout.distribute(availW, ratios.cols, colMin);
    violation += widths.overflow / Math.max(W, 1);

    const rects: Rect[] = new Array(items.length);
    let x = X;
    colItems.forEach((ids, c) => {
      const w = widths.sizes[c];
      const R = ids.length;
      const availH = H - gap * (R - 1);
      const rowRatios =
        ratios.rows[c] && ratios.rows[c].length === R
          ? ratios.rows[c]
          : SmartLayout.normalize(ids.map(() => 1));
      const heights = SmartLayout.distribute(
        availH,
        rowRatios,
        ids.map((i) => mins[i].h),
      );
      violation += heights.overflow / Math.max(H, 1);
      let y = Y;
      ids.forEach((id, r) => {
        const h = heights.sizes[r];
        // last tile in a row/column absorbs rounding so edges stay flush
        const rw = c === C - 1 ? X + W - x : w;
        const rh = r === R - 1 ? Y + H - y : h;
        rects[id] = new Rect(x, y, Math.max(1, rw), Math.max(1, rh));
        y += h + gap;
      });
      x += w + gap;
    });
    return { rects, violation };
  }

  /**
   * Split `total` according to `ratios` while honouring `mins`. Space is taken
   * from parts proportionally to their slack. If the minimums can not fit at
   * all, everything is scaled down and the deficit is reported as overflow.
   */
  public static distribute(
    total: number,
    ratios: number[],
    mins: number[],
  ): { sizes: number[]; overflow: number } {
    const n = ratios.length;
    const norm = SmartLayout.normalize(ratios);
    let sizes = norm.map((r) => r * total);
    const minSum = mins.reduce((a, b) => a + b, 0);

    if (minSum > total) {
      const scale = minSum > 0 ? total / minSum : 0;
      sizes = mins.map((m) => (minSum > 0 ? m * scale : total / n));
      return { sizes: SmartLayout.roundSizes(sizes, total), overflow: minSum - total };
    }

    for (let iter = 0; iter < n; iter++) {
      let deficit = 0;
      for (let i = 0; i < n; i++) {
        if (sizes[i] < mins[i]) {
          deficit += mins[i] - sizes[i];
          sizes[i] = mins[i];
        }
      }
      if (deficit <= 0.5) break;
      let slack = 0;
      for (let i = 0; i < n; i++) slack += Math.max(0, sizes[i] - mins[i]);
      if (slack <= 0) break;
      for (let i = 0; i < n; i++) {
        const s = Math.max(0, sizes[i] - mins[i]);
        sizes[i] -= (deficit * s) / slack;
      }
    }
    return { sizes: SmartLayout.roundSizes(sizes, total), overflow: 0 };
  }

  private static roundSizes(sizes: number[], total: number): number[] {
    const out = sizes.map((s) => Math.floor(s));
    let diff = Math.floor(total) - out.reduce((a, b) => a + b, 0);
    for (let i = out.length - 1; i >= 0 && diff > 0; i--, diff--) out[i]++;
    return out;
  }

  public static normalize(values: number[]): number[] {
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum <= 0) return values.map(() => 1 / values.length);
    return values.map((v) => v / sum);
  }

  private static fromPlanSpace(r: Rect, area: Rect): Rect {
    return new Rect(r.y, r.x, r.height, r.width);
  }

  /* ================================================================ adjust */

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ): void {
    const n = tiles.length;
    const plan = this.lastPlans[n];
    if (!plan || n < 2) return;
    const idx = tiles.indexOf(basis);
    if (idx < 0) return;

    const items: ISmartItem[] = tiles.map((t) => ({
      minW: t.minSize.width || 0,
      minH: t.minSize.height || 0,
      weight: t.weight > 0 ? t.weight : 1,
    }));
    const base = this.memory[plan.key] || SmartLayout.defaultRatios(plan, items);
    const ratios: ISmartRatios = {
      cols: base.cols.slice(),
      rows: base.rows.map((r) => r.slice()),
    };

    // locate the window in plan space
    let col = 0;
    let row = idx;
    while (col < plan.cols.length && row >= plan.cols[col]) {
      row -= plan.cols[col];
      col++;
    }
    if (col >= plan.cols.length) return;

    const t = plan.transposed;
    const east = t ? delta.south : delta.east;
    const west = t ? delta.north : delta.west;
    const south = t ? delta.east : delta.south;
    const north = t ? delta.west : delta.north;
    const W = t ? area.height : area.width;
    const H = t ? area.width : area.height;

    if (east !== 0 && col < plan.cols.length - 1)
      SmartLayout.moveBoundary(ratios.cols, col, east / W);
    if (west !== 0 && col > 0)
      SmartLayout.moveBoundary(ratios.cols, col - 1, -west / W);
    const rows = ratios.rows[col];
    if (rows && rows.length > 1) {
      if (south !== 0 && row < rows.length - 1)
        SmartLayout.moveBoundary(rows, row, south / H);
      if (north !== 0 && row > 0)
        SmartLayout.moveBoundary(rows, row - 1, -north / H);
    }
    this.memory[plan.key] = ratios;
  }

  /** move the boundary between parts b and b+1 by d (fraction of total) */
  private static moveBoundary(parts: number[], b: number, d: number) {
    const min = SmartLayout.MIN_RATIO;
    const pair = parts[b] + parts[b + 1];
    const left = clip(parts[b] + d, min, pair - min);
    parts[b] = left;
    parts[b + 1] = pair - left;
  }

  /* ================================================================ shortcuts */

  public handleShortcut(ctx: EngineContext, input: Shortcut): boolean {
    switch (input) {
      case Shortcut.Increase:
        if (this.columnOffset < SmartLayout.MAX_COLUMNS) this.columnOffset++;
        ctx.showNotification(this.description);
        return true;
      case Shortcut.Decrease:
        if (this.columnOffset > -SmartLayout.MAX_COLUMNS) this.columnOffset--;
        ctx.showNotification(this.description);
        return true;
      case Shortcut.Rotate:
        this.orientation =
          this.orientation === "auto"
            ? "rows"
            : this.orientation === "rows"
              ? "columns"
              : "auto";
        ctx.showNotification(this.description);
        return true;
      case Shortcut.RotatePart: {
        // forget every remembered ratio -> back to the automatic sizes
        this.memory = {};
        this.columnOffset = 0;
        this.orientation = "auto";
        ctx.showNotification("Smart: reset");
        return true;
      }
      case Shortcut.DWMLeft:
      case Shortcut.DWMRight:
        return this.shiftFirstSplit(input === Shortcut.DWMRight ? 0.05 : -0.05);
      default:
        return false;
    }
  }

  /** move the first split of the most recently applied arrangement */
  private shiftFirstSplit(d: number): boolean {
    const plan = this.lastPlans[this.lastCount];
    if (!plan || this.lastCount < 2) return false;
    const base =
      this.memory[plan.key] ||
      SmartLayout.defaultRatios(
        plan,
        plan.cols.reduce((acc: ISmartItem[], c) => {
          for (let i = 0; i < c; i++) acc.push({ minW: 0, minH: 0, weight: 1 });
          return acc;
        }, []),
      );
    const ratios: ISmartRatios = {
      cols: base.cols.slice(),
      rows: base.rows.map((r) => r.slice()),
    };
    if (ratios.cols.length > 1) SmartLayout.moveBoundary(ratios.cols, 0, d);
    else if (ratios.rows[0].length > 1)
      SmartLayout.moveBoundary(ratios.rows[0], 0, d);
    this.memory[plan.key] = ratios;
    return true;
  }

  /* ================================================================ misc */

  public clone(): ILayout {
    const other = new SmartLayout(this.capacity);
    for (const k in this.memory)
      other.memory[k] = {
        cols: this.memory[k].cols.slice(),
        rows: this.memory[k].rows.map((r) => r.slice()),
      };
    for (const k in this.lastPlans) other.lastPlans[k] = this.lastPlans[k];
    other.columnOffset = this.columnOffset;
    other.orientation = this.orientation;
    return other;
  }

  public toString(): string {
    return `SmartLayout(colOffset=${this.columnOffset}, orientation=${this.orientation})`;
  }
}
