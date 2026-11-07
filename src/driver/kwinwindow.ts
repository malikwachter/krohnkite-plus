/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class KWinWindow implements IDriverWindow {
  public static generateID(w: Window) {
    return w.internalId.toString();
  }

  /** last floating geometry per window class, relative to its output (session only) */
  private static floatMemory: {
    [cls: string]: { x: number; y: number; w: number; h: number };
  } = {};


  public get isActive(): boolean {
    return this.window.active;
  }

  public get fullScreen(): boolean {
    return this.window.fullScreen;
  }

  public get geometry(): Rect {
    return toRect(this.window.frameGeometry);
  }

  public get windowClassName(): string {
    return this.window.resourceClass;
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
      this.isFloatByConfig ||
      (CONFIG.floatSkipPager && this.window.skipPager) ||
      (KWINCONFIG.floatUtility &&
        (this.window.dialog || this.window.splash || this.window.utility)) ||
      (KWINCONFIG.smartFloat && this.isFloatByHeuristic)
    );
  }

  /**
   * Windows that are almost never meant to be tiled:
   * picture-in-picture players, fixed size windows, overlays that ask to be
   * kept above or that hide from both taskbar and pager.
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
    if (this.initialKeepAbove) return true;
    if (w.skipTaskbar && w.skipPager && !w.normalWindow) return true;
    return false;
  }

  public maximized: boolean;
  public get minimized(): boolean {
    return this.window.minimized;
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
      this.window.output,
      activity,
      vDesktop,
    );
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
    let width = this.window.minSize.width;
    let height = this.window.minSize.height;
    /* minSize is the client size, layouts work with frame geometry */
    const frame = this.window.frameGeometry;
    const client = this.window.clientGeometry;
    if (frame && client) {
      if (width > 0) width += Math.max(0, frame.width - client.width);
      if (height > 0) height += Math.max(0, frame.height - client.height);
    }
    if (this.rule !== null && (this.rule.minWidth || this.rule.minHeight)) {
      const out = this.window.output.geometry;
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
    return {
      width: this.window.maxSize.width,
      height: this.window.maxSize.height,
    };
  }
  public readonly window: Window;
  public readonly id: string;
  public readonly rule: IWindowRule | null;

  private readonly workspace: Workspace;
  private readonly isFloatByConfig: boolean;
  private readonly isIgnoredByConfig: boolean;
  private readonly _surfaceStore: KWinSurfaceStore;
  private _movePointerToCenter: { isMove: boolean; time: number };
  private noBorderManaged: boolean;
  private noBorderOriginal: boolean;
  private readonly initialKeepAbove: boolean;
  /** key for the float memory: "" = do not remember this window */
  private readonly memoryKey: string;

  constructor(
    window: Window,
    workspace: Workspace,
    surfaceStore: KWinSurfaceStore,
  ) {
    this.workspace = workspace;
    this._surfaceStore = surfaceStore;
    this._movePointerToCenter = {
      isMove: false,
      time: 0,
    };
    this.window = window;
    this.id = KWinWindow.generateID(window);
    this.maximized = false;
    this.noBorderManaged = false;
    this.noBorderOriginal = window.noBorder;
    this.initialKeepAbove = window.keepAbove;
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
      KWinWindow.isContain(KWINCONFIG.ignoreClass, window.resourceClass) ||
      KWinWindow.isContain(KWINCONFIG.ignoreClass, window.resourceName) ||
      matchWords(this.window.caption, KWINCONFIG.ignoreTitle) >= 0 ||
      KWinWindow.isContain(KWINCONFIG.ignoreRole, window.windowRole) ||
      (KWINCONFIG.tileNothing &&
        KWinWindow.isContain(KWINCONFIG.tilingClass, window.resourceClass)) ||
      (this.rule !== null && this.rule.state === "ignore");
    this.isFloatByConfig =
      KWinWindow.isContain(KWINCONFIG.floatingClass, window.resourceClass) ||
      KWinWindow.isContain(KWINCONFIG.floatingClass, window.resourceName) ||
      matchWords(this.window.caption, KWINCONFIG.floatingTitle) >= 0 ||
      (this.rule !== null && this.rule.state === "float");
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
    return (
      (KWINCONFIG.smartRememberFloat &&
        this.memoryKey !== "" &&
        KWinWindow.floatMemory[this.memoryKey] !== undefined) ||
      (this.rule !== null &&
        (this.rule.floatWidth !== undefined || this.rule.floatPos !== undefined))
    );
  }

  public rememberFloatGeometry(geometry: Rect) {
    if (!KWINCONFIG.smartRememberFloat) return;
    const key = this.memoryKey;
    if (key === "") return;
    const out = this.window.output.geometry;
    if (out.width <= 0 || out.height <= 0) return;
    KWinWindow.floatMemory[key] = {
      x: (geometry.x - out.x) / out.width,
      y: (geometry.y - out.y) / out.height,
      w: geometry.width / out.width,
      h: geometry.height / out.height,
    };
  }

  public moveMouseToFocus() {
    const time = getTime();
    this._movePointerToCenter.isMove = this.isActive;
    this._movePointerToCenter.time = time;
  }

  public commit(
    geometry?: Rect,
    noBorder?: boolean,
    windowLayer?: WindowLayer,
  ) {
    LOG?.send(
      LogModules.window,
      "KwinWindow#commit",
      `geometry:${geometry}, noBorder:${noBorder}, windowLayer:${windowLayer}`,
    );
    if (this.window.move || this.window.resize) return;

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
        const area = toRect(
          this.workspace.clientArea(
            ClientAreaOption.PlacementArea,
            this.window.output,
            this.workspace.currentDesktop,
          ),
        );
        const winOutput = this.window.output;
        if (
          geometry.x < area.x &&
          KWinDriver.getNeighborOutput(this.workspace, "left", winOutput) ===
          null
        ) {
          geometry.x = area.x;
        }
        if (
          geometry.y < area.y &&
          KWinDriver.getNeighborOutput(this.workspace, "up", winOutput) === null
        ) {
          geometry.y = area.y;
        }
        if (
          geometry.maxX > area.maxX &&
          KWinDriver.getNeighborOutput(this.workspace, "right", winOutput) ===
          null
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
          KWinDriver.getNeighborOutput(this.workspace, "down", winOutput) ===
          null
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
      this.window.frameGeometry = toQRect(geometry);
      if (this._movePointerToCenter.isMove) {
        this._movePointerToCenter.isMove = false;
        if (CONFIG.movePointerOnFocus) {
          if (getTime() - this._movePointerToCenter.time < 100) {
            DBUS.moveMouseToFocus(20);
          }
        }
      }
    }
  }

  public toString(): string {
    return `${debugWin(this.window)}`;
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
      this.window.output === ksrf.output
    );
  }

  //#region Private Methods
  public static isContain(filterList: string[], s: string): boolean {
    for (let filterWord of filterList) {
      if (filterWord[0] === "[" && filterWord[filterWord.length - 1] === "]") {
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
      width = clip(width, this.window.minSize.width, this.window.maxSize.width);
      height = clip(
        height,
        this.window.minSize.height,
        this.window.maxSize.height,
      );
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
    const out = this.window.output.geometry;
    const area = toRect(
      this.workspace.clientArea(
        ClientAreaOption.PlacementArea,
        this.window.output,
        this.workspace.currentDesktop,
      ),
    );
    const fit = (r: Rect): Rect => {
      let width = clip(r.width, this.window.minSize.width, this.window.maxSize.width);
      let height = clip(
        r.height,
        this.window.minSize.height,
        this.window.maxSize.height,
      );
      width = Math.min(width, area.width);
      height = Math.min(height, area.height);
      const x = clip(r.x, area.x, area.maxX - width);
      const y = clip(r.y, area.y, area.maxY - height);
      return new Rect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    };

    const mem =
      KWINCONFIG.smartRememberFloat && this.memoryKey !== ""
        ? KWinWindow.floatMemory[this.memoryKey]
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
    if (rule === null || (rule.floatWidth === undefined && rule.floatPos === undefined))
      return null;
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

  public getInitFloatGeometry(): Rect {
    const preferred = this.getPreferredFloatGeometry();
    if (preferred !== null) return preferred;
    let outputGeometry = this.window.output.geometry;
    if (CONFIG.floatInit === null) {
      return toRect(outputGeometry);
    }
    let width, height, x, y: number;
    width = outputGeometry.width * (CONFIG.floatInit.windowWidth / 100);
    height = outputGeometry.height * (CONFIG.floatInit.windowHeight / 100);
    x = outputGeometry.x + outputGeometry.width / 2 - width / 2;
    y = outputGeometry.y + outputGeometry.height / 2 - height / 2;
    if (
      this.window.minSize.width > outputGeometry.width ||
      this.window.minSize.height > outputGeometry.height
    ) {
      width = this.window.minSize.width;
      height = this.window.minSize.height;
      x = outputGeometry.x;
      y = outputGeometry.y;
    } else if (
      !this.window.resizeable ||
      this.window.maxSize.width < width ||
      this.window.maxSize.height < height
    ) {
      width = this.window.maxSize.width;
      height = this.window.maxSize.height;
      x = outputGeometry.x + outputGeometry.width / 2 - width / 2;
      y = outputGeometry.y + outputGeometry.height / 2 - height / 2;
    } else {
      if (CONFIG.floatInit.randomize) {
        x =
          x +
          getRandomInt(
            (x - outputGeometry.x) * (CONFIG.floatInit.randomWidth / 100),
            true,
          );
        y =
          y +
          getRandomInt(
            (y - outputGeometry.y) * (CONFIG.floatInit.randomHeight / 100),
            true,
          );
      }
    }

    return new Rect(x, y, width, height);
  }
}
