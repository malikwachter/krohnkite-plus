/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class WindowStore {
  public list: WindowClass[];
  /** Previous master per surface id, used to toggle back via SetMaster. */
  private _prevMaster: Map<string, WindowClass>;

  constructor(windows?: WindowClass[]) {
    this.list = windows || [];
    this._prevMaster = new Map();
  }

  public move(srcWin: WindowClass, destWin: WindowClass, after?: boolean) {
    const srcIdx = this.list.indexOf(srcWin);
    const destIdx = this.list.indexOf(destWin);
    if (srcIdx === -1 || destIdx === -1) return;

    this.list.splice(srcIdx, 1);
    this.list.splice(after ? destIdx + 1 : destIdx, 0, srcWin);
  }
  public moveNew(srcWin: WindowClass, destWin: WindowClass, after?: boolean) {
    const srcIdx = this.list.indexOf(srcWin);
    const destIdx = this.list.indexOf(destWin);
    if (srcIdx === -1 || destIdx === -1) return;

    if (srcIdx > destIdx) {
      this.list.splice(srcIdx, 1);
      this.list.splice(after ? destIdx + 1 : destIdx, 0, srcWin);
    } else if (destIdx > srcIdx) {
      this.list.splice(srcIdx, 1);
      this.list.splice(after ? destIdx : destIdx - 1, 0, srcWin);
    }
  }
  public moveGroup(
    windows: WindowClass[],
    destWin: WindowClass,
    after?: boolean,
  ) {
    const removed: WindowClass[] = [];
    for (const win of windows) {
      const idx = this.list.indexOf(win);
      if (idx >= 0) removed.push(this.list.splice(idx, 1)[0]);
    }
    if (removed.length === 0) return;
    const destIdx = this.list.indexOf(destWin);
    if (destIdx === -1) {
      this.list.push(...removed);
      return;
    }
    this.list.splice(after ? destIdx + 1 : destIdx, 0, ...removed);
  }

  public getWindowById(id: string): WindowClass | null {
    let idx = this.list.map((w) => w.id).indexOf(id);
    return idx < 0 ? null : this.list[idx];
  }

  /** First window on the same surface, i.e. that surface's master. */
  public surfaceMaster(window: WindowClass): WindowClass | null {
    const id = window.surface.id;
    for (const win of this.list) {
      if (win.surface.id === id) return win;
    }
    return null;
  }

  /** Previous master of this surface, if still usable. */
  public getPrevMaster(window: WindowClass): WindowClass | null {
    const id = window.surface.id;
    const prev = this._prevMaster.get(id);
    if (
      prev === undefined ||
      prev === window ||
      !prev.isAlive() ||
      this.list.indexOf(prev) === -1 ||
      prev.surface.id !== id
    ) {
      this._prevMaster.delete(id);
      return null;
    }
    return prev;
  }

  /** Record `prev` as the previous master of the surface of `window`. */
  public setPrevMaster(window: WindowClass, prev: WindowClass): void {
    if (prev === null || prev === window || !prev.isAlive()) return;
    const id = window.surface.id;
    if (prev.surface.id !== id || this.list.indexOf(prev) === -1) return;
    this._prevMaster.set(id, prev);
  }

  public setMaster(window: WindowClass) {
    if (this.list.indexOf(window) === -1) return;
    const id = window.surface.id;
    const master = this.surfaceMaster(window);
    if (master === null || master === window) {
      const prev = this.getPrevMaster(window);
      if (prev === null) return;
      this.swap(window, prev);
      this._prevMaster.set(id, window);
      return;
    }
    this._prevMaster.set(id, master);
    this.swap(window, master);
  }

  public swap(alpha: WindowClass, beta: WindowClass) {
    const alphaIndex = this.list.indexOf(alpha);
    const betaIndex = this.list.indexOf(beta);
    if (alphaIndex < 0 || betaIndex < 0) return;

    this.list[alphaIndex] = beta;
    this.list[betaIndex] = alpha;
  }

  //#region Storage Operation

  public get length(): number {
    return this.list.length;
  }

  public at(idx: number) {
    return this.list[idx];
  }

  public indexOf(window: WindowClass) {
    return this.list.indexOf(window);
  }

  public push(window: WindowClass) {
    this.list.push(window);
  }

  public beside_first(window: WindowClass) {
    this.list.splice(1, 0, window);
  }

  public remove(window: WindowClass) {
    const idx = this.list.indexOf(window);
    if (idx >= 0) this.list.splice(idx, 1);
    for (const [id, prev] of this._prevMaster) {
      if (prev === window) this._prevMaster.delete(id);
    }
  }

  public unshift(window: WindowClass) {
    this.list.unshift(window);
  }

  /** Return all visible "Tile" and "Docked" windows on the given surface. */
  public getVisibleTilesOrDocked(srf: ISurface): WindowClass[] {
    return this.list.filter(
      (win) => win.visible(srf) && (win.isTiled || win.isDocked),
    );
  }
  /** Return all visible "Tile" and "Float" windows on the given surface. */
  public getVisibleTilesOrFloat(srf: ISurface): WindowClass[] {
    return this.list.filter(
      (win) => win.visible(srf) && (win.isTiled || win.isFloating),
    );
  }
  /** Return all visible "Float" and "Docked" windows on the given surface. */
  public getVisibleFloatOrDocked(srf: ISurface): WindowClass[] {
    return this.list.filter(
      (win) => win.visible(srf) && (win.isFloating || win.isDocked),
    );
  }
  /** Return all visible "Tile" windows on the given surface. */
  public getVisibleTiles(srf: ISurface): WindowClass[] {
    return this.list.filter((win) => win.isTiled && win.visible(srf));
  }
  /** Return all visible "Tile" windows on the given surface. */
  public getVisibleDocked(srf: ISurface): WindowClass[] {
    return this.list.filter((win) => win.isDocked && win.visible(srf));
  }
  /** Return all visible "Float" windows on the given surface. */
  public getVisibleFloat(srf: ISurface): WindowClass[] {
    return this.list.filter((win) => win.isFloating && win.visible(srf));
  }

  /** Returns all visible windows on the given surface. */
  public getVisibleWindows(srf: ISurface): WindowClass[] {
    return this.list.filter((win) => win.visible(srf));
  }

  /**
   * Return all visible "tileable" windows on the given surface
   * @see WindowClass#isTileable
   */
  public getVisibleTileables(srf: ISurface): WindowClass[] {
    return this.list.filter((win) => win.isTileable && win.visible(srf));
  }

  //#endregion
}
