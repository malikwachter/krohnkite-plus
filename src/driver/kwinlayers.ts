/*
    SPDX-License-Identifier: MIT

    Kröhnkite-Plus: window layers above the tiles.

      tray layer    one "quickview" at a time: apps that live in the system
                    tray float square and centered above everything and go
                    back into the tray when something else gets the focus
      popup layer   dialogs and other small windows that programs open,
                    packed around the middle of the screen
      main layer    the tiles (TilingEngine)

    The layers are handled here, next to the engine: popups may or may not
    be managed by the engine (only normal windows are), quickview windows
    never are.
*/

interface ILayerHost {
  readonly workspace: Workspace;
  connect(signal: QSignal, handler: (...args: any[]) => void): void;
  setTimeout(f: () => void, ms: number): void;
  notify(text: string): void;
  stateChanged(): void;
  syncEffect(): void;
  /** take a window out of the layout, it became a quickview */
  releaseFromTiling(client: KwinWindow): void;
  /** give a window back to the layout, it is no quickview any more */
  returnToTiling(client: KwinWindow): void;
}

interface ILayersState {
  quickview?: string[];
  quickviewSizes?: { [cls: string]: { w: number; h: number } };
  popupSizes?: { [key: string]: ISize };
}

interface IPopupEntry {
  client: KwinWindow;
  order: number;
  /** the size this window wants */
  requested: ISize;
  /** requested is a size the user gave it or the app insists on: no floor */
  exact: boolean;
  /** limits seen from the app refusing a size */
  learnedMin: ISize;
  learnedMax: ISize;
  placed: Rect | null;
  /** moved by the user: stays where it was dropped */
  pinned: boolean;
  key: string;
  interactive: "" | "move" | "resize";
  keepAboveManaged: boolean;
  keepAboveOriginal: boolean;
  settleScheduled: boolean;
  fixes: number;
}

interface IQuickviewEntry {
  client: KwinWindow;
  placed: Rect | null;
  /** until when app-made geometry changes are corrected (apps restoring their old place) */
  settleUntil: number;
  fixes: number;
  interactive: "" | "move" | "resize";
  keepAboveOriginal: boolean;
}

class LayerManager {
  /* remembered across configuration reloads and (through state.json) restarts */
  private static quickviewClasses: string[] = [];
  private static quickviewSizes: { [cls: string]: { w: number; h: number } } = {};
  private static popupSizes: { [key: string]: ISize } = {};
  /** placement of the popups, so the engine floats managed popups right there */
  private static placedById: { [id: string]: Rect } = {};

  private popups: Map<string, IPopupEntry>;
  private quickviews: Map<string, IQuickviewEntry>;
  private current: KwinWindow | null;
  private order: number;
  private arrangePending: boolean;

  constructor(private host: ILayerHost) {
    this.popups = new Map();
    this.quickviews = new Map();
    this.current = null;
    this.order = 0;
    this.arrangePending = false;
  }

  /* ============================================================ state */

  public static exportState(): ILayersState {
    return {
      quickview: LayerManager.quickviewClasses.slice(),
      quickviewSizes: JSON.parse(JSON.stringify(LayerManager.quickviewSizes)),
      popupSizes: JSON.parse(JSON.stringify(LayerManager.popupSizes)),
    };
  }

  public static importState(s: ILayersState | undefined) {
    if (!s) return;
    if (Array.isArray(s.quickview))
      LayerManager.quickviewClasses = s.quickview
        .filter((c) => typeof c === "string" && c !== "")
        .map((c) => c.toLowerCase());
    const num = (v: any) => typeof v === "number" && isFinite(v) && v > 0;
    if (s.quickviewSizes)
      for (const k in s.quickviewSizes) {
        const v = s.quickviewSizes[k];
        if (v && num(v.w) && num(v.h) && v.w <= 1 && v.h <= 1)
          LayerManager.quickviewSizes[k] = { w: v.w, h: v.h };
      }
    if (s.popupSizes)
      for (const k in s.popupSizes) {
        const v = s.popupSizes[k];
        if (v && num(v.width) && num(v.height))
          LayerManager.popupSizes[k] = { width: v.width, height: v.height };
      }
  }

