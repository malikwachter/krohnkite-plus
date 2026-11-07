/*
    SPDX-License-Identifier: MIT

    Undo / Redo (Meta+Ctrl+Z / Meta+Ctrl+Y).

    A step is the state right before a user action (a shortcut, or a window
    moved / resized with the mouse) whenever that action changed something:
    window order, floating/tiling, floating geometry, monitor, the selected
    layout and the Smart layout's sizes. Snapshots are only taken around user
    actions, never on plain arranges. Windows opening or closing are no step:
    snapshots are compared on the windows both of them know.
*/

class UndoHistory {
  /** a change this long after a user action still belongs to it (async moves) */
  private static readonly ACTION_WINDOW = 800;
  /** a move/resize that never reports its end must not stop undo forever */
  private static readonly HOLD_TIMEOUT = 120000;

  private undoStack: IUndoSnapshot[] = [];
  private redoStack: IUndoSnapshot[] = [];
  /** the state right before the current user action (null: none pending) */
  private base: IUndoSnapshot | null = null;
  /** a user action happened at this time: the next change becomes a step */
  private actionAt = 0;
  /** a window is being moved/resized with the mouse: wait for the end */
  private holdAt = 0;
  /** the pending action could not be checked yet (a drag was running): keep its base */
  private blocked = false;

  constructor(private engine: TilingEngine) {}

  public set hold(on: boolean) {
    this.holdAt = on ? getTime() : 0;
  }
  public get hold(): boolean {
    return this.holdAt !== 0 && getTime() - this.holdAt < UndoHistory.HOLD_TIMEOUT;
  }

  public get undoSteps(): number {
    return this.undoStack.length;
  }
  public get redoSteps(): number {
    return this.redoStack.length;
  }

  /** call right before a user action (shortcut, ...) */
  public markUserAction() {
    const now = getTime();
    // fresh, unless an earlier action is still waiting to be checked (drag ran)
    if (this.base === null || !this.blocked) this.setBase(this.snapshot());
    this.actionAt = now;
  }

  /** a window starts being moved/resized with the mouse */
  public beginMouseAction() {
    if (this.base === null || !this.blocked) this.setBase(this.snapshot());
    this.hold = true;
  }

  /** ... and is released: the change becomes one step */
  public endMouseAction() {
    this.hold = false;
    if (this.base !== null) this.actionAt = getTime();
  }

  /** after every arrange and user action: record a step if the user changed something */
  public observe(reason: string) {
    if (this.actionAt === 0) return;
    if (this.hold || this.engine.dragWindow !== null) {
      this.blocked = true; // check once the mouse is released
      return;
    }
    const base = this.base;
    if (base === null || (!this.blocked && getTime() - this.actionAt > UndoHistory.ACTION_WINDOW)) {
      this.actionAt = 0;
      this.setBase(null);
      return;
    }
    this.blocked = false; // checked now
    if (!UndoHistory.differs(base, this.snapshot())) return; // maybe later (async move)
    this.actionAt = 0;
    this.setBase(null);
    this.undoStack.push(base);
    while (this.undoStack.length > CONFIG.undoDepth) this.undoStack.shift();
    this.redoStack = [];
  }

  /** undo (redo=false) or redo the last step. Returns false if there was nothing to do. */
  public undo(ctx: IDriverContext, redo: boolean): boolean {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    this.actionAt = 0;
    this.setBase(null);
    this.engine.unzoom();
    const cur = this.snapshot();
    while (from.length > 0) {
      const target = from.pop() as IUndoSnapshot;
      if (!UndoHistory.differs(target, cur)) continue; // its windows are gone
      to.push(cur);
      this.restore(ctx, target);
      return true;
    }
    return false;
  }

  private setBase(base: IUndoSnapshot | null) {
    this.base = base;
    this.blocked = false;
  }

  public snapshot(): IUndoSnapshot {
    const wins: IUndoWindow[] = [];
    this.engine.windows.list.forEach((w) => {
      const state = w.state;
      const tiled = state === WindowState.Tiled;
      const floating = state === WindowState.Floating;
      let output = "";
      try {
        output = w.surface.output.name;
      } catch (e) {
        /* window without output (closing) */
      }
      const g = floating ? w.actualGeometry : null;
      wins.push({
        id: w.id,
        output,
        state: tiled ? "tile" : floating ? "float" : "other",
        float: g === null ? null : [g.x, g.y, g.width, g.height],
      });
    });
    let layouts = "";
    try {
      layouts = JSON.stringify(this.engine.layouts.exportState());
    } catch (e) {
      /* ignore */
    }
    return { wins, layouts };
  }

  /** compare two snapshots on the windows both know (opening/closing is no step) */
  private static key(s: IUndoSnapshot, ids: { [id: string]: boolean }): string {
    return (
      s.wins
        .filter((w) => ids[w.id])
        .map((w) => `${w.id}@${w.output}:${w.state}:${w.float ? w.float.join(",") : ""}`)
        .join("|") +
      "#" +
      s.layouts
    );
  }

  public static differs(a: IUndoSnapshot, b: IUndoSnapshot): boolean {
    if (a.layouts !== b.layouts) return true;
    const inA: { [id: string]: boolean } = {};
    a.wins.forEach((w) => (inA[w.id] = true));
    const both: { [id: string]: boolean } = {};
    b.wins.forEach((w) => {
      if (inA[w.id]) both[w.id] = true;
    });
    return UndoHistory.key(a, both) !== UndoHistory.key(b, both);
  }

  private restore(ctx: IDriverContext, snap: IUndoSnapshot) {
    const engine = this.engine;
    const byId: { [id: string]: WindowClass } = {};
    engine.windows.list.forEach((w) => (byId[w.id] = w));
    const known = snap.wins.filter((s) => byId[s.id] !== undefined);

    /* window order */
    engine.applyOrder(known.map((s) => byId[s.id]));

    /* floating / tiling and floating geometry */
    known.forEach((s) => {
      const w = byId[s.id];
      if (s.state === "other") return;
      const rect = s.float ? new Rect(s.float[0], s.float[1], s.float[2], s.float[3]) : null;
      if (s.state === "float") {
        if (rect !== null) w.floatGeometry = rect;
        if (w.state === WindowState.Floating) {
          if (rect !== null && !w.actualGeometry.equals(rect)) w.forceSetGeometry(rect);
        } else w.state = WindowState.Floating;
      } else if (w.state !== WindowState.Tiled) w.state = WindowState.Tiled;
    });

    /* layouts and sizes */
    if (snap.layouts !== "") {
      try {
        engine.layouts.importState(JSON.parse(snap.layouts), true);
      } catch (e) {
        /* ignore */
      }
    }

    /* monitors */
    const outputs: { [name: string]: Output } = {};
    ctx.currentSurfaces.forEach((srf) => (outputs[srf.output.name] = srf.output));
    const moves: [Output, WindowClass[]][] = [];
    known.forEach((s) => {
      const w = byId[s.id];
      let now = "";
      try {
        now = w.surface.output.name;
      } catch (e) {
        return;
      }
      if (s.output === "" || s.output === now || !outputs[s.output]) return;
      let entry = moves.find((m) => m[0] === outputs[s.output]);
      if (!entry) moves.push((entry = [outputs[s.output], []]));
      entry[1].push(w);
    });
    if (moves.length > 0) ctx.moveWindowsToScreen(moves); // arranges afterwards
    else engine.arrange(ctx, "undo");
  }
}
