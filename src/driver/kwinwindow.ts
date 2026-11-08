/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/
type DriverFloatConfig = NonNullableProps<
  PartialWithRequired<
    IFloatWindow,
    | "shouldFloat"
    | "auto"
    | "width"
    | "height"
    | "leftIndent"
    | "topIndent"
    | "stepWidth"
    | "stepHeight"
  >
>;

class DriverWindow implements IDriverWindow {
  public static generateID(w: KwinWindow) {
    return w.internalId.toString();
  }

  /** last floating geometry per window class, relative to its output */
  private static floatMemory: {
    [cls: string]: { x: number; y: number; w: number; h: number };
  } = {};

  public get isActive(): boolean {
    return this.window.active;
  }
  public get fullScreen(): boolean {
    return this.window.fullScreen;
  }
  public get floatGeometry(): Rect {
    if (this._floatGeometry === null) {
      this._floatGeometry = this._getInitFloatGeometry();
    }
    return this._floatGeometry;
  }
  public set floatGeometry(value: Rect) {
    this._floatGeometry = value;
  }
  public get geometry(): Rect {
    return toRect(this.window.frameGeometry);
  }
  public get windowClassName(): string {
    return this.window.resourceClass;
  }
  public get windowCaption(): string {
    return this.window.caption;
  }
  public get stackingOrder(): number {
    return this.window.stackingOrder;
  }
  public get shouldIgnore(): boolean {
    if (this.window.deleted) return true;
    return (
      this.window.specialWindow ||
      this.window.resourceClass === "plasmashell" ||
      this.isIgnoredByConfig
    );
  }
  public get shouldFloat(): boolean {
    /* real dialogs always float, even with a "tile" rule */
    if (this.window.modal || this.window.transient || !this.window.resizeable)
      return true;
    if (this.rule !== null && this.rule.state === "tile") return false;
    return (
      this.floatConfig.shouldFloat ||
      (this.rule !== null && this.rule.state === "float") ||
      (CONFIG.floatSkipPager && this.window.skipPager) ||
      (KWINCONFIG.floatUtility &&
        (this.window.dialog || this.window.splash || this.window.utility)) ||
      (KWINCONFIG.smartFloat && this.isFloatByHeuristic)
    );
  }

  /** human readable reason why shouldFloat is true (for the journal) */
  public get floatReason(): string {
    const w = this.window;
    if (w.modal) return "modal dialog";
    if (w.transient) return "transient (dialog of another window)";
    if (!w.resizeable) return "not resizeable";
    if (this.rule !== null && this.rule.state === "tile") return "";
    if (this.rule !== null && this.rule.state === "float")
      return `window rule line ${this.rule.matched}`;
    if (this.floatConfig.shouldFloat) return "floating class/title setting";
    if (CONFIG.floatSkipPager && w.skipPager) return "skip pager";
    if (KWINCONFIG.floatUtility && (w.dialog || w.splash || w.utility))
      return "dialog/splash/utility window type";
    if (KWINCONFIG.smartFloat && this.isFloatByHeuristic)
      return "smart float (picture-in-picture / fixed size / overlay)";
    return "";
  }

  /**
   * Windows that are almost never meant to be tiled:
   * picture-in-picture players, fixed size windows and overlays that hide
   * from both taskbar and pager.
   * (keep-above is NOT used: Krohnkite sets it itself on floating windows,
   * so after a script reload every once-floated window would stay floating.)
   */
  private get isFloatByHeuristic(): boolean {
    const w = this.window;
    const caption = (w.caption || "").toLowerCase();
    if (KWINCONFIG.smartFloatTitles.some((t) => caption.indexOf(t) >= 0))
      return true;
    if (
      w.minSize.width > 0 &&
      w.minSize.height > 0 &&
      w.minSize.width === w.maxSize.width &&
      w.minSize.height === w.maxSize.height
    )
      return true;
    if (w.skipTaskbar && w.skipPager && !w.normalWindow) return true;
    return false;
  }

