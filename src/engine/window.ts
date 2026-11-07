/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class WindowClass implements IWindowClass {
  public static isTileableState(state: WindowState): boolean {
    return (
      state === WindowState.Tiled ||
      state === WindowState.Maximized ||
      state === WindowState.TiledAfloat
    );
  }
  public static isTiledState(state: WindowState): boolean {
    return state === WindowState.Tiled || state === WindowState.Maximized;
  }
  public static isFloatingState(state: WindowState): boolean {
    return state === WindowState.Floating || state === WindowState.TiledAfloat;
  }
  public static isDockedState(state: WindowState): boolean {
    return state === WindowState.Docked;
  }
  public static isToggleableState(
    state: WindowState,
  ): state is ToggleableState {
    return (
      state === WindowState.Tiled ||
      state === WindowState.Floating ||
      state === WindowState.Docked
    );
  }

  public get actualGeometry(): Readonly<Rect> {
    return this.window.geometry;
  }
  public get shouldFloat(): boolean {
    return this.window.shouldFloat;
  }
  public get shouldIgnore(): boolean {
    return this.window.shouldIgnore;
  }
  public isAlive(): boolean {
    return this.window.isAlive();
  }
  /** If this window ***can be*** tiled by layout. */
  public get isTileable(): boolean {
    return WindowClass.isTileableState(this.state);
  }
  /** If this window is ***already*** tiled, thus a part of the current layout. */
  public get isTiled(): boolean {
    return WindowClass.isTiledState(this.state);
  }
  /** If this window is floating, thus its geometry is not tightly managed. */
  public get isFloating(): boolean {
    return WindowClass.isFloatingState(this.state);
  }
  public get isDocked(): boolean {
    return WindowClass.isDockedState(this.state);
  }
  public get geometryDelta(): RectDelta | null {
    if (this.geometry === this.actualGeometry) return null;

    return RectDelta.fromRects(this.geometry, this.actualGeometry);
  }
  /* read live: apps change their size hints and rules may raise them */
  public get minSize(): ISize {
    if (this.minSizeEpoch === WindowClass.sizeEpoch && this.minSizeCached !== null)
      return this.minSizeCached;
    const reported = this.window.minSize;
    const learned = WindowClass.learnedMin[this.windowClassName];
    const size =
      learned === undefined
        ? reported
        : {
            width: Math.max(reported.width, learned.width),
            height: Math.max(reported.height, learned.height),
          };
    this.minSizeCached = size;
    this.minSizeEpoch = WindowClass.sizeEpoch;
    return size;
  }

  /*
   * Reading the minimal size goes through several KWin properties (min size,
   * frame and client geometry, window rules). It cannot change within one
   * event, so it is read once per "epoch"; a new epoch starts with every
   * arrange / driver event and whenever a minimal size is learned.
   */
  private static sizeEpoch = 0;
  private minSizeEpoch = -1;
  private minSizeCached: ISize | null = null;

  public static invalidateSizes() {
    WindowClass.sizeEpoch++;
  }

  /**
   * Minimal sizes observed from windows that refused to shrink, per window
   * class, so the next window of that app is laid out correctly right away.
   */
  private static learnedMin: { [cls: string]: ISize } = {};
  /** tolerance for rounding / scaling differences */
  private static readonly LEARN_TOLERANCE = 4;

  public learnCheckPending: boolean = false;

  public static exportLearnedMin(): { [cls: string]: ISize } {
    const out: { [cls: string]: ISize } = {};
    for (const k in WindowClass.learnedMin)
      out[k] = { width: WindowClass.learnedMin[k].width, height: WindowClass.learnedMin[k].height };
    return out;
  }

  public static importLearnedMin(data: { [cls: string]: ISize } | undefined) {
    if (!data) return;
    for (const k in data) {
      const v = data[k];
      if (v && typeof v.width === "number" && typeof v.height === "number")
        WindowClass.learnedMin[k] = { width: v.width, height: v.height };
    }
    WindowClass.invalidateSizes();
  }

  public isTooBigFor(target: Rect): boolean {
    const actual = this.actualGeometry;
    return (
      actual.width > target.width + WindowClass.LEARN_TOLERANCE ||
      actual.height > target.height + WindowClass.LEARN_TOLERANCE
    );
  }

  /**
   * The window is now smaller than what we learned (it was only slow, or the
   * app changed): lower the learned minimal size again.
   */
  public observeSize() {
    const learned = WindowClass.learnedMin[this.windowClassName];
    if (learned === undefined || !this.isTiled) return;
    const actual = this.actualGeometry;
    const tol = WindowClass.LEARN_TOLERANCE;
    if (actual.width + tol < learned.width || actual.height + tol < learned.height)
    {
      WindowClass.learnedMin[this.windowClassName] = {
        width: Math.min(learned.width, actual.width),
        height: Math.min(learned.height, actual.height),
      };
      WindowClass.invalidateSizes();
    }
  }

  /** remember the current oversize as minimal size; true if it grew */
  public learnMinSize(): boolean {
    const target = this.geometry;
    const actual = this.actualGeometry;
    if (!this.isTooBigFor(target)) return false;
    const cls = this.windowClassName;
    if (!cls) return false;
    const area = this.surface.workingArea;
    /*
     * A window that stays (almost) as big as the whole screen did not react
     * to the resize at all - that tells nothing about its minimal size.
     */
    if (actual.width >= area.width * 0.9 && actual.height >= area.height * 0.9) {
      notice(
        `Kröhnkite-Plus: ${cls} ignores resizing (${actual.width}x${actual.height}, tile ${target.width}x${target.height}), not learning a min size`,
      );
      return false;
    }
    const prev = WindowClass.learnedMin[cls] || { width: 0, height: 0 };
    const next = {
      width:
        actual.width > target.width + WindowClass.LEARN_TOLERANCE
          ? Math.min(Math.max(prev.width, actual.width), area.width)
          : prev.width,
      height:
        actual.height > target.height + WindowClass.LEARN_TOLERANCE
          ? Math.min(Math.max(prev.height, actual.height), area.height)
          : prev.height,
    };
    if (next.width <= prev.width && next.height <= prev.height) return false;
    WindowClass.learnedMin[cls] = next;
    WindowClass.invalidateSizes();
    const reported = this.window.minSize;
    notice(
      `Kröhnkite-Plus: ${cls} refuses to shrink: tile ${target.width}x${target.height}, actual ${actual.width}x${actual.height}, reported min ${reported.width}x${reported.height} -> learned min ${next.width}x${next.height}`,
    );
    LOG?.send(
      LogModules.arrangeScreen,
      "learnMinSize",
      `${cls}: learned min size ${next.width}x${next.height}`,
    );
    return true;
  }
  public get maxSize(): ISize {
    return this.window.maxSize;
  }
  /**
   * The current state of the window.
   *
   * This value affects what and how properties gets commited to the backend.
   *
   * Avoid comparing this value directly, and use `tileable`, `tiled`,
   * `floating` as much as possible.
   */
  public get state(): WindowState {
    /* external states override the internal state. */
    if (this.window.fullScreen) return WindowState.NativeFullscreen;
    if (this.window.maximized) return WindowState.NativeMaximized;

    return this.internalState;
  }
  public set state(value: WindowState) {
    const state = this.state;

    /* cannot transit to the current state */
    if (state === value) return;

    if (
      (state === WindowState.Unmanaged || this.isTileable || this.isDocked) &&
      WindowClass.isFloatingState(value)
    )
      this.shouldCommitFloat = true;
    else if (
      this.isFloating &&
      (WindowClass.isTileableState(value) || WindowClass.isDockedState(value))
    ) {
      /* save the current geometry before leaving floating state */
      this.floatGeometry = this.actualGeometry;
      /* The layout did not own the size of a floating window, so the last
       * request no longer describes it. Let the next commit compare with the
       * frame again, or a window resized by hand and then tiled counts as
       * unchanged. */
      this.window.forgetRequestedGeometry();
    }

    if (
      state === WindowState.Tiled ||
      state === WindowState.Floating ||
      state === WindowState.Docked
    ) {
      this.previousState = state;
    }
    this.internalState = value;
  }
  /**
   * Set the state directly, bypassing previousState and float-commit
   * bookkeeping. For transient previews (e.g. during dragging).
   */
  public setTransientState(state: WindowState): void {
    this.internalState = state;
  }
  /**
   * Enter the floating state while keeping the window exactly where it is.
   *
   * `commit()` applies `floatGeometry` (not the layout geometry) once a window
   * is floating. If the current geometry is not captured first, the window is
   * snapped to its remembered/lazily-computed native float rect, which shows up
   * as a small jump when an automatically-floated window (e.g. one that cannot
   * fit the tile) leaves the layout. User-initiated toggles intentionally keep
   * the remembered float position and should not use this.
   */
  public floatInPlace(): void {
    if (!this.isFloating) this.floatGeometry = this.actualGeometry.clone();
    this.state = WindowState.Floating;
  }
  public get surface(): ISurface {
    return this.window.surface;
  }
  public set surface(srf: ISurface) {
    this.window.surface = srf;
  }
  public get weight(): number {
    const srfID = this.window.surface.id;
    const weight: number | undefined = this.weightMap[srfID];
    if (weight === undefined) {
      /* a window rule may ask for a bigger share */
      const initial = this.window.weight !== null ? this.window.weight : 1.0;
      this.weightMap[srfID] = initial;
      return initial;
    }
    return weight;
  }
  public set weight(value: number) {
    const srfID = this.window.surface.id;
    this.weightMap[srfID] = value;
  }
  public get windowClassName(): string {
    return this.window.windowClassName;
  }
  public get windowCaption(): string {
    return this.window.windowCaption;
  }
  public get floatGeometry(): Rect {
    return this.window.floatGeometry;
  }
  public set floatGeometry(value: Rect) {
    this.window.floatGeometry = value;
  }
  /**
   * The dock state of the window, instantiated lazily from the configured
   * template on first access.
   */
  public get dock(): Dock {
    if (this._dock === null) this._dock = this._dockTemplate.clone();
    return this._dock;
  }
  public setDockTemplate(template: Dock): void {
    this._dockTemplate = template;
  }

  public readonly id: string;
  public readonly window: IDriverWindow;
  public geometry: Rect;
  public focusTime: number;
  public isSendingToOutput: boolean;
  public isRelocationPending: boolean;
  /* Surface id where this window must survive the first overcapacity pass.
   * Set when a shortcut moves the window onto a full surface, cleared once
   * the target surface has arranged it. */
  public preserveOnSurface: string | null;
  public surfaceArrangeToken: number;
  public relocationTargetOutput: Output | null;
  public isDragging: boolean;
  public previousState: ToggleableState;
  /** temporarily lifted above the tiles (zoom), keeps its place in the layout */
  public zoomed = false;

  private internalState: WindowState;
  private shouldCommitFloat: boolean;
  private weightMap: { [key: string]: number };
  private _dock: Dock | null;
  private _dockTemplate: Dock;

  constructor(window: IDriverWindow) {
    this.id = window.id;
    this.window = window;

    this.geometry = window.geometry;
    this.focusTime = 0;
    this.isSendingToOutput = false;
    this.isRelocationPending = false;
    this.preserveOnSurface = null;
    this.surfaceArrangeToken = 0;
    this.relocationTargetOutput = null;
    this.isDragging = false;
    this.internalState = WindowState.Unmanaged;
    this.previousState = WindowState.Tiled;
    this.shouldCommitFloat = this.shouldFloat;
    // this._floatGeometry =
    //   this.shouldCommitFloat || CONFIG.floatConfig === null
    //     ? this.geometry
    //     : null;
    this.weightMap = {};
    this._dock = null;
    this._dockTemplate = new Dock(DefaultDockCfg.instance);
  }

  public toString(): string {
    return `Window: id=${this.id}, state: ${this.state}. ${this.window}`;
  }

  public commit(ctx: IDriverContext, noBorders?: boolean) {
    if (this.isDragging) return;
    if (!this.window.isCommittedEver) this.window.isCommittedEver = true;
    const state = this.state;
    LOG?.send(
      LogModules.arrangeScreen,
      "commit",
      `id: ${this.id}, state: ${state}, floatGeometry: ${
        this.floatGeometry
      }, commitGeometry: ${this.geometry}, noBorders: ${noBorders}`,
    );
    switch (state) {
      case WindowState.NativeMaximized:
        this.window.commit(ctx, undefined, undefined, undefined);
        break;

      case WindowState.NativeFullscreen:
        this.window.commit(ctx, undefined, undefined, WindowLayer.Normal);
        break;

      case WindowState.Floating:
        if (!this.shouldCommitFloat) break;
        this.window.commit(
          ctx,
          this.floatGeometry,
          false,
          CONFIG.floatedWindowsLayer,
        );
        this.shouldCommitFloat = false;
        break;

      case WindowState.Maximized:
        this.window.commit(ctx, this.geometry, true, WindowLayer.Normal);
        break;

      case WindowState.Tiled:
        this.window.commit(
          ctx,
          this.geometry,
          this.zoomed ? false : CONFIG.noTileBorder || Boolean(noBorders),
          this.zoomed ? WindowLayer.Above : CONFIG.tiledWindowsLayer,
        );
        break;

      case WindowState.TiledAfloat:
        if (!this.shouldCommitFloat) break;
        this.window.commit(
          ctx,
          this.floatGeometry,
          false,
          CONFIG.floatedWindowsLayer,
        );
        this.shouldCommitFloat = false;
        break;
      case WindowState.Floating:
        this.window.commit(
          ctx,
          this.geometry,
          CONFIG.noTileBorder || Boolean(noBorders),
          CONFIG.floatedWindowsLayer,
        );
        break;
      case WindowState.Docked:
        this.window.commit(
          ctx,
          this.geometry,
          CONFIG.noTileBorder,
          CONFIG.tiledWindowsLayer,
        );
        break;
    }
  }

  /**
   * Force apply the geometry *immediately*.
   *
   * This method is a quick hack created for engine#resizeFloat, thus should
   * not be used in other places.
   */
  public forceSetGeometry(ctx: IDriverContext, geometry: Rect) {
    this.window.commit(ctx, geometry);
  }

  public isTransientOf(owner: WindowClass): boolean {
    return this.window.isTransientOf
      ? this.window.isTransientOf(owner.window)
      : false;
  }

  public visible(srf: ISurface): boolean {
    return this.window.visible(srf);
  }
  public get minimized(): boolean {
    return this.window.minimized;
  }
}
