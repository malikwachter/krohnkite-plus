/*
    SPDX-License-Identifier: MIT

    Per-application window rules.

    One rule per line:

        <matchers> : <actions>

    Matchers (all must match, space separated):
        class=firefox          exact match on resourceClass OR resourceName (case-insensitive)
        class~steam            substring match
        title=Steam            exact caption match (case-insensitive)
        title~"Picture-in-Picture"
        title/^Friends.*$/     regular expression (case-insensitive)
        role=pop-up            window role
        (class / title / role all support "=", "~" and "/regex/")

    Actions (comma separated):
        tile | float | ignore      force tiling state
        master                     new window becomes the first (master) tile
        last                       new window is appended to the end of the stack
        weight=2                   relative share of space in layouts (default 1)
        minwidth=900               minimal width the layout will give the window (px or %)
        minheight=50%              minimal height (px or %)
        quickview                  the app lives in the system tray: its window opens
                                   as a quickview (tray layer) instead of being tiled
        size=1280x720 | 60%x70%    initial size when floating
        pos=center|left|right|top|bottom|top-left|top-right|bottom-left|bottom-right
                                   initial position when floating

    Lines starting with "#" or "//" are comments. Later rules override earlier ones
    action by action, so a generic rule can be refined by a more specific one below it.
*/

type RuleState = "tile" | "float" | "ignore";
type RulePos =
  | "center"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

interface IRuleLength {
  value: number;
  percent: boolean;
}

interface IWindowRule {
  state?: RuleState;
  order?: "master" | "last";
  weight?: number;
  minWidth?: IRuleLength;
  minHeight?: IRuleLength;
  floatWidth?: IRuleLength;
  floatHeight?: IRuleLength;
  floatPos?: RulePos;
  /** tray layer: open as a quickview instead of tiling */
  quickview?: boolean;
  /** line numbers of all rules that matched, e.g. "3,7" */
  matched?: string;
}

interface IWindowProps {
  resourceClass: string;
  resourceName: string;
  desktopFileName?: string;
  caption: string;
  windowRole: string;
}

type RuleField = "class" | "title" | "role";

interface IRuleMatcher {
  field: RuleField;
  op: "=" | "~" | "/";
  value: string;
  regex: RegExp | null;
}

interface IParsedRule {
  line: number;
  matchers: IRuleMatcher[];
  rule: IWindowRule;
}

