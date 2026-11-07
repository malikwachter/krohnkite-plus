/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class WindowClass {
  public static isTileableState(state: WindowState): boolean {
    return (
      state === WindowState.Dragging ||
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

  public readonly id: string;
  public readonly window: IDriverWindow;

  public get actualGeometry(): Readonly<Rect> {
    return this.window.geometry;
  }
  public get shouldFloat(): boolean {
    return this.window.shouldFloat;
  }
  public get shouldIgnore(): boolean {
    return this.window.shouldIgnore;
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
    const reported = this.window.minSize;
    const learned = WindowClass.learnedMin[this.windowClassName];
    if (learned === undefined) return reported;
    return {
      width: Math.max(reported.width, learned.width),
      height: Math.max(reported.height, learned.height),
    };
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
      WindowClass.learnedMin[this.windowClassName] = {
        width: Math.min(learned.width, actual.width),
        height: Math.min(learned.height, actual.height),
      };
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
        `Krohnkite Smart: ${cls} ignores resizing (${actual.width}x${actual.height}, tile ${target.width}x${target.height}), not learning a min size`,
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
    const reported = this.window.minSize;
    notice(
      `Krohnkite Smart: ${cls} refuses to shrink: tile ${target.width}x${target.height}, actual ${actual.width}x${actual.height}, reported min ${reported.width}x${reported.height} -> learned min ${next.width}x${next.height}`,
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
    if (state === value || state === WindowState.Dragging) return;

    if (
      (state === WindowState.Unmanaged || WindowClass.isTileableState(state)) &&
      WindowClass.isFloatingState(value)
    )
      this.shouldCommitFloat = true;
    else if (
      WindowClass.isFloatingState(state) &&
      WindowClass.isTileableState(value)
    )
      /* save the current geometry before leaving floating state */
      this._floatGeometry = this.actualGeometry;

    this.internalState = value;
  }
  public setDraggingState() {
    this.internalState = WindowState.Dragging;
  }
  public setState(value: WindowState) {
    this.internalState = value;
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

  public get floatGeometry(): Rect {
    if (this._floatGeometry === null) {
      this._floatGeometry = this.window.getInitFloatGeometry();
    }
    return this._floatGeometry;
  }
  public set floatGeometry(value: Rect) {
    this._floatGeometry = value;
  }

  public dock: Dock | null;
  public geometry: Rect;
  /** temporarily lifted above the tiles (zoom), keeps its place in the layout */
  public zoomed = false;
  public timestamp: number;

  private internalState: WindowState;
  private shouldCommitFloat: boolean;
  private weightMap: { [key: string]: number };
  private _floatGeometry: Rect | null;

  constructor(window: IDriverWindow) {
    this.id = window.id;
    this.window = window;

    this.geometry = window.geometry;
    this.timestamp = 0;

    this.internalState = WindowState.Unmanaged;
    this.shouldCommitFloat = this.shouldFloat;
    this._floatGeometry = window.hasPreferredFloatGeometry
      ? window.getInitFloatGeometry()
      : this.shouldCommitFloat || CONFIG.floatInit === null
        ? this.geometry
        : null;
    this.weightMap = {};
    this.dock = null;

  }
  public toString(): string {
    return `Window: id=${this.id}, state: ${windowStateStr(this.state)}. ${
      this.window
    }`;
  }

  public commit(noBorders?: boolean) {
    const state = this.state;
    LOG?.send(
      LogModules.arrangeScreen,
      "commit",
      `id: ${this.id}, state: ${windowStateStr(state)}, floatGeometry: ${
        this.floatGeometry
      }, commitGeometry: ${this.geometry}, noBorders: ${noBorders}`,
    );
    switch (state) {
      case WindowState.Dragging:
        break;
      case WindowState.NativeMaximized:
        this.window.commit(undefined, undefined, undefined);
        break;

      case WindowState.NativeFullscreen:
        this.window.commit(undefined, undefined, WindowLayer.Normal);
        break;

      case WindowState.Floating:
        if (!this.shouldCommitFloat) break;
        this.window.commit(
          this.floatGeometry,
          false,
          CONFIG.floatedWindowsLayer,
        );
        this.shouldCommitFloat = false;
        break;

      case WindowState.Maximized:
        this.window.commit(this.geometry, true, WindowLayer.Normal);
        break;

      case WindowState.Tiled:
        this.window.commit(
          this.geometry,
          this.zoomed ? false : CONFIG.noTileBorder || Boolean(noBorders),
          this.zoomed ? WindowLayer.Above : CONFIG.tiledWindowsLayer,
        );
        break;

      case WindowState.TiledAfloat:
        if (!this.shouldCommitFloat) break;
        this.window.commit(
          this.floatGeometry,
          false,
          CONFIG.floatedWindowsLayer,
        );
        this.shouldCommitFloat = false;
        break;
      case WindowState.Floating:
        this.window.commit(
          this.geometry,
          CONFIG.noTileBorder || Boolean(noBorders),
          CONFIG.floatedWindowsLayer,
        );
        break;
      case WindowState.Docked:
        this.window.commit(
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
  public forceSetGeometry(geometry: Rect) {
    this.window.commit(geometry);
  }

  public isTransientOf(owner: WindowClass): boolean {
    return this.window.isTransientOf ? this.window.isTransientOf(owner.window) : false;
  }

  public moveMouseToFocus() {
    this.window.moveMouseToFocus();
  }

  public visible(srf: ISurface): boolean {
    return this.window.visible(srf);
  }
  public get minimized(): boolean {
    return this.window.minimized;
  }
}
