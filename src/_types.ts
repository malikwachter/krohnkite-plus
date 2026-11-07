/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

type NonNullableProps<T> = { [K in keyof T]: NonNullable<T[K]> };
type PartialWithRequired<T, K extends keyof T> = Partial<T> &
  Required<Pick<T, K>>;
type percentType = number;
type Direction = "up" | "down" | "left" | "right";
/* Where the pointer should land when Krohnkite moves it: the center of the
 * active window or the center of the active screen. */
type PointerTarget = "window" | "screen";
// TODO: DELETE Position type
type Position = "left" | "middle" | "right" | "upper" | "bottom" | "single";
function getOppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case "right":
      return "left";
    case "left":
      return "right";
    case "up":
      return "down";
    case "down":
      return "up";
  }
}

const ArrangeReason = {
  forcedArrangeScreen: "forcedArrangeScreen",
  moveWindowToOutput: "moveWindowToOutput",
  transferWindowToVDesktop: "transferWindowToVDesktop",
  quickRelocationWindows: "quickRelocationWindows",
  relocationOutputChangedCB: "relocationOutputChangedCB",
  relocationCompletionCB: "relocationCompletionCB",
  manageDock: "manageDock",
  outputChangedCB: "outputChangedCB",
  activitiesChangedCB: "activitiesChangedCB",
  screensChangedCB: "screensChangedCB",
  virtualScreenGeometryChangedCB: "virtualScreenGeometryChangedCB",
  currentDesktopChangedCB: "currentDesktopChangedCB",
  windowRemovedCB: "windowRemovedCB",
  currentActivityChangedCB: "currentActivityChangedCB",
  windowAdded: "windowAdded",
  windowDesktopsChangedCB: "windowDesktopsChangedCB",
  windowFullScreenChangedCB: "windowFullScreenChangedCB",
  windowMinimizedChangedCB: "windowMinimizedChangedCB",
  windowSkipPagerCB: "windowSkipPagerCB",
  windowInteractiveMoveResizeSteppedCB: "WindowInteractiveMoveResizeSteppedCB",
  windowMoveResizedChangedCB: "windowMoveResizedChangedCB",
  windowBufferGeometryChangedCB: "windowBufferGeometryChangedCB",
  windowMaximizeAboutChangeCB: "windowMaximizeAboutChangeCB",
  stackingOrderChanged: "stackingOrderChanged",
  shortcutCB: "shortcutCB",
  shortcutLayoutCB: "shortcutLayoutCB",
  /* Kröhnkite-Plus */
  zoom: "zoom",
  unzoom: "unzoom",
  zoomResize: "zoomResize",
  undo: "undo",
  focusGrow: "focusGrow",
  dragFinish: "dragFinish",
  learnedMinSize: "learnedMinSize",
  stateRestored: "stateRestored",
  gamingModeOff: "gamingModeOff",
} as const;
type ArrangeReason = (typeof ArrangeReason)[keyof typeof ArrangeReason];