  public maximized: boolean;
  public get minimized(): boolean {
    return this.window.minimized;
  }
  public get nativeFloatGeometry(): Rect {
    return this._nativeFloatGeometry;
  }
  public get surface(): ISurface {
    let activity;
    let vDesktop;
    if (this.window.activities.length === 0)
      activity = this.workspace.currentActivity;
    else if (
      this.window.activities.indexOf(this.workspace.currentActivity) >= 0
    )
      activity = this.workspace.currentActivity;
    else activity = this.window.activities[0];

    if (this.window.desktops.length === 1) {
      vDesktop = this.window.desktops[0];
    } else if (this.window.desktops.length === 0) {
      vDesktop = this.workspace.currentDesktop;
    } else {
      if (this.window.desktops.indexOf(this.workspace.currentDesktop) >= 0)
        vDesktop = this.workspace.currentDesktop;
      else vDesktop = this.window.desktops[0];
    }

    return this._surfaceStore.getSurface(
      this.resolvedOutput,
      activity,
      vDesktop,
    );
  }
  /* The window's live output, or the active screen when that output is an
   * already-destroyed wrapper. During a hotplug/resume flurry a still-alive
   * window can briefly reference a destroyed output before KWin reassigns
   * it to a live one; surface ids derive from output.name, so resolving
   * against the dead wrapper would throw mid-arrange. surface(), visible()
   * and commit() all go through this so a window whose output just died is
   * tiled on the fallback screen instead of vanishing from arrange. */
  private get resolvedOutput(): Output {
    return resolveWindowOutput(this.workspace, this.window);
  }
  public set surface(srf: ISurface) {
    const ksrf = srf as KWinSurface;

    // TODO: setting activity?
    // TODO: setting screen = move to the screen
    if (this.window.desktops[0] !== ksrf.vDesktop)
      this.window.desktops = [ksrf.vDesktop];
    if (this.window.activities[0] !== ksrf.activity)
      this.window.activities = [ksrf.activity];
  }
  /** minimal frame size, raised by a "minwidth"/"minheight" window rule */
  public get minSize(): ISize {
    const reported = this.window.minSize;
    let width = reported.width;
    let height = reported.height;
    /* minSize is the client size, layouts work with frame geometry */
    const frame = this.window.frameGeometry;
    const client = this.window.clientGeometry;
    if (frame && client) {
      if (width > 0) width += Math.max(0, frame.width - client.width);
      if (height > 0) height += Math.max(0, frame.height - client.height);
    }
    if (this.rule !== null && (this.rule.minWidth || this.rule.minHeight)) {
      const out = this.resolvedOutput.geometry;
      if (this.rule.minWidth)
        width = Math.max(
          width,
          WindowRules.resolveLength(this.rule.minWidth, out.width),
        );
      if (this.rule.minHeight)
        height = Math.max(
          height,
          WindowRules.resolveLength(this.rule.minHeight, out.height),
        );
    }
    return { width, height };
  }
  public get maxSize(): ISize {
    const max = this.window.maxSize;
    return { width: max.width, height: max.height };
  }
  public get srfTime() {
    if (this._srfTime.time === null) this._srfTime.time = getTime();
    return this._srfTime.time;
  }

  public readonly window: KwinWindow;
  public readonly id: string;
  public readonly rule: IWindowRule | null;
  /** key for the float memory: "" = do not remember this window */
  private readonly memoryKey: string;
  public isCommittedEver: boolean;
  public floatConfig: DriverFloatConfig;
  private _srfTime: { time: number | null; srfId: string | null };
  private readonly workspace: Workspace;
  private readonly isIgnoredByConfig: boolean;
  private readonly _surfaceStore: KWinSurfaceStore;
  private _floatGeometry: Rect | null;
  private _nativeFloatGeometry: Rect;
  /* A runtime reload replaces DriverWindow instances but keeps the native
   * KWin windows alive. Remember properties Krohnkite overrides so dispose()
   * can remove this runtime's effects before the replacement snapshots them. */
  private noBorderManaged: boolean;
  private noBorderOriginal: boolean;
  private layerManaged: boolean;
  private keepAboveOriginal: boolean;
  private keepBelowOriginal: boolean;
  private minimizedManaged: boolean;
  private minimizedOriginal: boolean;
  /* The geometry last requested from KWin. Null before the first request, and
   * empty while KWin owns the size, so the next request counts as a resize. */
  private lastRequestedGeometry: Rect | null;

