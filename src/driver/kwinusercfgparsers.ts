/*
    SPDX-FileCopyrightText: 2026 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

function parseShortcutConf(lines: string[]): IShortcutConfEntry[] {
  const result: IShortcutConfEntry[] = [];

  const shortcutNames: { [lower: string]: ShortcutName } = {};
  for (const name of Object.keys(Shortcuts) as ShortcutName[]) {
    shortcutNames[name.toLowerCase()] = name;
  }
  const actionNames: { [lower: string]: KrohnkiteAction } = {};
  for (const key of Object.keys(KrohnkiteAction)) {
    const action = KrohnkiteAction[key as keyof typeof KrohnkiteAction];
    actionNames[action.toLowerCase()] = action;
  }
  /* undefined means the flag was not given; "null" clears the action. */
  const parseAction = (
    rawVal: string,
  ): KrohnkiteAction | null | undefined => {
    if (rawVal.toLowerCase() === "null") return null;
    return actionNames[rawVal.toLowerCase()];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    const parts = trimmed.split(":");
    if (parts.length !== 2) {
      warning(`parseShortcutConf: invalid format in "${trimmed}"`);
      continue;
    }

    const shortcutStrs = separate(parts[0], ",");
    if (shortcutStrs.length === 0) {
      warning(`parseShortcutConf: empty shortcut list in "${trimmed}"`);
      continue;
    }

    const shortcuts: ShortcutName[] = [];
    let valid = true;
    for (const s of shortcutStrs) {
      const name = shortcutNames[s.toLowerCase()];
      if (name === undefined) {
        warning(`parseShortcutConf: unknown shortcut "${s}" in "${trimmed}"`);
        valid = false;
        break;
      }
      shortcuts.push(name);
    }
    if (!valid) continue;

    let mainAction: KrohnkiteAction | null | undefined = undefined;
    let registerAction: KrohnkiteAction | null | undefined = undefined;
    let sequenceTime: number | null = null;

    const flags = separate(parts[1], ",");
    for (const flag of flags) {
      const eqIdx = flag.indexOf("=");
      if (eqIdx < 0) {
        warning(`parseShortcutConf: invalid flag "${flag}" in "${trimmed}"`);
        valid = false;
        break;
      }
      const key = flag.slice(0, eqIdx).trim().toLowerCase();
      const rawVal = flag.slice(eqIdx + 1).trim();

      switch (key) {
        case "mainaction":
        case "ma": {
          const action = parseAction(rawVal);
          if (action === undefined) {
            warning(
              `parseShortcutConf: unknown action "${rawVal}" in "${trimmed}"`,
            );
            valid = false;
            break;
          }
          mainAction = action;
          break;
        }
        case "registeraction":
        case "ra": {
          const action = parseAction(rawVal);
          if (action === undefined) {
            warning(
              `parseShortcutConf: unknown action "${rawVal}" in "${trimmed}"`,
            );
            valid = false;
            break;
          }
          registerAction = action;
          break;
        }
        case "sequencetime":
        case "st": {
          const t = validateNumber(rawVal, 0, 9999);
          if (t instanceof Err) {
            warning(
              `parseShortcutConf: invalid sequence time "${rawVal}" in "${trimmed}"`,
            );
            valid = false;
            break;
          }
          sequenceTime = t;
          break;
        }
        default:
          warning(
            `parseShortcutConf: unknown flag "${flag}" in "${trimmed}"`,
          );
          valid = false;
          break;
      }
      if (!valid) break;
    }
    if (!valid) continue;

    if (mainAction === undefined && registerAction === undefined) {
      warning(
        `parseShortcutConf: no action flag (mainaction/registeraction) in "${trimmed}"`,
      );
      continue;
    }

    result.push({ shortcuts, mainAction, registerAction, sequenceTime });
  }

  return result;
}

