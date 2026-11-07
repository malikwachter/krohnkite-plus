/*
    SPDX-License-Identifier: MIT

    Remembering things across KWin restarts / logins.

    KWin scripts can read their config but not write files. The QML side
    provides a tiny shell runner (Plasma5Support "executable" data source);
    the state is stored as JSON in ~/.local/share/krohnkite/state.json.
    The JSON travels base64-encoded so no shell quoting can break it.
*/

interface IShellQml {
  run(cmd: string, callback: (exitCode: number, stdout: string, stderr: string) => void): void;
}

interface IPersistedState {
  version: number;
  learnedMin: { [cls: string]: ISize };
  floatMemory: { [key: string]: { x: number; y: number; w: number; h: number } };
  layouts: { [layoutId: string]: ILayoutEntryState };
}

interface ILayoutEntryState {
  current?: string;
  smart?: ISmartLayoutState;
}

class StateStore {
  public static readonly VERSION = 1;
  private static readonly DIR = '"$HOME/.local/share/krohnkite"';
  private static readonly FILE = '"$HOME/.local/share/krohnkite/state.json"';

  private lastSaved: string | null;
  private saveScheduled: boolean;

  constructor(
    private shell: IShellQml | null,
    private setTimeout: (f: () => void, ms: number) => void,
  ) {
    this.lastSaved = null;
    this.saveScheduled = false;
  }

  public get available(): boolean {
    return this.shell !== null;
  }

  public load(callback: (state: IPersistedState | null) => void) {
    if (this.shell === null) return callback(null);
    this.shell.run(`cat ${StateStore.FILE} 2>/dev/null`, (code, stdout) => {
      if (code !== 0 || !stdout || stdout.trim() === "") return callback(null);
      try {
        const state = JSON.parse(stdout) as IPersistedState;
        if (!state || state.version !== StateStore.VERSION) return callback(null);
        this.lastSaved = JSON.stringify(state);
        callback(state);
      } catch (e) {
        warning(`state.json is not valid JSON, ignoring it: ${e}`);
        callback(null);
      }
    });
  }

  /**
   * Save a little later if the state differs from what is on disk. The state
   * is only collected when the timer fires, so frequent calls cost nothing.
   */
  public saveSoon(collect: () => IPersistedState) {
    if (this.shell === null || this.saveScheduled) return;
    this.saveScheduled = true;
    this.setTimeout(() => {
      this.saveScheduled = false;
      let json: string;
      try {
        json = JSON.stringify(collect());
      } catch (e) {
        warning(`could not collect the state: ${e}`);
        return;
      }
      if (json !== this.lastSaved) this.write(json);
    }, 2000);
  }

  private write(json: string) {
    const b64 = StateStore.base64(json);
    const tmp = '"$HOME/.local/share/krohnkite/state.json.tmp"';
    const cmd =
      `mkdir -p ${StateStore.DIR} && printf '%s' '${b64}' | base64 -d > ${tmp}` +
      ` && mv -f ${tmp} ${StateStore.FILE}`;
    this.shell!.run(cmd, (code, _out, err) => {
      if (code === 0) this.lastSaved = json;
      else warning(`could not save state.json (${code}): ${err}`);
    });
  }

  /** UTF-8 safe base64 (window classes / desktop names may contain umlauts) */
  public static base64(text: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        const lo = text.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000)
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else
        bytes.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 63),
          0x80 | ((c >> 6) & 63),
          0x80 | (c & 63),
        );
    }
    const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += t[b0 >> 2] + t[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? t[((b1 & 15) << 2) | (b2 >> 6)] : "=";
      out += i + 2 < bytes.length ? t[b2 & 63] : "=";
    }
    return out;
  }
}