  /** classes the effect animates out of / into the tray */
  public static effectClasses(): string[] {
    const out = LayerManager.quickviewClasses.slice();
    KWINCONFIG.windowRules.exactClassesWith((r) => r.quickview === true).forEach((c) => {
      if (out.indexOf(c) < 0) out.push(c);
    });
    return out.filter((c) => /^[a-z0-9._-]+$/.test(c));
  }

  /** where the popup layer put this window (engine: float exactly there) */
  public static placedFor(id: string): Rect | null {
    const r = LayerManager.placedById[id];
    return r ? r.clone() : null;
  }

  /* ============================================================ classify */

  public static classOf(c: KwinWindow): string {
    return (c.resourceClass || c.resourceName || "").toLowerCase();
  }

  private static idOf(c: KwinWindow): string {
    return c.internalId.toString();
  }

  /** windows that never count as "somewhere else" for the quickview */
  private static isNeutral(c: KwinWindow): boolean {
    if (c.desktopWindow) return false; // a click on the desktop does close it
    const cls = LayerManager.classOf(c);
    return (
      c.dock ||
      c.popupWindow ||
      c.notification ||
      c.criticalNotification ||
      c.onScreenDisplay ||
      c.appletPopup ||
      c.tooltip ||
      c.specialWindow ||
      cls === "plasmashell" ||
      cls === "org.kde.plasmashell" ||
      cls.indexOf("kwin") === 0
    );
  }

  private static rootOf(c: KwinWindow): KwinWindow {
    let w = c;
    for (let i = 0; i < 10 && w.transient && w.transientFor; i++) w = w.transientFor;
    return w;
  }

  private static isTransientOf(c: KwinWindow, owner: KwinWindow): boolean {
    let w: KwinWindow | null = c;
    for (let i = 0; w && i < 10; i++) {
      if (!w.transient) return false;
      w = w.transientFor;
      if (w === owner) return true;
    }
    return false;
  }

  private static ruleOf(c: KwinWindow): IWindowRule | null {
    return KWINCONFIG.windowRules.match({
      resourceClass: c.resourceClass,
      resourceName: c.resourceName,
      desktopFileName: c.desktopFileName,
      caption: c.caption,
      windowRole: c.windowRole,
    });
  }

  public isQuickviewClient(c: KwinWindow | null): boolean {
    if (!c || c.deleted) return false;
    if (!c.normalWindow || c.transient || c.modal || c.dialog) return false;
    if (c.dock || c.desktopWindow || c.specialWindow || c.popupWindow) return false;
    const cls = LayerManager.classOf(c);
    if (cls === "") return false;
    if (LayerManager.quickviewClasses.indexOf(cls) >= 0) return true;
    const rule = LayerManager.ruleOf(c);
    return rule !== null && rule.quickview === true;
  }

  /** dialogs, file pickers, message boxes ... of other programs */
  public isPopupClient(c: KwinWindow): boolean {
    if (!KWINCONFIG.popupLayer) return false;
    if (c.deleted || c.dock || c.desktopWindow || c.popupWindow || c.specialWindow) return false;
    if (c.fullScreen || !c.moveable) return false;
    if (!(c.dialog || c.modal || c.transient)) return false;
    if (!(c.normalWindow || c.dialog || c.utility)) return false;
    /* tool palettes of image editors and the like stay where the app wants them */
    if (c.utility && !c.dialog && !c.modal) return false;
    const cls = LayerManager.classOf(c);
    if (cls === "plasmashell" || cls === "org.kde.plasmashell" || cls.indexOf("kwin") === 0)
      return false;
    if (DriverWindow.isGame(c)) return false;
    if (
      DriverWindow.isContain(KWINCONFIG.ignoreClass, c.resourceClass || "") ||
      DriverWindow.isContain(KWINCONFIG.ignoreClass, c.resourceName || "")
    )
      return false;
    const rule = LayerManager.ruleOf(c);
    if (rule !== null && rule.state === "ignore") return false;
    return true;
  }

