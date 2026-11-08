/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

/**
 * TilingController translates events to actions, implementing high-level
 * window management logic.
 *
 * In short, this class is just a bunch of event handling methods.
 */

const LayoutShortcutIds: Partial<Record<KrohnkiteAction, string>> = {
  ["SetTileLayout"]: "TileLayout",
  ["SetMonocleLayout"]: "MonocleLayout",
  ["SetThreeColumnLayout"]: "ThreeColumnLayout",
  ["SetSpreadLayout"]: "SpreadLayout",
  ["SetStairLayout"]: "StairLayout",
  ["SetFloatingLayout"]: "FloatingLayout",
  ["SetQuarterLayout"]: "QuarterLayout",
  ["SetStackedLayout"]: "StackedLayout",
  ["SetColumnsLayout"]: "ColumnsLayout",
  ["SetSpiralLayout"]: "SpiralLayout",
  ["SetBinaryTreeLayout"]: "BinaryTreeLayout",
  ["SetCascadeLayout"]: "CascadeLayout",
  ["SetSmartLayout"]: "SmartLayout",
};

interface DragAction {
  result: {
    isProcessed: boolean;
    isArrangeNeeded: boolean;
  };
  actionTime: number;
  srf: ISurface;
  initialSrfId: string;
  workingArea: Rect;
  tilesArea: Rect | null;
  window: WindowClass;
  dockTarget: DockPosition | null;
  mousePointer: QPoint;
  middlePointer: QPoint;
  /* Physically adjacent outputs per side. Decides whether a dock zone is
   * tested against the cursor or the window's middle (see dockstore). */
  neighbors: { left: boolean; right: boolean; up: boolean; down: boolean };
  /* Surface id the neighbors were resolved for; the set is recalculated only
   * when the window crosses to another surface. */
  neighborsSrfId: string | null;
  dockSnapshots: { [srfId: string]: DockDragSnapshot };
  initialState: ToggleableState;
  isLayoutHasDragStep: boolean;
}

class TilingController {
  public engine: TilingEngine;
  private dragAction: DragAction | null;

  public constructor(engine: TilingEngine) {
    this.engine = engine;
    this.dragAction = null;
  }

  public onSurfaceUpdate(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    extraSurfaces?: ISurface[],
  ): void {
    this.engine.arrange(ctx, reason, getMethodName(), extraSurfaces);
  }

