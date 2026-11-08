/*
    SPDX-License-Identifier: MIT

    Kröhnkite-Plus: geometry of the popup layer and the tray layer.

    Popup layer: small windows other programs open (dialogs, file pickers,
    message boxes) do not fill the screen like tiles. They keep a sensible
    size of their own and are packed around the middle of the screen: in
    columns, the whole group centered, every column centered vertically and
    every window leaning towards the middle line.

    Tray layer: one "quickview" window (an app that lives in the system
    tray), square and centered, or the size the user gave it last time.

    Pure functions, no KWin access, so they can be tested in node.
*/

class LayerGeometry {
  /** the smallest share of the screen a popup is allowed to take at most */
  public static readonly POPUP_MAX_SHARE = 0.85;

  /**
   * Size of a popup: what the app asked for, but never below `floor` (so
   * small dialogs still show their content) and never below the app's own
   * minimal size, never above its maximal size or most of the screen.
   * `exact` sizes (remembered from the user, or insisted on by the app) only
   * get clamped.
   */
  public static popupSize(
    requested: ISize,
    min: ISize,
    max: ISize,
    area: Rect,
    floor: ISize,
    exact: boolean,
  ): ISize {
    const capW = Math.max(1, Math.floor(area.width * LayerGeometry.POPUP_MAX_SHARE));
    const capH = Math.max(1, Math.floor(area.height * LayerGeometry.POPUP_MAX_SHARE));
    const one = (want: number, lo: number, hi: number, fl: number, cap: number, total: number) => {
      let v = exact ? want : Math.max(want, fl);
      v = Math.min(v, cap);
      if (hi > 0) v = Math.min(v, hi);
      if (lo > 0) v = Math.max(v, lo);
      return Math.round(Math.max(1, Math.min(v, total)));
    };
    return {
      width: one(requested.width, min.width, max.width, floor.width, capW, area.width),
      height: one(requested.height, min.height, max.height, floor.height, capH, area.height),
    };
  }

  /**
   * Split `heights` (in order) into `k` consecutive, non-empty columns with
   * the smallest possible highest column. Returns the indices per column.
   */
  public static partition(heights: number[], k: number, gap: number): number[][] {
    const n = heights.length;
    k = Math.max(1, Math.min(k, n));
    const pre = [0];
    for (let i = 0; i < n; i++) pre.push(pre[i] + heights[i]);
    const colH = (a: number, b: number) => pre[b] - pre[a] + gap * (b - a - 1); // [a, b)
    /* best[j][i]: smallest highest column for the first i windows in j columns */
    const best: number[][] = [];
    const cut: number[][] = [];
    for (let j = 0; j <= k; j++) {
      best.push(new Array(n + 1).fill(Infinity));
      cut.push(new Array(n + 1).fill(0));
    }
    best[0][0] = 0;
    for (let j = 1; j <= k; j++)
      for (let i = j; i <= n; i++)
        for (let p = j - 1; p < i; p++) {
          const v = Math.max(best[j - 1][p], colH(p, i));
          if (v < best[j][i] - 1e-9) {
            best[j][i] = v;
            cut[j][i] = p;
          }
        }
    const cols: number[][] = [];
    let i = n;
    for (let j = k; j >= 1; j--) {
      const p = cut[j][i];
      const col: number[] = [];
      for (let q = p; q < i; q++) col.push(q);
      cols.unshift(col);
      i = p;
    }
    return cols;
  }

  /**
   * Pack popups around the middle of `area`. Every possible column count is
   * tried; the arrangement that fits and whose outline is closest to the
   * screen's shape wins. If nothing fits, the windows shrink (not below
   * `mins`).
   */
  public static packPopups(
    sizes: ISize[],
    mins: ISize[],
    area: Rect,
    gap: number,
  ): Rect[] {
    const n = sizes.length;
    if (n === 0) return [];
    const heights = sizes.map((s) => s.height);
    const areaAspect = area.width / Math.max(1, area.height);
    let bestCols: number[][] = [[...Array(n).keys()]];
    let bestScore = Infinity;
    for (let k = 1; k <= n; k++) {
      const cols = LayerGeometry.partition(heights, k, gap);
      const { w, h } = LayerGeometry.outline(cols, sizes, gap);
      const overflow =
        Math.max(0, w - area.width) / area.width +
        Math.max(0, h - area.height) / area.height;
      const shape = Math.abs(Math.log(w / Math.max(1, h) / areaAspect));
      const score = overflow * 100 + shape;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        bestCols = cols;
      }
    }