  /* ============================================================ events */

  /**
   * A window appeared (or existed when the script started).
   * Returns true if the window belongs to the tray layer: then it is not tiled.
   */
  public onWindowAdded(c: KwinWindow, atStart: boolean): boolean {
    if (!c || c.deleted) return false;
    if (this.isQuickviewClient(c)) {
      this.adoptQuickview(c);
      if (!c.minimized && (!atStart || c.active)) this.present(c);
      return true;
    }
    if (this.isPopupClient(c)) this.addPopup(c, atStart);
    return false;
  }

  /** the engine committed a managed popup with its own layer: the popup layer is above */
  public afterManaged(c: KwinWindow) {
    const e = this.popups.get(LayerManager.idOf(c));
    if (e && e.keepAboveManaged && !c.deleted) c.keepAbove = true;
  }

  public onWindowRemoved(c: KwinWindow) {
    if (!c) return;
    const id = LayerManager.idOf(c);
    if (this.popups.has(id)) {
      this.popups.delete(id);
      delete LayerManager.placedById[id];
      this.arrangeSoon();
    }
    this.quickviews.delete(id);
    if (this.current === c) this.current = null;
  }

  public onWindowActivated(c: KwinWindow) {
    if (!c || c.deleted) return;
    if (this.isQuickviewClient(c)) {
      if (this.current !== c && !c.minimized) this.present(c);
      return;
    }
    const cur = this.current;
    if (cur === null) return;
    if (cur.deleted) {
      this.current = null;
      return;
    }
    if (LayerManager.isNeutral(c)) return;
    /* its own dialogs (master password, settings) do not close it */
    if (LayerManager.isTransientOf(c, cur)) return;
    this.dismiss(cur);
  }

  /** the saved state arrived after the windows were added: move quickview apps out of the tiles */
  public reclassify() {
    this.host.workspace.stackingOrder.forEach((c) => {
      if (!this.isQuickviewClient(c)) return;
      this.host.releaseFromTiling(c);
      this.adoptQuickview(c);
    });
  }

  public onDesktopChanged() {
    this.arrangeSoon();
  }

  /** the quickview shortcut: the app of the active window lives in the tray (or not any more) */
  public toggleQuickview(active: KwinWindow | null) {
    if (!active || active.deleted) {
      this.host.notify("Quickview: no window is active");
      return;
    }
    const root = LayerManager.rootOf(active);
    const cls = LayerManager.classOf(root);
    if (cls === "" || !root.normalWindow) {
      this.host.notify("Quickview: this window can not be a quickview");
      return;
    }
    const name = root.resourceClass || cls;
    const sameApp = (c: KwinWindow) =>
      !c.deleted && LayerManager.classOf(c) === cls && c.normalWindow && !c.transient && !c.dialog;
    const i = LayerManager.quickviewClasses.indexOf(cls);
    if (i < 0 && this.isQuickviewClient(root)) {
      this.host.notify(`Quickview for ${name} comes from a window rule`);
      return;
    }
    const clients = this.host.workspace.stackingOrder.filter(sameApp);
    if (i >= 0) {
      LayerManager.quickviewClasses.splice(i, 1);
      clients.forEach((c) => {
        const q = this.quickviews.get(LayerManager.idOf(c));
        if (q) c.keepAbove = q.keepAboveOriginal;
        this.quickviews.delete(LayerManager.idOf(c));
        if (this.current === c) this.current = null;
        this.host.returnToTiling(c);
      });
      this.host.notify(`Quickview off: ${name} is tiled again`);
    } else {
      LayerManager.quickviewClasses.push(cls);
      clients.forEach((c) => {
        this.host.releaseFromTiling(c);
        this.adoptQuickview(c);
      });
      this.present(root);
      this.host.notify(`Quickview on: ${name} opens over everything and hides again on a click outside`);
    }
    this.host.stateChanged();
    this.host.syncEffect();
  }