  public onCurrentActivityChanged(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onStackingOrderChanged(
    ctx: IDriverContext,
    window: WindowClass,
  ): void {
    /* The spread geometry does not depend on the stacking order, so a raise
     * must only restack the windows: the focused one comes to the front
     * without any window moving. */
    if (!window.isTiled) return;
    const layout = this.engine.layouts.getCurrentLayout(window.surface);
    if (layout instanceof SpreadLayout)
      this.engine.restackSpread(ctx, window.surface, window);
  }

  public onWindowAdded(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.manage(window);

    /* move window to next surface if the current surface is "full" */
    if (window.isTileable) {
      const srf = ctx.currentSurface;
      const tiles = this.engine.windows.getVisibleTiles(srf);
    }
    if (
      window.state !== WindowState.NativeMaximized &&
      window.state !== WindowState.NativeFullscreen
    )
      this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowSkipPagerChanged(
    ctx: IDriverContext,
    window: WindowClass,
    skipPager: boolean,
    reason: keyof typeof ArrangeReason,
  ) {
    if (skipPager) window.state = WindowState.Floating;
    else window.state = WindowState.Undecided;
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowRemoved(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (this.dragAction !== null && this.dragAction.window === window)
      this.finishDrag(ctx);
    this.engine.unmanage(window);
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowMoveStart(window: WindowClass): void {
    this.engine.beginMouseAction();
  }

  public onWindowMove(window: WindowClass): void {
    /* do nothing */
  }

  public onWindowDragging(
    ctx: IDriverContext,
    window: WindowClass,
    windowRect: Rect,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (!(window.isTiled || window.isDocked)) return;
    const srf = window.surface;
    const workingArea = srf.workingArea.clone();
    const draggingRect = toRect(windowRect);
    const mousePointer: QPoint =
      ctx.cursorPosition || draggingRect.activationPoint;
    /* The middle of the dragged window horizontally, the cursor vertically.
     * A window can cross to an adjacent output before the cursor does, so on
     * a side with a neighboring monitor the dock zone must be tested against
     * the window rather than the pointer. */
    const middlePointer: QPoint = {
      x: draggingRect.center.x,
      y: mousePointer.y,
    };
    const getNeighbors = (srf: ISurface) => ({
      left: ctx.getNeighborOutput("left", srf.output) !== null,
      right: ctx.getNeighborOutput("right", srf.output) !== null,
      up: ctx.getNeighborOutput("up", srf.output) !== null,
      down: ctx.getNeighborOutput("down", srf.output) !== null,
    });
    const markActionTime = () => {
      if (this.dragAction === null) return;
      this.dragAction.actionTime = getTime();
    };
    const getDragAction = () => {
      window.isDragging = true;
      const initialState = window.state as ToggleableState;
      return {
        result: { isProcessed: false, isArrangeNeeded: false },
        actionTime: getTime(),
        srf,
        initialSrfId: srf.id,
        workingArea,
        tilesArea: null,
        window,
        dockTarget: null,
        mousePointer,
        middlePointer,
        neighbors: getNeighbors(srf),
        neighborsSrfId: srf.id,
        dockSnapshots: {},
        initialState,
        isLayoutHasDragStep: false,
      };
    };
    if (this.dragAction === null) {
      window.window.commit(
        ctx,
        new Rect(
          window.actualGeometry.x,
          window.actualGeometry.y,
          Math.max(window.minSize.width, workingArea.width * 0.25),
          Math.max(window.minSize.height, workingArea.height * 0.25),
        ),
      );
      this.dragAction = getDragAction();
    }
    // 100 milliseconds - min interval between run this function
    // else if (getTime() - this.dragAction.actionTime < 100) return;
    else {
      if (window === this.dragAction.window) {
        this.dragAction.actionTime = getTime();
        this.dragAction.mousePointer = mousePointer;
        this.dragAction.middlePointer = middlePointer;
        this.dragAction.srf = srf;
        this.dragAction.workingArea = workingArea;
      } else {
        this.finishDrag(ctx);
        this.dragAction = getDragAction();
      }
    }
    this.dragAction.result = { isProcessed: false, isArrangeNeeded: false };
    this.dragAction.dockTarget = null;
    if (this.dragAction.neighborsSrfId !== srf.id) {
      this.dragAction.neighbors = getNeighbors(srf);
      this.dragAction.neighborsSrfId = srf.id;
    }

    this.engine.docks.drag(this.dragAction);
    if (this.dragAction.result.isProcessed) {
      /* a dock zone took over: the live drop preview ends */
      if (this.engine.dragWindow === window) this.engine.dragCancel(ctx);
      if (this.dragAction.result.isArrangeNeeded)
        this.engine.arrange(ctx, reason, getMethodName());
      this.updateDragPreview(ctx);
      return markActionTime();
    }

    const layout = this.engine.layouts.getCurrentLayout(srf);
    if (!layout.drag) {
      this.updateDragPreview(ctx);
      /* layouts without their own dragging: preview the drop live
         (silhouette, the other windows move out of the way, also across
         monitors) */
      if (CONFIG.dragPreview && window.state === WindowState.Tiled)
        this.engine.dragUpdate(ctx, window);
      return markActionTime();
    }
    this.dragAction.isLayoutHasDragStep = true;
    layout.drag(new EngineContext(ctx, this.engine), this.dragAction);
    if (this.dragAction.result.isArrangeNeeded)
      this.engine.arrange(ctx, reason, getMethodName());
    this.updateDragPreview(ctx);
    return markActionTime();
  }

  /**
   * Draw (or clear) the dock-slot preview rectangle for the active drag. The
   * dragged window's geometry has already been computed by the engine but is
   * not committed while `isDragging` is set, so it is the exact drop target.
   */
  private updateDragPreview(ctx: IDriverContext): void {
    const dragAction = this.dragAction;
    if (
      dragAction === null ||
      dragAction.dockTarget === null ||
      dragAction.window.state !== WindowState.Docked
    ) {
      ctx.hideDragPreview();
      return;
    }
    ctx.showDragPreview(
      toRect(dragAction.srf.output.geometry),
      dragAction.window.geometry,
    );
  }

  public onWindowMoveOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.endMouseAction();
    this.moveOver(ctx, window, reason);
    this.engine.undoObserve("moveOver");
  }

  private moveOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    /* swap window by dragging */
    window.isDragging = false;
    /* a live drag preview was shown: do exactly what it showed */
    if (this.engine.dragWindow === window) {
      this.finishDrag(ctx);
      if (this.engine.dragFinish(ctx, window)) return;
    }
    if (this.dragAction !== null && this.dragAction.window === window) {
      const isLayoutHasDragStep = this.dragAction.isLayoutHasDragStep;
      this.finishDrag(ctx);
      if (isLayoutHasDragStep) {
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}`,
        );
        return;
      }
    }

    if (window.state === WindowState.Tiled) {
      const target = this.engine.dropTarget(ctx, window);
      if (target !== null) {
        this.engine.windows.swap(window, target);
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}`,
        );
        return;
      }
    }

    /* ... or float window by dragging */
    if (!CONFIG.keepTilingOnDrag && window.state === WindowState.Tiled) {
      const diff = window.actualGeometry.subtract(window.geometry);
      const distance = Math.sqrt(diff.x ** 2 + diff.y ** 2);
      // TODO: arbitrary constant
      if (distance > 30) {
        window.floatGeometry = window.actualGeometry;
        window.state = WindowState.Floating;
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}:keepTilingOnDrag=${CONFIG.keepTilingOnDrag}`,
        );
        return;
      }
    }

    /* ... or return to the previous position */
    window.commit(ctx);
  }

  /**
   * Finalize the active drag: restore the pre-drag state of the dragged and
   * swapped windows, then clear the drag context. Safe to call when no drag
   * is active or when the dragged window is already gone.
   */
  private finishDrag(ctx: IDriverContext): void {
    const dragAction = this.dragAction;
    if (dragAction === null) return;
    ctx.hideDragPreview();
    const { window, initialState } = dragAction;
    this.engine.docks.finishDrag(dragAction);
    this.dragAction = null;
    if (window.isAlive()) {
      window.isDragging = false;
      // previousState is unchanged during drag (setTransientState), so it
      // still holds the pre-drag value; only overwrite it if the state changed.
      if (window.state !== initialState) window.previousState = initialState;
    }
  }

  public onWindowResizeStart(window: WindowClass): void {
    this.engine.beginMouseAction();
  }

  public onWindowResize(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (window.zoomed) return; // zoomed: not a layout resize
    if (
      CONFIG.adjustLayout &&
      CONFIG.adjustLayoutLive &&
      window.state === WindowState.Tiled
    ) {
      this.engine.adjustLayout(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    } else if (window.state === WindowState.Docked) {
      this.engine.adjustDock(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    }
  }

  public onWindowResizeOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.endMouseAction();
    this.resizeOver(ctx, window, reason);
    this.engine.undoObserve("resizeOver");
  }

  private resizeOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (window.zoomed) {
      this.engine.arrange(ctx, "zoomResize"); // back to the zoom size
      return;
    }
    if (CONFIG.adjustLayout && window.isTiled) {
      this.engine.adjustLayout(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    } else if (window.state === WindowState.Docked) {
      this.engine.adjustDock(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    } else if (!CONFIG.adjustLayout) this.engine.enforceSize(ctx, window);
  }

  public onWindowMaximizeChanged(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowGeometryChanged(
    ctx: IDriverContext,
    window: WindowClass,
  ): void {
    LOG?.send(
      LogModules.bufferGeometryChanged,
      "enforceSize",
      `Window: id:${window.id} actualGeometry: ${window.actualGeometry}, commitGeometry:${window.geometry}`,
      { winClass: [`${(window.window as DriverWindow).window.resourceClass}`] },
    );
    this.engine.enforceSize(ctx, window);
  }

  // NOTE: accepts `null` to simplify caller. This event is a catch-all hack
  // by itself anyway.
  public onWindowChanged(
    ctx: IDriverContext,
    window: WindowClass | null,
    reason: keyof typeof ArrangeReason,
    comment?: string,
    extraSurfaces?: ISurface[],
  ): void {
    if (window) {
      // TODO: delete one string bellow if the future caresses you with its grace
      // if (comment === "unminimized") ctx.currentWindow = window;
      const workingArea = window.surface.workingArea;
      if (window.floatGeometry.width > workingArea.width) {
        window.floatGeometry.width = workingArea.width;
      }
      if (window.floatGeometry.height > workingArea.height) {
        window.floatGeometry.height = workingArea.height;
      }
      window.floatGeometry.x =
        workingArea.x + (workingArea.width - window.floatGeometry.width) / 2;
      window.floatGeometry.y =
        workingArea.y + (workingArea.height - window.floatGeometry.height) / 2;
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
        extraSurfaces,
      );
    }
  }

  public onWindowFocused(ctx: IDriverContext, window: WindowClass) {
    window.focusTime = getTime();
    /* A focus that came with a raise brings the window to the front of the
     * spread; a focus change that left it behind other tiles (focus follows
     * mouse) does not. The engine checks which case applies. */
    if (window.isTiled) this.engine.restackSpreadOnFocus(ctx, window);
    /* zoom ends as soon as another window gets the focus
       (dialogs of the zoomed app do not end it) */
    const z = this.engine.zoomWindow;
    if (z && z !== window && !window.isTransientOf(z)) {
      this.engine.unzoom();
      this.engine.arrange(ctx, "unzoom");
    }
    /* focus grow: the Smart layout gives the focused window more room */
    if (
      window.isTiled &&
      KWINCONFIG.smartFocusGrow > 0 &&
      this.engine.layouts.getCurrentLayout(window.surface) instanceof
        SmartLayout &&
      this.engine.windows.getVisibleTiles(window.surface).length > 1
    )
      this.engine.arrange(ctx, "focusGrow");
  }

  /** a window Krohnkite does not manage got the focus (desktop, ignored app) */
  public onForeignFocus(ctx: IDriverContext, isDialog: boolean) {
    if (!this.engine.zoomWindow || isDialog) return;
    this.engine.unzoom();
    this.engine.arrange(ctx, "unzoom");
  }

  public onDesktopsChanged(ctx: IDriverContext, window: WindowClass) {
    if (window.state !== WindowState.Docked)
      window.state = WindowState.Undecided;
  }

  public onShortcut(
    ctx: IDriverContext,
    action: KrohnkiteAction | null,
    reason: keyof typeof ArrangeReason,
  ) {
    if (action === null) return;
    if (ctx.handleLayoutChooserShortcut(action)) return;
    switch (action) {
      case KrohnkiteAction.Zoom:
        if (this.engine.toggleZoom(ctx)) this.engine.arrange(ctx, "zoom");
        return;
      case KrohnkiteAction.ToggleQuickview:
        if (ctx.toggleQuickview) ctx.toggleQuickview();
        return;
      case KrohnkiteAction.Undo:
      case KrohnkiteAction.Redo: {
        const redo = action === KrohnkiteAction.Redo;
        if (this.engine.undo(ctx, redo))
          ctx.showNotification(
            redo
              ? `Redo (${this.engine.redoSteps} more)`
              : `Undo (${this.engine.undoSteps} more)`,
          );
        else ctx.showNotification(redo ? "Nothing to redo" : "Nothing to undo");
        return;
      }
    }
    this.engine.markUserAction();
    this.shortcut(ctx, action, reason);
    this.engine.undoObserve("shortcut");
  }

  private shortcut(
    ctx: IDriverContext,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ) {

    let isArrangeNeeded = true;
    let currentCapacity: number | null;
    const window = ctx.currentWindow;

    if (
      this.engine.handleDockWinShortcut(ctx, window, action, reason) ||
      this.engine.handleFloatWinShortcut(ctx, window, action) ||
      this.engine.handleLayoutShortcut(ctx, action, reason) ||
      this.engine.handleTiledWinShortcut(ctx, window, action, reason)
    ) {
      if (window) ctx.requestPointerOnFocus("window", true);
      return;
    }
    switch (action) {
      case KrohnkiteAction.AlterRegister:
      case KrohnkiteAction.ToggleRegister:
        ctx.alterRegisterHdl(action);
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.FocusNext:
        this.engine.focusOrder(ctx, +1);
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.FocusPrev:
        this.engine.focusOrder(ctx, -1);
        isArrangeNeeded = false;
        break;

      case KrohnkiteAction.FocusUp:
        isArrangeNeeded = this.engine.focusDir(ctx, "up");
        break;
      case KrohnkiteAction.FocusDown:
        isArrangeNeeded = this.engine.focusDir(ctx, "down");
        break;
      case KrohnkiteAction.DWMLeft:
      case KrohnkiteAction.FocusLeft:
        isArrangeNeeded = this.engine.focusDir(ctx, "left");
        break;
      case KrohnkiteAction.DWMRight:
      case KrohnkiteAction.FocusRight:
        isArrangeNeeded = this.engine.focusDir(ctx, "right");
        break;

      case KrohnkiteAction.SetMaster:
        if (window) this.engine.setMaster(ctx, window);
        break;
      case KrohnkiteAction.ToggleFloat:
        if (window) this.engine.toggleFloat(window);
        break;
      case KrohnkiteAction.ToggleFloatAll:
        this.engine.floatAll(ctx, ctx.currentSurface);
        break;

      case KrohnkiteAction.NextLayout:
        this.engine.cycleLayout(ctx, 1);
        break;
      case KrohnkiteAction.PreviousLayout:
        this.engine.cycleLayout(ctx, -1);
        break;
      case KrohnkiteAction.LayoutChooser:
        ctx.showLayoutChooser();
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.SetTileLayout:
      case KrohnkiteAction.SetMonocleLayout:
      case KrohnkiteAction.SetThreeColumnLayout:
      case KrohnkiteAction.SetSpreadLayout:
      case KrohnkiteAction.SetStairLayout:
      case KrohnkiteAction.SetFloatingLayout:
      case KrohnkiteAction.SetQuarterLayout:
      case KrohnkiteAction.SetStackedLayout:
      case KrohnkiteAction.SetColumnsLayout:
      case KrohnkiteAction.SetSpiralLayout:
      case KrohnkiteAction.SetBinaryTreeLayout:
      case KrohnkiteAction.SetCascadeLayout:
      case KrohnkiteAction.SetSmartLayout:
        this.engine.setLayout(ctx, LayoutShortcutIds[action]!);
        break;

      case KrohnkiteAction.ToggleDock:
        if (window) this.engine.toggleDock(window);
        break;

      case KrohnkiteAction.RaiseSurfaceCapacity:
        currentCapacity = this.engine.raiseSurfaceCapacity(ctx);
        ctx.showNotification(
          `Surface capacity: ${currentCapacity !== null ? currentCapacity : "unlimited"}`,
        );
        break;
      case KrohnkiteAction.LowerSurfaceCapacity:
        currentCapacity = this.engine.lowerSurfaceCapacity(ctx);
        ctx.showNotification(`Surface capacity: ${currentCapacity}`);
        break;
      case KrohnkiteAction.ResetSurfaceCapacity:
        currentCapacity = this.engine.ResetSurfaceCapacity(ctx);
        ctx.showNotification(
          `Surface capacity: ${currentCapacity !== null ? currentCapacity : "unlimited"}`,
        );
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.ShowCurrentCapacity:
        currentCapacity = this.engine.getCurrentSurfaceCapacity(ctx);
        ctx.showNotification(
          `Surface capacity: ${currentCapacity !== null ? currentCapacity : "unlimited"}`,
        );
        isArrangeNeeded = false;
        break;
    }
    if (isArrangeNeeded) {
      this.engine.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
    }
  }
}
