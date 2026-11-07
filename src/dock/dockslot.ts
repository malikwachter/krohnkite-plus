/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class DockSlot {
  readonly _position: DockPosition;
  readonly _order: number;
  public windows: WindowClass[];

  public get position(): DockPosition {
    return this._position;
  }
  public get order(): number {
    return this._order;
  }

  constructor(position: DockPosition, order: number) {
    this._position = position;
    this._order = order;
    this.windows = [];
  }

  public add(window: WindowClass, index: number = this.windows.length): void {
    const target = Math.max(0, Math.min(index, this.windows.length));
    this.windows.splice(target, 0, window);
  }

  public remove(window: WindowClass): boolean {
    const index = this.windows.indexOf(window);
    if (index < 0) return false;
    this.windows.splice(index, 1);
    return true;
  }

  public indexOf(window: WindowClass): number {
    return this.windows.indexOf(window);
  }
}