  public dispose() {
    this.popups.forEach((e) => {
      try {
        if (e.keepAboveManaged && !e.client.deleted) e.client.keepAbove = e.keepAboveOriginal;
      } catch (_) {
        /* destroyed meanwhile */
      }
    });
    this.quickviews.forEach((q) => {
      try {
        if (!q.client.deleted) q.client.keepAbove = q.keepAboveOriginal;
      } catch (_) {
        /* destroyed meanwhile */
      }
    });
    this.popups.clear();
    this.quickviews.clear();
    this.current = null;
  }

  /* ============================================================ tray layer */

  private adoptQuickview(c: KwinWindow) {
    const id = LayerManager.idOf(c);
    if (this.quickviews.has(id)) return;
    const q: IQuickviewEntry = {
      client: c,
      placed: null,
      settleUntil: 0,
      fixes: 0,
      interactive: "",
      keepAboveOriginal: c.keepAbove,
    };
    this.quickviews.set(id, q);
    const h = this.host;
    h.connect(c.minimizedChanged, () => {
      if (c.deleted || !this.isQuickviewClient(c)) return;
      if (!c.minimized) this.present(c);
      else if (this.current === c) this.current = null;
    });
    h.connect(c.moveResizedChanged, () => {
      if (c.deleted || !this.quickviews.has(id)) return;
      if (c.move || c.resize) {
        q.interactive = c.resize ? "resize" : "move";
        return;
      }
      const was = q.interactive;
      q.interactive = "";
      if (was !== "resize") return;
      /* the user gave it a new size: remember it for this app, stay centered */
      const area = this.areaOf(c);
      const f = c.frameGeometry;
      LayerManager.quickviewSizes[LayerManager.classOf(c)] = {
        w: Math.min(1, f.width / area.width),
        h: Math.min(1, f.height / area.height),
      };
      this.host.stateChanged();
      this.placeQuickview(q);
    });
    h.connect(c.frameGeometryChanged, () => {
      /* apps that restore their old place right after showing (Electron) */
      if (c.deleted || q.placed === null || q.interactive !== "" || this.current !== c) return;
      if (getTime() > q.settleUntil || q.fixes >= 5) return;
      if (LayerManager.close(toRect(c.frameGeometry), q.placed)) return;
      q.fixes++;
      this.host.setTimeout(() => {
        if (this.current === c && !c.deleted && q.placed && !LayerManager.close(toRect(c.frameGeometry), q.placed))
          c.frameGeometry = toQRect(q.placed);
      }, 30);
    });
  }

  /** bring the quickview up: square, centered, above everything, focused */
  private present(c: KwinWindow) {
    const id = LayerManager.idOf(c);
    if (!this.quickviews.has(id)) this.adoptQuickview(c);
    const q = this.quickviews.get(id) as IQuickviewEntry;
    const prev = this.current;
    this.current = c;
    /* one quickview at a time (a second window of the same app may join it) */
    if (prev !== null && prev !== c && !prev.deleted && LayerManager.classOf(prev) !== LayerManager.classOf(c))
      this.dismiss(prev);
    const ws = this.host.workspace;
    try {
      const target = ws.activeScreen;
      if (target && c.output !== target && c.moveableAcrossScreens !== false)
        ws.sendClientToScreen(c, target);
    } catch (_) {
      /* the screen went away meanwhile: stay where it is */
    }
    if (c.minimized) c.minimized = false;
    c.keepAbove = true;
    q.settleUntil = getTime() + 1500;
    q.fixes = 0;
    this.placeQuickview(q);
    if (typeof ws.raiseWindow === "function") ws.raiseWindow(c);
    if (ws.activeWindow !== c) ws.activeWindow = c;
  }

  private placeQuickview(q: IQuickviewEntry) {
    const c = q.client;
    if (c.deleted || c.fullScreen) return;
    const area = this.areaOf(c);
    const rect = LayerGeometry.quickviewRect(
      area,
      KWINCONFIG.zoomMarginX,
      KWINCONFIG.zoomMarginY,
      LayerManager.quickviewSizes[LayerManager.classOf(c)] || null,
      LayerManager.frameMin(c, null),
      LayerManager.frameMax(c, null),
    );
    q.placed = rect;
    if (!LayerManager.close(toRect(c.frameGeometry), rect)) c.frameGeometry = toQRect(rect);
  }

