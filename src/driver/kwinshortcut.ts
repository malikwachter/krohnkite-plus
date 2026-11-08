/*
    SPDX-FileCopyrightText: 2026 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

const Shortcuts = {
  AlterRegisterSC: {
    defaultAction: KrohnkiteAction.AlterRegister,
    defaultRegisterAction: KrohnkiteAction.AlterRegister,
  },
  FocusNextSC: {
    defaultAction: KrohnkiteAction.FocusNext,
    defaultRegisterAction: KrohnkiteAction.SwapUp,
  },
  FocusPrevSC: {
    defaultAction: KrohnkiteAction.FocusPrev,
    defaultRegisterAction: KrohnkiteAction.SwapDown,
  },
  FocusLeftSC: {
    defaultAction: KrohnkiteAction.FocusLeft,
    defaultRegisterAction: KrohnkiteAction.FocusLeft,
  },
  FocusRightSC: {
    defaultAction: KrohnkiteAction.FocusRight,
    defaultRegisterAction: KrohnkiteAction.FocusRight,
  },
  FocusDownSC: {
    defaultAction: KrohnkiteAction.FocusDown,
    defaultRegisterAction: KrohnkiteAction.FocusDown,
  },
  FocusUpSC: {
    defaultAction: KrohnkiteAction.FocusUp,
    defaultRegisterAction: KrohnkiteAction.FocusUp,
  },
  MoveDownSC: {
    defaultAction: KrohnkiteAction.MoveDown,
    defaultRegisterAction: KrohnkiteAction.SwapDown,
  },
  MoveUpSC: {
    defaultAction: KrohnkiteAction.MoveUp,
    defaultRegisterAction: KrohnkiteAction.SwapUp,
  },
  MoveLeftSC: {
    defaultAction: KrohnkiteAction.MoveLeft,
    defaultRegisterAction: null,
  },
  MoveRightSC: {
    defaultAction: KrohnkiteAction.MoveRight,
    defaultRegisterAction: null,
  },
  ToggleDockSC: {
    defaultAction: KrohnkiteAction.ToggleDock,
    defaultRegisterAction: null,
  },
  GrowHeightSC: {
    defaultAction: KrohnkiteAction.GrowHeight,
    defaultRegisterAction: null,
  },
  ShrinkHeightSC: {
    defaultAction: KrohnkiteAction.ShrinkHeight,
    defaultRegisterAction: null,
  },
  ShrinkWidthSC: {
    defaultAction: KrohnkiteAction.ShrinkWidth,
    defaultRegisterAction: null,
  },
  GrowWidthSC: {
    defaultAction: KrohnkiteAction.GrowWidth,
    defaultRegisterAction: null,
  },
  IncreaseSC: {
    defaultAction: KrohnkiteAction.Increase,
    defaultRegisterAction: KrohnkiteAction.FocusNext,
  },
  DecreaseSC: {
    defaultAction: KrohnkiteAction.Decrease,
    defaultRegisterAction: KrohnkiteAction.FocusPrev,
  },
  ToggleFloatSC: {
    defaultAction: KrohnkiteAction.ToggleFloat,
    defaultRegisterAction: null,
  },
  ToggleFloatAllSC: {
    defaultAction: KrohnkiteAction.ToggleFloatAll,
    defaultRegisterAction: null,
  },
  NextLayoutSC: {
    defaultAction: KrohnkiteAction.NextLayout,
    defaultRegisterAction: null,
  },
  PreviousLayoutSC: {
    defaultAction: KrohnkiteAction.PreviousLayout,
    defaultRegisterAction: null,
  },
  LayoutChooserSC: {
    defaultAction: KrohnkiteAction.LayoutChooser,
    defaultRegisterAction: null,
  },
  RotateSC: {
    defaultAction: KrohnkiteAction.Rotate,
    defaultRegisterAction: KrohnkiteAction.RotatePart,
  },
  RotatePartSC: {
    defaultAction: KrohnkiteAction.RotatePart,
    defaultRegisterAction: KrohnkiteAction.Rotate,
  },
  SetMasterSC: {
    defaultAction: KrohnkiteAction.SetMaster,
    defaultRegisterAction: null,
  },
  RaiseSurfaceCapacitySC: {
    defaultAction: KrohnkiteAction.RaiseSurfaceCapacity,
    defaultRegisterAction: KrohnkiteAction.ShowCurrentCapacity,
  },
  LowerSurfaceCapacitySC: {
    defaultAction: KrohnkiteAction.LowerSurfaceCapacity,
    defaultRegisterAction: KrohnkiteAction.ResetSurfaceCapacity,
  },
  SetTileLayoutSC: {
    defaultAction: KrohnkiteAction.SetTileLayout,
    defaultRegisterAction: null,
  },
  SetMonocleLayoutSC: {
    defaultAction: KrohnkiteAction.SetMonocleLayout,
    defaultRegisterAction: null,
  },
  SetThreeColumnLayoutSC: {
    defaultAction: KrohnkiteAction.SetThreeColumnLayout,
    defaultRegisterAction: null,
  },
  SetSpreadLayoutSC: {
    defaultAction: KrohnkiteAction.SetSpreadLayout,
    defaultRegisterAction: null,
  },
  SetStairLayoutSC: {
    defaultAction: KrohnkiteAction.SetStairLayout,
    defaultRegisterAction: null,
  },
  SetFloatingLayoutSC: {
    defaultAction: KrohnkiteAction.SetFloatingLayout,
    defaultRegisterAction: null,
  },
  SetQuarterLayoutSC: {
    defaultAction: KrohnkiteAction.SetQuarterLayout,
    defaultRegisterAction: null,
  },
  SetStackedLayoutSC: {
    defaultAction: KrohnkiteAction.SetStackedLayout,
    defaultRegisterAction: null,
  },
  SetColumnsLayoutSC: {
    defaultAction: KrohnkiteAction.SetColumnsLayout,
    defaultRegisterAction: null,
  },
  SetSpiralLayoutSC: {
    defaultAction: KrohnkiteAction.SetSpiralLayout,
    defaultRegisterAction: null,
  },
  SetBinaryTreeLayoutSC: {
    defaultAction: KrohnkiteAction.SetBinaryTreeLayout,
    defaultRegisterAction: null,
  },
  SetCascadeLayoutSC: {
    defaultAction: KrohnkiteAction.SetCascadeLayout,
    defaultRegisterAction: null,
  },
  /* Kröhnkite-Plus */
  SetSmartLayoutSC: {
    defaultAction: KrohnkiteAction.SetSmartLayout,
    defaultRegisterAction: null,
  },
  ZoomSC: {
    defaultAction: KrohnkiteAction.Zoom,
    defaultRegisterAction: null,
  },
  UndoSC: {
    defaultAction: KrohnkiteAction.Undo,
    defaultRegisterAction: null,
  },
  RedoSC: {
    defaultAction: KrohnkiteAction.Redo,
    defaultRegisterAction: null,
  },
  ToggleQuickviewSC: {
    defaultAction: KrohnkiteAction.ToggleQuickview,
    defaultRegisterAction: null,
  },
} as const;
type ShortcutName = keyof typeof Shortcuts;

