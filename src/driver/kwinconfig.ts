/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/
const enum WinTypes {
  tiled = 1,
  docked = 2,
  float = 4,
  surfaces = 8,
  special = 16,
}
const winTypesCfg = [
  WinTypes.docked | WinTypes.float | WinTypes.tiled,
  WinTypes.surfaces,
  WinTypes.tiled,
  WinTypes.float,
  WinTypes.docked,
  WinTypes.tiled | WinTypes.float,
  WinTypes.tiled | WinTypes.docked,
  WinTypes.float | WinTypes.docked,
  WinTypes.special,
];
interface ISortedLayouts {
  order: number;
  layoutClass: ILayoutClass;
  isCapacity: boolean;
}
interface ISoleWindowProps {
  width: number;
  height: number;
  noGaps: boolean;
  noBorders: boolean;
}
interface IFloatWindowsConfig {
  isNativeSizeOverride: boolean;
  floatWidth: number;
  floatHeight: number;
  randomize: boolean;
  randomWidth: number;
  randomHeight: number;
  sizeStepWidth: number;
  sizeStepHeight: number;
  config: IFloatWindow[];
}
type IndentValue = {
  value: number;
  unit: "px" | "%";
};
interface IFloatWindow {
  class: string;
  title: string;
  shouldFloat: boolean;
  auto: boolean;
  width: number | null;
  height: number | null;
  leftIndent: IndentValue | null;
  topIndent: IndentValue | null;
  stepWidth: number | null;
  stepHeight: number | null;
}

interface IShortcutConfEntry {
  shortcuts: ShortcutName[];
  /** undefined: flag not specified; null: explicitly cleared with "null". */
  mainAction: KrohnkiteAction | null | undefined;
  /** undefined: flag not specified; null: explicitly cleared with "null". */
  registerAction: KrohnkiteAction | null | undefined;
  sequenceTime: number | null;
}

/* Window classes that are always ignored, regardless of the user config.
 * They are merged with the "ignoreClass" setting, so the Rules -> By Class
 * field can stay empty by default without tiling KDE system windows. */
const hardcodedIgnoreClasses: string[] = [
  "krunner",
  "yakuake",
  "spectacle",
  "kded5",
  "xwaylandvideobridge",
  "plasmashell",
  "ksplashqml",
  "org.kde.plasmashell",
  "org.kde.polkit-kde-authentication-agent-1",
  "org.kde.kruler",
  "kruler",
  "kwin_wayland",
  "ksmserver-logout-greeter",
  "org.krohnkite.configurator",
];

/* System Settings hosts the Krohnkite configuration form in a separate
 * "Configure — System Settings" dialog. Match that dialog's exact localized
 * caption, not just the app name: brackets would also match the main System
 * Settings window, which must stay tiled. */
const hardcodedFloatConfig: string[] = [
  "systemsettings:Configure — System Settings:auto=1",
  "systemsettings:Настройка — Параметры системы:auto=1",
  "systemsettings:配置 — 系统设置:auto=1",
];

function isValidConfigKey(key: string): key is keyof typeof ConfigVariables {
  return key in ConfigVariables;
}

function toCssColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const str = value.trim();
  if (str.length === 0) return fallback;
  if (str.charAt(0) === "#") return str;
  if (str.indexOf(",") !== -1) {
    const parts = str.split(",").map((part) => parseInt(part.trim(), 10));
    if (
      (parts.length === 3 || parts.length === 4) &&
      parts.every((part) => !isNaN(part))
    ) {
      const clamp = (n: number) => Math.max(0, Math.min(255, n));
      const r = clamp(parts[0]);
      const g = clamp(parts[1]);
      const b = clamp(parts[2]);
      const a = clamp(parts.length === 4 ? parts[3] : 255);
      const hex = (n: number) => (n < 16 ? "0" : "") + n.toString(16);
      return "#" + hex(a) + hex(r) + hex(g) + hex(b);
    }
  }
  return fallback;
}

