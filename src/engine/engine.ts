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
interface IRelocationWindows {
  readonly totalNumWinsPrepareToOutput: number;
  readonly totalNumWinsPrepareToVDesktop: number;
  isSending: boolean;
  startTime: number;
  toOutputs: WrapperMap<Output, WindowClass[]>;
  toVDesktops: WrapperMap<VirtualDesktop, WindowClass[]>;
  activeWindow: WindowClass | null;
  direction: Direction | null;

  clear(): void;
}
class RelocationWindows implements IRelocationWindows {
  public get totalNumWinsPrepareToOutput() {
    let total = 0;
    for (const windows of this.toOutputs) {
      total += windows.length;
    }
    return total;
  }
  public get totalNumWinsPrepareToVDesktop() {
    let total = 0;
    for (const windows of this.toVDesktops) {
      total += windows.length;
    }
    return total;
  }
  public get getWinsSendingToOutput() {
    let total = 0;
    for (const [output, windows] of this.toOutputs.entries()) {
      for (const w of windows) {
        if (output.name === w.surface.output.name && w.isSendingToOutput)
          total++;
      }
    }
    return total;
  }
  public get isExistSendingWindowsToOutput(): boolean {
    for (const [output, windows] of this.toOutputs.entries()) {
      for (const w of windows) {
        if (output.name !== w.surface.output.name && w.isSendingToOutput)
          return true;
      }
    }
    return false;
  }
  public get isExistTransferWindowsToVDesktop(): boolean {
    for (const windows of this.toVDesktops) {
      for (const w of windows) {
        if (w instanceof WindowClass) return true;
      }
    }
    return false;
  }
  public isSending: boolean;
  public startTime: number;
  public toOutputs: WrapperMap<Output, WindowClass[]>;
  public toVDesktops: WrapperMap<VirtualDesktop, WindowClass[]>;
  public activeWindow: WindowClass | null;
  public direction: Direction | null;

  constructor() {
    this.isSending = false;
    this.startTime = 0;
    this.toOutputs = new WrapperMap(
      (client: Output) => client.name,
      (_: Output) => new Array(),
    );
    this.toVDesktops = new WrapperMap(
      (client: VirtualDesktop) => client.id,
      (_: VirtualDesktop) => new Array(),
    );

    this.activeWindow = null;
    this.direction = null;
  }
  public clear() {
    for (const windows of this.toOutputs) {
      windows.forEach((w) => {
        w.isSendingToOutput = false;
        w.relocationTargetOutput = null;
      });
    }
    this.isSending = false;
    this.startTime = 0;
    this.toOutputs.clear();
    this.toVDesktops.clear();
    this.activeWindow = null;
    this.direction = null;
  }
}
/**
 * Maintains tiling context and performs various tiling actions.
 */
class TilingEngine {
  // max time for waiting KWin to move relocated windows to outputs calling KWin func sendClientToScreen() and to Virtual Desktops
  static SENDING_WINDOWS_MAX_WAIT_TIME = 100;
  // upper bound for coalesced arrange passes to stop a genuine layout loop
  static MAX_ARRANGE_PASSES = 10;
  /** fraction of the screen a tile may be smaller than a window's min size */
  public static readonly UNFIT_TOLERANCE = 0.03;

  public layouts: LayoutStore;
  public windows: WindowStore;
  public docks: DockStore;
  public relocationWindows: RelocationWindows;
  public makeWinActive: WindowClass | null;
  public arrangeProcessId: number | null;
  /* Windows hidden by the overcapacity logic, in minimization order. The
   * array is used as a LIFO stack when space becomes available. */
  private _overCapacityMinimized: WindowClass[];
  private _defaultGaps: DefaultGapsCfg | null;
  private _gapsSurfacesCfg: SurfaceCfg<IGaps>[];
  private _arranging: boolean;
  private _arrangePending: boolean;
  private _pendingExtraSurfaces: Map<string, ISurface>;
  private _batchDepth: number;

  constructor() {
    this.layouts = new LayoutStore();
    this.windows = new WindowStore();
    this.docks = new DockStore();
    this.relocationWindows = new RelocationWindows();
    this.arrangeProcessId = null;
    this.makeWinActive = null;
    this._overCapacityMinimized = [];
    this._defaultGaps = null;
    this._gapsSurfacesCfg = [];
    this._arranging = false;
    this._arrangePending = false;
    this._pendingExtraSurfaces = new Map();
    this._batchDepth = 0;
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
    WindowClass.invalidateSizes();
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
    const widthDiff = basis.actualGeometry.width - basis.geometry.width;
    const heightDiff = basis.actualGeometry.height - basis.geometry.height;
    this.docks.adjust(basis, widthDiff, heightDiff);
  }

