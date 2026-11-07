/*
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class ColumnsLayout implements ILayout {
  public static readonly id = "ColumnsLayout";
  public parts: ColumnLayout[];
  public readonly classID = ColumnsLayout.id;
  public readonly capacity?: number | null;
  private direction: windRose;
  private _columns: ColumnLayout[];
  private _columnsConfiguration: number[] | null;

  public get description(): string {
    return "Columns";
  }

  public get columns(): ColumnLayout[] {
    return this._columns;
  }

  public get columnsConfiguration(): number[] {
    if (this._columnsConfiguration === null) return [];
    return this._columnsConfiguration;
  }

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.parts = [new ColumnLayout()];
    this._columns = [];
    this.direction = new windRose(CONFIG.columnsLayoutInitialAngle);
    this._columnsConfiguration = null;
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ) {
    let columnId = this.getColumnId(basis);
    if (columnId === null) return;
    let isReverse = this.direction.east || this.direction.south;
    let columnsLength = this.columns.length;
    // column resize
    if (
      ((this.direction.east || this.direction.west) &&
        (delta.east !== 0 || delta.west !== 0)) ||
      ((this.direction.north || this.direction.south) &&
        (delta.north !== 0 || delta.south !== 0))
    ) {
      const horizontal = this.direction.east || this.direction.west;
      const orderedColumns = isReverse
        ? this.columns.slice(0).reverse()
        : this.columns;
      const oldWeights = orderedColumns.map((column) => column.weight);
      const minLengths = orderedColumns.map((column) => column.minWeight);
      const axisLength = horizontal ? area.width : area.height;
      const availableLength = axisLength - (columnsLength - 1) * gap;
      const totalMin = minLengths.reduce((sum, min) => sum + min, 0);
      const weights = LayoutUtils.adjustAreaWeightsProportional(
        area,
        oldWeights,
        gap,
        isReverse ? columnsLength - 1 - columnId : columnId,
        delta,
        horizontal,
        totalMin <= availableLength ? minLengths : undefined,
      );

      weights.forEach((weight, i) => {
        this.columns[isReverse ? columnsLength - 1 - i : i].weight =
          weight * columnsLength;
      });
    }
    if (
      ((delta.north !== 0 || delta.south !== 0) &&
        (this.direction.east || this.direction.west)) ||
      ((delta.east !== 0 || delta.west !== 0) &&
        (this.direction.north || this.direction.south))
    ) {
      this.columns[columnId].adjust(area, tiles, basis, delta, gap);
    }
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    if (this._columnsConfiguration === null)
      this._columnsConfiguration = this.getDefaultConfig(ctx);
    this.arrangeTileables(ctx, tileables);
    if (this.columns.length === 0) return;
    const horizontal = this.direction.east || this.direction.west;
    const orderedColumns =
      this.direction.east || this.direction.south
        ? this.columns.slice(0).reverse()
        : this.columns;
    const weights = orderedColumns.map((column) => column.weight);
    const minLengths = orderedColumns.map((column) => column.minWeight);
    const axisLength = horizontal ? area.width : area.height;
    const availableLength = axisLength - (this.columns.length - 1) * gap;
    const totalMin = minLengths.reduce((sum, min) => sum + min, 0);
    const rects = LayoutUtils.splitAreaWeighted(
      area,
      weights,
      gap,
      horizontal,
      totalMin <= availableLength ? minLengths : undefined,
    );
    if (this.direction.east || this.direction.south) {
      let i = 0;
      for (var idx = this.columns.length - 1; idx >= 0; idx--) {
        this.columns[idx].isHorizontal = this.direction.south;
        this.columns[idx].apply(ctx, tileables, rects[i], gap);
        i++;
      }
    } else {
      for (var idx = 0; idx < this.columns.length; idx++) {
        this.columns[idx].isHorizontal = this.direction.north;
        this.columns[idx].apply(ctx, tileables, rects[idx], gap);
      }
    }
  }

  public drag(ctx: EngineContext, dragAction: DragAction): void {
    if (
      this.columns.length === 0 ||
      (this.columns.length === 1 && this.columns[0].windowIds.size === 1)
    )
      return;
    const window = dragAction.window;
    const workingArea =
      dragAction.tilesArea !== null
        ? dragAction.tilesArea
        : dragAction.workingArea;
    const columnId = this.getColumnId(window);
    const windowId = window.id;

    // Handle drag to the primary edge of the screen
    // Creates a new column at the beginning or reuses a hidden one and moves the window to it
    if (
      ((this.direction.north &&
        workingArea.isTopZone(dragAction.mousePointer)) ||
        (this.direction.south &&
          workingArea.isBottomZone(dragAction.middlePointer)) ||
        (this.direction.west &&
          workingArea.isLeftZone(dragAction.mousePointer)) ||
        (this.direction.east &&
          workingArea.isRightZone(dragAction.mousePointer))) &&
      !(
        this.columns[0].windowIds.size === 1 &&
        this.columns[0].windowIds.has(windowId)
      )
    ) {
      if (columnId !== null) this.columns[columnId].windowIds.delete(windowId);
      let column: ColumnLayout;
      if (
        CONFIG.columnsLimitColumns &&
        this.columnsConfiguration.length > 0 &&
        this.parts.length >= this.columnsConfiguration.length
      ) {
        column = this.parts[0];
      } else {
        column = this.insertColumn(true);
        if (CONFIG.columnsApplyConfOnNewColumns) {
          this.applyColumnWeights();
        }
      }
      column.windowIds.add(windowId);
      dragAction.result.isArrangeNeeded = true;
      return;
    }

    // Handle drag to the secondary edge of the screen
    // Creates a new column at the end or reuses a hidden one and moves the window to it
    if (
      ((this.direction.north &&
        workingArea.isBottomZone(dragAction.middlePointer)) ||
        (this.direction.south &&
          workingArea.isTopZone(dragAction.mousePointer)) ||
        (this.direction.west &&
          workingArea.isRightZone(dragAction.mousePointer)) ||
        (this.direction.east &&
          workingArea.isLeftZone(dragAction.mousePointer))) &&
      !(
        this.columns[this.columns.length - 1].windowIds.size === 1 &&
        this.columns[this.columns.length - 1].windowIds.has(windowId)
      )
    ) {
      if (columnId !== null) this.columns[columnId].windowIds.delete(windowId);
      let column: ColumnLayout;
      if (
        CONFIG.columnsLimitColumns &&
        this.columnsConfiguration.length > 0 &&
        this.parts.length >= this.columnsConfiguration.length
      ) {
        column = this.parts[this.parts.length - 1];
      } else {
        column = this.insertColumn(false);
        if (CONFIG.columnsApplyConfOnNewColumns) {
          this.applyColumnWeights();
        }
      }
      column.windowIds.add(windowId);
      dragAction.result.isArrangeNeeded = true;
      return;
    }

    // Handle drag over existing windows - iterate through all columns and their windows
    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const column = this.columns[colIdx];
      for (let i = 0; i < column.renderedWindowsRects.length; i++) {
        const renderedRect = column.renderedWindowsRects[i];

        // Check if dragged to top/left half of a window - place BEFORE the target window
        if (
          (this.direction.west &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Top,
            )) ||
          (this.direction.north &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Left,
            )) ||
          (this.direction.east &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Top,
            )) ||
          (this.direction.south &&
            renderedRect.includesPoint(dragAction.mousePointer, RectParts.Left))
        ) {
          if (column.renderedWindowsIds[i] === windowId) {
            return;
          }
          if (i > 0 && column.renderedWindowsIds[i - 1] === windowId) {
            return;
          }

          const renderedId = column.renderedWindowsIds[i];
          if (columnId !== null && columnId !== colIdx)
            this.columns[columnId].windowIds.delete(windowId);
          column.windowIds.add(windowId);
          ctx.moveWindowByWinId(window, renderedId);
          dragAction.result.isArrangeNeeded = true;
          return;
        }

        // Check if dragged to bottom/right half of a window - place AFTER the target window
        if (
          (this.direction.west &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Bottom,
            )) ||
          (this.direction.north &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Right,
            )) ||
          (this.direction.east &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Bottom,
            )) ||
          (this.direction.south &&
            renderedRect.includesPoint(
              dragAction.mousePointer,
              RectParts.Right,
            ))
        ) {
          if (column.renderedWindowsIds[i] === windowId) {
            return;
          }
          if (
            i < column.renderedWindowsIds.length - 1 &&
            column.renderedWindowsIds[i + 1] === windowId
          ) {
            return;
          }

          const renderedId = column.renderedWindowsIds[i];
          if (columnId !== null && columnId !== colIdx)
            this.columns[columnId].windowIds.delete(windowId);
          column.windowIds.add(windowId);
          ctx.moveWindowByWinId(window, renderedId, true);
          dragAction.result.isArrangeNeeded = true;
          return;
        }
      }
    }
    return;
  }

  private arrangeTileables(ctx: EngineContext, tileables: WindowClass[]) {
    let latestTimestamp: number = 0;
    let partId: number | null = null;
    let newWindows: Array<string> = [];
    let tileableIds: Set<string> = new Set();
    let currentColumnId = 0;

    tileables.forEach((tileable) => {
      tileable.state = WindowState.Tiled;
      partId = this.getPartsId(tileable);

      if (partId !== null) {
        if (this.parts[partId].timestamp < tileable.focusTime) {
          this.parts[partId].timestamp = tileable.focusTime;
        }
        if (this.parts[partId].timestamp > latestTimestamp) {
          latestTimestamp = tileable.focusTime;
          currentColumnId = partId;
        }
      } else {
        newWindows.push(tileable.id);
      }
      tileableIds.add(tileable.id);
    });

    const colsLength = CONFIG.columnsLimitColumns
      ? this.parts.length
      : this.columns.length;

    if (
      this.columnsConfiguration.length > 0 &&
      tileableIds.size > 0 &&
      newWindows.length > 0 &&
      this.columnsConfiguration.length > colsLength
    ) {
      let new_columns_length =
        this.columnsConfiguration.length - colsLength > newWindows.length
          ? newWindows.length
          : this.columnsConfiguration.length - colsLength;
      for (let i = 0; i < new_columns_length; i++) {
        let winId = newWindows.shift();
        if (winId === undefined) continue;
        let column = this.insertColumn(false);
        column.windowIds.add(winId);
      }
      this.applyColumnWeights();
    }

    if (CONFIG.columnsBalanced) {
      for (var [_, id] of newWindows.entries()) {
        let minSizeColumn = this.parts.reduce((prev, curr) => {
          return prev.size < curr.size ? prev : curr;
        });
        minSizeColumn.windowIds.add(id);
      }
    } else {
      this.parts[currentColumnId].windowIds = new Set([
        ...this.parts[currentColumnId].windowIds,
        ...newWindows,
      ]);
    }

    this.parts.forEach((column) => {
      column.actualizeWindowIds(ctx, tileableIds);
    });
    this.parts = this.parts.filter((column) => column.windowIds.size !== 0);
    if (this.parts.length === 0) this.insertColumn(true);
    this.applyColumnsPosition();
    this.updateColumnsMinWeight(ctx);
  }

  private updateColumnsMinWeight(ctx: EngineContext) {
    const horizontal = this.direction.east || this.direction.west;
    this.columns.forEach((column) => {
      let min = 0;
      column.windowIds.forEach((id) => {
        const win = ctx.getWindowById(id);
        if (win === null || win.isFloating || win.minimized) return;
        const size = horizontal ? win.minSize.width : win.minSize.height;
        if (size > min) min = size;
      });
      column.minWeight = Math.max(1, min);
    });
  }

  private getColumnId(t: WindowClass | string | null): number | null {
    if (t !== null) {
      const windowId = typeof t === "string" ? t : t.id;
      for (let i = 0; i < this.columns.length; i++) {
        if (this.columns[i].windowIds.has(windowId)) return i;
      }
    }
    return null;
  }

  private getPartsId(t: WindowClass | string | null): number | null {
    if (t !== null) {
      const windowId = typeof t === "string" ? t : t.id;
      for (let i = 0; i < this.parts.length; i++) {
        if (this.parts[i].windowIds.has(windowId)) return i;
      }
    }
    return null;
  }

  private applyColumnsPosition() {
    this._columns = this.parts.filter((column) => !column.isEmpty());
  }

  /**
   * Adjusts column weights to follow the user given configuration.
   */
  private applyColumnWeights() {
    if (
      this.columnsConfiguration.length > 0 &&
      this.columnsConfiguration[0] !== 0
    ) {
      const columnsList = CONFIG.columnsLimitColumns
        ? this.parts
        : this.columns;
      const sumWeights = this.columnsConfiguration.reduce((a, b) => a + b, 0);

      for (
        let i = 0;
        i < columnsList.length && i < this.columnsConfiguration.length;
        i++
      ) {
        columnsList[i].weight =
          (this.columnsConfiguration[i] / sumWeights) * columnsList.length;
      }
    }
  }

  private toColumnWithBiggerIndex(ctx: EngineContext): boolean {
    const currentWindow = ctx.currentWindow;
    const currentWindowId = currentWindow !== null ? currentWindow.id : null;
    const activeColumnId =
      CONFIG.columnsLimitColumns && this.columnsConfiguration.length > 0
        ? this.getPartsId(currentWindowId)
        : this.getColumnId(currentWindowId);
    const columnList =
      CONFIG.columnsLimitColumns && this.columnsConfiguration.length > 0
        ? this.parts
        : this.columns;

    if (
      currentWindow === null ||
      currentWindowId === null ||
      activeColumnId === null ||
      (columnList[activeColumnId].windowIds.size < 2 &&
        (activeColumnId === columnList.length - 1 || columnList.length < 2)) ||
      (this.columnsConfiguration.length > 0 &&
        activeColumnId === columnList.length - 1 &&
        columnList.length >= this.columnsConfiguration.length)
    ) {
      return false;
    }

    let targetColumn: ColumnLayout;
    const column = columnList[activeColumnId];
    const center =
      column.renderedWindowsRects[
        column.renderedWindowsIds.indexOf(currentWindowId)
      ].center;
    column.windowIds.delete(currentWindowId);

    if (activeColumnId === columnList.length - 1) {
      targetColumn = this.insertColumn(false);
      targetColumn.windowIds.add(currentWindowId);
    } else {
      targetColumn = columnList[activeColumnId + 1];
      targetColumn.windowIds.add(currentWindowId);
    }
    let idOnTarget: string | null;
    if (this.direction.north || this.direction.south)
      idOnTarget = targetColumn.getWindowIdOnRight(center.x);
    else idOnTarget = targetColumn.getWindowIdOnTop(center.y);
    if (idOnTarget !== null) ctx.moveWindowByWinId(currentWindow, idOnTarget);
    else {
      const targetId =
        targetColumn.renderedWindowsIds[
          targetColumn.renderedWindowsIds.length - 1
        ];
      ctx.moveWindowByWinId(currentWindow, targetId);
    }
    this.applyColumnsPosition();
    return true;
  }

  private toColumnWithSmallerIndex(ctx: EngineContext): boolean {
    const currentWindow = ctx.currentWindow;
    const currentWindowId = currentWindow !== null ? currentWindow.id : null;
    const activeColumnId =
      CONFIG.columnsLimitColumns && this.columnsConfiguration.length > 0
        ? this.getPartsId(currentWindowId)
        : this.getColumnId(currentWindowId);
    const columnList =
      CONFIG.columnsLimitColumns && this.columnsConfiguration.length > 0
        ? this.parts
        : this.columns;

    if (
      currentWindow === null ||
      currentWindowId === null ||
      activeColumnId === null ||
      (columnList[activeColumnId].windowIds.size < 2 &&
        (activeColumnId === 0 || columnList.length < 2)) ||
      (this.columnsConfiguration.length > 0 &&
        activeColumnId === 0 &&
        columnList.length >= this.columnsConfiguration.length)
    ) {
      return false;
    }

    let targetColumn: ColumnLayout;
    const column = columnList[activeColumnId];
    const center =
      column.renderedWindowsRects[
        column.renderedWindowsIds.indexOf(currentWindowId)
      ].center;
    column.windowIds.delete(currentWindowId);

    if (activeColumnId === 0) {
      targetColumn = this.insertColumn(true);
      targetColumn.windowIds.add(currentWindowId);
    } else {
      targetColumn = columnList[activeColumnId - 1];
      targetColumn.windowIds.add(currentWindowId);
    }
    let idOnTarget: string | null;
    if (this.direction.north || this.direction.south)
      idOnTarget = targetColumn.getWindowIdOnRight(center.x);
    else idOnTarget = targetColumn.getWindowIdOnTop(center.y);
    if (idOnTarget !== null) ctx.moveWindowByWinId(currentWindow, idOnTarget);
    else {
      const targetId =
        targetColumn.renderedWindowsIds[
          targetColumn.renderedWindowsIds.length - 1
        ];
      ctx.moveWindowByWinId(currentWindow, targetId);
    }
    this.applyColumnsPosition();
    return true;
  }

  private toUpOrLeft(ctx: EngineContext): boolean {
    let currentWindow = ctx.currentWindow;
    let currentWindowId = currentWindow !== null ? currentWindow.id : null;
    let activeColumnId = this.getColumnId(currentWindowId);

    if (
      currentWindow === null ||
      currentWindowId === null ||
      activeColumnId === null ||
      this.columns[activeColumnId].windowIds.size < 2
    )
      return false;
    let upperWinId =
      this.columns[activeColumnId].getUpperWindowId(currentWindowId);
    if (upperWinId === null) return false;
    ctx.moveWindowByWinId(currentWindow, upperWinId);
    return true;
  }

  private toBottomOrRight(ctx: EngineContext): boolean {
    let currentWindow = ctx.currentWindow;
    let currentWindowId = currentWindow !== null ? currentWindow.id : null;
    let activeColumnId = this.getColumnId(currentWindowId);

    if (
      currentWindow === null ||
      currentWindowId === null ||
      activeColumnId === null ||
      this.columns[activeColumnId].windowIds.size < 2
    )
      return false;
    let lowerWinId =
      this.columns[activeColumnId].getLowerWindowId(currentWindowId);
    if (lowerWinId === null) return false;
    ctx.moveWindowByWinId(currentWindow, lowerWinId, true);
    return true;
  }

  public showDirection(ctx: EngineContext) {
    let notification: string;
    if (this.direction.east) notification = "vertical ⟰";
    else if (this.direction.north) notification = "horizontal ⭆";
    else if (this.direction.west) notification = "vertical ⟱";
    else if (this.direction.south) notification = "horizontal ⭅";
    else notification = "";
    ctx.showNotification(notification);
  }

  public handleShortcut(ctx: EngineContext, input: KrohnkiteAction) {
    let isApply: boolean = false;
    switch (input) {
      case KrohnkiteAction.MoveLeft:
        if (this.direction.north || this.direction.south) {
          isApply = this.toUpOrLeft(ctx);
        } else if (this.direction.east) {
          isApply = this.toColumnWithBiggerIndex(ctx);
        } else isApply = this.toColumnWithSmallerIndex(ctx);
        break;
      case KrohnkiteAction.MoveRight:
        if (this.direction.north || this.direction.south) {
          isApply = this.toBottomOrRight(ctx);
        } else if (this.direction.east) {
          isApply = this.toColumnWithSmallerIndex(ctx);
        } else isApply = this.toColumnWithBiggerIndex(ctx);
        break;
      case KrohnkiteAction.MoveUp:
        if (this.direction.north) {
          isApply = this.toColumnWithSmallerIndex(ctx);
        } else if (this.direction.south) {
          isApply = this.toColumnWithBiggerIndex(ctx);
        } else isApply = this.toUpOrLeft(ctx);
        break;
      case KrohnkiteAction.MoveDown:
        if (this.direction.north) {
          isApply = this.toColumnWithBiggerIndex(ctx);
        } else if (this.direction.south) {
          isApply = this.toColumnWithSmallerIndex(ctx);
        } else isApply = this.toBottomOrRight(ctx);
        break;
      case KrohnkiteAction.Rotate:
        this.direction.cwRotation();
        this.showDirection(ctx);
        isApply = true;
        break;
      case KrohnkiteAction.RotatePart:
        this.direction.ccwRotation();
        this.showDirection(ctx);
        isApply = true;
        break;

      default:
        return false;
    }
    return isApply;
  }

  private insertColumn(onTop: boolean): ColumnLayout {
    let column = new ColumnLayout();
    this.parts.splice(onTop ? 0 : this.parts.length, 0, column);
    return column;
  }

  private getDefaultConfig(ctx: EngineContext): number[] {
    let returnValue: number[] = [];

    let [outputName, activityId, vDesktopName] = ctx.surfaceParams;
    for (let conf of CONFIG.columnsLayerConf) {
      if (!conf || typeof conf !== "string") continue;
      let conf_arr = conf.split(":").map((part) => part.trim());
      if (conf_arr.length < 5) {
        warning(`Columns conf: ${conf} has less then 5 elements`);
        continue;
      }
      if (
        (outputName === conf_arr[0] || conf_arr[0] === "") &&
        (activityId === conf_arr[1] || conf_arr[1] === "") &&
        (vDesktopName === conf_arr[2] || conf_arr[2] === "")
      ) {
        for (let i = 3; i < conf_arr.length; i++) {
          let columnWeight = parseFloat(conf_arr[i]);
          if (isNaN(columnWeight)) {
            warning(
              `Columns conf:${conf_arr}: ${conf_arr[i]} is not a number.`,
            );
            returnValue = [];
            break;
          }
          if (columnWeight === 0) {
            warning(`Columns conf:${conf_arr}: weight cannot be zero`);
            returnValue = [];
            break;
          }
          returnValue.push(columnWeight);
        }
        if (
          returnValue.length > 1 &&
          returnValue.every((el) => el === returnValue[0])
        ) {
          returnValue.fill(0);
        }
        return returnValue;
      }
    }
    return returnValue;
  }
}