abstract class ShortcutBase {
  public action!: KrohnkiteAction | null;
  public registerAction!: KrohnkiteAction | null;

  public resolve(isRegister: boolean): KrohnkiteAction | null {
    if (isRegister && this.registerAction !== null) return this.registerAction;
    return this.action;
  }
}

class Shortcut extends ShortcutBase {
  public name: ShortcutName;
  public hdl: ShortcutHandler;
  public defaultAction: KrohnkiteAction;
  public defaultRegisterAction: KrohnkiteAction | null;

  constructor(entry: IShortcutEntry) {
    super();
    const defaults = Shortcuts[entry.name];
    this.name = entry.name;
    this.hdl = entry.hdl;
    this.defaultAction = defaults.defaultAction;
    this.defaultRegisterAction = defaults.defaultRegisterAction;
    this.action = defaults.defaultAction;
    this.registerAction = defaults.defaultRegisterAction;
  }
}

type ShortcutSequenceState = "timeIsUp" | "finish" | "inProcess" | "failed";
class ShortcutSequence extends ShortcutBase {
  public get state() {
    if (
      this._state === "inProcess" &&
      getTime() - this.timeout > this._beginTime
    )
      this._state = "timeIsUp";
    return this._state;
  }
  public set state(s: ShortcutSequenceState) {
    this._state = s;
  }
  public sequence: ShortcutName[];
  public timeout: number;
  private _currentIndex: number;
  private _beginTime: number;
  private _state: ShortcutSequenceState;

  constructor(shortcutConf: IShortcutConfEntry) {
    super();
    this.sequence = shortcutConf.shortcuts;
    this.action = shortcutConf.mainAction ?? null;
    this.registerAction = shortcutConf.registerAction ?? null;
    this._currentIndex = 0;
    this.timeout =
      shortcutConf.sequenceTime !== null
        ? shortcutConf.sequenceTime
        : CONFIG.shortcutSequenceTime;
    this._beginTime = getTime();
    this._state = "inProcess";
  }
  public next(shortcut: Shortcut): ShortcutSequenceState {
    if (this.state !== "inProcess") return this.state;
    this._currentIndex++;
    this._beginTime = getTime();
    if (shortcut.name === this.sequence[this._currentIndex]) {
      if (this._currentIndex === this.sequence.length - 1) {
        this.state = "finish";
      } else {
        this.state = "inProcess";
      }
    } else {
      this.state = "failed";
    }
    return this.state;
  }
}
