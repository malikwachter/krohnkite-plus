// The real KWinRuntime + KWinDriver against a fake KWin workspace: start,
// tiling of new windows, the Kröhnkite-Plus shortcuts (zoom, undo/redo, smart
// layout), the saved state and a configuration reload.
// Run: npx tsc && node test/runtime.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");

/* ------------------------------------------------------------------ clock */
let now = 1000;
let timers = [];
const runTimers = (ms) => {
  const until = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > until) break;
    timers.shift();
    now = t.at;
    t.fire();
  }
  now = until;
};
class Signal {
  constructor() { this.cbs = []; }
  connect(f) { this.cbs.push(f); }
  disconnect(f) { this.cbs = this.cbs.filter((c) => c !== f); }
  emit(...a) { this.cbs.slice().forEach((f) => f(...a)); }
}
class Timer {
  constructor() { this.triggered = new Signal(); this.interval = 0; this.repeat = false; }
  start() { this.stop(); const me = { at: now + this.interval, fire: () => this.triggered.emit() }; this.entry = me; timers.push(me); }
  stop() { if (this.entry) timers = timers.filter((t) => t !== this.entry); this.entry = null; }
  destroy() { this.stop(); }
}

/* ------------------------------------------------------------------ fake KWin */
const rect = (x, y, width, height) => ({ x, y, width, height });
const outA = { name: "DP-2", geometry: rect(0, 0, 1920, 1080) };
const outB = { name: "HDMI-A-1", geometry: rect(1920, 0, 1920, 1080) };
const desk = { id: "d1", name: "Desktop 1", x11DesktopNumber: 1 };
let nextId = 1;
function client(cls, output = outA) {
  const c = {
    internalId: { toString: () => `{id-${c._id}}` }, _id: nextId++,
    resourceClass: cls, resourceName: cls, desktopFileName: cls, caption: cls, windowRole: "",
    pid: 100, deleted: false, popupWindow: false, normalWindow: true, desktopWindow: false, hidden: false,
    dock: false, specialWindow: false, dialog: false, splash: false, utility: false, modal: false, transient: false,
    transientFor: null, skipPager: false, skipTaskbar: false, fullScreen: false, minimized: false, maximizeMode: 0,
    resizeable: true, moveable: true, move: false, resize: false, noBorder: false,
    onAllDesktops: false, desktops: [desk], activities: [], output, stackingOrder: nextId,
    minSize: { width: 0, height: 0 }, maxSize: { width: 99999, height: 99999 },
    frameGeometry: rect(output.geometry.x + 100, 100, 800, 600), clientGeometry: rect(output.geometry.x + 100, 130, 800, 570),
    get width() { return this.frameGeometry.width; }, get height() { return this.frameGeometry.height; },
    get active() { return ws.activeWindow === c; },
    setMaximize() {},
    /* like KWin: keep above and keep below exclude each other */
    _above: false, _below: false,
    get keepAbove() { return this._above; }, set keepAbove(v) { this._above = v; if (v) this._below = false; },
    get keepBelow() { return this._below; }, set keepBelow(v) { this._below = v; if (v) this._above = false; },
  };
  ["activitiesChanged", "bufferGeometryChanged", "desktopsChanged", "fullScreenChanged", "interactiveMoveResizeStepped",
    "maximizedAboutToChange", "minimizedChanged", "moveResizedChanged", "outputChanged", "stackingOrderChanged",
    "frameGeometryChanged", "skipPagerChanged", "captionChanged"].forEach((s) => (c[s] = new Signal()));
  return c;
}
const ws = {
  screens: [outA, outB], activeScreen: outA, currentDesktop: desk, desktops: [desk], currentActivity: "act",
  activities: ["act"], activeWindow: null, stackingOrder: [], cursorPos: { x: 10, y: 10 }, desktopGridSize: { width: 1, height: 1 },
  clientArea: (_opt, out) => rect(out.geometry.x, out.geometry.y, out.geometry.width, out.geometry.height),
  currentDesktopForScreen: () => desk, setCurrentDesktopForScreen() {}, isEffectActive: () => false,
  screenAt: (p) => (p.x >= 1920 ? outB : outA), raiseWindow() {},
  sendClientToScreen(c, out) { c.output = out; c.outputChanged.emit(); },
};
["windowAdded", "windowRemoved", "windowActivated", "screensChanged", "virtualScreenGeometryChanged", "currentDesktopChanged",
  "currentActivityChanged", "activitiesChanged", "activityAdded", "activityRemoved", "desktopsChanged", "desktopLayoutChanged",
  "cursorPosChanged"].forEach((s) => (ws[s] = new Signal()));