  constructor(
    window: KwinWindow,
    workspace: Workspace,
    surfaceStore: KWinSurfaceStore,
  ) {
    this.workspace = workspace;
    this._surfaceStore = surfaceStore;
    this._srfTime = { time: null, srfId: null };
    this.window = window;
    this.isCommittedEver = false;
    this._nativeFloatGeometry = toRect(window.frameGeometry);
    this._floatGeometry = null;
    this.id = DriverWindow.generateID(window);
    this.maximized = false;
    this.noBorderManaged = false;
    this.noBorderOriginal = window.noBorder;
    this.layerManaged = false;
    this.keepAboveOriginal = window.keepAbove;
    this.keepBelowOriginal = window.keepBelow;
    this.minimizedManaged = false;
    this.minimizedOriginal = window.minimized;
    this.lastRequestedGeometry = null;
    this.floatConfig = this._getFloatConfig(window);
    this.rule = KWINCONFIG.windowRules.match({
      resourceClass: window.resourceClass,
      resourceName: window.resourceName,
      desktopFileName: window.desktopFileName,
      caption: window.caption,
      windowRole: window.windowRole,
    });
    const cls = (window.resourceClass || window.resourceName || "").toLowerCase();
    const caption = (window.caption || "").toLowerCase();
    const pip = KWINCONFIG.smartFloatTitles.some((t) => caption.indexOf(t) >= 0);
    this.memoryKey =
      cls === "" || window.transient || window.modal || window.dialog
        ? ""
        : `${cls}|${this.rule !== null ? this.rule.matched : ""}|${pip ? "pip" : ""}`;
    this.isIgnoredByConfig =
      DriverWindow.isContain(KWINCONFIG.ignoreClass, window.resourceClass) ||
      DriverWindow.isContain(KWINCONFIG.ignoreClass, window.resourceName) ||
      matchWords(this.window.caption, KWINCONFIG.ignoreTitle) >= 0 ||
      DriverWindow.isContain(KWINCONFIG.ignoreRole, window.windowRole) ||
      (KWINCONFIG.tileNothing &&
        !DriverWindow.isContain(KWINCONFIG.tilingClass, window.resourceClass)) ||
      (this.rule !== null && this.rule.state === "ignore") ||
      DriverWindow.isGame(window);
  }
  /** Steam/Proton games, gamescope ... (gaming mode) */
  public static isGame(w: KwinWindow): boolean {
    if (!KWINCONFIG.gamingMode) return false;
    const cls = `${w.resourceClass || ""} ${w.resourceName || ""}`.toLowerCase();
    return KWINCONFIG.gameClasses.some((g) => g !== "" && cls.indexOf(g) >= 0);
  }

  public get weight(): number | null {
    return this.rule !== null && this.rule.weight !== undefined
      ? this.rule.weight
      : null;
  }

  public get placement(): "master" | "last" | null {
    return this.rule !== null && this.rule.order !== undefined
      ? this.rule.order
      : null;
  }

  /** true if a rule or the float memory knows where this window should go */
  public get hasPreferredFloatGeometry(): boolean {
    if (KWINCONFIG.popupLayer && LayerManager.placedFor(this.id) !== null) return true;
    return (
      (KWINCONFIG.smartRememberFloat &&
        this.memoryKey !== "" &&
        DriverWindow.floatMemory[this.memoryKey] !== undefined) ||
      (this.rule !== null &&
        (this.rule.floatWidth !== undefined || this.rule.floatPos !== undefined)) ||
      (KWINCONFIG.smartCenterDialogs && this.isDialogLike)
    );
  }

  public isTransientOf(owner: IDriverWindow): boolean {
    const target = (owner as DriverWindow).window;
    let w: KwinWindow | null = this.window;
    for (let i = 0; w && i < 10; i++) {
      if (!w.transient) return false;
      w = w.transientFor;
      if (w === target) return true;
    }
    return false;
  }

  /** settings dialogs, file pickers, message boxes ... */
  private get isDialogLike(): boolean {
    return this.window.transient || this.window.modal || this.window.dialog;
  }

  public static exportFloatMemory(): IPersistedState["floatMemory"] {
    const out: IPersistedState["floatMemory"] = {};
    for (const k in DriverWindow.floatMemory) {
      const m = DriverWindow.floatMemory[k];
      out[k] = { x: m.x, y: m.y, w: m.w, h: m.h };
    }
    return out;
  }

  public static importFloatMemory(data: IPersistedState["floatMemory"] | undefined) {
    if (!data) return;
    for (const k in data) {
      const m = data[k];
      if (m && [m.x, m.y, m.w, m.h].every((v) => typeof v === "number" && isFinite(v)))
        DriverWindow.floatMemory[k] = { x: m.x, y: m.y, w: m.w, h: m.h };
    }
  }