const ConfigVariables = {
  /* Layouts */
  tileLayoutInitialRotationAngle: "tileLayoutInitialRotationAngle",
  monocleMaximize: "monocleMaximize",
  monocleMinimizeRest: "monocleMinimizeRest",
  quarterLayoutReset: "quarterLayoutReset",
  columnsLayoutInitialRotationAngle: "columnsLayoutInitialRotationAngle",
  columnsBalanced: "columnsBalanced",
  columnsLayerConf: "columnsLayerConf",
  columnsApplyConfOnNewColumns: "columnsApplyConfOnNewColumns",
  columnsLimitColumns: "columnsLimitColumns",
  stairReverse: "stairReverse",
  spreadLayoutSpace: "spreadLayoutSpace",
  /* Layout enabled */
  tileLayoutEnabled: "tileLayoutEnabled",
  monocleLayoutEnabled: "monocleLayoutEnabled",
  threeColumnLayoutEnabled: "threeColumnLayoutEnabled",
  spiralLayoutEnabled: "spiralLayoutEnabled",
  quarterLayoutEnabled: "quarterLayoutEnabled",
  stackedLayoutEnabled: "stackedLayoutEnabled",
  columnsLayoutEnabled: "columnsLayoutEnabled",
  spreadLayoutEnabled: "spreadLayoutEnabled",
  floatingLayoutEnabled: "floatingLayoutEnabled",
  stairLayoutEnabled: "stairLayoutEnabled",
  binaryTreeLayoutEnabled: "binaryTreeLayoutEnabled",
  cascadeLayoutEnabled: "cascadeLayoutEnabled",
  smartLayoutEnabled: "smartLayoutEnabled",
  /* Layout orders */
  tileLayoutOrder: "tileLayoutOrder",
  monocleLayoutOrder: "monocleLayoutOrder",
  threeColumnLayoutOrder: "threeColumnLayoutOrder",
  spiralLayoutOrder: "spiralLayoutOrder",
  quarterLayoutOrder: "quarterLayoutOrder",
  stackedLayoutOrder: "stackedLayoutOrder",
  columnsLayoutOrder: "columnsLayoutOrder",
  spreadLayoutOrder: "spreadLayoutOrder",
  floatingLayoutOrder: "floatingLayoutOrder",
  stairLayoutOrder: "stairLayoutOrder",
  binaryTreeLayoutOrder: "binaryTreeLayoutOrder",
  cascadeLayoutOrder: "cascadeLayoutOrder",
  smartLayoutOrder: "smartLayoutOrder",
  /* Layout capacities */
  tileLayoutCapacity: "tileLayoutCapacity",
  threeColumnLayoutCapacity: "threeColumnLayoutCapacity",
  spiralLayoutCapacity: "spiralLayoutCapacity",
  stackedLayoutCapacity: "stackedLayoutCapacity",
  columnsLayoutCapacity: "columnsLayoutCapacity",
  spreadLayoutCapacity: "spreadLayoutCapacity",
  stairLayoutCapacity: "stairLayoutCapacity",
  binaryTreeLayoutCapacity: "binaryTreeLayoutCapacity",
  cascadeLayoutCapacity: "cascadeLayoutCapacity",
  smartLayoutCapacity: "smartLayoutCapacity",
  /* Surfaces */
  srfExceededToScreen: "srfExceededToScreen",
  srfToScreenOrderLeft: "srfToScreenOrderLeft",
  srfToScreenOrderTop: "srfToScreenOrderTop",
  srfToScreenOrderRight: "srfToScreenOrderRight",
  srfToScreenOrderBottom: "srfToScreenOrderBottom",
  srfExceededToVDesktop: "srfExceededToVDesktop",
  srfToVDesktopOrderLeft: "srfToVDesktopOrderLeft",
  srfToVDesktopOrderTop: "srfToVDesktopOrderTop",
  srfToVDesktopOrderRight: "srfToVDesktopOrderRight",
  srfToVDesktopOrderBottom: "srfToVDesktopOrderBottom",
  srfOvercapacityEviction: "srfOvercapacityEviction",
  srfOvercapacityMode: "srfOvercapacityMode",
  srfAllowShortcutMoveToFullSurface: "srfAllowShortcutMoveToFullSurface",
  srfDefineCfg: "srfDefineCfg",
  srfDefaultConfig: "srfDefaultConfig",
  /* Geometry */
  screenGapTop: "screenGapTop",
  screenGapLeft: "screenGapLeft",
  screenGapBetween: "screenGapBetween",
  screenGapRight: "screenGapRight",
  screenGapBottom: "screenGapBottom",
  gapsOverrideConfig: "gapsOverrideConfig",
  limitTileWidth: "limitTileWidth",
  limitTileWidthRatio: "limitTileWidthRatio",
  /* Shortcuts */
  shortcutConf: "shortcutConf",
  altRegisterTimeout: "altRegisterTimeout",
  altRegisterIsToggle: "altRegisterIsToggle",
  altRegisterIsPushedTwice: "altRegisterIsPushedTwice",
  shortcutSequenceTime: "shortcutSequenceTime",
  /* Behavior */
  adjustLayout: "adjustLayout",
  adjustLayoutLive: "adjustLayoutLive",
  focusNormal: "focusNormal",
  focusMeta: "focusMeta",
  focusMoveScreensNormal: "focusMoveScreensNormal",
  focusMoveVDesktopsNormal: "focusMoveVDesktopsNormal",
  focusMoveScreensMeta: "focusMoveScreensMeta",
  focusMoveVDesktopsMeta: "focusMoveVDesktopsMeta",
  movePointerOnFocus: "movePointerOnFocus",
  movePointerOnFocusShortcutsOnly: "movePointerOnFocusShortcutsOnly",
  movePointerOnResize: "movePointerOnResize",
  newWindowPosition: "newWindowPosition",
  /* Rules */
  ignoreClass: "ignoreClass",
  ignoreTitle: "ignoreTitle",
  ignoreRole: "ignoreRole",
  ignoreActivity: "ignoreActivity",
  ignoreScreen: "ignoreScreen",
  ignoreVDesktop: "ignoreVDesktop",
  tileNothing: "tileNothing",
  tilingClass: "tilingClass",
  screenDefaultLayout: "screenDefaultLayout",
  /* Float */
  floatDefaultSizeEnable: "floatDefaultSizeEnable",
  floatDefaultWidth: "floatDefaultWidth",
  floatDefaultHeight: "floatDefaultHeight",
  floatRandomEnable: "floatRandomEnable",
  floatRandomWidth: "floatRandomWidth",
  floatRandomHeight: "floatRandomHeight",
  floatSizeStepWidth: "floatSizeStepWidth",
  floatSizeStepHeight: "floatSizeStepHeight",
  floatAsDefault: "floatAsDefault",
  floatUtility: "floatUtility",
  floatConfig: "floatConfig",

  /* Dock */
  dockOrderLeft: "dockOrderLeft",
  dockOrderTop: "dockOrderTop",
  dockOrderRight: "dockOrderRight",
  dockOrderBottom: "dockOrderBottom",
  dockHHeight: "dockHHeight",
  dockHWide: "dockHWide",
  dockHGap: "dockHGap",
  dockHEdgeGap: "dockHEdgeGap",
  dockHAlignment: "dockHAlignment",
  dockHEdgeAlignment: "dockHEdgeAlignment",
  dockVHeight: "dockVHeight",
  dockVWide: "dockVWide",
  dockVGap: "dockVGap",
  dockVEdgeGap: "dockVEdgeGap",
  dockVAlignment: "dockVAlignment",
  dockVEdgeAlignment: "dockVEdgeAlignment",
  dockSurfacesConfig: "dockSurfacesConfig",
  dockWindowClassConfig: "dockWindowClassConfig",
  dockFrameColor: "dockFrameColor",
  dockBorderColor: "dockBorderColor",
  dockTopDragZone: "dockTopDragZone",
  dockBottomDragZone: "dockBottomDragZone",
  dockLeftDragZone: "dockLeftDragZone",
  dockRightDragZone: "dockRightDragZone",
  /* Options */
  tiledWindowsLayer: "tiledWindowsLayer",
  floatedWindowsLayer: "floatedWindowsLayer",
  soleWindowWidth: "soleWindowWidth",
  soleWindowHeight: "soleWindowHeight",
  soleWindowNoBorders: "soleWindowNoBorders",
  soleWindowNoGaps: "soleWindowNoGaps",
  soleWindowOutputOverride: "soleWindowOutputOverride",
  unfitGreater: "unfitGreater",
  unfitLess: "unfitLess",
  notificationDuration: "notificationDuration",
  layoutPerActivity: "layoutPerActivity",
  layoutPerDesktop: "layoutPerDesktop",
  noTileBorder: "noTileBorder",
  optVKeyboardSupport: "optVKeyboardSupport",
  keepTilingOnDrag: "keepTilingOnDrag",
  dragPreview: "dragPreview",
  preventMinimize: "preventMinimize",
  preventProtrusion: "preventProtrusion",
  floatSkipPagerWindows: "floatSkipPagerWindows",
  /* Kröhnkite-Plus */
  smartTargetAspect: "smartTargetAspect",
  smartFloat: "smartFloat",
  smartFloatTitles: "smartFloatTitles",
  smartFocusGrow: "smartFocusGrow",
  gamingMode: "gamingMode",
  gameClasses: "gameClasses",
  gamePauseFullscreen: "gamePauseFullscreen",
  animationDuration: "animationDuration",
  zoomMarginX: "zoomMarginX",
  zoomMarginY: "zoomMarginY",
  undoDepth: "undoDepth",
  smartPersist: "smartPersist",
  smartCenterDialogs: "smartCenterDialogs",
  smartRememberFloat: "smartRememberFloat",
  windowRules: "windowRules",
  /* Logging */
  logging: "logging",
  logNewWindows: "logNewWindows",
  logFilteredWindows: "logFilteredWindows",
  logUnmanagedWindows: "logUnmanagedWindows",
  logWorkspaceSignals: "logWorkspaceSignals",
  logWorkspaceSignalsSubmodules: "logWorkspaceSignalsSubmodules",
  logWindowSignals: "logWindowSignals",
  logWindowSignalsSubmodules: "logWindowSignalsSubmodules",
  logOther: "logOther",
  logOtherSubmodules: "logOtherSubmodules",
  logFilter: "logFilter",
  logFilterStr: "logFilterStr",
} as const;
type ConfigVariables = (typeof ConfigVariables)[keyof typeof ConfigVariables];

