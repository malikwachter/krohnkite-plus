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

interface ISmartLayoutState {
  memory: { [key: string]: ISmartRatios };
  columnOffset: number;
  orientation: "auto" | "columns" | "rows";
}

interface ISmartPlan {
  /** number of windows per column (plan space) */
  cols: number[];
  /** plan space is rotated by 90deg (columns become rows) */
  transposed: boolean;
  key: string;
  /** slot -> window index; identity unless big windows had to be moved */
  order: number[];
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
  private lastFitWarning = "";

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
      this.lastPlans[1] = { cols: [1], transposed: false, key: "N:1", order: [0] };
      return;
    }

    const focused = ctx.currentWindow;
    const rects = this.compute(
      tileables,
      area,
      gap,
      focused !== null ? tileables.indexOf(focused) : -1,
    );
    tileables.forEach((tile, i) => (tile.geometry = rects[i]));
  }

  /** Pure geometry computation; exposed separately to keep apply() trivial. */
  public compute(
    tiles: WindowClass[],
    area: Rect,
    gap: number,
    focusedIdx: number = -1,
    probe: boolean = false,
  ): Rect[] {
    const items: ISmartItem[] = tiles.map((t) => {
      const min = t.minSize;
      const weight = t.weight;
      return {
        minW: Math.max(0, min.width || 0),
        minH: Math.max(0, min.height || 0),
        weight: weight > 0 ? weight : 1,
      };
    });
    const plan = this.choosePlan(items, area, gap);
    /* a probe (drag preview trying orders) must not change state or log */
    if (!probe) this.lastPlans[tiles.length] = plan;

    const ordered = plan.order.map((i) => items[i]);
    let ratios =
      this.memory[plan.key] || SmartLayout.defaultRatios(plan, ordered);
    if (focusedIdx >= 0 && CONFIG.smartFocusGrow > 0)
      ratios = SmartLayout.grow(plan, ratios, plan.order.indexOf(focusedIdx), 1 + CONFIG.smartFocusGrow);
    const solved = SmartLayout.solve(plan, ratios, ordered, area, gap);
    if (probe) {
      /* nothing to report */
    } else if (solved.violation > 0) {
      const msg = `Krohnkite Smart: windows do not fit ${area.width}x${area.height} (${plan.key}): ${tiles
        .map((t) => `${t.windowClassName} min ${t.minSize.width}x${t.minSize.height}`)
        .join(", ")}`;
      if (msg !== this.lastFitWarning) notice(msg);
      this.lastFitWarning = msg;
    } else this.lastFitWarning = "";
    const result: Rect[] = new Array(tiles.length);
    solved.rects.forEach((r, slot) => {
      result[plan.order[slot]] = plan.transposed
        ? SmartLayout.fromPlanSpace(r, area)
        : r;
    });
    return result;
  }

  /**
   * Window orders worth trying: the user's order, and - if some windows have
   * a minimal size - the same windows with the most demanding ones first, so
   * they land in the big (master) slots instead of a small stacked one.
   */
  private static orders(items: ISmartItem[], area: Rect): number[][] {
    const identity = items.map((_, i) => i);
    const aw = Math.max(area.width, 1);
    const ah = Math.max(area.height, 1);
    const demand = items.map((it) => Math.max(it.minW / aw, it.minH / ah));
    if (!demand.some((d) => d > 0)) return [identity];
    const bySize = identity.slice().sort((a, b) => demand[b] - demand[a] || a - b);
    return bySize.every((v, i) => v === i) ? [identity] : [identity, bySize];
  }

  /* ================================================================ plan */

  /**
   * The best plan only depends on the windows' minimal sizes and weights, the
   * area and the user's column/orientation choice. Arranging happens far more
   * often than any of these change (focus changes, every commit), so the
   * choice is cached; the geometry itself is still solved every time.
   */
  private planCache: { [key: string]: ISmartPlan } = {};
  private planCacheSize = 0;

  private choosePlan(items: ISmartItem[], area: Rect, gap: number): ISmartPlan {
    let key = `${area.x},${area.y},${area.width},${area.height},${gap},${this.orientation},${this.columnOffset}`;
    for (const it of items) key += `|${it.minW},${it.minH},${it.weight}`;
    const cached = this.planCache[key];
    if (cached !== undefined) return cached;
    if (this.planCacheSize >= 256) {
      this.planCache = {};
      this.planCacheSize = 0;
    }
    const plan = this.searchPlan(items, area, gap);
    this.planCache[key] = plan;
    this.planCacheSize++;
    return plan;
  }

  private searchPlan(items: ISmartItem[], area: Rect, gap: number): ISmartPlan {
    const n = items.length;
    const target = CONFIG.smartTargetAspect > 0 ? CONFIG.smartTargetAspect : 1.3;
    const landscape = area.width >= area.height;

    let best: ISmartPlan | null = null;
    let bestScore = Infinity;
    let autoBest: { plan: ISmartPlan; score: number }[] = [];

    const orders = SmartLayout.orders(items, area);
    const candidates = SmartLayout.candidates(n);
    /* independent of the orientation: computed once, shared by both */
    const ordereds = orders.map((order) => order.map((i) => items[i]));
    const keys = candidates.map((cols) => cols.join("-"));
    const ratios = candidates.map((cols) =>
      ordereds.map((ordered) =>
        SmartLayout.defaultRatios({ cols, transposed: false, key: "", order: [] }, ordered),
      ),
    );
    for (const transposed of [false, true]) {
      if (this.orientation === "columns" && transposed) continue;
      if (this.orientation === "rows" && !transposed) continue;
      const prefix = transposed ? "T:" : "N:";
      for (let ci = 0; ci < candidates.length; ci++) {
        const cols = candidates[ci];
        const key = prefix + keys[ci];
        for (let oi = 0; oi < orders.length; oi++) {
          const plan: ISmartPlan = { cols, transposed, key, order: orders[oi] };
          const solved = SmartLayout.solve(plan, ratios[ci][oi], ordereds[oi], area, gap);
          let score = 0;
          const rects = solved.rects;
          for (let r = 0; r < rects.length; r++) {
            // aspect is evaluated in real (not plan) space
            const w = transposed ? rects[r].height : rects[r].width;
            const h = transposed ? rects[r].width : rects[r].height;
            score += Math.abs(Math.log(Math.max(w, 1) / Math.max(h, 1) / target));
          }
          score += 100 * solved.violation;
          // preference for columns on landscape and rows on portrait screens;
          // the other orientation only wins when minimal sizes force it
          if (transposed === landscape) score += 0.2 * n;
          // gentle preference for fewer splits when everything else is equal
          score += 0.01 * cols.length;
          // keep the user's window order unless moving windows avoids overlap
          if (oi > 0) score += 0.5;
          autoBest.push({ plan, score });
          if (score < bestScore) {
            bestScore = score;
            best = plan;
          }
        }
      }
    }

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
  private static candidateCache: { [n: number]: number[][] } = {};

  public static candidates(n: number): number[][] {
    const cached = SmartLayout.candidateCache[n];
    if (cached !== undefined) return cached;
    return (SmartLayout.candidateCache[n] = SmartLayout.buildCandidates(n));
  }

  private static buildCandidates(n: number): number[][] {
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
    const cols = plan.cols;
    const C = cols.length;

    /* minimal width of every column (plan space) */
    const colMin: number[] = new Array(C);
    for (let c = 0, idx = 0; c < C; c++) {
      let m = 0;
      for (let r = 0; r < cols[c]; r++, idx++) {
        const v = t ? items[idx].minH : items[idx].minW;
        if (v > m) m = v;
      }
      colMin[c] = m;
    }

    let violation = 0;
    const availW = W - gap * (C - 1);
    const widths = SmartLayout.distribute(availW, ratios.cols, colMin);
    violation += widths.overflow / Math.max(W, 1);

    const rects: Rect[] = new Array(items.length);
    let x = X;
    for (let c = 0, first = 0; c < C; c++) {
      const w = widths.sizes[c];
      const R = cols[c];
      const availH = H - gap * (R - 1);
      const given = ratios.rows[c];
      const rowRatios = given && given.length === R ? given : SmartLayout.even(R);
      const rowMin: number[] = new Array(R);
      for (let r = 0; r < R; r++) rowMin[r] = t ? items[first + r].minW : items[first + r].minH;
      const heights = SmartLayout.distribute(availH, rowRatios, rowMin);
      violation += heights.overflow / Math.max(H, 1);
      // last tile in a row/column absorbs rounding so edges stay flush
      const rw = Math.max(1, c === C - 1 ? X + W - x : w);
      let y = Y;
      for (let r = 0; r < R; r++) {
        const h = heights.sizes[r];
        const rh = r === R - 1 ? Y + H - y : h;
        rects[first + r] = new Rect(x, y, rw, Math.max(1, rh));
        y += h + gap;
      }
      first += R;
      x += w + gap;
    }
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
    const sizes: number[] = new Array(n);
    for (let i = 0; i < n; i++) sizes[i] = norm[i] * total;
    let minSum = 0;
    for (let i = 0; i < mins.length; i++) minSum += mins[i];

    if (minSum > total) {
      const scale = minSum > 0 ? total / minSum : 0;
      const scaled = mins.map((m) => (minSum > 0 ? m * scale : total / n));
      return { sizes: SmartLayout.roundSizes(scaled, total), overflow: minSum - total };
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
    const out: number[] = new Array(sizes.length);
    let sum = 0;
    for (let i = 0; i < sizes.length; i++) sum += out[i] = Math.floor(sizes[i]);
    let diff = Math.floor(total) - sum;
    for (let i = out.length - 1; i >= 0 && diff > 0; i--, diff--) out[i]++;
    return out;
  }

  /** n equal shares (exactly what normalize() returns for n ones) */
  private static evenCache: number[][] = [];
  private static even(n: number): number[] {
    const cached = SmartLayout.evenCache[n];
    if (cached !== undefined) return cached;
    const ones: number[] = [];
    for (let i = 0; i < n; i++) ones.push(1);
    return (SmartLayout.evenCache[n] = SmartLayout.normalize(ones));
  }

  public static normalize(values: number[]): number[] {
    const n = values.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    const out: number[] = new Array(n);
    if (sum <= 0) for (let i = 0; i < n; i++) out[i] = 1 / n;
    else for (let i = 0; i < n; i++) out[i] = values[i] / sum;
    return out;
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

    const items: ISmartItem[] = plan.order.map((i) => ({
      minW: tiles[i].minSize.width || 0,
      minH: tiles[i].minSize.height || 0,
      weight: tiles[i].weight > 0 ? tiles[i].weight : 1,
    }));
    const base = this.memory[plan.key] || SmartLayout.defaultRatios(plan, items);
    const ratios: ISmartRatios = {
      cols: base.cols.slice(),
      rows: base.rows.map((r) => r.slice()),
    };

    // locate the window in plan space
    const slot = plan.order.indexOf(idx);
    if (slot < 0) return;
    let col = 0;
    let row = slot;
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

  /**
   * Focus grow: the focused window's column (and its row inside the column)
   * gets `factor` times its share. Minimal sizes are still honoured by
   * solve(), so neighbours never shrink below what they need.
   */
  public static grow(plan: ISmartPlan, base: ISmartRatios, slot: number, factor: number): ISmartRatios {
    const ratios: ISmartRatios = { cols: base.cols.slice(), rows: base.rows.map((r) => r.slice()) };
    if (slot < 0) return ratios;
    let col = 0;
    let row = slot;
    while (col < plan.cols.length && row >= plan.cols[col]) {
      row -= plan.cols[col];
      col++;
    }
    if (col >= plan.cols.length) return ratios;
    if (ratios.cols.length > 1) {
      ratios.cols[col] *= factor;
      ratios.cols = SmartLayout.normalize(ratios.cols);
    }
    if (ratios.rows[col] && ratios.rows[col].length > 1) {
      ratios.rows[col][row] *= factor;
      ratios.rows[col] = SmartLayout.normalize(ratios.rows[col]);
    }
    return ratios;
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

  /* ================================================================ persistence */

  public exportState(): ISmartLayoutState {
    const memory: { [key: string]: ISmartRatios } = {};
    for (const k in this.memory)
      memory[k] = { cols: this.memory[k].cols.slice(), rows: this.memory[k].rows.map((r) => r.slice()) };
    return { memory, columnOffset: this.columnOffset, orientation: this.orientation };
  }

  public importState(state: ISmartLayoutState | undefined, replace?: boolean) {
    if (!state) return;
    if (replace) this.memory = {};
    const okList = (l: any) => Array.isArray(l) && l.every((v: any) => typeof v === "number" && v > 0);
    if (state.memory)
      for (const k in state.memory) {
        const r = state.memory[k];
        if (r && okList(r.cols) && Array.isArray(r.rows) && r.rows.every(okList))
          this.memory[k] = { cols: r.cols.slice(), rows: r.rows.map((x) => x.slice()) };
      }
    const off = state.columnOffset;
    if (typeof off === "number" && Math.round(off) === off && Math.abs(off) <= SmartLayout.MAX_COLUMNS)
      this.columnOffset = off;
    if (state.orientation === "auto" || state.orientation === "rows" || state.orientation === "columns")
      this.orientation = state.orientation;
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
