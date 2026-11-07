/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class MonocleLayout implements ILayout {
  public static readonly id = "MonocleLayout";
  public readonly description: string = "Monocle";

  public readonly classID = MonocleLayout.id;

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    /* Tile all tileables */
    tileables.forEach((tile) => {
      tile.state = CONFIG.monocleMaximize
        ? WindowState.Maximized
        : WindowState.Tiled;
      tile.geometry = area;
    });

    /* KWin-specific `monocleMinimizeRest` option */
    if (
      ctx.backend === KWinDriver.backendName &&
      KWINCONFIG.monocleMinimizeRest
    ) {
      const tiles = [...tileables];
      ctx.setTimeout(() => {
        const current = ctx.currentWindow;
        if (current && current.isTiled) {
          tiles.forEach((window) => {
            if (window !== current)
              (window.window as DriverWindow).setMinimizedByScript(true);
          });
        }
      }, 50);
    }
  }

  public clone(): this {
    /* fake clone */
    return this;
  }

  public handleShortcut(ctx: EngineContext, input: KrohnkiteAction): boolean {
    switch (input) {
      // case KrohnkiteAction.Up:
      // case KrohnkiteAction.Left:
      case KrohnkiteAction.DWMLeft:
      case KrohnkiteAction.FocusNext:
      case KrohnkiteAction.FocusUp:
      case KrohnkiteAction.FocusLeft:
        ctx.cycleFocus(-1);
        return true;
      // case KrohnkiteAction.Down:
      // case KrohnkiteAction.Right:
      case KrohnkiteAction.DWMRight:
      case KrohnkiteAction.FocusPrev:
      case KrohnkiteAction.FocusDown:
      case KrohnkiteAction.FocusRight:
        ctx.cycleFocus(1);
        return true;
      default:
        return false;
    }
  }

  public toString(): string {
    return "MonocleLayout()";
  }
}