  public rememberFloatGeometry(geometry: Rect) {
    if (!KWINCONFIG.smartRememberFloat) return;
    const key = this.memoryKey;
    if (key === "") return;
    const out = this.resolvedOutput.geometry;
    if (out.width <= 0 || out.height <= 0) return;
    DriverWindow.floatMemory[key] = {
      x: (geometry.x - out.x) / out.width,
      y: (geometry.y - out.y) / out.height,
      w: geometry.width / out.width,
      h: geometry.height / out.height,
    };
  }

  /* A destroyed KwinWindow wrapper reads its properties as undefined or throws
   * instead of exposing deleted === true, so `!deleted` would wrongly report a
   * dead window as alive. Only a valid wrapper reporting deleted === false is
   * alive; a missing/undefined/erroring read means dead. Mirrors outputIsAlive. */
  public isAlive(): boolean {
    try {
      return !!this.window && this.window.deleted === false;
    } catch (_) {
      return false;
    }
  }
  public commit(
    ctx: IDriverContext,
    geometry?: Rect,
    noBorder?: boolean,
    windowLayer?: WindowLayer,
  ) {
    if (!this.window || this.window.deleted) return;
    LOG?.send(
      LogModules.window,
      "KwinWindow#commit",
      `geometry:${geometry}, noBorder:${noBorder}, windowLayer:${windowLayer}`,
    );
    if (this.window.resize) return;

    if (noBorder !== undefined) {
      if (!this.noBorderManaged && noBorder)
        /* Backup border state when transitioning from unmanaged to managed */
        this.noBorderOriginal = this.window.noBorder;
      else if (this.noBorderManaged && !this.window.noBorder)
        /* If border is enabled while in managed mode, remember it.
         * Note that there's no way to know if border is re-disabled in managed mode. */
        this.noBorderOriginal = false;

      if (noBorder)
        /* (Re)entering managed mode: remove border. */
        this.window.noBorder = true;
      else if (this.noBorderManaged)
        /* Exiting managed mode: restore original value. */
        this.window.noBorder = this.noBorderOriginal;

      /* update mode */
      this.noBorderManaged = noBorder;
    }

    if (windowLayer !== undefined) {
      this.layerManaged = true;
      if (windowLayer === WindowLayer.Above) this.window.keepAbove = true;
      else if (windowLayer === WindowLayer.Below) this.window.keepBelow = true;
      else if (windowLayer === WindowLayer.Normal) {
        this.window.keepAbove = false;
        this.window.keepBelow = false;
      }
    }

    if (geometry !== undefined) {
      geometry = this.adjustGeometry(geometry);
      if (KWINCONFIG.preventProtrusion) {
        /* Resolve to a live output first: on the hotplug/resume path the
         * window can still point at a destroyed output, and handing that
         * to workspace.clientArea()/getNeighborOutput() can crash KWin --
         * the very path this fallback exists to avoid. */
        const winOutput = this.resolvedOutput;
        const area = toRect(
          this.workspace.clientArea(
            ClientAreaOption.PlacementArea,
            winOutput,
            this.workspace.currentDesktop,
          ),
        );
        if (
          geometry.x < area.x &&
          ctx.getNeighborOutput("left", winOutput) === null
        ) {
          geometry.x = area.x;
        }
        if (
          geometry.y < area.y &&
          ctx.getNeighborOutput("up", winOutput) === null
        ) {
          geometry.y = area.y;
        }
        if (
          geometry.maxX > area.maxX &&
          ctx.getNeighborOutput("right", winOutput) === null
        ) {
          if (geometry.width > area.width) {
            geometry.x = area.x;
            geometry.width = area.width;
          } else {
            geometry.x = area.maxX - geometry.width;
          }
        }
        if (
          geometry.maxY > area.maxY &&
          ctx.getNeighborOutput("down", winOutput) === null
        ) {
          if (geometry.height > area.height) {
            geometry.y = area.y;
            geometry.height = area.height;
          } else {
            geometry.y = area.maxY - geometry.height;
          }
        }
        geometry = this.adjustGeometry(geometry);
      }
      if (this.window.deleted) return;
      /* Compare with the last request, not with the frame the window settled
       * on: a client can answer with another size for as long as it lives, such
       * as 1075.625 for a request of 1075 at 160% scale, and an arrange that
       * changes nothing is no resize. Without a request to compare with, a
       * difference below one pixel is only that rounding. */
      const baseline = this.lastRequestedGeometry ?? this.window.frameGeometry;
      if (
        Math.abs(geometry.width - baseline.width) >= 1 ||
        Math.abs(geometry.height - baseline.height) >= 1
      )
        ctx.onWindowSizeCommitted(this.window);
      this.lastRequestedGeometry = geometry;
      this.window.frameGeometry = toQRect(geometry);
    } else {
      /* Natively maximized or fullscreen: no size of ours is in effect, so the
       * next request is a resize even if KWin already restored the frame. */
      this.lastRequestedGeometry = new Rect(0, 0, 0, 0);
    }
  }
  /* The window's size is no longer ours to compare against -- it floats, so the
   * user owns it, or the window left the layout. The next request has to be
   * compared with the frame, with the rounding tolerance, instead of with a
   * request that no longer describes the window. */
  public forgetRequestedGeometry(): void {
    this.lastRequestedGeometry = null;
  }
  public toString(): string {
    return `${debugWin(this.window)}`;
  }
  public setMinimizedByScript(minimized: boolean): void {
    if (this.window.deleted) return;
    if (!this.minimizedManaged) {
      // Capture on first write, not construction: the user or application may
      // have changed this state before Monocle first takes control of it.
      this.minimizedOriginal = this.window.minimized;
      this.minimizedManaged = true;
    }
    this.window.minimized = minimized;
  }