    /* shrink to fit: widths all together, heights per column */
    const out = sizes.map((s) => ({ width: s.width, height: s.height }));
    const colW = (c: number[]) => Math.max(...c.map((i) => out[i].width));
    const totalW = () =>
      bestCols.reduce((s, c) => s + colW(c), 0) + gap * (bestCols.length - 1);
    if (totalW() > area.width) {
      const free = area.width - gap * (bestCols.length - 1);
      const f = free / Math.max(1, totalW() - gap * (bestCols.length - 1));
      out.forEach((s, i) => (s.width = Math.max(mins[i].width, Math.floor(s.width * f))));
    }
    bestCols.forEach((c) => {
      const h = c.reduce((s, i) => s + out[i].height, 0) + gap * (c.length - 1);
      if (h <= area.height) return;
      const f = (area.height - gap * (c.length - 1)) / Math.max(1, h - gap * (c.length - 1));
      c.forEach((i) => (out[i].height = Math.max(mins[i].height, Math.floor(out[i].height * f))));
    });

    const rects: Rect[] = new Array(n);
    const W = totalW();
    const cx = area.x + area.width / 2;
    let x = Math.max(area.x, area.x + (area.width - W) / 2);
    bestCols.forEach((c) => {
      const cw = colW(c);
      const ch = c.reduce((s, i) => s + out[i].height, 0) + gap * (c.length - 1);
      let y = Math.max(area.y, area.y + (area.height - ch) / 2);
      const colCenter = x + cw / 2;
      c.forEach((i) => {
        const s = out[i];
        let wx: number;
        if (bestCols.length === 1 || Math.abs(colCenter - cx) < 1) wx = x + (cw - s.width) / 2;
        else if (colCenter < cx) wx = x + cw - s.width; // left of the middle: lean right
        else wx = x; // right of the middle: lean left
        rects[i] = new Rect(Math.round(wx), Math.round(y), s.width, s.height);
        y += s.height + gap;
      });
      x += cw + gap;
    });
    return rects;
  }

  private static outline(cols: number[][], sizes: ISize[], gap: number): { w: number; h: number } {
    let w = 0;
    let h = 0;
    cols.forEach((c) => {
      w += Math.max(...c.map((i) => sizes[i].width));
      h = Math.max(h, c.reduce((s, i) => s + sizes[i].height, 0) + gap * (c.length - 1));
    });
    return { w: w + gap * (cols.length - 1), h };
  }

  /**
   * Quickview: square and centered (the size of a zoomed window, but 1:1),
   * or the size remembered for this app (share of the area).
   */
  public static quickviewRect(
    area: Rect,
    marginX: number,
    marginY: number,
    remembered: { w: number; h: number } | null,
    min: ISize,
    max: ISize,
  ): Rect {
    let width: number;
    let height: number;
    if (remembered !== null) {
      width = remembered.w * area.width;
      height = remembered.h * area.height;
    } else {
      const side = Math.min(area.width * (1 - 2 * marginX), area.height * (1 - 2 * marginY));
      width = height = side;
    }
    const clampTo = (v: number, lo: number, hi: number, total: number) => {
      if (hi > 0) v = Math.min(v, hi);
      if (lo > 0) v = Math.max(v, lo);
      return Math.round(Math.max(1, Math.min(v, total)));
    };
    width = clampTo(width, min.width, max.width, area.width);
    height = clampTo(height, min.height, max.height, area.height);
    return new Rect(
      Math.round(area.x + (area.width - width) / 2),
      Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    );
  }
}