const WindowState = {
  /* initial value */
  Unmanaged: "Unmanaged",

  /* script-external state - overrides internal state */
  NativeFullscreen: "NativeFullscreen",
  NativeMaximized: "NativeMaximized",

  /* script-internal state */
  Floating: "Floating",
  Maximized: "Maximized",
  Tiled: "Tiled",
  TiledAfloat: "TiledAfloat",
  Undecided: "Undecided",
  Docked: "Docked",
} as const;
type WindowState = (typeof WindowState)[keyof typeof WindowState];
type ToggleableState = Extract<WindowState, "Tiled" | "Floating" | "Docked">;

const KrohnkiteAction = {
  FocusNext: "FocusNext",
  FocusPrev: "FocusPrev",
  DWMLeft: "DWMLeft",
  DWMRight: "DWMRight",

  FocusUp: "FocusUp",
  FocusDown: "FocusDown",
  FocusLeft: "FocusLeft",
  FocusRight: "FocusRight",

  MoveLeft: "MoveLeft",
  MoveRight: "MoveRight",
  MoveUp: "MoveUp",
  MoveDown: "MoveDown",

  SwapUp: "SwapUp",
  SwapDown: "SwapDown",

  GrowWidth: "GrowWidth",
  GrowHeight: "GrowHeight",
  ShrinkWidth: "ShrinkWidth",
  ShrinkHeight: "ShrinkHeight",

  Increase: "Increase",
  Decrease: "Decrease",

  ToggleFloat: "ToggleFloat",
  ToggleFloatAll: "ToggleFloatAll",
  SetMaster: "SetMaster",
  NextLayout: "NextLayout",
  PreviousLayout: "PreviousLayout",
  LayoutChooser: "LayoutChooser",

  SetTileLayout: "SetTileLayout",
  SetMonocleLayout: "SetMonocleLayout",
  SetThreeColumnLayout: "SetThreeColumnLayout",
  SetSpreadLayout: "SetSpreadLayout",
  SetStairLayout: "SetStairLayout",
  SetFloatingLayout: "SetFloatingLayout",
  SetQuarterLayout: "SetQuarterLayout",
  SetStackedLayout: "SetStackedLayout",
  SetColumnsLayout: "SetColumnsLayout",
  SetSpiralLayout: "SetSpiralLayout",
  SetBinaryTreeLayout: "SetBinaryTreeLayout",
  SetCascadeLayout: "SetCascadeLayout",

  Rotate: "Rotate",
  RotatePart: "RotatePart",

  ToggleDock: "ToggleDock",

  RaiseSurfaceCapacity: "RaiseSurfaceCapacity",
  LowerSurfaceCapacity: "LowerSurfaceCapacity",
  ResetSurfaceCapacity: "ResetSurfaceCapacity",
  ShowCurrentCapacity: "ShowCurrentCapacity",

  AlterRegister: "AlterRegister",
  ToggleRegister: "ToggleRegister",

  /* Kröhnkite-Plus */
  SetSmartLayout: "SetSmartLayout",
  Zoom: "Zoom",
  Undo: "Undo",
  Redo: "Redo",
} as const;
type KrohnkiteAction = (typeof KrohnkiteAction)[keyof typeof KrohnkiteAction];