const addClient = (c) => { ws.stackingOrder.push(c); ws.activeWindow = c; ws.windowAdded.emit(c); ws.windowActivated.emit(c); };

/* shortcuts from shortcuts.qml: name -> fake handler */
const qml = fs.readFileSync(path.join(__dirname, "..", "res", "shortcuts.qml"), "utf8");
const shortcutList = [...qml.matchAll(/\{ name: "(\w+)", hdl: (\w+) \}/g)].map(([, name]) => ({ name, hdl: { activated: new Signal() } }));
const press = (name) => shortcutList.find((s) => s.name === name).hdl.activated.emit();

/* shell runner: remembers commands, "disk" holds the saved file */
let disk = null;
const shellCmds = [];
const shell = {
  run(cmd, cb) {
    shellCmds.push(cmd);
    let out = "";
    if (/^cat /.test(cmd)) out = disk || "";
    const m = cmd.match(/printf '%s' '([^']*)' \| base64 -d/);
    if (m) disk = Buffer.from(m[1], "base64").toString("utf8");
    timers.push({ at: now + 5, fire: () => cb(0, out, "") });
  },
};
const previewCalls = [];
const preview = { show: (...a) => previewCalls.push(a), hide: () => previewCalls.push(["hide"]) };
const notes = [];
let config = {};

const ctx = {
  console: { log() {}, warn() {}, error: console.error }, print() {},
  Qt: { rect, createQmlObject: () => new Timer() },
  scriptRoot: {},
  KWin: {},
  popupDialog: { showNotification: (t) => notes.push(t), showLayoutShortcut() {}, showLayouts() {} },
  layoutChooserDialog: { showLayouts() {}, isOpen: () => false, hide() {}, navigate() {} },
  dragPreview: { showRect() {}, hide() {} },
  activityInfo: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "krohnkite.js"), "utf8"), ctx);
vm.runInContext("getTime = () => __now()", Object.assign(ctx, { __now: () => now }));

const dbusCall = () => ({ call() {}, finished: new Signal(), failed: new Signal(), arguments: [] });
const api = {
  workspace: ws,
  kwin: { readConfig: (k, d) => (Object.prototype.hasOwnProperty.call(config, k) ? config[k] : d) },
  shortcuts: shortcutList,
  dbus: { getDBusExists: dbusCall, getDBusMoveMouseToFocus: dbusCall, getDBusMoveMouseToCenter: dbusCall,
    getDBusMoveMouseToScreenCenter: dbusCall, getDBusVirtualKeyboardVisible: dbusCall },
  shell,
  preview: () => preview,
};

let failed = 0;
const test = (name, f) => { try { f(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e.actual !== undefined ? JSON.stringify(e.actual) + " vs " + JSON.stringify(e.expected) + "\n     " : "") + e.stack.split("\n").slice(0, 4).join("\n     ")); } };
const focus = (c) => { ws.activeWindow = c; ws.windowActivated.emit(c); runTimers(50); };
const geo = (c) => { const g = c.frameGeometry; return [g.x, g.y, g.width, g.height]; };

const runtime = vm.runInContext("(api) => new KWinRuntime(api)", ctx)(api);
const a = client("konsole"), b = client("dolphin"), c3 = client("firefox");