class KWinConfig implements IConfig {
  /*
   * Layouts
   * */
  public tileLayoutInitialAngle: string;
  public monocleMaximize: boolean;
  public monocleMinimizeRest: boolean;
  public quarterLayoutReset: boolean;
  public columnsLayoutInitialAngle: string;
  public columnsBalanced: boolean;
  public columnsLayerConf: string[];
  public columnsApplyConfOnNewColumns: boolean;
  public columnsLimitColumns: boolean;
  public stairReverse: boolean;
  public spreadLayoutSpace: number;
  public layoutOrder: string[];
  public layoutFactories: { [key: string]: () => ILayout };
  private layoutFactoryCapacities: { [key: string]: number | null };
  private loggingConfig: {
    enabled: boolean;
    parts: [LogPartition, string[]][];
    filters: string[];
  };
  /*
   * Surfaces
   * */
  public srfExceededToScreen: boolean;
  public srfToScreenOrder: Direction[];
  public srfExceededToVDesktop: boolean;
  public srfToVDesktopOrder: Direction[];
  public srfOvercapacityEviction: OvercapacityEvictionPolicy;
  public srfOvercapacityMode: OvercapacityMode;
  public srfAllowShortcutMoveToFullSurface: boolean;
  public srfDefineCfg: string[];
  public srfDefaultConfig: string[];
  /*
   * Shortcuts
   * */
  public altRegisterTimeout: number;
  public altRegisterIsToggle: boolean;
  public altRegisterIsPushedTwice: boolean;
  public shortcutSequenceTime: number;
  public shortcutConf: IShortcutConfEntry[];
  /*
   * Geometry
   * */
  public screenGapTop: number;
  public screenGapLeft: number;
  public screenGapBetween: number;
  public screenGapRight: number;
  public screenGapBottom: number;
  public gapsOverrideConfig: string[];
  public limitTileWidthRatio: number;
  /*
   * Behavior
   * */
  public adjustLayout: boolean;
  public adjustLayoutLive: boolean;
  public focusNormalCfg: WinTypes;
  public focusMetaCfg: WinTypes;
  public focusMoveScreensNormal: boolean;
  public focusMoveVDesktopsNormal: boolean;
  public focusMoveScreensMeta: boolean;
  public focusMoveVDesktopsMeta: boolean;
  public movePointerOnFocus: boolean;
  public movePointerOnFocusShortcutsOnly: boolean;
  public movePointerOnResize: boolean;
  public newWindowPosition: "last" | "first" | "second";
  /*
   * Rules
   * */
  public ignoreClass: string[];
  public ignoreTitle: string[];
  public ignoreRole: string[];
  public ignoreActivity: string[];
  public ignoreScreen: string[];
  public ignoreVDesktop: string[];
  public tileNothing: boolean;
  public tilingClass: string[];
  public screenDefaultLayout: string[];
  /*
   * Float
   * */
  public floatAsDefault: boolean;
  public floatUtility: boolean;
  public floatConfig: IFloatWindowsConfig;

  /*
   * Dock
   * */
  public dockOrder: [number, number, number, number];
  public dockHHeight: number;
  public dockHWide: number;
  public dockHGap: number;
  public dockHEdgeGap: number;
  public dockHAlignment: number;
  public dockHEdgeAlignment: number;
  public dockVHeight: number;
  public dockVWide: number;
  public dockVGap: number;
  public dockVEdgeGap: number;
  public dockVAlignment: number;
  public dockVEdgeAlignment: number;
  public dockSurfacesConfig: string[];
  public dockWindowClassConfig: string[];
  public dockFrameColor: string;
  public dockBorderColor: string;
  public dockTopDragZone: number;
  public dockBottomDragZone: number;
  public dockLeftDragZone: number;
  public dockRightDragZone: number;
  /*
   * Options
   * */
  public tiledWindowsLayer: number;
  public floatedWindowsLayer: number;

  public soleWindowDefaultProps: ISoleWindowProps;
  public soleWindowOutputOverride: { [outputName: string]: ISoleWindowProps };

  public unfitLess: boolean;
  public unfitGreater: boolean;

  public notificationDuration: number;

  public layoutPerActivity: boolean;
  public layoutPerDesktop: boolean;
  public noTileBorder: boolean;
  public optVKeyboardSupport: boolean;
  public keepTilingOnDrag: boolean;
  public dragPreview: boolean;
  public preventMinimize: boolean;
  public preventProtrusion: boolean;
  public floatSkipPager: boolean;
  /*
   * Kröhnkite-Plus
   * */
  public windowRules: WindowRules;
  public smartFloat: boolean;
  public smartFloatTitles: string[];
  public smartRememberFloat: boolean;
  public smartCenterDialogs: boolean;
  public gamingMode: boolean;
  public gameClasses: string[];
  public gamePauseFullscreen: boolean;
  public smartFocusGrow: number;
  public smartPersist: boolean;
  public animationDuration: number;
  /** popup layer: dialogs are packed around the middle of the screen */
  public popupLayer: boolean;
  public popupKeepAbove: boolean;
  public popupMinWidth: number;
  public popupMinHeight: number;
  /** tray layer: 0 = close (back to the tray), 1 = minimize */
  public quickviewHide: number;
  public zoomMarginX: number;
  public zoomMarginY: number;
  public undoDepth: number;
  public smartTargetAspect: number;
  /*
   * Log
   * */

