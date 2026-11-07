/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

/**
 * Provides contextual information and operations to Layout layer.
 *
 * Its purpose is to limit the visibility of information and operation. It's
 * not really a find-grained control mechanism, but is simple and concise.
 */

class EngineContext {
  public get backend(): string {
    return this.drvctx.backend;
  }

  public get currentWindow(): WindowClass | null {
    return this.drvctx.currentWindow;
  }

  public set currentWindow(window: WindowClass | null) {
    this.drvctx.currentWindow = window;
  }

  public raiseWindow(window: WindowClass): void {
    this.drvctx.raiseWindow(window);
  }

  public get cursorPos(): QPoint | null {
    return this.drvctx.cursorPosition;
  }

  public get surfaceParams(): string {
    let srf = this.drvctx.currentSurface;
    return (srf.output.name, srf.activity, srf.vDesktop.name);
  }

  constructor(
    private drvctx: IDriverContext,
    private engine: TilingEngine,
  ) {}

  public setTimeout(func: () => void, timeout: number): void {
    this.drvctx.setTimeout(func, timeout);
  }

  public cycleFocus(step: -1 | 1) {
    this.engine.focusOrder(this.drvctx, step);
  }

  public moveWindowByWinId(
    window: WindowClass,
    targetId: string,
    after?: boolean,
  ) {
    let target = this.engine.windows.getWindowById(targetId);
    if (target === null) return;
    this.engine.windows.moveNew(window, target, after);
  }
  public getWindowById(id: string): WindowClass | null {
    return this.engine.windows.getWindowById(id);
  }

  public setPrevMaster(window: WindowClass, prev: WindowClass): void {
    this.engine.windows.setPrevMaster(window, prev);
  }

  public getPrevMaster(window: WindowClass): WindowClass | null {
    return this.engine.windows.getPrevMaster(window);
  }

  public showNotification(text: string) {
    this.drvctx.showNotification(text);
  }

  public showLayoutOSD() {
    this.drvctx.showLayoutOSD();
  }

  public showLayoutShortcut(id: string) {
    this.drvctx.showLayoutShortcut(id);
  }
}