// Logging
const LogModules = {
  newWindowAdded: "newWindowAdded",
  newWindowFiltered: "newWindowFiltered",
  newWindowUnmanaged: "newWindowUnmanaged",

  screensChanged: "screensChanged",
  virtualScreenGeometryChanged: "virtualScreenGeometryChanged",
  currentActivityChanged: "currentActivityChanged",
  currentDesktopChanged: "currentDesktopChanged",
  windowAdded: "windowAdded",
  windowActivated: "windowActivated",
  windowRemoved: "windowRemoved",
  surfaceChanged: "surfaceChanged",

  activitiesChanged: "activitiesChanged",
  bufferGeometryChanged: "bufferGeometryChanged",
  desktopsChanged: "desktopsChanged",
  fullScreenChanged: "fullScreenChanged",
  interactiveMoveResizeStepped: "interactiveMoveResizeStepped",
  maximizedAboutToChange: "maximizedAboutToChange",
  minimizedChanged: "minimizedChanged",
  moveResizedChanged: "moveResizedChanged",
  outputChanged: "outputChanged",
  stackingOrderChanged: "stackingOrderChanged",
  shortcut: "shortcut",
  arrangeScreen: "arrangeScreen",
  printConfig: "printConfig",
  setTimeout: "setTimeout",
  window: "window",
  dbus: "dbus",
} as const;
type LogModule = (typeof LogModules)[keyof typeof LogModules];