  /** Restore only window properties that this driver instance managed. */
  public dispose(): void {
    if (!this.window || this.window.deleted) return;
    try {
      if (this.noBorderManaged) this.window.noBorder = this.noBorderOriginal;
      if (this.layerManaged) {
        this.window.keepAbove = this.keepAboveOriginal;
        this.window.keepBelow = this.keepBelowOriginal;
      }
      if (this.minimizedManaged) this.window.minimized = this.minimizedOriginal;
    } catch (_) {
      /* The KWin window may be destroyed while the runtime is reloading. */
    }
    this.noBorderManaged = false;
    this.layerManaged = false;
    this.minimizedManaged = false;
  }
  public visible(srf: ISurface): boolean {
    const ksrf = srf as KWinSurface;
    return (
      !this.window.deleted &&
      !this.window.minimized &&
      (this.window.onAllDesktops ||
        this.window.desktops.indexOf(ksrf.vDesktop) !== -1) &&
      (this.window.activities.length === 0 /* on all activities */ ||
        this.window.activities.indexOf(ksrf.activity) !== -1) &&
      this.resolvedOutput === ksrf.output
    );
  }
  public updateSrfTime(srfId: string): void {
    if (srfId !== this._srfTime.srfId) {
      this._srfTime.srfId = srfId;
      this._srfTime.time = getTime();
    }
  }
  private _getFloatConfig(window: KwinWindow): DriverFloatConfig {
    const configs = CONFIG.floatConfig.config;
    const defaults: DriverFloatConfig = {
      shouldFloat: false,
      auto: CONFIG.floatAsDefault,
      width: this._nativeFloatGeometry.width,
      height: this._nativeFloatGeometry.height,
      leftIndent: { value: this._nativeFloatGeometry.x, unit: "px" },
      topIndent: { value: this._nativeFloatGeometry.y, unit: "px" },
      stepWidth: CONFIG.floatConfig.sizeStepWidth,
      stepHeight: CONFIG.floatConfig.sizeStepHeight,
    };
    if (!configs || configs.length === 0) return defaults;

    for (const cfg of configs) {
      if (cfg.class) {
        const classes = cfg.class
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c !== "");
        if (classes.length > 0) {
          if (
            !DriverWindow.isContain(classes, window.resourceClass) &&
            !DriverWindow.isContain(classes, window.resourceName)
          )
            continue;
        }
      }

      if (cfg.title) {
        if (!DriverWindow.isContain([cfg.title], window.caption)) continue;
      }

      return {
        shouldFloat: cfg.shouldFloat,
        auto: cfg.auto,
        width: cfg.width ?? this._nativeFloatGeometry.width,
        height: cfg.height ?? this._nativeFloatGeometry.height,
        leftIndent: cfg.leftIndent ?? {
          value: this._nativeFloatGeometry.x,
          unit: "px",
        },
        topIndent: cfg.topIndent ?? {
          value: this._nativeFloatGeometry.y,
          unit: "px",
        },
        stepWidth: cfg.stepWidth ?? CONFIG.floatConfig.sizeStepWidth,
        stepHeight: cfg.stepHeight ?? CONFIG.floatConfig.sizeStepHeight,
      };
    }