  constructor() {
    /***************************
     ****************** Layouts
     **************************/
    this.tileLayoutInitialAngle = KWIN.readConfig(
      "tileLayoutInitialRotationAngle",
      "0",
    );
    this.monocleMaximize = KWIN.readConfig("monocleMaximize", true);
    this.monocleMinimizeRest = KWIN.readConfig("monocleMinimizeRest", false);
    this.quarterLayoutReset = KWIN.readConfig("quarterLayoutReset", false);
    this.columnsLayoutInitialAngle = KWIN.readConfig(
      "columnsLayoutInitialRotationAngle",
      "0",
    );
    this.columnsBalanced = KWIN.readConfig("columnsBalanced", false);
    this.columnsLayerConf = separate(
      KWIN.readConfig("columnsLayerConf", ""),
      ",",
    );
    this.columnsApplyConfOnNewColumns = KWIN.readConfig(
      "columnsApplyConfOnNewColumns",
      false,
    );
    this.columnsLimitColumns = KWIN.readConfig("columnsLimitColumns", false);
    this.stairReverse = KWIN.readConfig("stairReverse", false);
    this.spreadLayoutSpace = validateNumberWithDefault(
      KWIN.readConfig("spreadLayoutSpace", 4),
      4,
      "spreadLayoutSpace",
      0,
      15,
    );

    const layoutsList = [
      [TileLayout, true],
      [MonocleLayout, false],
      [ThreeColumnLayout, true],
      [SpiralLayout, true],
      [QuarterLayout, false],
      [StackedLayout, true],
      [ColumnsLayout, true],
      [SpreadLayout, true],
      [FloatingLayout, false],
      [StairLayout, true],
      [BinaryTreeLayout, true],
      [CascadeLayout, true],
      [SmartLayout, true],
    ] as Array<[ILayoutClass, boolean]>;
    const sortedLayouts: ISortedLayouts[] =
      KWinConfig.getSortedLayouts(layoutsList);
    this.layoutOrder = KWinConfig.getLayoutOrder(sortedLayouts);
    const layoutConfig = KWinConfig.getLayoutFactories(sortedLayouts);
    this.layoutFactories = layoutConfig.factories;
    this.layoutFactoryCapacities = layoutConfig.capacities;

    //***************************
    //****************** Surfaces
    //***************************
    this.srfExceededToScreen = KWIN.readConfig("srfExceededToScreen", false);
    // Define the config mapping (cleaner and easier to maintain)
    const directionConfigs: {
      direction: Direction;
      screenKey: keyof typeof ConfigVariables;
      vDesktopKey: keyof typeof ConfigVariables;
      defaultOrder: number;
    }[] = [
      {
        direction: "left",
        screenKey: "srfToScreenOrderLeft",
        vDesktopKey: "srfToVDesktopOrderLeft",
        defaultOrder: 1,
      },
      {
        direction: "up",
        screenKey: "srfToScreenOrderTop",
        vDesktopKey: "srfToVDesktopOrderTop",
        defaultOrder: 2,
      },
      {
        direction: "right",
        screenKey: "srfToScreenOrderRight",
        vDesktopKey: "srfToVDesktopOrderRight",
        defaultOrder: 3,
      },
      {
        direction: "down",
        screenKey: "srfToScreenOrderBottom",
        vDesktopKey: "srfToVDesktopOrderBottom",
        defaultOrder: 4,
      },
    ];
    // Build the sorted array of directions
    this.srfToScreenOrder = directionConfigs
      .map(({ direction, screenKey: key, defaultOrder }) => ({
        direction,
        order: Number(KWIN.readConfig(key, defaultOrder)), // ensure number
      }))
      .filter((el) => el.order !== 0) // exclude if order is 0
      .sort((a, b) => a.order - b.order) // ascending order
      .map((el) => el.direction); // extract direction strings

    this.srfExceededToVDesktop = KWIN.readConfig(
      "srfExceededToVDesktop",
      false,
    );
    this.srfToVDesktopOrder = directionConfigs
      .map(({ direction, vDesktopKey: key, defaultOrder }) => ({
        direction,
        order: Number(KWIN.readConfig(key, defaultOrder)), // ensure number
      }))
      .filter((el) => el.order !== 0) // exclude if order is 0
      .sort((a, b) => a.order - b.order) // ascending order
      .map((el) => el.direction); // extract direction strings
    this.srfOvercapacityEviction =
      Number(KWIN.readConfig("srfOvercapacityEviction", 1)) === 1
        ? "oldest"
        : "lastFocused";
    this.srfOvercapacityMode =
      Number(KWIN.readConfig("srfOvercapacityMode", 1)) === 0
        ? "float"
        : "minimize";
    this.srfAllowShortcutMoveToFullSurface = KWIN.readConfig(
      "srfAllowShortcutMoveToFullSurface",
      false,
    );
    this.srfDefineCfg = separate(KWIN.readConfig("srfDefineCfg", ""), "\n");
    this.srfDefaultConfig = separate(
      KWIN.readConfig("srfDefaultConfig", ""),
      "\n",
    );

    //***************************
    //****************** Geometry
    //***************************
    this.screenGapTop = KWIN.readConfig("screenGapTop", 0);
    this.screenGapLeft = KWIN.readConfig("screenGapLeft", 0);
    this.screenGapBetween = KWIN.readConfig("screenGapBetween", 0);
    this.screenGapRight = KWIN.readConfig("screenGapRight", 0);
    this.screenGapBottom = KWIN.readConfig("screenGapBottom", 0);
    this.gapsOverrideConfig = separate(
      KWIN.readConfig("gapsOverrideConfig", ""),
      "\n",
    );
    this.limitTileWidthRatio = 0;
    if (KWIN.readConfig("limitTileWidth", false))
      this.limitTileWidthRatio = KWIN.readConfig("limitTileWidthRatio", 1.6);

    //***************************
    //***************** Shortcuts
    //***************************
    this.altRegisterTimeout = validateNumberWithDefault(
      KWIN.readConfig("altRegisterTimeout", 3000),
      3000,
      "altRegisterTimeout",
      100,
      9999,
    );
    this.altRegisterIsToggle = KWIN.readConfig("altRegisterIsToggle", false);
    this.altRegisterIsPushedTwice = KWIN.readConfig(
      "altRegisterIsPushedTwice",
      false,
    );
    this.shortcutSequenceTime = validateNumberWithDefault(
      KWIN.readConfig("shortcutSequenceTime", 400),
      400,
      "shortcutSequenceTime",
      0,
      9999,
    );
    this.shortcutConf = parseShortcutConf(
      separate(KWIN.readConfig("shortcutConf", ""), "\n"),
    );

    //***************************
    //****************** Behavior
    //***************************
    this.adjustLayout = KWIN.readConfig("adjustLayout", true);
    this.adjustLayoutLive = KWIN.readConfig("adjustLayoutLive", true);

    this.focusNormalCfg =
      winTypesCfg[
        validateNumberWithDefault(
          KWIN.readConfig("focusNormal", 0),
          0,
          "focusNormal",
          0,
          winTypesCfg.length,
        )
      ];
    this.focusMetaCfg =
      winTypesCfg[
        validateNumberWithDefault(
          KWIN.readConfig("focusMeta", 1),
          1,
          "focusMeta",
          0,
          winTypesCfg.length,
        )
      ];

    this.focusMoveScreensNormal = KWIN.readConfig(
      "focusMoveScreensNormal",
      true,
    );
    this.focusMoveVDesktopsNormal = KWIN.readConfig(
      "focusMoveVDesktopsNormal",
      true,
    );
    this.focusMoveScreensMeta = KWIN.readConfig("focusMoveScreensMeta", false);
    this.focusMoveVDesktopsMeta = KWIN.readConfig(
      "focusMoveVDesktopsMeta",
      true,
    );
    this.movePointerOnFocus = KWIN.readConfig("movePointerOnFocus", false);
    this.movePointerOnFocusShortcutsOnly = KWIN.readConfig(
      "movePointerOnFocusShortcutsOnly",
      false,
    );
    this.movePointerOnResize = KWIN.readConfig("movePointerOnResize", false);
    this.newWindowPosition =
      (["last", "first", "second"] as const)[
        validateNumberWithDefault(
          KWIN.readConfig("newWindowPosition", 0),
          0,
          "newWindowPosition",
          0,
          2,
        )
      ] ?? "last";

    //***************************
    //****************** Rules
    //***************************
    this.ignoreClass = hardcodedIgnoreClasses.concat(
      separate(KWIN.readConfig("ignoreClass", ""), ","),
    );
    this.ignoreTitle = separate(KWIN.readConfig("ignoreTitle", ""), ",");
    this.ignoreRole = separate(KWIN.readConfig("ignoreRole", "quake"), ",");
    this.ignoreActivity = separate(KWIN.readConfig("ignoreActivity", ""), ",");
    this.ignoreScreen = separate(KWIN.readConfig("ignoreScreen", ""), ",");
    this.ignoreVDesktop = separate(KWIN.readConfig("ignoreVDesktop", ""), ",");
    this.tileNothing = KWIN.readConfig("tileNothing", false);
    this.tilingClass = separate(KWIN.readConfig("tilingClass", ""), ",");

    this.screenDefaultLayout = separate(
      KWIN.readConfig("screenDefaultLayout", ""),
      ",",
    );
    //***************************
    //****************** Float
    //***************************
    this.floatConfig = {
      isNativeSizeOverride: KWIN.readConfig("floatDefaultSizeEnable", false),
      floatWidth: validateNumberWithDefault(
        KWIN.readConfig("floatDefaultWidth", 50),
        50,
        "floatDefaultWidth",
        1,
        100,
      ),
      floatHeight: validateNumberWithDefault(
        KWIN.readConfig("floatDefaultHeight", 50),
        50,
        "floatDefaultHeight",
        1,
        100,
      ),
      randomize: KWIN.readConfig("floatRandomEnable", true),
      randomWidth: validateNumberWithDefault(
        KWIN.readConfig("floatRandomWidth", 15),
        15,
        "floatRandomWidth",
        1,
        100,
      ),
      randomHeight: validateNumberWithDefault(
        KWIN.readConfig("floatRandomHeight", 15),
        15,
        "floatRandomHeight",
        1,
        100,
      ),
      sizeStepWidth: validateNumberWithDefault(
        KWIN.readConfig("floatSizeStepWidth", 6),
        6,
        "floatSizeStepWidth",
        0,
        100,
      ),
      sizeStepHeight: validateNumberWithDefault(
        KWIN.readConfig("floatSizeStepHeight", 4),
        4,
        "floatSizeStepHeight",
        0,
        100,
      ),
      config: parseFloatConfig(
        hardcodedFloatConfig.concat(
          separate(KWIN.readConfig("floatConfig", ""), "\n"),
        ),
      ),
    };
    this.floatAsDefault = KWIN.readConfig("floatAsDefault", false);
    this.floatUtility = KWIN.readConfig("floatUtility", true);
    //***************************
    //****************** Dock
    //***************************
    this.dockOrder = [
      KWIN.readConfig("dockOrderLeft", 1),
      KWIN.readConfig("dockOrderTop", 2),
      KWIN.readConfig("dockOrderRight", 3),
      KWIN.readConfig("dockOrderBottom", 4),
    ];
    this.dockHHeight = KWIN.readConfig("dockHHeight", 15);
    this.dockHWide = KWIN.readConfig("dockHWide", 100);
    this.dockHGap = KWIN.readConfig("dockHGap", 0);
    this.dockHEdgeGap = KWIN.readConfig("dockHEdgeGap", 0);
    this.dockHAlignment = KWIN.readConfig("dockHAlignment", 0);
    this.dockHEdgeAlignment = KWIN.readConfig("dockHEdgeAlignment", 0);
    this.dockVHeight = KWIN.readConfig("dockVHeight", 100);
    this.dockVWide = KWIN.readConfig("dockVWide", 15);
    this.dockVEdgeGap = KWIN.readConfig("dockVEdgeGap", 0);
    this.dockVGap = KWIN.readConfig("dockVGap", 0);
    this.dockVAlignment = KWIN.readConfig("dockVAlignment", 0);
    this.dockVEdgeAlignment = KWIN.readConfig("dockVEdgeAlignment", 0);
    this.dockSurfacesConfig = separate(
      KWIN.readConfig("dockSurfacesConfig", ""),
      "\n",
    );
    this.dockWindowClassConfig = separate(
      KWIN.readConfig("dockWindowClassConfig", ""),
      "\n",
    );
    this.dockFrameColor = toCssColor(
      KWIN.readConfig("dockFrameColor", "61,135,240,77"),
      "#4d3d87f0",
    );
    this.dockBorderColor = toCssColor(
      KWIN.readConfig("dockBorderColor", "61,135,240,230"),
      "#e63d87f0",
    );
    this.dockTopDragZone = validateNumberWithDefault(
      KWIN.readConfig("dockTopDragZone", 15),
      15,
      "dockTopDragZone",
      0,
      999,
    );
    this.dockBottomDragZone = validateNumberWithDefault(
      KWIN.readConfig("dockBottomDragZone", 15),
      15,
      "dockBottomDragZone",
      0,
      999,
    );
    this.dockLeftDragZone = validateNumberWithDefault(
      KWIN.readConfig("dockLeftDragZone", 15),
      15,
      "dockLeftDragZone",
      0,
      999,
    );
    this.dockRightDragZone = validateNumberWithDefault(
      KWIN.readConfig("dockRightDragZone", 15),
      15,
      "dockRightDragZone",
      0,
      999,
    );

    //***************************
    //****************** Options
    //***************************
    this.tiledWindowsLayer = getWindowLayer(
      KWIN.readConfig("tiledWindowsLayer", 0),
    );
    this.floatedWindowsLayer = getWindowLayer(
      KWIN.readConfig("floatedWindowsLayer", 1),
    );

    this.soleWindowDefaultProps = {
      width: validateNumberWithDefault(
        KWIN.readConfig("soleWindowWidth", 100),
        100,
        "soleWindowDefault.Width",
        1,
        100,
        true,
      ),
      height: validateNumberWithDefault(
        KWIN.readConfig("soleWindowHeight", 100),
        100,
        "soleWindowDefault.Height",
        1,
        100,
        true,
      ),

      noBorders: Boolean(KWIN.readConfig("soleWindowNoBorders", false)),
      noGaps: Boolean(KWIN.readConfig("soleWindowNoGaps", false)),
    };

    this.soleWindowOutputOverride = KWinConfig.getSoleWindowsOverriddenProps(
      KWIN.readConfig("soleWindowOutputOverride", ""),
      this.soleWindowDefaultProps,
    );

    this.unfitLess = KWIN.readConfig("unfitLess", true);
    this.unfitGreater = KWIN.readConfig("unfitGreater", false);

    this.notificationDuration = KWIN.readConfig("notificationDuration", 1000);

    this.layoutPerActivity = KWIN.readConfig("layoutPerActivity", true);
    this.layoutPerDesktop = KWIN.readConfig("layoutPerDesktop", true);
    this.noTileBorder = KWIN.readConfig("noTileBorder", false);

    this.optVKeyboardSupport = KWIN.readConfig("optVKeyboardSupport", false);

    this.keepTilingOnDrag = KWIN.readConfig("keepTilingOnDrag", true);
    this.dragPreview = KWIN.readConfig("dragPreview", true);
    this.preventMinimize = KWIN.readConfig("preventMinimize", false);
    if (this.preventMinimize && this.monocleMinimizeRest) {
      this.preventMinimize = false;
    }
    this.preventProtrusion = KWIN.readConfig("preventProtrusion", true);
    this.floatSkipPager = KWIN.readConfig("floatSkipPagerWindows", false);

    //***************************
    //****************** Kröhnkite-Plus
    //***************************
    this.windowRules = new WindowRules(
      String(KWIN.readConfig("windowRules", defaultWindowRules())).split("\n"),
    );
    this.smartFloat = KWIN.readConfig("smartFloat", true);
    this.smartFloatTitles = separate(
      KWIN.readConfig(
        "smartFloatTitles",
        "Picture-in-Picture,Picture in picture,Bild-im-Bild,Bild im Bild",
      ),
      ",",
    ).map((t) => t.toLowerCase());
    this.smartRememberFloat = KWIN.readConfig("smartRememberFloat", true);
    this.smartCenterDialogs = KWIN.readConfig("smartCenterDialogs", true);
    this.gamingMode = KWIN.readConfig("gamingMode", true);
    this.gameClasses = separate(
      KWIN.readConfig("gameClasses", "steam_app_,gamescope,steam_proton"),
      ",",
    ).map((c) => c.toLowerCase());
    this.gamePauseFullscreen = KWIN.readConfig("gamePauseFullscreen", true);
    this.smartFocusGrow =
      validateNumberWithDefault(
        KWIN.readConfig("smartFocusGrow", 50),
        50,
        "smartFocusGrow",
        0,
        300,
      ) / 100;
    this.smartPersist = KWIN.readConfig("smartPersist", true);
    this.animationDuration = validateNumberWithDefault(
      KWIN.readConfig("animationDuration", 150),
      150,
      "animationDuration",
      0,
      2000,
    );
    this.zoomMarginX =
      validateNumberWithDefault(KWIN.readConfig("zoomMarginX", 7), 7, "zoomMarginX", 0, 40) / 100;
    this.zoomMarginY =
      validateNumberWithDefault(KWIN.readConfig("zoomMarginY", 3), 3, "zoomMarginY", 0, 40) / 100;
    this.popupLayer = KWIN.readConfig("popupLayer", true);
    this.popupKeepAbove = KWIN.readConfig("popupKeepAbove", true);
    this.popupMinWidth = validateNumberWithDefault(
      KWIN.readConfig("popupMinWidth", 480), 480, "popupMinWidth", 0, 4000);
    this.popupMinHeight = validateNumberWithDefault(
      KWIN.readConfig("popupMinHeight", 300), 300, "popupMinHeight", 0, 4000);
    this.quickviewHide = validateNumberWithDefault(
      KWIN.readConfig("quickviewHide", 0), 0, "quickviewHide", 0, 1);
    this.undoDepth = validateNumberWithDefault(
      KWIN.readConfig("undoDepth", 50),
      50,
      "undoDepth",
      1,
      500,
    );
    this.smartTargetAspect =
      validateNumberWithDefault(
        KWIN.readConfig("smartTargetAspect", 130),
        130,
        "smartTargetAspect",
        50,
        400,
      ) / 100;

    //***************************
    //****************** Log
    //***************************
    const loggingEnabled = KWIN.readConfig("logging", false);
    if (loggingEnabled) {
      let logParts: [LogPartition, string[]][] = [];
      let newWindowSubmodules: string[] = [];
      if (KWIN.readConfig("logNewWindows", false))
        newWindowSubmodules.push("1");
      if (KWIN.readConfig("logFilteredWindows", false))
        newWindowSubmodules.push("2");
      if (KWIN.readConfig("logUnmanagedWindows", false))
        newWindowSubmodules.push("3");
      if (newWindowSubmodules.length > 0)
        logParts.push([LogPartitions.newWindow, newWindowSubmodules]);

      if (KWIN.readConfig("logWorkspaceSignals", false)) {
        let workspaceSignalsSubmodules = separate(
          KWIN.readConfig("logWorkspaceSignalsSubmodules", ""),
          ",",
        );
        logParts.push([
          LogPartitions.workspaceSignals,
          workspaceSignalsSubmodules,
        ]);
      }
      if (KWIN.readConfig("logWindowSignals", false)) {
        let windowSignalsSubmodules = separate(
          KWIN.readConfig("logWindowSignalsSubmodules", ""),
          ",",
        );
        logParts.push([LogPartitions.windowSignals, windowSignalsSubmodules]);
      }
      if (KWIN.readConfig("logOther", false)) {
        let otherSubmodules = separate(
          KWIN.readConfig("logOtherSubmodules", ""),
          ",",
        );
        logParts.push([LogPartitions.other, otherSubmodules]);
      }
      const logFilters = KWIN.readConfig("logFilter", false)
        ? separate(KWIN.readConfig("logFilterStr", ""), ",")
        : [];
      this.loggingConfig = {
        enabled: true,
        parts: logParts,
        filters: logFilters,
      };
    } else {
      this.loggingConfig = { enabled: false, parts: [], filters: [] };
    }
    //***************************
    //***************************
    //***************************
  }