function parseFloatConfig(lines: string[]): IFloatWindow[] {
  const result: IFloatWindow[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    const parts = trimmed.split(":");
    const classList = parts[0].trim();
    if (classList) {
      const rawParts = classList.split(",");
      const classes = rawParts.map((c) => c.trim()).filter((c) => c !== "");
      if (classes.length < rawParts.length) {
        warning(`parseFloatConfig: empty class name in list "${classList}"`);
        continue;
      }
    }

    let title = "";
    let paramsStr = "";
    if (parts.length === 2) {
      paramsStr = parts[1];
    } else if (parts.length === 3) {
      title = parts[1];
      paramsStr = parts[2];
    } else if (parts.length > 3) {
      warning(`parseFloatConfig: invalid format in "${trimmed}"`);
      continue;
    }

    const entry: IFloatWindow = {
      class: classList,
      title,
      shouldFloat: true,
      auto: false,
      width: null,
      height: null,
      leftIndent: null,
      topIndent: null,
      stepWidth: null,
      stepHeight: null,
    };

    if (paramsStr) {
      const params = separate(paramsStr, ",");
      for (const param of params) {
        const eqIdx = param.indexOf("=");
        const key =
          eqIdx >= 0
            ? param.slice(0, eqIdx).trim().toLowerCase()
            : param.trim().toLowerCase();
        const rawVal =
          eqIdx >= 0
            ? param
                .slice(eqIdx + 1)
                .trim()
                .toLowerCase()
            : "";
        switch (key) {
          case "shouldfloat":
          case "f":
            entry.shouldFloat = rawVal === "true" || rawVal === "1";
            break;
          case "auto":
          case "a":
            entry.auto = rawVal === "true" || rawVal === "1";
            break;
          case "width":
          case "w": {
            const w = parseNumber(rawVal, false);
            if (w instanceof Err) {
              warning(`parseFloatConfig: invalid width "${rawVal}"`);
            } else {
              const vw = validateNumber(w, 1, 100);
              if (vw instanceof Err) {
                warning(`parseFloatConfig: width out of range: ${rawVal}`);
              } else {
                entry.width = vw;
              }
            }
            break;
          }
          case "height":
          case "h": {
            const h = parseNumber(rawVal, false);
            if (h instanceof Err) {
              warning(`parseFloatConfig: invalid height "${rawVal}"`);
            } else {
              const vh = validateNumber(h, 1, 100);
              if (vh instanceof Err) {
                warning(`parseFloatConfig: height out of range: ${rawVal}`);
              } else {
                entry.height = vh;
              }
            }
            break;
          }
          case "leftindent":
          case "li":
          case "left": {
            let unit: "px" | "%" = "px";
            let numStr = rawVal;
            if (rawVal.endsWith("%")) {
              unit = "%";
              numStr = rawVal.slice(0, -1);
            } else if (rawVal.endsWith("px")) {
              numStr = rawVal.slice(0, -2);
            }
            const l = parseNumber(numStr, true);
            if (l instanceof Err) {
              warning(`parseFloatConfig: invalid left indent "${rawVal}"`);
            } else {
              entry.leftIndent = { value: l, unit };
            }
            break;
          }
          case "topindent":
          case "ti":
          case "top": {
            let unit: "px" | "%" = "px";
            let numStr = rawVal;
            if (rawVal.endsWith("%")) {
              unit = "%";
              numStr = rawVal.slice(0, -1);
            } else if (rawVal.endsWith("px")) {
              numStr = rawVal.slice(0, -2);
            }
            const t = parseNumber(numStr, true);
            if (t instanceof Err) {
              warning(`parseFloatConfig: invalid top indent "${rawVal}"`);
            } else {
              entry.topIndent = { value: t, unit };
            }
            break;
          }
          case "stepwidth":
          case "sw": {
            const sw = parseNumber(rawVal, false);
            if (sw instanceof Err) {
              warning(`parseFloatConfig: invalid step width "${rawVal}"`);
            } else {
              const vsw = validateNumber(sw, 0, 100);
              if (vsw instanceof Err) {
                warning(`parseFloatConfig: step width out of range: ${rawVal}`);
              } else {
                entry.stepWidth = vsw;
              }
            }
            break;
          }
          case "stepheight":
          case "sh": {
            const sh = parseNumber(rawVal, false);
            if (sh instanceof Err) {
              warning(`parseFloatConfig: invalid step height "${rawVal}"`);
            } else {
              const vsh = validateNumber(sh, 0, 100);
              if (vsh instanceof Err) {
                warning(
                  `parseFloatConfig: step height out of range: ${rawVal}`,
                );
              } else {
                entry.stepHeight = vsh;
              }
            }
            break;
          }
          default:
            warning(`parseFloatConfig: unknown param "${key}"`);
        }
      }
    }
    result.push(entry);
  }
  return result;
}
