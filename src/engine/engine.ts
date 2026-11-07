/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

type ScreenData = {
  visibles: WindowClass[];
  tileables: WindowClass[];
  layout: ILayout;
  workingArea: Rect;
  srf: ISurface;
  capacity: number | null;
  overCapacity: WindowClass[];
  awaitToMove: WindowClass[];
};

/**
 * Maintains tiling context and performs various tiling actions.
 */
class TilingEngine {
  /** fraction of the screen a tile may be smaller than a window's min size */
  public static readonly UNFIT_TOLERANCE = 0.03;
  public layouts: LayoutStore;
  public windows: WindowStore;
  public docks: DockStore;
  private _defaultGaps: DefaultGapsCfg | null;
  private _gapsSurfacesCfg: gapsSurfaceCfg[];

  constructor() {
    this.layouts = new LayoutStore();
    this.windows = new WindowStore();
    this.docks = new DockStore();
    this._defaultGaps = null;
    this._gapsSurfacesCfg = [];
  }

  /**
   * Adjust layout based on the change in size of a tile.
   *
   * This operation is completely layout-dependent, and no general implementation is
   * provided.
   *
   * Used when tile is resized using mouse.
   */
  public adjustLayout(basis: WindowClass) {
    let delta = basis.geometryDelta;
    if (delta === null) return;
    const srf = basis.surface;
    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const gaps = this.getGaps(srf);
      const area = srf.workingArea.gap(
        gaps.left,
        gaps.right,
        gaps.top,
        gaps.bottom,
      );
      const tiles = this.windows.getVisibleTiles(srf);
      layout.adjust(area, tiles, basis, delta, gaps.between);
    }
  }

  public adjustDock(basis: WindowClass) {
    if (basis.actualGeometry === basis.geometry) return;
    let widthDiff = basis.actualGeometry.width - basis.geometry.width;
    let heightDiff = basis.actualGeometry.height - basis.geometry.height;
    let dockCfg = basis.dock!.cfg;
    const workingArea = basis.surface.workingArea;

    switch (basis.dock!.position) {
      case DockPosition.left:
      case DockPosition.right:
        dockCfg.vHeight =
          dockCfg.vHeight + (100 * heightDiff) / workingArea.height;
        dockCfg.vWide = dockCfg.vWide + (100 * widthDiff) / workingArea.width;
        break;
      case DockPosition.top:
      case DockPosition.bottom:
        dockCfg.hHeight =
          dockCfg.hHeight + (100 * heightDiff) / workingArea.height;
        dockCfg.hWide = dockCfg.hWide + (100 * widthDiff) / workingArea.width;
        break;
    }
  }

  /**
   * Resize the current floating window.
   *
   * @param window a floating window
   */
  public resizeFloat(
    window: WindowClass,
    dir: "east" | "west" | "south" | "north",
    step: -1 | 1,
  ) {
    const srf = window.surface;

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.05;
    const vStepSize = srf.workingArea.height * 0.05;

    let hStep, vStep;
    switch (dir) {
      case "east":
        ((hStep = step), (vStep = 0));
        break;
      case "west":
        ((hStep = -step), (vStep = 0));
        break;
      case "south":
        ((hStep = 0), (vStep = step));
        break;
      case "north":
        ((hStep = 0), (vStep = -step));
        break;
    }

    const geometry = window.actualGeometry;
    const width = geometry.width + hStepSize * hStep;
    const height = geometry.height + vStepSize * vStep;

    window.forceSetGeometry(new Rect(geometry.x, geometry.y, width, height));
  }

  /**
   * Resize the current tile by adjusting the layout.
   *
   * Used by grow/shrink shortcuts.
   */
  public resizeTile(
    basis: WindowClass,
    dir: "east" | "west" | "south" | "north",
    step: -1 | 1,
  ) {
    const srf = basis.surface;
    const gaps = this.getGaps(srf);

    if (dir === "east") {
      const maxX = basis.geometry.maxX;
      const easternNeighbor = this.windows
        .getVisibleTiles(srf)
        .filter((tile) => tile.geometry.x >= maxX);
      if (easternNeighbor.length === 0) {
        dir = "west";
        step *= -1;
      }
    } else if (dir === "south") {
      const maxY = basis.geometry.maxY;
      const southernNeighbor = this.windows
        .getVisibleTiles(srf)
        .filter((tile) => tile.geometry.y >= maxY);
      if (southernNeighbor.length === 0) {
        dir = "north";
        step *= -1;
      }
    }

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.03;
    const vStepSize = srf.workingArea.height * 0.03;
    let delta: RectDelta;
    switch (dir) {
      case "east":
        delta = new RectDelta(hStepSize * step, 0, 0, 0);
        break;
      case "west":
        delta = new RectDelta(0, hStepSize * step, 0, 0);
        break;
      case "south":
        delta = new RectDelta(0, 0, vStepSize * step, 0);
        break;
      case "north": /* passthru */
      default:
        delta = new RectDelta(0, 0, 0, vStepSize * step);
        break;
    }

    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const area = srf.workingArea.gap(
        gaps.left,
        gaps.right,
        gaps.top,
        gaps.bottom,
      );
      layout.adjust(
        area,
        this.windows.getVisibleTileables(srf),
        basis,
        delta,
        gaps.between,
      );
    }
  }

  /**
   * Resize the given window, by moving border inward or outward.
   *
   * The actual behavior depends on the state of the given window.
   *
   * @param dir which border
   * @param step which direction. 1 means outward, -1 means inward.
   */
  public resizeWindow(
    window: WindowClass,
    dir: "east" | "west" | "south" | "north",
    step: -1 | 1,
  ) {
    const state = window.state;
    if (WindowClass.isFloatingState(state)) this.resizeFloat(window, dir, step);
    else if (WindowClass.isTiledState(state))
      this.resizeTile(window, dir, step);
  }

  /**
   * Arrange tiles on all screens.
   */
  /** an arrange was skipped while paused (gaming mode) */
  public pendingArrange = false;

  public arrange(ctx: IDriverContext, reason: string) {
    LOG?.send(
      LogModules.arrangeScreen,
      "ArrangeScreens",
      `###################################################Reason: ${reason}####################################`,
    );
    if (ctx.isPaused) {
      this.pendingArrange = true;
      return;
    }
    if (this.dragWindow !== null) {
      // a drag preview is live; a stuck drag (no move events) must not block forever
      if (getTime() - this.dragLastUpdate < 5000 && reason !== "dragFinish") {
        this.pendingArrange = true;
        return;
      }
      this.dragCancel(ctx);
    }
    this.pendingArrange = false;
    this.arrangeAll(ctx, reason);
    ctx.stateMaybeChanged();
  }

  private arrangeAll(ctx: IDriverContext, reason: string) {
    const surfaces = ctx.currentSurfaces;
    let screensData: ScreenData[] = [];
    surfaces.forEach((srf) => {
      screensData.push(this.getTileables(srf));
    });
    if (CONFIG.surfacesIsMoveWindows && reason !== "moveWindowsToScreen") {
      let isMoving = false;
      screensData.forEach((screenData: ScreenData) => {
        if (screenData.overCapacity.length > 0) {
          for (let i = 0; i < screensData.length; i++) {
            let sd = screensData[i];
            if (sd.capacity === null) {
              sd.awaitToMove.push(
                ...screenData.overCapacity.splice(
                  0,
                  screenData.overCapacity.length,
                ),
              );
              isMoving = true;
            } else if (sd.capacity - sd.awaitToMove.length > 0) {
              const availableSlots = Math.min(
                sd.capacity - sd.awaitToMove.length,
                screenData.overCapacity.length,
              );
              sd.awaitToMove.push(
                ...screenData.overCapacity.splice(0, availableSlots),
              );
              isMoving = true;
            }
            if (screenData.overCapacity.length === 0) {
              break;
            }
          }
        }
      });
      if (isMoving) {
        let moveTiles: [Output, WindowClass[]][] = [];
        screensData.forEach((screenData: ScreenData) => {
          if (screenData.awaitToMove.length > 0)
            moveTiles.push([screenData.srf.output, screenData.awaitToMove]);
        });
        ctx.moveWindowsToScreen(moveTiles);
        return;
      }
    }

    screensData.forEach((screenData: ScreenData) => {
      this.arrangeScreen(ctx, screenData, reason);
    });
  }

  private getTileables(srf: ISurface): ScreenData {
    let visibles = this.windows.getVisibleWindows(srf);
    visibles.forEach((window) => {
      if (window.state === WindowState.Undecided) {
        window.state =
          window.shouldFloat || CONFIG.floatDefault
            ? WindowState.Floating
            : WindowState.Tiled;
        if (window.state === WindowState.Floating)
          notice(
            `Krohnkite Smart: new window ${window.windowClassName} floats: ${
              CONFIG.floatDefault ? "float by default" : window.window.floatReason || "?"
            }`,
          );
      }
    });
    if (LOG?.isModuleOn(LogModules.arrangeScreen)) {
      let mes = "";
      visibles.forEach((tile) => {
        mes += `${tile}\n`;
      });
      LOG.print(LogModules.arrangeScreen, "visibles", mes);
    }
    let tileables = this.windows.getVisibleTileables(srf);
    let layout = this.layouts.getCurrentLayout(srf);

    let capacity: number | null;
    let layoutCap = layout.capacity === undefined ? null : layout.capacity;
    if (layoutCap === null && srf.capacity === null) {
      capacity = null;
    } else if (layoutCap === null || srf.capacity === null) {
      capacity = layoutCap || srf.capacity;
    } else {
      capacity = Math.min(layoutCap, srf.capacity);
    }
    let overCapacity: WindowClass[];
    if (capacity !== null && tileables.length > capacity) {
      if (!CONFIG.surfacesIsMoveOldestWindows) {
        overCapacity = tileables.splice(capacity - tileables.length);
      } else {
        overCapacity = tileables.splice(0, tileables.length - capacity);
      }
      capacity = 0;
    } else {
      overCapacity = [];
      capacity = capacity === null ? null : capacity - tileables.length;
    }
    let screenData = {
      visibles: visibles,
      tileables: tileables,
      layout: layout,
      workingArea: this.docks.render(srf, visibles, srf.workingArea.clone()),
      srf: srf,
      overCapacity: overCapacity,
      capacity: capacity,
      awaitToMove: [],
    };

    LOG?.send(
      LogModules.arrangeScreen,
      "getTileablesReturn",
      `output: ${srf.output.name}\n visibles number: ${visibles.length
      }\n tileables.length: ${screenData.tileables.length}, workingArea: ${screenData.workingArea
      }, layout: ${screenData.layout
      },capacity: ${capacity}, overCapacity: ${screenData.overCapacity.map(
        (win) => win.window.windowClassName,
      )}`,
    );
    return screenData;
  }

  /**
   * Arrange tiles on a screen.
   */
  public arrangeScreen(
    ctx: IDriverContext,
    screenData: ScreenData,
    reason: string,
  ) {
    LOG?.send(
      LogModules.arrangeScreen,
      "arrangeScreen",
      `output: ${screenData.srf.output.name}`,
    );
    screenData.overCapacity.forEach((win) => {
      win.state = WindowState.Floating;
    });
    const gaps = this.getGaps(screenData.srf);

    let tilingArea: Rect;
    if (
      (CONFIG.monocleMaximize && screenData.layout instanceof MonocleLayout) ||
      (screenData.tileables.length === 1 && CONFIG.soleWindowNoGaps)
    )
      tilingArea = screenData.workingArea;
    else if (
      screenData.tileables.length === 1 &&
      ((CONFIG.soleWindowWidth < 100 && CONFIG.soleWindowWidth > 0) ||
        (CONFIG.soleWindowHeight < 100 && CONFIG.soleWindowHeight > 0))
    ) {
      const h_gap =
        (screenData.workingArea.height -
          screenData.workingArea.height * (CONFIG.soleWindowHeight / 100)) /
        2;
      const v_gap =
        (screenData.workingArea.width -
          screenData.workingArea.width * (CONFIG.soleWindowWidth / 100)) /
        2;
      tilingArea = screenData.workingArea.gap(v_gap, v_gap, h_gap, h_gap);
    } else
      tilingArea = screenData.workingArea.gap(
        gaps.left,
        gaps.right,
        gaps.top,
        gaps.bottom,
      );

    let tileablesLen = screenData.tileables.length;
    if (tileablesLen > 0) {
      let engineCtx = new EngineContext(ctx, this);
      function layoutApply() {
        screenData.layout.apply(
          engineCtx,
          screenData.tileables,
          tilingArea,
          gaps.between,
        );
        if (LOG?.isModuleOn(LogModules.arrangeScreen)) {
          let mes = "";
          screenData.tileables.forEach((tile) => {
            mes += `${tile.id}, state:${windowStateStr(
              tile.state,
            )}, commitGeometry:${tile.geometry}\n`;
          });
          LOG?.send(LogModules.arrangeScreen, "LayoutApply", mes);
        }
      }
      /*
       * A tile is "too small" only if it misses the window's minimal size by
       * more than a few percent of the screen: a few pixels of overlap are
       * much better than floating the window (e.g. Steam 1010px + System
       * Settings 930px on a 1920px screen).
       */
      const tolW = screenData.workingArea.width * TilingEngine.UNFIT_TOLERANCE;
      const tolH = screenData.workingArea.height * TilingEngine.UNFIT_TOLERANCE;
      const tooSmall = (tile: WindowClass) =>
        tile.minSize.height > tile.geometry.height + tolH ||
        tile.minSize.width > tile.geometry.width + tolW;
      function getNumberTileablesGreaterThenMin(
        tileables: WindowClass[],
      ): number {
        let numberOfTiles = 0;
        tileables.forEach((tile) => {
          if (tooSmall(tile)) {
            numberOfTiles++;
          }
        });
        return numberOfTiles;
      }
      layoutApply();
      if (
        (CONFIG.unfitGreater || CONFIG.unfitLess) &&
        ["onWindowResize", "onWindowResizeOver"].indexOf(reason) < 0
      ) {
        let unfitGreaterQuantity = 0;
        screenData.tileables = screenData.tileables.filter((tile) => {
          if (
            CONFIG.unfitLess &&
            (tile.maxSize.height < tile.geometry.height ||
              tile.maxSize.width < tile.geometry.width)
          ) {
            LOG?.send(
              LogModules.arrangeScreen,
              "unfitLess",
              `id: ${tile.id} commitGeometry:${tile.geometry}. minSize:${tile.minSize.width
              }:${tile.minSize.height} - heightUnfit:${tile.minSize.height > tile.geometry.height
              } widthUnfit: ${tile.minSize.width > tile.geometry.width
              }, tile.maxSize:${tile.maxSize.width}:${tile.maxSize.height
              } heightUnfit: ${tile.maxSize.height < tile.geometry.height
              }, widthUnfit: ${tile.maxSize.width < tile.geometry.width}`,
            );
            notice(
              `Krohnkite Smart: floating ${tile.windowClassName}, max ${tile.maxSize.width}x${tile.maxSize.height} smaller than tile ${tile.geometry.width}x${tile.geometry.height}`,
            );
            tile.state = WindowState.Floating;
            return false;
          } else if (CONFIG.unfitGreater && tooSmall(tile)) {
            unfitGreaterQuantity += 1;
            return true;
          } else {
            return true;
          }
        });
        if (screenData.tileables.length !== tileablesLen) {
          layoutApply();
        }
        if (unfitGreaterQuantity > 0) {
          LOG?.send(
            LogModules.arrangeScreen,
            "UnfitGreater",
            `unfitGreaterQuantity: ${unfitGreaterQuantity}`,
          );
          if (screenData.tileables.length !== tileablesLen) {
            unfitGreaterQuantity = getNumberTileablesGreaterThenMin(
              screenData.tileables,
            );
          }
          while (screenData.tileables.length > 0 && unfitGreaterQuantity > 0) {
            /* float the window that does not fit - not an innocent neighbour */
            const area = screenData.workingArea;
            const demand = (t: WindowClass) =>
              Math.max(t.minSize.width / area.width, t.minSize.height / area.height);
            let tile = screenData.tileables[0];
            screenData.tileables.forEach((t) => {
              if (tooSmall(t) && demand(t) >= demand(tile)) tile = t;
            });
            screenData.tileables.splice(screenData.tileables.indexOf(tile), 1);
            notice(
              `Krohnkite Smart: floating ${tile.windowClassName}, min ${tile.minSize.width}x${tile.minSize.height} does not fit tile ${tile.geometry.width}x${tile.geometry.height}`,
            );
            tile.state = WindowState.Floating;
            layoutApply();
            unfitGreaterQuantity = getNumberTileablesGreaterThenMin(
              screenData.tileables,
            );
          }
        }
      }
    }

    if (
      CONFIG.limitTileWidthRatio > 0 &&
      !(screenData.layout instanceof MonocleLayout)
    ) {
      const maxWidth = Math.floor(
        screenData.workingArea.height * CONFIG.limitTileWidthRatio,
      );
      screenData.tileables
        .filter((tile) => tile.isTiled && tile.geometry.width > maxWidth)
        .forEach((tile) => {
          const g = tile.geometry;
          tile.geometry = new Rect(
            g.x + Math.floor((g.width - maxWidth) / 2),
            g.y,
            maxWidth,
            g.height,
          );
        });
    }

    if (CONFIG.soleWindowNoBorders && screenData.tileables.length === 1) {
      screenData.visibles.forEach((window) => {
        if (window.state === WindowState.Tiled)
          window.commit(CONFIG.soleWindowNoBorders);
        else window.commit();
      });
    } else {
      screenData.visibles.forEach((window) => window.commit());
    }
    LOG?.send(
      LogModules.arrangeScreen,
      "#######################################################Finished",
      `${screenData.srf}`,
    );
  }

  /* ============================================================ live drag & drop */

  /** the tiled window being dragged (normal arranging pauses meanwhile) */
  public dragWindow: WindowClass | null = null;
  private dragOrigin: ISurface | null = null;
  /** layout slots of all tiles when the drag started: stable hit testing */
  private dragSlots: { [id: string]: Rect } = {};
  private dragKey = "";
  private dragTargetSurface: ISurface | null = null;
  private dragOver: WindowClass | null = null;
  private dragLastUpdate = 0;
  /** the tile orders the preview shows; applied exactly on drop */
  private dragFinal: { srf: ISurface; tiles: WindowClass[] }[] = [];

  private surfaceAt(ctx: IDriverContext, pos: [number, number]): ISurface | null {
    const [x, y] = pos;
    const found = ctx.currentSurfaces.find((s) => {
      const g = s.output.geometry;
      return x >= g.x && x < g.x + g.width && y >= g.y && y < g.y + g.height;
    });
    return found || null;
  }

  /** tileable windows of a surface without the dragged one, in list order */
  private tilesWithout(srf: ISurface, window: WindowClass): WindowClass[] {
    return this.windows.list.filter((w) => w !== window && w.isTileable && w.visible(srf));
  }

  /** slot of a window at drag start (falls back to its current slot) */
  private slotOf(w: WindowClass): Rect {
    return this.dragSlots[w.id] || w.geometry;
  }

  /**
   * Where would the window go if dropped now? Target monitor = monitor under
   * the cursor, target tile = tile under the cursor there (by its slot at
   * drag start); null tile = back home (same monitor) / append (other monitor).
   */
  private dropAim(
    ctx: IDriverContext,
    window: WindowClass,
  ): { srf: ISurface; over: WindowClass | null } | null {
    const pos = ctx.cursorPosition || window.actualGeometry.center;
    const srf = this.surfaceAt(ctx, pos) || this.dragOrigin;
    if (srf === null || srf.ignore) return null;
    const home = this.dragOrigin !== null && srf.id === this.dragOrigin.id;
    if (home && this.slotOf(window).includesPoint(pos)) return { srf, over: null };
    let over: WindowClass | null = null;
    this.tilesWithout(srf, window).forEach((t) => {
      if (!t.isTiled) return;
      const slot = this.slotOf(t);
      if (!slot.includesPoint(pos)) return;
      if (over === null || slot.width * slot.height < this.slotOf(over).width * this.slotOf(over).height)
        over = t;
    });
    return { srf, over };
  }

  /** the final tile order of every affected monitor for a drop on `aim` */
  private dropLists(
    window: WindowClass,
    aim: { srf: ISurface; over: WindowClass | null },
  ): { srf: ISurface; tiles: WindowClass[] }[] {
    const origin = this.dragOrigin || aim.srf;
    if (aim.srf.id === origin.id) {
      const tiles = this.windows.list.filter(
        (w) => w === window || (w.isTileable && w.visible(origin)),
      );
      if (aim.over !== null) {
        const i = tiles.indexOf(window);
        const j = tiles.indexOf(aim.over);
        if (i >= 0 && j >= 0) {
          tiles[i] = aim.over;
          tiles[j] = window;
        }
      }
      return [{ srf: origin, tiles }];
    }
    const target = this.tilesWithout(aim.srf, window);
    const at = aim.over !== null ? target.indexOf(aim.over) : -1;
    if (at >= 0) target.splice(at, 0, window);
    else target.push(window);
    return [
      { srf: aim.srf, tiles: target },
      { srf: origin, tiles: this.tilesWithout(origin, window) },
    ];
  }

  /**
   * Called on every move step of a dragged tiled window: lay out the
   * affected monitors as they will be after the drop (the other windows
   * move out of the way) and show the silhouette where the window lands.
   */
  public dragUpdate(ctx: IDriverContext, window: WindowClass) {
    if (this.dragWindow !== window) {
      this.dragWindow = window;
      this.dragOrigin = window.surface;
      this.dragSlots = {};
      this.dragKey = "";
      ctx.currentSurfaces.forEach((s) =>
        this.windows.getVisibleTileables(s).forEach((w) => (this.dragSlots[w.id] = w.geometry)),
      );
      this.dragSlots[window.id] = window.geometry;
    }
    this.dragLastUpdate = getTime();
    const aim = this.dropAim(ctx, window);
    if (aim === null) {
      this.dragKey = "";
      this.dragTargetSurface = null;
      ctx.showDropPreview(null, false);
      return;
    }
    const key = `${aim.srf.id}|${aim.over !== null ? aim.over.id : "-"}`;
    if (key === this.dragKey) return; // nothing changed, keep everything as is
    this.dragKey = key;
    this.dragTargetSurface = aim.srf;
    this.dragOver = aim.over;

    const engineCtx = new EngineContext(ctx, this);
    const pos = ctx.cursorPosition || window.actualGeometry.center;
    const homeDrop = aim.over === null && this.dragOrigin !== null && aim.srf.id === this.dragOrigin.id;
    let silhouette: Rect | null = null;
    this.dragFinal = [];
    this.dropLists(window, aim).forEach(({ srf, tiles: base }) => {
      if (base.length === 0) return;
      const data = this.getTileables(srf);
      const gaps = this.getGaps(srf);
      const area = data.workingArea.gap(gaps.left, gaps.right, gaps.top, gaps.bottom);
      const layout = this.layouts.getCurrentLayout(srf);
      const tiles =
        !homeDrop && base.indexOf(window) >= 0 && layout instanceof SmartLayout
          ? this.orderLandingAt(layout, base, window, pos, area, gaps.between)
          : base;
      this.dragFinal.push({ srf, tiles });
      tiles.forEach((t) => (t.state = WindowState.Tiled));
      layout.apply(engineCtx, tiles, area, gaps.between);
      tiles.forEach((t) => {
        if (t === window) silhouette = t.geometry;
        else if (t.isTiled) t.commit();
      });
    });
    const moved = aim.over !== null || aim.srf.id !== (this.dragOrigin as ISurface).id;
    ctx.showDropPreview(silhouette, moved);
  }

  /**
   * The Smart layout may move windows with a big minimal size to other slots,
   * so a plain swap does not always put the window where it was dropped.
   * Find the tile order closest to `base` in which `window` lands under the
   * cursor (fewest other windows moved). Falls back to `base`.
   */
  private orderLandingAt(
    layout: SmartLayout,
    base: WindowClass[],
    window: WindowClass,
    pos: [number, number],
    area: Rect,
    gap: number,
  ): WindowClass[] {
    const lands = (tiles: WindowClass[]) => {
      const i = tiles.indexOf(window);
      const r = layout.compute(tiles, area, gap, i)[i];
      return r !== undefined && r.includesPoint(pos);
    };
    if (lands(base)) return base;
    const others = base.filter((w) => w !== window);
    const n = base.length;
    const candidates: WindowClass[][] = [];
    const withWindowAt = (order: WindowClass[], k: number) => {
      const c = order.slice();
      c.splice(k, 0, window);
      return c;
    };
    if (n <= 5) {
      // every order: small enough to try them all
      const permute = (rest: WindowClass[], acc: WindowClass[]) => {
        if (rest.length === 0) {
          for (let k = 0; k < n; k++) candidates.push(withWindowAt(acc, k));
          return;
        }
        rest.forEach((w, i) => permute(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat([w])));
      };
      permute(others, []);
    } else {
      // many windows: keep the others in order, try every position
      for (let k = 0; k < n; k++) candidates.push(withWindowAt(others, k));
    }
    const moved = (c: WindowClass[]) => c.filter((w, i) => w !== window && base[i] !== w).length;
    candidates.sort((a, b) => moved(a) - moved(b));
    for (const c of candidates) if (lands(c)) return c;
    return base;
  }

  /** put the given windows into exactly this relative order in the list */
  private applyOrder(order: WindowClass[]) {
    const list = this.windows.list;
    const at = order.map((w) => list.indexOf(w));
    if (at.some((i) => i < 0)) return;
    at.sort((a, b) => a - b).forEach((p, k) => (list[p] = order[k]));
  }

  /** the window was dropped: apply exactly what the preview showed */
  public dragFinish(ctx: IDriverContext, window: WindowClass): boolean {
    if (this.dragWindow !== window) return false;
    const srf = this.dragTargetSurface;
    const over = this.dragOver;
    const origin = this.dragOrigin;
    const final = this.dragFinal;
    this.dragCancel(ctx);
    if (srf === null || origin === null) return false;

    if (srf.id === origin.id) {
      if (over === null) {
        // back home, or float it when "keep tiling on drag" is off
        if (!CONFIG.keepTilingOnDrag) {
          const diff = window.actualGeometry.subtract(window.geometry);
          if (Math.sqrt(diff.x ** 2 + diff.y ** 2) > 30) {
            window.floatGeometry = window.actualGeometry;
            window.state = WindowState.Floating;
          }
        }
        this.arrange(ctx, "dragFinish");
        return true;
      }
      const plan = final.find((f) => f.srf.id === srf.id);
      if (plan) this.applyOrder(plan.tiles);
      else this.windows.swap(window, over);
      this.arrange(ctx, "dragFinish");
      return true;
    }
    // other monitor: exactly the previewed order there
    const plan = final.find((f) => f.srf.id === srf.id);
    if (plan) this.applyOrder(plan.tiles);
    else {
      const list = this.windows.list;
      list.splice(list.indexOf(window), 1);
      if (over !== null && list.indexOf(over) >= 0) list.splice(list.indexOf(over), 0, window);
      else list.push(window);
    }
    ctx.moveWindowsToScreen([[srf.output, [window]]]); // arranges afterwards
    return true;
  }

  /** drop target without a live preview (preview disabled) */
  public dropTarget(ctx: IDriverContext, window: WindowClass): WindowClass | null {
    const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
    const cursorPos = ctx.cursorPosition || window.actualGeometry.center;
    const targets = tiles.filter(
      (tile) => tile !== window && tile.actualGeometry.includesPoint(cursorPos),
    );
    return targets.length === 1 ? targets[0] : null;
  }

  public dragCancel(ctx: IDriverContext | null) {
    this.dragWindow = null;
    this.dragOrigin = null;
    this.dragSlots = {};
    this.dragKey = "";
    this.dragTargetSurface = null;
    this.dragOver = null;
    this.dragFinal = [];
    if (ctx !== null) ctx.showDropPreview(null, false);
  }

  /**
   * Re-apply window geometry, computed by layout algorithm.
   *
   * Sometimes applications move or resize windows without user intervention,
   * which is straigh against the purpose of tiling WM. This operation
   * move/resize such windows back to where/how they should be.
   */
  public enforceSize(ctx: IDriverContext, window: WindowClass) {
    if (ctx.isPaused) return;
    if (window.isTiled && !window.actualGeometry.equals(window.geometry)) {
      ctx.setTimeout(() => {
        if (window.isTiled) window.commit();
      }, 10);
      /*
       * Some apps (Steam, Electron, many XWayland clients) do not announce a
       * minimal size but refuse to become smaller than the tile. They then
       * protrude into their neighbours. If the window is still too big after
       * it had time to settle, remember that size as its real minimal size
       * and arrange again so the layout makes room for it.
       */
      const target = window.geometry;
      if (window.isTooBigFor(target) && !window.learnCheckPending) {
        window.learnCheckPending = true;
        const stillTooBig = () =>
          window.isTiled &&
          window.geometry.equals(target) &&
          window.isTooBigFor(target);
        // two checks: slow apps (Steam/CEF) can take a moment to shrink
        ctx.setTimeout(() => {
          if (!stillTooBig()) {
            window.learnCheckPending = false;
            return;
          }
          ctx.setTimeout(() => {
            window.learnCheckPending = false;
            if (stillTooBig() && window.learnMinSize())
              this.arrange(ctx, "learnedMinSize");
          }, 1200);
        }, 600);
      }
    }
  }

  /**
   * Register the given window to WM.
   */
  public manage(window: WindowClass) {
    if (!window.shouldIgnore) {
      if (this.docks.isNewWindowHaveDocked(window)) {
        window.state = WindowState.Docked;
      } else window.state = WindowState.Undecided;
      /* engine#arrange will update the state when required. */
      const placement = window.window.placement;
      if (placement === "master") this.windows.unshift(window);
      else if (placement === "last") this.windows.push(window);
      else if (CONFIG.newWindowPosition === 1) this.windows.unshift(window);
      else if (CONFIG.newWindowPosition === 2) {
        this.windows.beside_first(window);
      } else this.windows.push(window);
    }
  }

  /**
   * Unregister the given window from WM.
   */
  public unmanage(window: WindowClass) {
    if (this.dragWindow === window) this.dragCancel(null);
    try {
      if (window.state === WindowState.Floating)
        window.window.rememberFloatGeometry(window.actualGeometry);
    } catch (e) {
      /* window may already be gone */
    }
    if (window.state === WindowState.Docked) {
      this.docks.remove(window);
    }
    this.windows.remove(window);
  }

  /**
   * Focus the next or previous window.
   */
  public focusOrder(ctx: IDriverContext, step: -1 | 1) {
    const window = ctx.currentWindow;

    /* if no current window, select the first tile. */
    if (window === null) {
      const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
      if (tiles.length > 1) ctx.currentWindow = tiles[0];
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return;
    }

    const visibles = this.windows.getVisibleWindows(ctx.currentSurface);
    if (visibles.length === 0) /* nothing to focus */ return;

    const idx = visibles.indexOf(window);
    if (!window || idx < 0) {
      /* unmanaged window -> focus master */
      ctx.currentWindow = visibles[0];
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return;
    }

    const num = visibles.length;
    const newIndex = (idx + (step % num) + num) % num;

    ctx.currentWindow = visibles[newIndex];
    if (CONFIG.movePointerOnFocus) {
      DBUS.moveMouseToFocus();
    }
  }

  /**
   * Focus a neighbor at the given direction.
   */
  public focusDir(ctx: IDriverContext, dir: Direction): boolean {
    let winTypes = ctx.isMetaMode ? CONFIG.focusMetaCfg : CONFIG.focusNormalCfg;
    if (winTypes === WinTypes.special) {
      return ctx.focusSpecial(dir);
    }
    let surfaceWin = ctx.focusNeighborWindow(dir, winTypes);
    if (surfaceWin === true) {
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return false;
    }
    if (surfaceWin === false) surfaceWin = null;
    if (
      (!ctx.isMetaMode && !CONFIG.focusNormalDisableScreens) ||
      (ctx.isMetaMode && !CONFIG.focusMetaDisableScreens)
    ) {
      const result = ctx.focusOutput(surfaceWin, dir, winTypes);
      if (result) {
        if (CONFIG.movePointerOnFocus) {
          DBUS.moveMouseToCenter();
        }
        return false;
      }
    }

    if (
      (!ctx.isMetaMode && !CONFIG.focusNormalDisableVDesktops) ||
      (ctx.isMetaMode && !CONFIG.focusMetaDisableVDesktops)
    ) {
      return ctx.focusVDesktop(surfaceWin, dir, winTypes);
    }
    return false;
  }

  /**
   * Swap the position of the current window with the next or previous window.
   */
  public swapOrder(window: WindowClass, step: -1 | 1) {
    const srf = window.surface;
    const visibles = this.windows.getVisibleWindows(srf);
    if (visibles.length < 2) return;

    const vsrc = visibles.indexOf(window);
    const vdst = wrapIndex(vsrc + step, visibles.length);
    const dstWin = visibles[vdst];

    this.windows.move(window, dstWin);
  }

  /**
   * Swap the position of the current window with a neighbor at the given direction.
   */
  public swapDirection(
    ctx: IDriverContext,
    direction: Direction,
    window: WindowClass,
  ): boolean {
    const neighbor = this.getNeighborByDirection(ctx, window, direction);
    if (neighbor) {
      this.windows.swap(window, neighbor);
      return true;
    }
    if (ctx.moveToScreen(window, direction)) {
      return false; // the screens already arranged
    }
    return ctx.moveToVDesktop(window, direction);
  }

  /**
   * Move the given window towards the given direction by one step.
   * @param window a floating window
   * @param dir which direction
   */
  public moveFloat(window: WindowClass, dir: Direction) {
    const srf = window.surface;

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.05;
    const vStepSize = srf.workingArea.height * 0.05;

    let hStep, vStep;
    switch (dir) {
      case "up":
        ((hStep = 0), (vStep = -1));
        break;
      case "down":
        ((hStep = 0), (vStep = 1));
        break;
      case "left":
        ((hStep = -1), (vStep = 0));
        break;
      case "right":
        ((hStep = 1), (vStep = 0));
        break;
    }

    const geometry = window.actualGeometry;
    const x = geometry.x + hStepSize * hStep;
    const y = geometry.y + vStepSize * vStep;

    if (CONFIG.movePointerOnFocus) {
      window.moveMouseToFocus();
    }
    window.forceSetGeometry(new Rect(x, y, geometry.width, geometry.height));
  }

  public swapDirOrMoveFloat(ctx: IDriverContext, dir: Direction): boolean {
    const window = ctx.currentWindow;
    if (window === null) {
      /* if no current window, select the first tile. */
      const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
      if (tiles.length > 0) ctx.currentWindow = tiles[0];
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return false;
    }

    const state = window.state;
    if (WindowClass.isFloatingState(state)) {
      this.moveFloat(window, dir);
      return false;
    } else if (WindowClass.isTiledState(state)) {
      return this.swapDirection(ctx, dir, window);
    }
    return true;
  }

  public toggleDock(window: WindowClass) {
    window.state =
      window.state !== WindowState.Docked
        ? WindowState.Docked
        : WindowState.Tiled;
  }

  public raiseSurfaceCapacity(ctx: IDriverContext): number | null {
    const currentSurface = ctx.currentSurface;
    if (currentSurface.capacity !== null) {
      currentSurface.capacity =
        currentSurface.capacity < 98 ? currentSurface.capacity + 1 : null;
    } else {
      let tileables = this.windows.getVisibleTileables(currentSurface);
      currentSurface.capacity =
        tileables.length < 98 ? tileables.length + 1 : null;
    }
    return currentSurface.capacity;
  }
  public lowerSurfaceCapacity(ctx: IDriverContext): number | null {
    const currentSurface = ctx.currentSurface;
    if (currentSurface.capacity !== null) {
      currentSurface.capacity =
        currentSurface.capacity > 0 ? currentSurface.capacity - 1 : 0;
    } else {
      let tileables = this.windows.getVisibleTileables(currentSurface);
      currentSurface.capacity = tileables.length > 0 ? tileables.length - 1 : 0;
    }
    return currentSurface.capacity;
  }
  public ResetSurfaceCapacity(ctx: IDriverContext): number | null {
    return (ctx.currentSurface.capacity = null);
  }

  /**
   * Toggle float mode of window.
   */
  public toggleFloat(window: WindowClass) {
    window.state = !window.isTileable
      ? WindowState.Tiled
      : WindowState.Floating;
  }

  /**
   * Toggle float on all windows on the given surface.
   *
   * The behaviours of this operation depends on the number of floating
   * windows: windows will be tiled if more than half are floating, and will
   * be floated otherwise.
   */
  public floatAll(ctx: IDriverContext, srf: ISurface) {
    const windows = this.windows.getVisibleWindows(srf);
    const numFloats = windows.reduce<number>((count, window) => {
      return window.state === WindowState.Floating ? count + 1 : count;
    }, 0);

    if (numFloats === 0) {
      windows.forEach((window) => {
        window.state = WindowState.Floating;
      });
      ctx.showNotification("Float All");
    } else {
      windows.forEach((window) => {
        window.state = WindowState.Tiled;
      });
      ctx.showNotification("Tile All");
    }
  }

  /**
   * Set the current window as the "master".
   *
   * The "master" window is simply the first window in the window list.
   * Some layouts depend on this assumption, and will make such windows more
   * visible than others.
   */
  public setMaster(window: WindowClass) {
    this.windows.setMaster(window);
  }

  /**
   * Change the layout of the current surface to the next.
   */
  public cycleLayout(ctx: IDriverContext, step: 1 | -1) {
    const layout = this.layouts.cycleLayout(ctx.currentSurface, step);
    if (layout) ctx.showNotification(layout.description);
  }

  /**
   * Set the layout of the current surface to the specified layout.
   */
  public setLayout(ctx: IDriverContext, layoutClassID: string) {
    const layout = this.layouts.setLayout(ctx.currentSurface, layoutClassID);
    if (layout) ctx.showNotification(layout.description);
  }

  /**
   * Let the current layout override shortcut.
   *
   * @returns True if the layout overrides the shortcut. False, otherwise.
   */
  public handleLayoutShortcut(
    ctx: IDriverContext,
    input: Shortcut,
    data?: any,
  ): boolean {
    const layout = this.layouts.getCurrentLayout(ctx.currentSurface);
    if (layout.handleShortcut)
      return layout.handleShortcut(new EngineContext(ctx, this), input, data);
    return false;
  }
  /**
   * Let the docked window override shortcut.
   *
   * @returns True if the layout overrides the shortcut. False, otherwise.
   */
  public handleDockShortcut(
    ctx: IDriverContext,
    window: WindowClass,
    input: Shortcut,
  ): boolean {
    return this.docks.handleShortcut(ctx, window, input);
  }

  private getNeighborByDirection(
    ctx: IDriverContext,
    basis: WindowClass,
    dir: Direction,
  ): WindowClass | null {
    let vertical: boolean;
    let sign: -1 | 1;
    switch (dir) {
      case "up":
        vertical = true;
        sign = -1;
        break;
      case "down":
        vertical = true;
        sign = 1;
        break;
      case "left":
        vertical = false;
        sign = -1;
        break;
      case "right":
        vertical = false;
        sign = 1;
        break;
      default:
        return null;
    }
    let windows = this.windows.getVisibleTileables(ctx.currentSurface);

    const candidates = windows
      .filter(
        vertical
          ? (tile) => tile.geometry.y * sign > basis.geometry.y * sign
          : (tile) => tile.geometry.x * sign > basis.geometry.x * sign,
      )
      .filter(
        vertical
          ? (tile) =>
            overlap(
              basis.geometry.x,
              basis.geometry.maxX,
              tile.geometry.x,
              tile.geometry.maxX,
            )
          : (tile) =>
            overlap(
              basis.geometry.y,
              basis.geometry.maxY,
              tile.geometry.y,
              tile.geometry.maxY,
            ),
      );
    if (candidates.length === 0) return null;

    const min =
      sign *
      candidates.reduce(
        vertical
          ? (prevMin, tile): number => Math.min(tile.geometry.y * sign, prevMin)
          : (prevMin, tile): number =>
            Math.min(tile.geometry.x * sign, prevMin),
        Infinity,
      );

    const closest = candidates.filter(
      vertical
        ? (tile) => tile.geometry.y === min
        : (tile) => tile.geometry.x === min,
    );

    return closest.sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  private getGaps(srf: ISurface): IGaps {
    if (this._defaultGaps === null) {
      this._defaultGaps = DefaultGapsCfg.instance;
      this._gapsSurfacesCfg = gapsSurfaceCfg.parseGapsUserSurfacesCfg();
    }
    const surfaceCfg = this._gapsSurfacesCfg.find((surfaceCfg) =>
      surfaceCfg.isFit(srf),
    );
    if (surfaceCfg === undefined) return this._defaultGaps;
    return surfaceCfg.cfg;
  }
}