  private static getSoleWindowsOverriddenProps(
    props: string,
    defaultProps: ISoleWindowProps,
  ): {
    [outputName: string]: ISoleWindowProps;
  } {
    let outputProps: { [outputName: string]: ISoleWindowProps } = {};
    if (props.trim() === "") {
      return outputProps;
    }
    const warn_mess = "The sole window properties cannot be overridden.";
    separate(props, ",").forEach((userOutputStr) => {
      const outputRawProps = separate(userOutputStr, ":");
      if (outputRawProps.length < 2 || outputRawProps.length > 5) {
        warning(
          `${warn_mess} Number of parts separated by colon:${outputRawProps.length} in ${outputRawProps} but have to be 2-5`,
        );
        return;
      }
      let outputParams = { ...defaultProps } as ISoleWindowProps;
      let validatedResult: number | Err;
      for (let i = 1; i < outputRawProps.length; i++) {
        if (i < 3) {
          validatedResult = validateNumber(outputRawProps[i], 1, 100, true);
        } else {
          validatedResult = validateNumber(outputRawProps[i], 0, 1);
        }
        if (validatedResult instanceof Err) {
          warning(`${warn_mess} in ${outputRawProps}. ${validatedResult}`);
          return;
        }
        switch (i) {
          case 1:
            outputParams.width = validatedResult;
            break;
          case 2: {
            outputParams.height = validatedResult;
            break;
          }
          case 3:
            outputParams.noBorders = Boolean(validatedResult);
            break;
          case 4:
            outputParams.noGaps = Boolean(validatedResult);
            break;
        }
      }
      outputProps[outputRawProps[0].trim()] = outputParams;
    });
    return outputProps;
  }