const RULE_POSITIONS: RulePos[] = [
  "center",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

class WindowRules {
  public readonly rules: IParsedRule[];
  public readonly errors: string[];

  constructor(lines: string[]) {
    this.rules = [];
    this.errors = [];
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (line === "" || line[0] === "#" || line.slice(0, 2) === "//") return;
      try {
        this.rules.push(WindowRules.parseLine(line, idx + 1));
      } catch (e) {
        this.errors.push(`windowRules line ${idx + 1}: ${e} -> "${line}"`);
      }
    });
  }

  /** Merge every matching rule (top to bottom) into one effective rule. */
  public match(props: IWindowProps): IWindowRule | null {
    let result: IWindowRule | null = null;
    for (const parsed of this.rules) {
      if (!parsed.matchers.every((m) => WindowRules.test(m, props))) continue;
      result = result === null ? {} : result;
      result.matched =
        result.matched === undefined
          ? `${parsed.line}`
          : `${result.matched},${parsed.line}`;
      const r = parsed.rule;
      if (r.state !== undefined) result.state = r.state;
      if (r.order !== undefined) result.order = r.order;
      if (r.weight !== undefined) result.weight = r.weight;
      if (r.minWidth !== undefined) result.minWidth = r.minWidth;
      if (r.minHeight !== undefined) result.minHeight = r.minHeight;
      if (r.floatWidth !== undefined) result.floatWidth = r.floatWidth;
      if (r.floatHeight !== undefined) result.floatHeight = r.floatHeight;
      if (r.floatPos !== undefined) result.floatPos = r.floatPos;
      if (r.quickview !== undefined) result.quickview = r.quickview;
    }
    return result;
  }

  /** the exact `class=` values of rules whose actions match `pred` */
  public exactClassesWith(pred: (r: IWindowRule) => boolean): string[] {
    const out: string[] = [];
    for (const parsed of this.rules) {
      if (!pred(parsed.rule)) continue;
      parsed.matchers.forEach((m) => {
        if (m.field === "class" && m.op === "=") out.push(m.value.toLowerCase());
      });
    }
    return out;
  }

  public static resolveLength(len: IRuleLength, total: number): number {
    return len.percent ? (total * len.value) / 100 : len.value;
  }

  private static test(m: IRuleMatcher, props: IWindowProps): boolean {
    const candidates: string[] =
      m.field === "class"
        ? [props.resourceClass, props.resourceName, props.desktopFileName || ""]
        : m.field === "title"
          ? [props.caption]
          : [props.windowRole];
    return candidates.some((raw) => {
      const s = (raw || "").toString();
      if (m.op === "/") return m.regex!.test(s);
      const lower = s.toLowerCase();
      return m.op === "=" ? lower === m.value : lower.indexOf(m.value) >= 0;
    });
  }

  /* ------------------------------------------------------------ parsing */

  private static parseLine(line: string, lineNo: number): IParsedRule {
    const sep = WindowRules.findSeparator(line);
    if (sep < 0) throw "missing ':' between matchers and actions";
    const matchers = WindowRules.parseMatchers(line.slice(0, sep));
    if (matchers.length === 0) throw "no matcher (class=..., title~..., role=...)";
    const rule = WindowRules.parseActions(line.slice(sep + 1));
    return { line: lineNo, matchers, rule };
  }

  /** first ':' that is not inside quotes or a /regex/ */
  private static findSeparator(line: string): number {
    let quote = false;
    let regex = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && !regex) quote = !quote;
      else if (c === "/" && !quote && (regex || /[a-z]$/i.test(line.slice(0, i))))
        regex = !regex;
      else if (c === "\\" && regex) i++;
      else if (c === ":" && !quote && !regex) return i;
    }
    return -1;
  }

  private static parseMatchers(src: string): IRuleMatcher[] {
    const result: IRuleMatcher[] = [];
    const re =
      /(class|title|role)\s*(?:(=|~)\s*(?:"((?:[^"\\]|\\.)*)"|([^\s"]+))|\/((?:[^\/\\]|\\.)*)\/)/gi;
    let consumed = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      consumed += m[0];
      const field = m[1].toLowerCase() as RuleField;
      if (m[5] !== undefined) {
        let regex: RegExp;
        try {
          regex = new RegExp(m[5], "i");
        } catch (e) {
          throw `invalid regex /${m[5]}/`;
        }
        result.push({ field, op: "/", value: m[5], regex });
      } else {
        const value = (m[3] !== undefined ? m[3].replace(/\\(.)/g, "$1") : m[4])
          .toLowerCase();
        result.push({ field, op: m[2] as "=" | "~", value, regex: null });
      }
    }
    const leftover = src.replace(re, "").trim();
    if (leftover !== "") throw `cannot understand matcher "${leftover}"`;
    return result;
  }

  private static parseLength(src: string, what: string): IRuleLength {
    const m = /^(\d+(?:\.\d+)?)\s*(%|px)?$/.exec(src.trim());
    if (!m) throw `invalid ${what} "${src}"`;
    const value = parseFloat(m[1]);
    const percent = m[2] === "%";
    if (percent && (value <= 0 || value > 100)) throw `${what} out of range`;
    return { value, percent };
  }

  private static parseActions(src: string): IWindowRule {
    const rule: IWindowRule = {};
    src
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a !== "")
      .forEach((action) => {
        const eq = action.indexOf("=");
        const key = (eq < 0 ? action : action.slice(0, eq)).trim().toLowerCase();
        const val = eq < 0 ? "" : action.slice(eq + 1).trim().toLowerCase();
        switch (key) {
          case "tile":
          case "float":
          case "ignore":
            rule.state = key;
            break;
          case "master":
          case "first":
            rule.order = "master";
            break;
          case "last":
          case "slave":
            rule.order = "last";
            break;
          case "quickview":
          case "tray":
            rule.quickview = true;
            break;
          case "weight": {
            const w = parseFloat(val);
            if (isNaN(w) || w <= 0 || w > 20) throw `invalid weight "${val}"`;
            rule.weight = w;
            break;
          }
          case "minwidth":
            rule.minWidth = WindowRules.parseLength(val, "minwidth");
            break;
          case "minheight":
            rule.minHeight = WindowRules.parseLength(val, "minheight");
            break;
          case "size": {
            const parts = val.split("x");
            if (parts.length !== 2) throw `invalid size "${val}", use WxH`;
            rule.floatWidth = WindowRules.parseLength(parts[0], "size");
            rule.floatHeight = WindowRules.parseLength(parts[1], "size");
            if (rule.state === undefined) rule.state = "float";
            break;
          }
          case "pos":
          case "position": {
            const pos = val.replace(/\s+/g, "-") as RulePos;
            if (RULE_POSITIONS.indexOf(pos) < 0) throw `invalid pos "${val}"`;
            rule.floatPos = pos;
            break;
          }
          default:
            throw `unknown action "${key}"`;
        }
      });
    return rule;
  }
}
