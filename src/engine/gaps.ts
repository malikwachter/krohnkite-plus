/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class DefaultGapsCfg implements IGaps {
  static _gapsInstance: DefaultGapsCfg | undefined;

  public readonly left: number;
  public readonly right: number;
  public readonly top: number;
  public readonly bottom: number;
  public readonly between: number;

  private constructor() {
    let left = validateNumber(CONFIG.screenGapLeft);
    if (left instanceof Err) {
      warning(`DefaultGapsCfg: left: ${left}`);
      this.left = 0;
    } else this.left = left;
    let right = validateNumber(CONFIG.screenGapRight);
    if (right instanceof Err) {
      warning(`DefaultGapsCfg: right: ${right}`);
      this.right = 0;
    } else this.right = right;
    let top = validateNumber(CONFIG.screenGapTop);
    if (top instanceof Err) {
      warning(`DefaultGapsCfg: top: ${top}`);
      this.top = 0;
    } else this.top = top;
    let bottom = validateNumber(CONFIG.screenGapBottom);
    if (bottom instanceof Err) {
      warning(`DefaultGapsCfg: bottom: ${bottom}`);
      this.bottom = 0;
    } else this.bottom = bottom;
    let between = validateNumber(CONFIG.screenGapBetween);
    if (between instanceof Err) {
      warning(`DefaultGapsCfg: between: ${between}`);
      this.between = 0;
    } else this.between = between;
  }
  public static get instance(): DefaultGapsCfg {
    if (!DefaultGapsCfg._gapsInstance) {
      DefaultGapsCfg._gapsInstance = new DefaultGapsCfg();
    }
    return DefaultGapsCfg._gapsInstance;
  }
  public static reset(): void {
    DefaultGapsCfg._gapsInstance = undefined;
  }
  public cloneAndUpdate(cfg: Partial<IGaps>): IGaps {
    return Object.assign({} as IGaps, DefaultGapsCfg.instance, cfg);
  }
}
class gapsSurfaceCfg {
  public label: string;
  public cfg: IGaps;

  constructor(label: string, cfg: IGaps) {
    this.label = label;
    this.cfg = cfg;
  }
  public isFit(srf: ISurface): boolean {
    return srf.isFit(this.label);
  }
  public toString(): string {
    return `gapsSurfaceCfg: Label: ${this.label} cfg: ${this.cfg}`;
  }

  public static parseGapsUserSurfacesCfg(): SurfaceCfg<IGaps>[] {
    let surfacesCfg: SurfaceCfg<IGaps>[] = [];
    if (CONFIG.gapsOverrideConfig.length === 0) return surfacesCfg;
    CONFIG.gapsOverrideConfig.forEach((cfg) => {
      let surfaceCfgString = cfg.split(":").map((part) => part.trim());
      if (surfaceCfgString.length !== 2) {
        warning(
          `Invalid Gaps surface config: ${cfg}, config must have exactly one colon (expected: surfaceLabel:left=5,right=10,...)`,
        );
        return;
      }
      let label = surfaceCfgString[0];
      let userCfg = surfaceCfgString[1];
      let splittedUserCfg = userCfg
        .split(",")
        .map((part) => part.trim().toLowerCase());
      let partialGapsCfg = gapsSurfaceCfg.parseSplittedGapsCfg(splittedUserCfg);
      if (partialGapsCfg instanceof Err) {
        warning(`Invalid Gaps User surface config: ${cfg}. ${partialGapsCfg}`);
        return;
      }
      if (Object.keys(partialGapsCfg).length > 0) {
        surfacesCfg.push(
          new SurfaceCfg<IGaps>(
            label,
            DefaultGapsCfg.instance.cloneAndUpdate(partialGapsCfg),
          ),
        );
      }
    });
    return surfacesCfg;
  }
  private static parseSplittedGapsCfg(
    splittedUserCfg: string[],
  ): Partial<IGaps> | Err {
    let errors: string[] = [];
    let value: number | Err;
    let gapsCfg: {
      [gapsCfgField: string]: number;
    } = {};
    splittedUserCfg.forEach((part) => {
      let splittedPart = part
        .split("=")
        .map((part) => part.trim().toLowerCase());
      if (splittedPart.length !== 2) {
        errors.push(`"${part}" can have only one equal sign`);
        return;
      }
      if (splittedPart[0].length === 0 || splittedPart[1].length === 0) {
        errors.push(`"${part}" can not have empty name or value`);
        return;
      }

      value = validateNumber(splittedPart[1]);
      if (value instanceof Err) {
        errors.push(`GapsCfg: ${part}, ${splittedPart[1]} ${value}`);
        return;
      }
      switch (splittedPart[0]) {
        case "left":
        case "l":
          gapsCfg["left"] = value;
          break;
        case "right":
        case "r":
          gapsCfg["right"] = value;
          break;
        case "top":
        case "t":
          gapsCfg["top"] = value;
          break;
        case "bottom":
        case "b":
          gapsCfg["bottom"] = value;
          break;
        case "between":
        case "e":
          gapsCfg["between"] = value;
          break;
        default:
          errors.push(
            ` "${part}" unknown parameter name. It can be l,r,t,b,e or left,right,top,bottom,between`,
          );
          return;
      }
    });
    if (errors.length > 0) {
      return new Err(errors.join("\n"));
    }
    return gapsCfg as Partial<IGaps>;
  }
}