  /**
   * Resize the current floating window.
   *
   * @param window a floating window
   */
  public resizeFloat(
    ctx: IDriverContext,
    window: WindowClass,
    dir: "east" | "west" | "south" | "north",
    step: -1 | 1,
  ) {
    const srf = window.surface;

    const hStepSize =
      (srf.workingArea.width * window.window.floatConfig.stepWidth) / 100;
    const vStepSize =
      (srf.workingArea.height * window.window.floatConfig.stepHeight) / 100;

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

    window.forceSetGeometry(
      ctx,
      new Rect(geometry.x, geometry.y, width, height),
    );
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
   * Defer arrange requests until endArrangeBatch().
   *
   * Used for multi-step actions (e.g. moving a window to another virtual
   * desktop) where the intermediate state is not worth laying out and only
   * the final state matters. Requests made by the events fired inside the
   * batch are coalesced, and any extra surfaces are kept for the final pass.
   * Batches can be nested; the outermost endArrangeBatch() flushes.
   */
  public beginArrangeBatch(): void {
    this._batchDepth++;
  }

  public endArrangeBatch(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    message?: string,
    extraSurfaces?: ISurface[],
  ): void {
    if (this._batchDepth === 0) return;
    this._batchDepth--;
    this._addPendingExtraSurfaces(extraSurfaces);
    if (this._batchDepth > 0) return;
    this.arrange(ctx, reason, message);
  }

  /**
   * Arrange tiles on all screens.
   *
   * Arranging is not re-entrant: KWin emits signals synchronously while
   * windows are committed, and some of those handlers request another
   * arrange. Running one inside another would interleave layout passes and
   * commit stale geometries over the inner pass, so nested requests are
   * coalesced into another pass of the current arrange instead.
   */
  /** an arrange was skipped while paused (gaming mode) or during a live drag */
  public pendingArrange = false;

  public arrange(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    message?: string,
    extraSurfaces?: ISurface[],
  ) {
    WindowClass.invalidateSizes();
    this._addPendingExtraSurfaces(extraSurfaces);
    if (this._arranging || this._batchDepth > 0) {
      this._arrangePending = true;
      return;
    }
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

    this._arranging = true;
    ctx.onLayoutStart();
    try {
      let passes = 0;
      do {
        this._arrangePending = false;
        const extras = [...this._pendingExtraSurfaces.values()];
        this._pendingExtraSurfaces.clear();
        this._arrangeOnce(ctx, reason, message, extras);
      } while (
        this._arrangePending &&
        ++passes < TilingEngine.MAX_ARRANGE_PASSES
      );
      if (this._arrangePending) {
        warning(
          `${getMethodName()}: arrange did not settle after ${TilingEngine.MAX_ARRANGE_PASSES} passes.`,
        );
      }
    } finally {
      this._arranging = false;
      this._arrangePending = false;
      this._pendingExtraSurfaces.clear();
      /* Runs even when a pass throws, so a half-applied layout cannot leave a
       * pointer-move request behind for the next arrange. */
      ctx.onLayoutSettled();
    }
    this.undoObserve(reason);
    ctx.stateMaybeChanged();
  }

  private _addPendingExtraSurfaces(extraSurfaces?: ISurface[]) {
    if (extraSurfaces === undefined) return;
    for (const srf of extraSurfaces) this._pendingExtraSurfaces.set(srf.id, srf);
  }

  private _arrangeOnce(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    message: string | undefined,
    extraSurfaces: ISurface[],
  ) {
    this.arrangeProcessId = getRandomInt(1000000);
    if (LOG?.isModuleOn(LogModules.arrangeScreen)) {
      LOG.send(
        LogModules.arrangeScreen,
        "ArrangeScreens",
        `#######Reason: ${reason}:${message} arrangeProcessID:${this.arrangeProcessId}########`,
      );
    }
    const z = this.zoomWindow;
    if (
      z !== null &&
      (z.state !== WindowState.Tiled || this.windows.indexOf(z) < 0)
    )
      this.unzoom();
    const surfaces = ctx.currentSurfaces;
    /* A surface may have gained free slots since the last pass (a window was
     * closed or moved away, capacity was raised, or the layout changed).
     * Restore hidden windows before rebuilding the screen data so they take
     * part in the layout of this pass. */
    surfaces.forEach((srf) => this._restoreOverCapacityMinimized(srf));
    /* Surfaces vacated by a window that moved to another desktop as part of
     * a desktop switch (e.g. KWin's "Window One Desktop to the ..."). By the
     * time the event reaches us, the source desktop is no longer current, so
     * it is not part of ctx.currentSurfaces and the windows left behind keep
     * the old layout. Arrange the vacated surfaces explicitly and first: a
     * window on all desktops is visible on both surfaces and must finish with
     * the layout of the surface that is actually current now. */
    const extraScreensData: ScreenData[] = [];
    const knownSrfIds = new Set(surfaces.map((srf) => srf.id));
    for (const srf of extraSurfaces) {
      if (knownSrfIds.has(srf.id)) continue;
      knownSrfIds.add(srf.id);
      extraScreensData.push(this.getTileables(srf));
    }
    extraScreensData.forEach((screenData: ScreenData) => {
      this.arrangeScreen(ctx, screenData, reason, this.arrangeProcessId!);
    });
    let screensData: ScreenData[] = [];
    surfaces.forEach((srf) => {
      screensData.push(this.getTileables(srf));
    });
    if (
      this._isCheckCapacity(reason) &&
      (CONFIG.srfExceededToScreen || CONFIG.srfExceededToVDesktop)
    ) {
      if (this.relocationWindows.isSending) {
        const time = getTime();
        if (
          time - this.relocationWindows.startTime <
          TilingEngine.SENDING_WINDOWS_MAX_WAIT_TIME
        ) {
          warning(
            `Method: ${getMethodName()}.Attempt to Check OverCapacityWindows during sending Process.`,
          );
          return;
        }
        warning(
          `Method: ${getMethodName()}. OverCapacityWindows sending process is: enabled but SENDING_WINDOWS_MAX_WAIT_TIME is up.`,
        );
      }
      this.relocationWindows.clear();
      screensData.forEach((screenData: ScreenData) => {
        if (screenData.overCapacity.length > 0) {
          CONFIG.srfExceededToScreen &&
            this._prepareWindowsMoveToOutput(ctx, screenData);
          CONFIG.srfExceededToVDesktop &&
            this._prepareOverCapacityWindowsTranferToVDesktop(ctx, screenData);
        }
      });
      if (
        !this.relocationWindows.isSending &&
        (this.relocationWindows.totalNumWinsPrepareToOutput > 0 ||
          this.relocationWindows.totalNumWinsPrepareToVDesktop > 0)
      ) {
        this.relocationWindows.activeWindow = ctx.currentWindow;
        ctx.relocateWindows();
        this.arrangeProcessId = null;
        return;
      }
    }

    screensData.forEach((screenData: ScreenData) => {
      this.arrangeScreen(ctx, screenData, reason, this.arrangeProcessId!);
    });
    this.arrangeProcessId = null;
  }

  private _isCheckCapacity(reason: keyof typeof ArrangeReason) {
    /* These reasons are part of the relocation process itself; checking
     * capacity again while they run would re-enter the relocation logic. */
    const reasons: string[] = [
      "forcedArrangeScreen",
      "moveWindowToOutput",
      "transferWindowToVDesktop",
      "sendToOutputProcessFinish",
    ];
    return reasons.indexOf(reason) < 0;
  }

  private _searchAvailableSlotsForOvercapacity(
    ctx: IDriverContext,
    sourceScreenData: ScreenData,
    output: Output,
    screenDataStore: Map<string, ScreenData>,
    vDesktop?: VirtualDesktop,
    allowOverfill: boolean = false,
  ): WindowClass[] {
    const overCapacity = sourceScreenData.overCapacity.length;
    if (overCapacity <= 0) return [];

    const targetSrf = ctx.getSurface(output, vDesktop);
    if (targetSrf == null || !targetSrf.isOvercapacityCandidate) return [];

    /* A surface with no capacity at all must never receive windows, even
     * when a shortcut is allowed to overfill a merely full surface. */
    const targetCapacity = resolveSurfaceCapacity(
      this.layouts.getCurrentLayout(targetSrf).capacity,
      targetSrf.capacity,
    );
    if (targetCapacity === 0) return [];

    if (!screenDataStore.has(targetSrf.id)) {
      screenDataStore.set(targetSrf.id, this.getTileables(targetSrf));
    }
    const sd = screenDataStore.get(targetSrf.id)!;
    const wasFull =
      sd.capacity !== null && sd.capacity - sd.awaitToMove.length <= 0;
    const availableSlots = resolveAvailableSlots(
      sd.capacity,
      sd.awaitToMove.length,
      overCapacity,
      allowOverfill,
    );
    if (availableSlots <= 0) return [];

    const windowsToAvailableSlots = sourceScreenData.overCapacity.splice(
      0,
      availableSlots,
    );
    if (allowOverfill && wasFull) {
      /* The moved window must survive the target's first overcapacity pass;
       * the eviction policy then removes another window on that surface. */
      windowsToAvailableSlots.forEach((win) => {
        win.preserveOnSurface = targetSrf.id;
      });
    }
    sd.awaitToMove.push(...windowsToAvailableSlots);
    return windowsToAvailableSlots;
  }

  private _prepareWindowsMoveToOutput(
    ctx: IDriverContext,
    sourceScreenData: ScreenData,
    direction?: Direction,
    allowOverfill: boolean = false,
  ) {
    let alreadyDone = new Set<Output>();
    const screenDataStore = new Map<string, ScreenData>();
    const sourceOutput = sourceScreenData.srf.output;
    alreadyDone.add(sourceOutput);
    let outputQueue = new UniqueLifoFifo<Output>();
    this._getPossibleOutputs(
      ctx,
      sourceOutput,
      outputQueue,
      alreadyDone,
      direction,
    );
    while (sourceScreenData.overCapacity.length > 0 && outputQueue.size !== 0) {
      let neighborOutput = outputQueue.shift();
      if (!neighborOutput) return false;
      const windowsToMove = this._searchAvailableSlotsForOvercapacity(
        ctx,
        sourceScreenData,
        neighborOutput,
        screenDataStore,
        undefined,
        allowOverfill,
      );
      const windowsArr = this.relocationWindows.toOutputs.add(neighborOutput);
      windowsArr.push(...windowsToMove);
      if (sourceScreenData.overCapacity.length === 0) break;
      alreadyDone.add(neighborOutput);
      this._getPossibleOutputs(
        ctx,
        neighborOutput,
        outputQueue,
        alreadyDone,
        direction,
      );
    }
  }

  private _getPossibleOutputs(
    ctx: IDriverContext,
    sourceOutput: Output,
    outputQueue: UniqueLifoFifo<Output>,
    alreadyDone: Set<Output>,
    direction?: Direction,
  ) {
    let order: Direction[];
    if (direction) order = [direction];
    else order = CONFIG.srfToScreenOrder;
    for (let i = 0; i < order.length; i++) {
      const direction = order[i];
      const output = ctx.getNeighborOutput(direction, sourceOutput);
      if (output && !alreadyDone.has(output)) outputQueue.push(output);
    }
  }

  private _getPossibleVDesktops(
    ctx: IDriverContext,
    sourceVDesktop: VirtualDesktop,
    vDesktopsQueue: UniqueLifoFifo<VirtualDesktop>,
    alreadyDone: Set<VirtualDesktop>,
  ) {
    for (let i = 0; i < CONFIG.srfToVDesktopOrder.length; i++) {
      const direction = CONFIG.srfToScreenOrder[i];
      const vDesktop = ctx.getNeighborVDesktop(direction, sourceVDesktop);
      if (vDesktop && !alreadyDone.has(vDesktop)) vDesktopsQueue.push(vDesktop);
    }
  }

  private _prepareOverCapacityWindowsTranferToVDesktop(
    ctx: IDriverContext,
    sourceScreenData: ScreenData,
  ) {
    let alreadyDone = new Set<VirtualDesktop>();
    const screenDataStore = new Map<string, ScreenData>();
    alreadyDone.add(ctx.currentDesktop);
    let vDesktopsQueue = new UniqueLifoFifo<VirtualDesktop>();
    this._getPossibleVDesktops(
      ctx,
      ctx.currentDesktop,
      vDesktopsQueue,
      alreadyDone,
    );
    while (
      sourceScreenData.overCapacity.length > 0 &&
      vDesktopsQueue.size !== 0
    ) {
      let neighborVDesktop = vDesktopsQueue.shift();
      if (!neighborVDesktop) return;
      const windowsToTransfer = this._searchAvailableSlotsForOvercapacity(
        ctx,
        sourceScreenData,
        sourceScreenData.srf.output,
        screenDataStore,
        neighborVDesktop,
      );
      if (windowsToTransfer.length !== 0) {
        const windowsArr =
          this.relocationWindows.toVDesktops.add(neighborVDesktop);
        windowsArr.push(...windowsToTransfer);
      }
      if (sourceScreenData.overCapacity.length === 0) break;
      alreadyDone.add(neighborVDesktop);
      this._getPossibleVDesktops(
        ctx,
        neighborVDesktop,
        vDesktopsQueue,
        alreadyDone,
      );
    }
  }

  private _isMinimizeOvercapacityMode(): boolean {
    return isMinimizeOvercapacityMode(
      CONFIG.srfOvercapacityMode,
      KWINCONFIG.preventMinimize,
    );
  }

  /**
   * Hide an overcapacity window instead of floating it and remember it for
   * later restoration.
   */
  private _minimizeOvercapacityWindow(window: WindowClass) {
    if (this._overCapacityMinimized.indexOf(window) === -1)
      this._overCapacityMinimized.push(window);
    window.window.setMinimizedByScript(true);
  }

  private _handleOverCapacityWindows(screenData: ScreenData) {
    if (!this._isMinimizeOvercapacityMode()) {
      screenData.overCapacity.forEach((win) => win.floatInPlace());
      return;
    }

    screenData.overCapacity.forEach((win) => {
      this._minimizeOvercapacityWindow(win);
      /* `visibles` was snapshotted before the window was hidden. Keep the
       * final commit pass away from a window that is no longer on screen. */
      const idx = screenData.visibles.indexOf(win);
      if (idx >= 0) screenData.visibles.splice(idx, 1);
    });
  }

  /**
   * Restore windows hidden by the overcapacity logic when their surface has
   * free capacity again.
   *
   * Minimize mode restores just enough windows to fill the free slots and
   * does so in LIFO order: the most recently hidden window comes back first.
   * In float mode (or when minimizing is disabled) every hidden window is
   * restored so the normal overcapacity logic can decide what to do with it.
   */
  private _restoreOverCapacityMinimized(srf: ISurface) {
    if (this._overCapacityMinimized.length === 0) return;

    this._overCapacityMinimized = this._overCapacityMinimized.filter(
      (win) =>
        win.isAlive() &&
        this.windows.indexOf(win) >= 0 &&
        win.minimized,
    );
    if (this._overCapacityMinimized.length === 0) return;

    const restoreAll = !this._isMinimizeOvercapacityMode();
    let freeSlots: number | null = null;
    if (!restoreAll) {
      const layout = this.layouts.getCurrentLayout(srf);
      const capacity = resolveSurfaceCapacity(layout.capacity, srf.capacity);
      freeSlots =
        capacity === null
          ? null
          : Math.max(
              0,
              capacity - this.windows.getVisibleTileables(srf).length,
            );
      if (freeSlots !== null && freeSlots <= 0) return;
    }

    const toRestore = selectRestorableWindows(
      this._overCapacityMinimized,
      srf.id,
      freeSlots,
      restoreAll,
    );
    if (toRestore.length === 0) return;

    const restored = new Set(toRestore);
    this._overCapacityMinimized = this._overCapacityMinimized.filter(
      (win) => !restored.has(win),
    );
    toRestore.forEach((win) => win.window.setMinimizedByScript(false));
  }

  private getTileables(srf: ISurface): ScreenData {
    let visibles = this.windows.getVisibleWindows(srf);
    visibles.forEach((window) => {
      window.window.updateSrfTime(srf.id);
      if (!window.window.isCommittedEver && window.window.floatConfig.auto) {
        window.state = WindowState.Floating;
      } else if (window.state === WindowState.Undecided) {
        window.state = window.shouldFloat
          ? WindowState.Floating
          : WindowState.Tiled;
        if (window.state === WindowState.Floating)
          notice(
            `Kröhnkite-Plus: new window ${window.windowClassName} floats: ${
              window.window.floatReason || "?"
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
    /* a window rule "order=master/last" already placed the window (manage) */
    const newWins = tileables.filter(
      (t) => !t.window.isCommittedEver && t.window.placement === null,
    );
    if (
      CONFIG.newWindowPosition !== "last" &&
      newWins.length > 0 &&
      tileables.length > 1
    ) {
      const anchor = tileables.find((t) => t.window.isCommittedEver);
      if (anchor) {
        this.windows.moveGroup(
          newWins,
          anchor,
          CONFIG.newWindowPosition === "second",
        );
      } else {
        // A batched startup has no committed anchor. Reproduce the order that
        // sequential windowAdded arrangements would have produced without
        // arranging the whole workspace once per existing window.
        let bootstrapAnchor = newWins[0];
        for (const window of newWins.slice(1)) {
          const insertAfter = CONFIG.newWindowPosition === "second";
          this.windows.move(window, bootstrapAnchor, insertAfter);
          if (!insertAfter) bootstrapAnchor = window;
        }
      }
      tileables = this.windows.getVisibleTileables(srf);
    }
    const layout = this.layouts.getCurrentLayout(srf);

    const protectedWindows = tileables.filter(
      (win) => win.preserveOnSurface === srf.id,
    );
    const selection = selectOverCapacityWindows(
      tileables,
      resolveSurfaceCapacity(layout.capacity, srf.capacity),
      CONFIG.srfOvercapacityEviction,
      protectedWindows,
    );
    tileables = selection.tileables;
    const overCapacity = selection.overCapacity;
    const freeCapacity = selection.freeSlots;

    /* Consume the one-shot protection on the target surface. A window whose
     * move finished somewhere else must not keep a stale marker. */
    visibles.forEach((win) => {
      if (win.preserveOnSurface === null) return;
      if (
        win.preserveOnSurface === srf.id ||
        (!win.isSendingToOutput && !win.isRelocationPending)
      )
        win.preserveOnSurface = null;
    });

    let screenData = {
      visibles: visibles,
      tileables: tileables,
      layout: layout,
      workingArea: this.docks.render(srf, visibles, srf.workingArea.clone()),
      srf: srf,
      overCapacity: overCapacity,
      capacity: freeCapacity,
      awaitToMove: [],
    };

    LOG?.send(
      LogModules.arrangeScreen,
      "getTileablesReturn",
      `output: ${srf.output.name}\n visibles number: ${
        visibles.length
      }\n tileables.length: ${screenData.tileables.length}, workingArea: ${
        screenData.workingArea
      }, layout: ${
        screenData.layout
      },capacity: ${freeCapacity}, overCapacity: ${screenData.overCapacity.map(
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
    processID?: number,
  ) {
    const outputName = screenData.srf.output.name;
    LOG?.send(
      LogModules.arrangeScreen,
      "arrangeScreen",
      `output:processID: ${outputName}:${processID}`,
    );
    this._handleOverCapacityWindows(screenData);
    const gaps = this.getGaps(screenData.srf);

    let tileablesLen = screenData.tileables.length;
    const soleWindowProps = TilingEngine.soleWindowProps(outputName);
    const tilingArea = TilingEngine.tilingArea(
      screenData.workingArea,
      gaps,
      tileablesLen,
      screenData.layout,
      outputName,
    );

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
            mes += `${tile.id}, state:${tile.state}, commitGeometry:${tile.geometry}\n`;
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
              `id: ${tile.id} commitGeometry:${tile.geometry}. minSize:${
                tile.minSize.width
              }:${tile.minSize.height} - heightUnfit:${
                tile.minSize.height > tile.geometry.height
              } widthUnfit: ${
                tile.minSize.width > tile.geometry.width
              }, tile.maxSize:${tile.maxSize.width}:${
                tile.maxSize.height
              } heightUnfit: ${
                tile.maxSize.height < tile.geometry.height
              }, widthUnfit: ${tile.maxSize.width < tile.geometry.width}`,
            );
            notice(
              `Kröhnkite-Plus: floating ${tile.windowClassName}, max ${tile.maxSize.width}x${tile.maxSize.height} smaller than tile ${tile.geometry.width}x${tile.geometry.height}`,
            );
            tile.floatInPlace();
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
              Math.max(
                t.minSize.width / area.width,
                t.minSize.height / area.height,
              );
            let tile = screenData.tileables[0];
            screenData.tileables.forEach((t) => {
              if (tooSmall(t) && demand(t) >= demand(tile)) tile = t;
            });
            screenData.tileables.splice(screenData.tileables.indexOf(tile), 1);
            notice(
              `Kröhnkite-Plus: floating ${tile.windowClassName}, min ${tile.minSize.width}x${tile.minSize.height} does not fit tile ${tile.geometry.width}x${tile.geometry.height}`,
            );
            tile.floatInPlace();
            layoutApply();
            unfitGreaterQuantity = getNumberTileablesGreaterThenMin(
              screenData.tileables,
            );
          }
        }
      }
    }

    TilingEngine.limitTileWidth(
      screenData.tileables,
      screenData.workingArea,
      screenData.layout,
    );

    /* zoom: the window floats above its (kept) place, centered, almost fullscreen */
    const zw = this.zoomWindow;
    if (zw !== null && screenData.tileables.indexOf(zw) >= 0)
      zw.geometry = TilingEngine.zoomRect(screenData.workingArea, gaps);

    if (soleWindowProps.noBorders && tileablesLen === 1) {
      screenData.visibles.forEach((window) => {
        if (window.state === WindowState.Tiled)
          window.commit(ctx, soleWindowProps.noBorders);
        else window.commit(ctx);
      });
    } else {
      screenData.visibles.forEach((window) => window.commit(ctx));
    }
    LOG?.send(
      LogModules.arrangeScreen,
      "#######################################################Finished",
      `${screenData.srf}`,
    );
  }

  /** sole-window settings of an output (override, or the defaults) */
  public static soleWindowProps(outputName: string): ISoleWindowProps {
    return (
      CONFIG.soleWindowOutputOverride[outputName] ||
      CONFIG.soleWindowDefaultProps
    );
  }

  /**
   * The area the layout may use: gaps, or the sole-window size limits and
   * Monocle maximize. Shared by arranging and the drag preview so both
   * always agree.
   */
  public static tilingArea(
    workingArea: Rect,
    gaps: IGaps,
    tileCount: number,
    layout: ILayout,
    outputName: string,
  ): Rect {
    const sole = TilingEngine.soleWindowProps(outputName);
    if (
      (CONFIG.monocleMaximize && layout instanceof MonocleLayout) ||
      (tileCount === 1 && sole.noGaps)
    )
      return workingArea;
    if (tileCount === 1 && (sole.width < 100 || sole.height < 100)) {
      const h_gap =
        (workingArea.height - workingArea.height * (sole.height / 100)) / 2;
      const v_gap =
        (workingArea.width - workingArea.width * (sole.width / 100)) / 2;
      return workingArea.gap(v_gap, v_gap, h_gap, h_gap);
    }
    return workingArea.gap(gaps.left, gaps.right, gaps.top, gaps.bottom);
  }

  /** "limit tile width": too wide tiles are narrowed and centered */
  public static limitTileWidth(
    tiles: WindowClass[],
    workingArea: Rect,
    layout: ILayout,
  ) {
    if (!(CONFIG.limitTileWidthRatio > 0) || layout instanceof MonocleLayout)
      return;
    const maxWidth = Math.floor(workingArea.height * CONFIG.limitTileWidthRatio);
    tiles
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

  /* ============================================================ zoom */

  /** tiled window lifted into a centered, almost fullscreen view */
  public zoomWindow: WindowClass | null = null;

  public static zoomRect(area: Rect, gaps: IGaps): Rect {
    const mx = Math.max(gaps.left, gaps.right, Math.round(area.width * CONFIG.zoomMarginX));
    const my = Math.max(gaps.top, gaps.bottom, Math.round(area.height * CONFIG.zoomMarginY));
    return new Rect(area.x + mx, area.y + my, area.width - 2 * mx, area.height - 2 * my);
  }

  /** zoom the active tile, or put the zoomed one back. Returns true if something changed. */
  public toggleZoom(ctx: IDriverContext): boolean {
    const window = ctx.currentWindow;
    if (this.zoomWindow !== null) {
      const was = this.zoomWindow;
      this.unzoom();
      if (window === null || window === was) return true;
    }
    if (window === null || window.state !== WindowState.Tiled) {
      ctx.showNotification("Zoom: only tiled windows");
      return this.zoomWindow === null;
    }
    this.zoomWindow = window;
    window.zoomed = true;
    return true;
  }

  /** put the zoomed window back into its tile (caller arranges) */
  public unzoom(): boolean {
    const z = this.zoomWindow;
    if (z === null) return false;
    z.zoomed = false;
    this.zoomWindow = null;
    return true;
  }

  /* ============================================================ undo / redo */

  /** Undo/Redo history (see undohistory.ts); the methods below delegate to it
   * (and tolerate a stub engine without it). */
  public readonly history: UndoHistory = new UndoHistory(this);

  public set undoHold(on: boolean) {
    if (this.history) this.history.hold = on;
  }
  public get undoHold(): boolean {
    return this.history ? this.history.hold : false;
  }
  public markUserAction() {
    this.history?.markUserAction();
  }
  public beginMouseAction() {
    this.history?.beginMouseAction();
  }
  public endMouseAction() {
    this.history?.endMouseAction();
  }
  public snapshot(): IUndoSnapshot {
    return this.history.snapshot();
  }
  public undoObserve(reason: string) {
    this.history?.observe(reason);
  }
  public get undoSteps(): number {
    return this.history ? this.history.undoSteps : 0;
  }
  public get redoSteps(): number {
    return this.history ? this.history.redoSteps : 0;
  }
  public undo(ctx: IDriverContext, redo: boolean): boolean {
    return this.history.undo(ctx, redo);
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

  private surfaceAt(ctx: IDriverContext, pos: QPoint): ISurface | null {
    const { x, y } = pos;
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
    WindowClass.invalidateSizes();
    if (this.dragWindow !== window) {
      if (this.unzoom()) this.arrange(ctx, "unzoom"); // real slots for hit testing
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
      const workingArea = this.docks.render(
        srf,
        this.windows.getVisibleWindows(srf),
        srf.workingArea.clone(),
      );
      const gaps = this.getGaps(srf);
      const layout = this.layouts.getCurrentLayout(srf);
      const area = TilingEngine.tilingArea(
        workingArea,
        gaps,
        base.length,
        layout,
        srf.output.name,
      );
      const tiles =
        !homeDrop && base.indexOf(window) >= 0 && layout instanceof SmartLayout
          ? this.orderLandingAt(layout, base, window, pos, area, gaps.between)
          : base;
      this.dragFinal.push({ srf, tiles });
      tiles.forEach((t) => (t.state = WindowState.Tiled));
      layout.apply(engineCtx, tiles, area, gaps.between);
      TilingEngine.limitTileWidth(tiles, workingArea, layout);
      tiles.forEach((t) => {
        if (t === window) silhouette = t.geometry;
        else if (t.isTiled) t.commit(ctx);
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
    pos: QPoint,
    area: Rect,
    gap: number,
  ): WindowClass[] {
    const lands = (tiles: WindowClass[]) => {
      const i = tiles.indexOf(window);
      const r = layout.compute(tiles, area, gap, i, true)[i];
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
  public applyOrder(order: WindowClass[]) {
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
    this.moveWindowsToOutputs(ctx, [[srf.output, [window]]]); // arranges afterwards
    return true;
  }

  /**
   * Send windows to other monitors through the relocation queue (KWin moves
   * them, the arrange follows once they arrived). The windows are allowed on
   * the target even if it is full: the user put them there.
   */
  public moveWindowsToOutputs(
    ctx: IDriverContext,
    moves: [Output, WindowClass[]][],
  ) {
    const relocation = this.relocationWindows;
    if (
      relocation.isSending &&
      getTime() - relocation.startTime <=
        TilingEngine.SENDING_WINDOWS_MAX_WAIT_TIME
    ) {
      this.arrange(ctx, "moveWindowToOutput");
      return;
    }
    relocation.clear();
    moves.forEach(([output, windows]) => {
      const srf = ctx.getSurface(output);
      const arr = relocation.toOutputs.add(output);
      windows.forEach((w) => {
        if (srf !== null) w.preserveOnSurface = srf.id;
        arr.push(w);
      });
    });
    relocation.activeWindow = ctx.currentWindow;
    if (!ctx.relocateWindows()) this.arrange(ctx, "moveWindowToOutput");
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
   * Restack the spread tiles around the focused window without changing
   * their geometry. Called when an explicit focus change raises a tile, so
   * that the layout order stays stable and only the z-order changes.
   */
  public restackSpread(
    ctx: IDriverContext,
    srf: ISurface,
    focused: WindowClass | null,
  ): void {
    const layout = this.layouts.getCurrentLayout(srf);
    if (!(layout instanceof SpreadLayout)) return;
    const tiles = this.windows.getVisibleTiles(srf);
    layout.restack(new EngineContext(ctx, this), tiles, focused);
  }

  /**
   * Restack the spread around a window that received focus, but only when the
   * focus came with a raise: a focus-follows-mouse change that leaves the
   * window behind other tiles must not move the stack.
   */
  public restackSpreadOnFocus(ctx: IDriverContext, window: WindowClass): void {
    const srf = window.surface;
    const layout = this.layouts.getCurrentLayout(srf);
    if (!(layout instanceof SpreadLayout)) return;
    const tiles = this.windows.getVisibleTiles(srf);
    if (tiles.length === 0) return;

    let top = tiles[0];
    for (const tile of tiles) {
      if (tile.window.stackingOrder > top.window.stackingOrder) top = tile;
    }
    if (top !== window) return;

    layout.restack(new EngineContext(ctx, this), tiles, window);
  }

  private restackAfterFocus(ctx: IDriverContext): void {
    const window = ctx.currentWindow;
    if (window !== null && window.isTiled)
      this.restackSpread(ctx, window.surface, window);
  }

  /**
   * Re-apply window geometry, computed by layout algorithm.
   *
   * Sometimes applications move or resize windows without user intervention,
   * which is straigh against the purpose of tiling WM. This operation
   * move/resize such windows back to where/how they should be.
   */
  public enforceSize(ctx: IDriverContext, window: WindowClass) {
    WindowClass.invalidateSizes();
    if (ctx.isPaused) return;
    /* While a window is being relocated between outputs or desktops, its
     * geometry legitimately differs from the last layout rect. Enforcing the
     * old rect here would undo the relocation. */
    if (window.isRelocationPending || window.isSendingToOutput) return;
    if (window.isTiled && !window.actualGeometry.equals(window.geometry)) {
      /* The deferred commit is meant to undo application-driven geometry
       * changes on the current surface. If the window moves to another
       * surface in the meantime (e.g. KWin's Grid View drag), the remembered
       * geometry belongs to the old output/desktop; committing it would move
       * the window back and undo the relocation. */
      const srfId = window.surface.id;
      ctx.setTimeout(() => {
        if (
          window.isAlive() &&
          !window.isRelocationPending &&
          !window.isSendingToOutput &&
          window.isTiled &&
          window.surface.id === srfId
        )
          window.commit(ctx);
      }, 10);
      this.learnIfTooBig(ctx, window);
    }
  }

  /*
   * Some apps (Steam, Electron, many XWayland clients) do not announce a
   * minimal size but refuse to become smaller than the tile. They then
   * protrude into their neighbours. If the window is still too big after
   * it had time to settle, remember that size as its real minimal size
   * and arrange again so the layout makes room for it.
   */
  private learnIfTooBig(ctx: IDriverContext, window: WindowClass) {
    const target = window.geometry;
    if (!window.isTooBigFor(target) || window.learnCheckPending) return;
    window.learnCheckPending = true;
    const stillTooBig = () =>
      window.isAlive() &&
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

  /**
   * Register the given window to WM.
   */
  public manage(window: WindowClass) {
    if (!window.shouldIgnore) {
      this.docks.attachWindow(window);
      if (this.docks.isNewWindowHaveDocked(window)) {
        window.state = WindowState.Docked;
      } else window.state = WindowState.Undecided;
      /* engine#arrange will update the state when required. */
      if (window.window.placement === "master") this.windows.unshift(window);
      else this.windows.push(window);
    }
  }

  /**
   * Unregister the given window from WM.
   */
  public unmanage(window: WindowClass) {
    if (this.dragWindow === window) this.dragCancel(null);
    if (this.zoomWindow === window) this.unzoom();
    this.undoHold = false;
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
    this._overCapacityMinimized = this._overCapacityMinimized.filter(
      (win) => win !== window,
    );
  }

  /**
   * Focus the next or previous window.
   */
  public focusOrder(ctx: IDriverContext, step: -1 | 1) {
    const window = ctx.currentWindow;

    /* if no current window, select the first tile. */
    if (window === null) {
      const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
      if (tiles.length > 1) {
        ctx.currentWindow = tiles[0];
        this.restackAfterFocus(ctx);
      }
      ctx.requestPointerOnFocus("window", true);
      return;
    }

    const visibles = this.windows.getVisibleWindows(ctx.currentSurface);
    if (visibles.length === 0) /* nothing to focus */ return;

    const idx = visibles.indexOf(window);
    if (!window || idx < 0) {
      /* unmanaged window -> focus master */
      ctx.currentWindow = visibles[0];
      this.restackAfterFocus(ctx);
      ctx.requestPointerOnFocus("window", true);
      return;
    }

    const num = visibles.length;
    const newIndex = (idx + (step % num) + num) % num;

    ctx.currentWindow = visibles[newIndex];
    this.restackAfterFocus(ctx);
    ctx.requestPointerOnFocus("window", true);
  }

  /**
   * Focus a neighbor at the given direction.
   */
  public focusDir(ctx: IDriverContext, dir: Direction): boolean {
    let winTypes = ctx.isRegister ? CONFIG.focusMetaCfg : CONFIG.focusNormalCfg;
    if (winTypes === WinTypes.special) {
      return ctx.focusSpecial(dir);
    }
    if (ctx.focusNeighborWindow(dir, winTypes)) {
      this.restackAfterFocus(ctx);
      ctx.requestPointerOnFocus("window", true);
      return false;
    }
    if (
      (!ctx.isRegister && CONFIG.focusMoveScreensNormal) ||
      (ctx.isRegister && CONFIG.focusMoveScreensMeta)
    ) {
      const result = ctx.focusOutput(null, dir, winTypes);
      if (result) {
        this.restackAfterFocus(ctx);
        ctx.requestPointerOnFocus("screen", true);
        return false;
      }
    }

    if (
      (!ctx.isRegister && CONFIG.focusMoveVDesktopsNormal) ||
      (ctx.isRegister && CONFIG.focusMoveVDesktopsMeta)
    ) {
      const result = ctx.focusVDesktop(null, dir, winTypes);
      this.restackAfterFocus(ctx);
      return result;
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
  private _moveTiled(
    ctx: IDriverContext,
    direction: Direction,
    window: WindowClass,
  ): boolean {
    const neighbor = this.getNeighborByDirection(ctx, window, direction);
    if (neighbor) {
      this.windows.swap(window, neighbor);
      return true;
    }
    if (
      ctx.isRegister
        ? CONFIG.focusMoveScreensMeta
        : CONFIG.focusMoveScreensNormal
    ) {
      const sd = this.getTileables(window.surface);
      const idx = sd.tileables.indexOf(window);
      if (idx < 0) {
        warning(`${getMethodName()}: there is not windows among tileables.`);
        return false;
      }
      sd.overCapacity.push(...sd.tileables.splice(idx, 1));
      this._prepareWindowsMoveToOutput(
        ctx,
        sd,
        direction,
        CONFIG.srfAllowShortcutMoveToFullSurface,
      );
      if (
        !this.relocationWindows.isSending &&
        this.relocationWindows.totalNumWinsPrepareToOutput > 0
      ) {
        if (!ctx.relocateWindows())
          warning(
            `${getMethodName()}: window cannot send to direction ${direction}`,
          );
        return false; // sendClientToScreen() run arrange after output was Changed
      }
    }
    if (
      ctx.isRegister
        ? CONFIG.focusMoveVDesktopsMeta
        : CONFIG.focusMoveVDesktopsNormal
    )
      return ctx.moveWinToVDesktopByDirection(window, direction);
    return false;
  }

  /**
   * Move the given window towards the given direction by one step.
   * @param window a floating window
   * @param dir which direction
   */
  private _moveFloat(ctx: IDriverContext, window: WindowClass, dir: Direction) {
    /* Declare these before the helpers: the helpers close over them and
     * QJSEngine warns about the temporal-dead-zone ordering at load time. */
    const relocation = this.relocationWindows;
    const srcOutput = window.surface.output;

    function isRelocationReady(): boolean {
      if (relocation.isSending) {
        if (
          getTime() - relocation.startTime <=
          TilingEngine.SENDING_WINDOWS_MAX_WAIT_TIME
        ) {
          warning(
            `${getMethodName()} Relocation windows in process. relocationWindows.isSending=${relocation.isSending}`,
          );
          return false;
        } else {
          warning(
            `${getMethodName()} Relocation windows with startTime:${relocation.startTime} was canceled.`,
          );
          relocation.clear();
        }
      }
      return true;
    }
    function floatRelocation(target: "toOutput" | "toVDesktop"): boolean {
      const neighbor =
        target === "toOutput"
          ? ctx.getNeighborOutput(dir, srcOutput)
          : ctx.getNeighborVDesktop(dir);
      if (neighbor === null) return false;
      if (!isRelocationReady()) return false;
      const winArr =
        target === "toOutput"
          ? relocation.toOutputs.add(neighbor as Output)
          : relocation.toVDesktops.add(neighbor as VirtualDesktop);
      winArr.push(window);
      return true;
    }
    const srf = window.surface;
    const srfRect = srf.workingArea;

    const geometry = window.actualGeometry;
    let x = geometry.x;
    let y = geometry.y;
    if (
      (x === srfRect.x && dir === "left") ||
      (x === srfRect.maxX - geometry.width && dir === "right") ||
      (y === srfRect.y && dir === "up") ||
      (y === srfRect.maxY - geometry.height && dir === "down")
    ) {
      if (
        (ctx.isRegister
          ? CONFIG.focusMoveScreensMeta
          : CONFIG.focusMoveScreensNormal) &&
        floatRelocation("toOutput")
      ) {
        this.relocationWindows.activeWindow = window;
        this.relocationWindows.direction = dir;
        ctx.relocateWindows();
        return;
      }
      if (
        (ctx.isRegister
          ? CONFIG.focusMoveVDesktopsMeta
          : CONFIG.focusMoveVDesktopsNormal) &&
        floatRelocation("toVDesktop")
      ) {
        this.relocationWindows.activeWindow = window;
        this.relocationWindows.direction = dir;
        ctx.relocateWindows();
      }
      return;
    }

    const hStepSize =
      (srfRect.width * window.window.floatConfig.stepWidth) / 100;
    const vStepSize =
      (srfRect.height * window.window.floatConfig.stepHeight) / 100;

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

    x = geometry.x + hStepSize * hStep;
    y = geometry.y + vStepSize * vStep;

    if (x < srfRect.x) x = srfRect.x;
    else if (x + geometry.width > srfRect.maxX)
      x = srfRect.maxX - geometry.width;
    if (y < srfRect.y) y = srfRect.y;
    else if (y + geometry.height > srfRect.maxY)
      y = srfRect.maxY - geometry.height;
    ctx.requestPointerOnFocus("window", true);
    window.forceSetGeometry(
      ctx,
      new Rect(x, y, geometry.width, geometry.height),
    );
  }

  public moveTiledWindow(ctx: IDriverContext, dir: Direction): boolean {
    const window = ctx.currentWindow;
    if (window === null) {
      /* if no current window, select the first tile. */
      const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
      if (tiles.length > 0) ctx.currentWindow = tiles[0];
      ctx.requestPointerOnFocus("window", true);
      return false;
    }

    if (window.isTiled) {
      return this._moveTiled(ctx, dir, window);
    }
    return false;
  }

  public toggleDock(window: WindowClass) {
    if (WindowClass.isToggleableState(window.state)) {
      if (window.isDocked) window.state = window.previousState;
      else window.state = WindowState.Docked;
    }
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
   * Effective capacity of the current surface, combining the layout limit
   * with the per-surface override.
   */
  public getCurrentSurfaceCapacity(ctx: IDriverContext): number | null {
    const currentSurface = ctx.currentSurface;
    return resolveSurfaceCapacity(
      this.layouts.getCurrentLayout(currentSurface).capacity,
      currentSurface.capacity,
    );
  }

  /**
   * Toggle float mode of window.
   */
  public toggleFloat(window: WindowClass) {
    if (WindowClass.isToggleableState(window.state)) {
      if (window.isFloating) window.state = window.previousState;
      else window.state = WindowState.Floating;
    }
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
        if (WindowClass.isToggleableState(window.state))
          window.state = WindowState.Floating;
      });
      ctx.showNotification("Float All");
    } else {
      windows.forEach((window) => {
        if (WindowClass.isToggleableState(window.state))
          window.state = window.previousState;
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
   *
   * The target is swapped with the current master of its surface. Calling
   * this on the window that is already master toggles back to the previous
   * master.
   */
  public setMaster(ctx: IDriverContext, window: WindowClass) {
    this.windows.setMaster(window);
    const master = this.windows.surfaceMaster(window);
    if (master === null) return;
    ctx.currentWindow = master;
    ctx.requestPointerOnFocus("window", true);
  }

  /**
   * Change the layout of the current surface to the next.
   */
  public cycleLayout(ctx: IDriverContext, step: 1 | -1) {
    const layout = this.layouts.cycleLayout(ctx.currentSurface, step);
    if (layout) ctx.showLayoutOSD();
  }

  /**
   * Set the layout of the current surface to the specified layout.
   */
  public setLayout(
    ctx: IDriverContext,
    layoutClassID: string,
    showOSD: boolean = true,
  ) {
    const layout = this.layouts.setLayout(ctx.currentSurface, layoutClassID);
    if (layout && showOSD) ctx.showLayoutShortcut(layout.classID);
  }

  /**
   * Let the docked window override shortcut.
   *
   * @returns True if the docked window overrides the shortcut. False, otherwise.
   */
  public handleDockWinShortcut(
    ctx: IDriverContext,
    window: WindowClass | null,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ): boolean {
    if (window === null || !window.isDocked) return false;
    const isHandled = this.docks.handleShortcut(ctx, window, action);
    if (isHandled) {
      this.arrange(ctx, reason, `${getMethodName()}:action=${action}`);
    }
    return isHandled;
  }
  public handleFloatWinShortcut(
    ctx: IDriverContext,
    window: WindowClass | null,
    action: KrohnkiteAction,
  ): boolean {
    if (window === null || !window.isFloating) return false;
    switch (action) {
      case KrohnkiteAction.Increase:
      case KrohnkiteAction.Decrease:
        break;
      case KrohnkiteAction.GrowWidth:
        this.resizeFloat(ctx, window, "east", 1);
        break;
      case KrohnkiteAction.ShrinkWidth:
        this.resizeFloat(ctx, window, "east", -1);
        break;
      case KrohnkiteAction.GrowHeight:
        this.resizeFloat(ctx, window, "south", 1);
        break;
      case KrohnkiteAction.ShrinkHeight:
        this.resizeFloat(ctx, window, "south", -1);
        break;
      case KrohnkiteAction.MoveLeft:
        this._moveFloat(ctx, window, "left");
        break;
      case KrohnkiteAction.MoveUp:
        this._moveFloat(ctx, window, "up");
        break;
      case KrohnkiteAction.MoveRight:
        this._moveFloat(ctx, window, "right");
        break;
      case KrohnkiteAction.MoveDown:
        this._moveFloat(ctx, window, "down");
        break;
      default:
        return false;
    }
    return true;
  }
  /**
   * Let the current layout override shortcut.
   *
   * @returns True if the layout overrides the shortcut. False, otherwise.
   */
  public handleLayoutShortcut(
    ctx: IDriverContext,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ): boolean {
    const layout = this.layouts.getCurrentLayout(ctx.currentSurface);
    if (layout.handleShortcut) {
      const isHandled = layout.handleShortcut(
        new EngineContext(ctx, this),
        action,
      );
      if (isHandled) {
        this.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
        return true;
      }
    }
    return false;
  }
  public handleTiledWinShortcut(
    ctx: IDriverContext,
    window: WindowClass | null,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ): boolean {
    if (window === null || !window.isTiled) return false;
    let isArrangeNeeded = true;
    switch (action) {
      case KrohnkiteAction.GrowWidth:
        this.resizeTile(window, "east", 1);
        break;
      case KrohnkiteAction.ShrinkWidth:
        this.resizeTile(window, "east", -1);
        break;
      case KrohnkiteAction.GrowHeight:
        this.resizeTile(window, "south", 1);
        break;
      case KrohnkiteAction.ShrinkHeight:
        this.resizeTile(window, "south", -1);
        break;

      case KrohnkiteAction.SwapUp:
        this.swapOrder(window, -1);
        break;
      case KrohnkiteAction.SwapDown:
        this.swapOrder(window, +1);
        break;

      case KrohnkiteAction.MoveUp:
        isArrangeNeeded = this.moveTiledWindow(ctx, "up");
        break;
      case KrohnkiteAction.MoveDown:
        isArrangeNeeded = this.moveTiledWindow(ctx, "down");
        break;
      case KrohnkiteAction.MoveLeft:
        isArrangeNeeded = this.moveTiledWindow(ctx, "left");
        break;
      case KrohnkiteAction.MoveRight:
        isArrangeNeeded = this.moveTiledWindow(ctx, "right");
        break;
      default:
        return false;
    }
    if (isArrangeNeeded) {
      this.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
    }
    return true;
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

    return closest.sort((a, b) => b.focusTime - a.focusTime)[0];
  }

  private getGaps(srf: ISurface): IGaps {
    if (this._defaultGaps === null) {
      this._defaultGaps = DefaultGapsCfg.instance;
      this._gapsSurfacesCfg = gapsSurfaceCfg.parseGapsUserSurfacesCfg();
    }
    const surfaceCfg = this._gapsSurfacesCfg.find((surfaceCfg) =>
      srf.isFit(surfaceCfg.userLabel),
    );
    if (surfaceCfg === undefined) return this._defaultGaps;
    return surfaceCfg.cfg;
  }
}