  private static getSortedLayouts(
    layoutsList: [ILayoutClass, boolean][],
  ): ISortedLayouts[] {
    let sortedLayouts: ISortedLayouts[] = [];
    for (const [idx, [layoutClass, isCapacity]] of layoutsList.entries()) {
      const enabledConfigKey = `${unCapitalize(layoutClass.id)}Enabled`;
      if (!isValidConfigKey(enabledConfigKey)) {
        warning(
          `kwinconfig: unrecognized config key "${enabledConfigKey}" for layout ${layoutClass.id}, treating layout as enabled`,
        );
      } else if (!KWIN.readConfig(enabledConfigKey, true)) {
        continue;
      }

      const orderConfigKey = `${unCapitalize(layoutClass.id)}Order`;
      if (!isValidConfigKey(orderConfigKey)) {
        warning(
          `kwinconfig: unrecognized config key "${orderConfigKey}" for layout ${layoutClass.id}, skipping layout order`,
        );
        continue;
      }
      /* the Smart layout is the default layout */
      const defaultOrder = layoutClass.id === SmartLayout.id ? 1 : idx + 1;
      let validatedOrder = validateNumber(
        KWIN.readConfig(orderConfigKey, defaultOrder),
        1,
        layoutsList.length,
      );
      if (validatedOrder instanceof Err) {
        validatedOrder = defaultOrder;
        warning(
          `kwinconfig: layout order for ${layoutClass.id} is invalid, using default value ${validatedOrder}`,
        );
      }
      sortedLayouts.push({
        order: validatedOrder as number,
        layoutClass: layoutClass,
        isCapacity: isCapacity,
      });
    }
    // on equal order the Smart layout comes first, otherwise keep list order
    const rank = (l: ISortedLayouts) =>
      l.layoutClass.id === SmartLayout.id
        ? -1
        : layoutsList.findIndex(([cls]) => cls === l.layoutClass);
    sortedLayouts.sort((a, b) => a.order - b.order || rank(a) - rank(b));
    if (sortedLayouts.length === 0) {
      sortedLayouts.push({
        order: 1,
        layoutClass: TileLayout,
        isCapacity: false,
      });
    }
    return sortedLayouts;
  }
  private static getLayoutOrder(sortedLayouts: ISortedLayouts[]): string[] {
    let layoutOrder: string[] = [];
    sortedLayouts.forEach(({ layoutClass }) => {
      layoutOrder.push(layoutClass.id);
    });
    return layoutOrder;
  }