test("the runtime starts the driver with all shortcuts bound", () => {
  runtime.start();
  runTimers(100);
  ["ZoomSC", "UndoSC", "RedoSC", "SetSmartLayoutSC"].forEach((n) => assert(shortcutList.find((s) => s.name === n), n));
  assert(shortcutList.every((s) => s.hdl.activated.cbs.length === 1), "every shortcut connected once");
  assert(shellCmds.some((c) => /^cat .*state\.json/.test(c)), "saved state is loaded");
  assert(shellCmds.some((c) => /Effect-krohnkite_smooth --key Duration 150/.test(c)), "animation speed passed to the effect");
});
test("new windows are tiled by the Smart layout", () => {
  addClient(a); runTimers(50);
  assert.deepStrictEqual(geo(a), [0, 0, 1920, 1080]);
  addClient(b); runTimers(50);
  addClient(c3); runTimers(50);
  const gs = [a, b, c3].map(geo);
  gs.forEach((g) => assert(g[0] >= 0 && g[0] + g[2] <= 1920 && g[1] + g[3] <= 1080, "on monitor A: " + g));
  const area = gs.reduce((s, g) => s + g[2] * g[3], 0);
  assert(area > 1920 * 1080 * 0.9, "the tiles fill the screen");
});
test("Zoom key lifts the active window, focusing another ends it", () => {
  focus(a);
  focus(b);
  press("ZoomSC"); runTimers(50);
  assert.deepStrictEqual(geo(b), [134, 32, 1652, 1016]);
  assert.strictEqual(b.keepAbove, true, "zoomed window is above the others");
  focus(a);
  const back = geo(b);
  assert.notDeepStrictEqual(back, [134, 32, 1652, 1016], "back in its tile");
  assert(back[2] < 1920 && back[3] <= 1080, "a tile again: " + back);
  assert.strictEqual(b.keepAbove, false, "not above the others any more");
});
test("Undo / Redo of a shortcut (SetMaster)", () => {
  focus(c3);
  const before = [a, b, c3].map(geo);
  press("SetMasterSC"); runTimers(50);
  const after = [a, b, c3].map(geo);
  assert.notDeepStrictEqual(after, before, "set master changed the layout");
  press("UndoSC"); runTimers(50);
  assert.deepStrictEqual([a, b, c3].map(geo), before);
  assert(/^Undo/.test(notes[notes.length - 1]), notes[notes.length - 1]);
  press("RedoSC"); runTimers(50);
  assert.deepStrictEqual([a, b, c3].map(geo), after);
});
test("the state is saved a little later", () => {
  runTimers(2500);
  assert(disk !== null, "state.json written");
  const st = JSON.parse(disk);
  assert.strictEqual(st.version, 1);
  assert(Object.keys(st.layouts).length > 0, "layouts saved");
});
test("a configuration reload keeps tiling, the shortcuts and the layouts", () => {
  const layoutNow = () =>
    runtime.driver.engine.layouts.getCurrentLayout(runtime.driver.currentSurface).classID;
  press("NextLayoutSC"); runTimers(50); // changed right before the reload: not on disk yet
  const chosen = layoutNow();
  assert.notStrictEqual(chosen, "SmartLayout");
  config = { smartFocusGrow: 20 };
  assert.strictEqual(runtime.reloadIfChanged(), true);
  runTimers(100);
  assert.strictEqual(layoutNow(), chosen, "the new driver knows the layout chosen just before");
  press("SetSmartLayoutSC"); runTimers(50);
  assert.strictEqual(layoutNow(), "SmartLayout", "Smart layout shortcut");
  runTimers(2500);
  const diskBefore = disk;
  assert(shortcutList.every((s) => s.hdl.activated.cbs.length === 1), "old connections are gone, new ones bound once");
  const gs = [a, b, c3].map(geo);
  gs.forEach((g) => assert(g[2] > 0 && g[0] + g[2] <= 1920, "still tiled: " + g));
  assert.strictEqual(disk, diskBefore, "nothing new to save");
});
test("gaming mode: a fullscreen window pauses tiling and notifications", () => {
  const before = [a, b].map(geo);
  ws.activeWindow = c3; c3.fullScreen = true; c3.fullScreenChanged.emit(); runTimers(50);
  const n = notes.length;
  const d = client("kate");
  ws.stackingOrder.push(d); ws.windowAdded.emit(d); runTimers(50);
  assert.deepStrictEqual([a, b].map(geo), before, "nothing moved while the game runs");
  press("NextLayoutSC"); runTimers(50);
  assert.strictEqual(notes.length, n, "no popups over the game");
  c3.fullScreen = false; c3.fullScreenChanged.emit(); ws.windowActivated.emit(c3); runTimers(50);
  assert(geo(d)[2] < 1920, "caught up afterwards: " + geo(d));
});
test("the runtime shuts down cleanly", () => {
  runtime.dispose();
  runTimers(100);
  assert(shortcutList.every((s) => s.hdl.activated.cbs.length === 0), "all shortcuts disconnected");
});

console.log(failed === 0 ? "\nall runtime tests passed" : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