const LogPartitions = {
  newWindow: {
    number: 100,
    name: "newWindow",
    modules: [
      LogModules.newWindowAdded,
      LogModules.newWindowFiltered,
      LogModules.newWindowUnmanaged,
    ],
  },
  workspaceSignals: {
    number: 200,
    name: "workspaceSignal",
    modules: [
      LogModules.screensChanged,
      LogModules.virtualScreenGeometryChanged,
      LogModules.currentActivityChanged,
      LogModules.currentDesktopChanged,
      LogModules.windowAdded,
      LogModules.windowActivated,
      LogModules.windowRemoved,
      LogModules.surfaceChanged,
    ],
  },
  windowSignals: {
    number: 300,
    name: "windowSignal",
    modules: [
      LogModules.activitiesChanged,
      LogModules.bufferGeometryChanged,
      LogModules.desktopsChanged,
      LogModules.fullScreenChanged,
      LogModules.interactiveMoveResizeStepped,
      LogModules.maximizedAboutToChange,
      LogModules.minimizedChanged,
      LogModules.moveResizedChanged,
      LogModules.outputChanged,
      LogModules.stackingOrderChanged,
    ],
  },
  other: {
    number: 1000,
    name: "other",
    modules: [
      LogModules.shortcut,
      LogModules.arrangeScreen,
      LogModules.printConfig,
      LogModules.setTimeout,
      LogModules.window,
      LogModules.dbus,
    ],
  },
} as const;
type LogPartition = (typeof LogPartitions)[keyof typeof LogPartitions];