  private static getLayoutFactories(sortedLayouts: ISortedLayouts[]): {
    factories: { [key: string]: () => ILayout };
    capacities: { [key: string]: number | null };
  } {
    let layoutFactories: { [key: string]: () => ILayout } = {};
    let layoutFactoryCapacities: { [key: string]: number | null } = {};
    for (const { layoutClass, isCapacity } of sortedLayouts) {
      if (isCapacity) {
        const capacityConfigKey = `${unCapitalize(layoutClass.id)}Capacity`;
        if (!isValidConfigKey(capacityConfigKey)) {
          warning(
            `kwinconfig: unrecognized config key "${capacityConfigKey}" for layout ${layoutClass.id}, skipping capacity config`,
          );
          layoutFactories[layoutClass.id] = () => new layoutClass(null);
          layoutFactoryCapacities[layoutClass.id] = null;
          continue;
        }
        let capacity = validateNumber(
          KWIN.readConfig(capacityConfigKey, 99),
          0,
          99,
        );
        if (capacity instanceof Err) {
          warning(
            `kwinconfig: layout capacity for ${layoutClass.id} is invalid: ${capacity}`,
          );
          layoutFactories[layoutClass.id] = () => new layoutClass(null);
          layoutFactoryCapacities[layoutClass.id] = null;
        } else if (capacity === 0 || capacity > 98) {
          layoutFactories[layoutClass.id] = () => new layoutClass(null);
          layoutFactoryCapacities[layoutClass.id] = null;
        } else {
          layoutFactories[layoutClass.id] = () => new layoutClass(capacity);
          layoutFactoryCapacities[layoutClass.id] = capacity;
        }
      } else {
        layoutFactories[layoutClass.id] = () => new layoutClass();
        layoutFactoryCapacities[layoutClass.id] = null;
      }
    }
    return { factories: layoutFactories, capacities: layoutFactoryCapacities };
  }