  /** back into the tray */
  private dismiss(c: KwinWindow) {
    if (this.current === c) this.current = null;
    if (c.deleted) return;
    if (KWINCONFIG.quickviewHide === 0 && c.closeable !== false) c.closeWindow();
    else if (c.minimizable !== false) c.minimized = true;
  }

  /* ============================================================ popup layer */

  private static popupKey(c: KwinWindow): string {
    const caption = (c.caption || "").replace(/[0-9]+/g, "#").toLowerCase();
    return `${LayerManager.classOf(c)}|${c.windowRole || ""}|${caption}`;
  }

  private addPopup(c: KwinWindow, atStart: boolean) {
    const id = LayerManager.idOf(c);
    if (this.popups.has(id)) return;
    const f = c.frameGeometry;
    const key = LayerManager.popupKey(c);
    const mem = LayerManager.popupSizes[key];
    const e: IPopupEntry = {
      client: c,
      order: this.order++,
      requested: mem ? { width: mem.width, height: mem.height } : { width: f.width, height: f.height },
      exact: mem !== undefined,
      learnedMin: { width: 0, height: 0 },
      learnedMax: { width: 0, height: 0 },
      placed: null,
      /* windows that were already open keep their place */
      pinned: atStart,
      key,
      interactive: "",
      keepAboveManaged: false,
      keepAboveOriginal: c.keepAbove,
      settleScheduled: false,
      fixes: 0,
    };
    this.popups.set(id, e);
    if (KWINCONFIG.popupKeepAbove && !atStart) {
      e.keepAboveManaged = true;
      c.keepAbove = true;
    }
    const h = this.host;
    h.connect(c.moveResizedChanged, () => {
      if (c.deleted || !this.popups.has(id)) return;
      if (c.move || c.resize) {
        e.interactive = c.resize ? "resize" : "move";
        return;
      }
      const was = e.interactive;
      e.interactive = "";
      if (was === "move") {
        /* dropped somewhere by hand: it stays there, the others close up */
        e.pinned = true;
        delete LayerManager.placedById[id];
      } else if (was === "resize") {
        const g = c.frameGeometry;
        e.requested = { width: g.width, height: g.height };
        e.exact = true;
        LayerManager.popupSizes[e.key] = { width: g.width, height: g.height };
        this.host.stateChanged();
      }
      this.arrange();
    });
    h.connect(c.frameGeometryChanged, () => {
      if (c.deleted || e.pinned || e.interactive !== "" || e.settleScheduled) return;
      e.settleScheduled = true;
      this.host.setTimeout(() => this.settle(e), 250);
    });
    if (!atStart) {
      this.arrange();
      /* Wayland clients may announce their size a moment later */
      e.settleScheduled = true;
      this.host.setTimeout(() => this.settle(e), 250);
    }
  }

  /** the window answered with another size or place than it was given */
  private settle(e: IPopupEntry) {
    e.settleScheduled = false;
    const c = e.client;
    if (c.deleted || e.pinned || e.interactive !== "" || e.placed === null) return;
    if (!this.popups.has(LayerManager.idOf(c))) return;
    const f = toRect(c.frameGeometry);
    const p = e.placed;
    if (Math.abs(f.width - p.width) > 2 || Math.abs(f.height - p.height) > 2) {
      /* the app insists on its size: learn its limits, take the size */
      if (f.width > p.width + 2) e.learnedMin.width = f.width;
      if (f.height > p.height + 2) e.learnedMin.height = f.height;
      if (f.width < p.width - 2) e.learnedMax.width = f.width;
      if (f.height < p.height - 2) e.learnedMax.height = f.height;
      e.requested = { width: f.width, height: f.height };
      e.exact = true;
      this.arrange();
    } else if (!LayerManager.close(f, p) && e.fixes < 4) {
      e.fixes++;
      c.frameGeometry = toQRect(p);
    }
  }