    return defaults;
  }
  public static isContain(filterList: string[], s: string): boolean {
    for (let filterWord of filterList) {
      if (
        filterWord.startsWith("[") &&
        filterWord[filterWord.length - 1] === "]"
      ) {
        if (
          s
            .toLowerCase()
            .includes(filterWord.toLowerCase().slice(1, filterWord.length - 1))
        )
          return true;
      } else if (s.toLowerCase() === filterWord.toLowerCase()) return true;
    }
    return false;
  }
  /** apply various resize hints to the given geometry */
  private adjustGeometry(geometry: Rect): Rect {
    let width = geometry.width;
    let height = geometry.height;

    /* do not resize fixed-size windows */
    if (!this.window.resizeable) {
      width = this.window.width;
      height = this.window.height;
    } else {
      const min = this.window.minSize;
      const max = this.window.maxSize;
      width = clip(width, min.width, max.width);
      height = clip(height, min.height, max.height);
    }

    /* a window that can not fill its tile (max size) is centered in it */
    let x = geometry.x;
    let y = geometry.y;
    if (width < geometry.width) x += Math.floor((geometry.width - width) / 2);
    if (height < geometry.height)
      y += Math.floor((geometry.height - height) / 2);

    return new Rect(x, y, width, height);
  }
  /** float geometry from float memory or a window rule, null if none */
  private getPreferredFloatGeometry(): Rect | null {
    /* the popup layer already placed this dialog */
    if (KWINCONFIG.popupLayer) {
      const placed = LayerManager.placedFor(this.id);
      if (placed !== null) return placed;
    }
    const out = this.resolvedOutput.geometry;
    const area = toRect(
      this.workspace.clientArea(
        ClientAreaOption.PlacementArea,
        this.resolvedOutput,
        this.workspace.currentDesktop,
      ),
    );
    const min = this.window.minSize;
    const max = this.window.maxSize;
    const fit = (r: Rect): Rect => {
      let width = clip(r.width, min.width, max.width);
      let height = clip(r.height, min.height, max.height);
      width = Math.min(width, area.width);
      height = Math.min(height, area.height);
      const x = clip(r.x, area.x, area.maxX - width);
      const y = clip(r.y, area.y, area.maxY - height);
      return new Rect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    };

    const mem =
      KWINCONFIG.smartRememberFloat && this.memoryKey !== ""
        ? DriverWindow.floatMemory[this.memoryKey]
        : undefined;
    if (mem !== undefined)
      return fit(
        new Rect(
          out.x + mem.x * out.width,
          out.y + mem.y * out.height,
          mem.w * out.width,
          mem.h * out.height,
        ),
      );

    const rule = this.rule;
    if (rule === null || (rule.floatWidth === undefined && rule.floatPos === undefined)) {
      if (!(KWINCONFIG.smartCenterDialogs && this.isDialogLike)) return null;
      /*
       * Dialogs open at their minimal size, centered on the screen (not on
       * top of their parent window). Dialogs without a useful minimal size
       * keep the size they asked for.
       */
      const min = this.minSize; // frame size incl. decoration
      const useMin = min.width >= 200 && min.height >= 120;
      const width = useMin ? min.width : this.window.width;
      const height = useMin ? min.height : this.window.height;
      return fit(
        new Rect(
          area.x + (area.width - width) / 2,
          area.y + (area.height - height) / 2,
          width,
          height,
        ),
      );
    }
    const width =
      rule.floatWidth !== undefined
        ? WindowRules.resolveLength(rule.floatWidth, area.width)
        : this.window.width;
    const height =
      rule.floatHeight !== undefined
        ? WindowRules.resolveLength(rule.floatHeight, area.height)
        : this.window.height;
    const margin = Math.max(KWINCONFIG.screenGapBetween, 8);
    const pos = rule.floatPos || "center";
    let x = area.x + (area.width - width) / 2;
    let y = area.y + (area.height - height) / 2;
    if (pos.indexOf("left") >= 0) x = area.x + margin;
    if (pos.indexOf("right") >= 0) x = area.maxX - width - margin;
    if (pos.indexOf("top") >= 0) y = area.y + margin;
    if (pos.indexOf("bottom") >= 0) y = area.maxY - height - margin;
    return fit(new Rect(x, y, width, height));
  }

  public _getInitFloatGeometry(): Rect {
    const preferred = this.getPreferredFloatGeometry();
    if (preferred !== null) return preferred;
    /* resolvedOutput, not window.output: this runs from the arrange path
     * (floatGeometry), where a fallback window may still hold a destroyed
     * output whose .geometry read would throw and abort the arrange. */
    let outputGeometry = this.resolvedOutput.geometry;
    if (CONFIG.floatConfig === null) {
      return toRect(outputGeometry);
    }

    const cfg = this.floatConfig;
    const nativeW = this._nativeFloatGeometry.width;
    const nativeH = this._nativeFloatGeometry.height;
    const nativeX = this._nativeFloatGeometry.x;
    const nativeY = this._nativeFloatGeometry.y;

    const cfgWidth = cfg.width ?? nativeW;
    const cfgHeight = cfg.height ?? nativeH;
    const defaultLeft: IndentValue = { value: nativeX, unit: "px" };
    const defaultTop: IndentValue = { value: nativeY, unit: "px" };
    const cfgLeft = cfg.leftIndent ?? defaultLeft;
    const cfgTop = cfg.topIndent ?? defaultTop;

    const hasCustomWidth = cfg.width !== null && cfg.width !== nativeW;
    const hasCustomHeight = cfg.height !== null && cfg.height !== nativeH;
    const hasCustomLeft =
      cfg.leftIndent !== null &&
      (cfg.leftIndent.value !== nativeX || cfg.leftIndent.unit !== "px");
    const hasCustomTop =
      cfg.topIndent !== null &&
      (cfg.topIndent.value !== nativeY || cfg.topIndent.unit !== "px");

    let width = hasCustomWidth
      ? cfgWidth
      : CONFIG.floatConfig.isNativeSizeOverride
        ? outputGeometry.width * (CONFIG.floatConfig.floatWidth / 100)
        : nativeW;
    let height = hasCustomHeight
      ? cfgHeight
      : CONFIG.floatConfig.isNativeSizeOverride
        ? outputGeometry.height * (CONFIG.floatConfig.floatHeight / 100)
        : nativeH;

    let x: number;
    let y: number;

    if (hasCustomLeft) {
      if (cfgLeft.unit === "%") {
        x = outputGeometry.x + outputGeometry.width * (cfgLeft.value / 100);
      } else {
        x = cfgLeft.value;
      }
    } else if (hasCustomWidth) {
      x = outputGeometry.x + outputGeometry.width / 2 - width / 2;
    } else {
      x = outputGeometry.x + outputGeometry.width / 2 - width / 2;
    }

    if (hasCustomTop) {
      if (cfgTop.unit === "%") {
        y = outputGeometry.y + outputGeometry.height * (cfgTop.value / 100);
      } else {
        y = cfgTop.value;
      }
    } else if (hasCustomHeight) {
      y = outputGeometry.y + outputGeometry.height / 2 - height / 2;
    } else {
      y = outputGeometry.y + outputGeometry.height / 2 - height / 2;
    }

    if (!this.window.resizeable) {
      if (this.window.maxSize.width < width) {
        x = x + (width - this.window.maxSize.width) / 2;
        width = this.window.maxSize.width;
      }

      if (this.window.maxSize.height < height) {
        y = y + (height - this.window.maxSize.height) / 2;
        height = this.window.maxSize.height;
      }
    } else {
      if (this.window.minSize.width > outputGeometry.width) {
        width = this.window.minSize.width;
        x = outputGeometry.x;
      }
      if (this.window.minSize.height > outputGeometry.height) {
        height = this.window.minSize.height;
        y = outputGeometry.y;
      }
      if (CONFIG.floatConfig.randomize) {
        x =
          x +
          getRandomInt(
            (x - outputGeometry.x) * (CONFIG.floatConfig.randomWidth / 100),
            true,
          );
        y =
          y +
          getRandomInt(
            (y - outputGeometry.y) * (CONFIG.floatConfig.randomHeight / 100),
            true,
          );
      }
    }

    return new Rect(x, y, width, height);
  }
}