  /** Stable representation of every effective value used by Krohnkite. */
  public signature(): string {
    const serializable: { [key: string]: any } = {};
    for (const key of Object.keys(this).sort()) {
      if (key !== "layoutFactories") serializable[key] = (this as any)[key];
    }
    return JSON.stringify(serializable);
  }

  public equals(other: KWinConfig): boolean {
    return this.signature() === other.signature();
  }

  /** Build the logger only when this configuration becomes active. */
  public createLogger(): ILogModules | undefined {
    if (!this.loggingConfig.enabled) return undefined;

    // Logging normalizes exclusion markers in-place, so keep the immutable
    // configuration snapshot used by equals() isolated from those mutations.
    const parts: [LogPartition, string[]][] = this.loggingConfig.parts.map(
      ([partition, modules]) => [partition, [...modules]],
    );
    return new Logging(parts, [...this.loggingConfig.filters]);
  }

  public toString(): string {
    return "Config(" + JSON.stringify(this, undefined, 2) + ")";
  }
}

// /* HACK: save casting */
var KWINCONFIG: KWinConfig;

/* functions (not consts) so they are hoisted: KWin warns about consts used
 * "before their declaration" in the concatenated script */
function smartVersion(): string {
  // replaced with the release version by the Makefile
  return "@PLUS_VERSION@";
}

function defaultWindowRules(): string {
  return [
  "# <matchers> : <actions>   -- see README (Smart features) for the syntax",
  'title~"Picture-in-Picture" : float, size=30%x30%, pos=bottom-right',
  'title~"Bild-im-Bild" : float, size=30%x30%, pos=bottom-right',
  'class=steam title~"Friends List" : float, size=22%x70%, pos=right',
  'class=steam title~"Freundesliste" : float, size=22%x70%, pos=right',
  "class=org.kde.kcalc : float, pos=center",
  "class=org.pulseaudio.pavucontrol : float, size=40%x55%, pos=center",
  "class=pavucontrol : float, size=40%x55%, pos=center",
  "class=nm-connection-editor : float, pos=center",
  "class=blueman-manager : float, size=35%x50%, pos=center",
  "class=org.kde.kdeconnect.handler : float, pos=center",
  "class=xdg-desktop-portal-kde : float, pos=center",
].join("\n");
}