  private arrangeSoon() {
    if (this.arrangePending) return;
    this.arrangePending = true;
    this.host.setTimeout(() => {
      this.arrangePending = false;
      this.arrange();
    }, 0);
  }

  /** pack the popups of every screen around its middle */
  public arrange() {
    if (!KWINCONFIG.popupLayer) return;
    const ws = this.host.workspace;
    const desk = ws.currentDesktop;
    const byOutput = new Map<string, { out: Output; list: IPopupEntry[] }>();
    this.popups.forEach((e) => {
      const c = e.client;
      if (c.deleted || e.pinned || e.interactive !== "" || c.minimized || c.fullScreen) return;
      if (!(c.onAllDesktops || !c.desktops || c.desktops.length === 0 || c.desktops.indexOf(desk) >= 0))
        return;
      const out = c.output;
      if (!out) return;
      const k = out.name;
      if (!byOutput.has(k)) byOutput.set(k, { out, list: [] });
      (byOutput.get(k) as { out: Output; list: IPopupEntry[] }).list.push(e);
    });
    byOutput.forEach(({ out, list }) => {
      list.sort((a, b) => a.order - b.order);
      const area = toRect(ws.clientArea(ClientAreaOption.PlacementArea, out, desk));
      const floor = { width: KWINCONFIG.popupMinWidth, height: KWINCONFIG.popupMinHeight };
      const mins = list.map((e) => LayerManager.frameMin(e.client, e.learnedMin));
      const sizes = list.map((e, i) => {
        if (!e.client.resizeable) {
          const g = e.client.frameGeometry;
          return { width: g.width, height: g.height };
        }
        return LayerGeometry.popupSize(
          e.requested,
          mins[i],
          LayerManager.frameMax(e.client, e.learnedMax),
          area,
          floor,
          e.exact,
        );
      });
      const gap = Math.max(KWINCONFIG.screenGapBetween, 8);
      const rects = LayerGeometry.packPopups(sizes, mins, area, gap);
      list.forEach((e, i) => {
        const r = rects[i];
        e.placed = r;
        LayerManager.placedById[LayerManager.idOf(e.client)] = r;
        if (!LayerManager.close(toRect(e.client.frameGeometry), r))
          e.client.frameGeometry = toQRect(r);
      });
    });
  }

  /* ============================================================ helpers */

  private areaOf(c: KwinWindow): Rect {
    const ws = this.host.workspace;
    return toRect(ws.clientArea(ClientAreaOption.PlacementArea, c.output, ws.currentDesktop));
  }

  private static deco(c: KwinWindow): ISize {
    const f = c.frameGeometry;
    const i = c.clientGeometry;
    if (!f || !i) return { width: 0, height: 0 };
    return { width: Math.max(0, f.width - i.width), height: Math.max(0, f.height - i.height) };
  }

  /** minimal frame size (KWin reports the client size) */
  private static frameMin(c: KwinWindow, learned: ISize | null): ISize {
    const d = LayerManager.deco(c);
    const m = c.minSize || { width: 0, height: 0 };
    return {
      width: Math.max(m.width > 0 ? m.width + d.width : 0, learned ? learned.width : 0),
      height: Math.max(m.height > 0 ? m.height + d.height : 0, learned ? learned.height : 0),
    };
  }

  private static frameMax(c: KwinWindow, learned: ISize | null): ISize {
    const d = LayerManager.deco(c);
    const m = c.maxSize || { width: 0, height: 0 };
    const one = (v: number, dv: number, l: number) => {
      let r = v > 0 && v < 100000 ? v + dv : 0;
      if (l > 0) r = r > 0 ? Math.min(r, l) : l;
      return r;
    };
    return {
      width: one(m.width, d.width, learned ? learned.width : 0),
      height: one(m.height, d.height, learned ? learned.height : 0),
    };
  }

  private static close(a: Rect, b: Rect): boolean {
    return (
      Math.abs(a.x - b.x) <= 2 &&
      Math.abs(a.y - b.y) <= 2 &&
      Math.abs(a.width - b.width) <= 2 &&
      Math.abs(a.height - b.height) <= 2
    );
  }
}
