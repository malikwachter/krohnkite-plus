// The Kröhnkite-Plus layers: the popup layer (dialogs packed around the middle
// of the screen) and the tray layer (quickview), against the fake KWin of
// runtime.test.js, plus the pure geometry.
// Run: npx tsc && node test/layers.test.js
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
    closeable: true, minimizable: true, moveableAcrossScreens: true, closed: false,
    closeWindow() { this.closed = true; },
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
let config = { windowRules: "class=telegram : quickview" };

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


const R = (r) => [r.x, r.y, r.width, r.height];
const overlap = (p, q) => p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3];
const G = vm.runInContext("LayerGeometry", ctx);
const area = vm.runInContext("new Rect(0, 0, 1920, 1046)", ctx);

/* ------------------------------------------------------------------ geometry */
test("two popups sit side by side, the group centered, each centered vertically (screenshot 1)", () => {
  const r = G.packPopups([{ width: 505, height: 530 }, { width: 530, height: 228 }], [{ width: 0, height: 0 }, { width: 0, height: 0 }], area, 8).map(R);
  assert.strictEqual(r[0][1] + r[0][3] / 2, 523, "first centered vertically");
  assert(Math.abs(r[1][1] + r[1][3] / 2 - 523) <= 1, "second centered vertically");
  assert.strictEqual(r[0][0] + r[0][2] + 8, r[1][0], "side by side with a gap");
  const left = r[0][0], right = r[1][0] + r[1][2];
  assert(Math.abs((left + right) / 2 - 960) <= 1, "the group is centered: " + left + ".." + right);
});
test("three popups: one column on the left, two stacked on the right (screenshot 2)", () => {
  const r = G.packPopups([{ width: 510, height: 560 }, { width: 532, height: 192 }, { width: 593, height: 420 }],
    [0, 0, 0].map(() => ({ width: 0, height: 0 })), area, 8).map(R);
  assert.strictEqual(r[1][0], r[2][0], "right column: both lean to the middle line");
  assert(r[0][0] + r[0][2] < r[1][0], "first is left of the others");
  assert.strictEqual(r[1][1] + r[1][3] + 8, r[2][1], "stacked with a gap");
  assert(!overlap(r[0], r[1]) && !overlap(r[0], r[2]) && !overlap(r[1], r[2]));
  const top = r[1][1], bottom = r[2][1] + r[2][3];
  assert(Math.abs((top + bottom) / 2 - 523) <= 1, "the column is centered vertically");
});
test("many popups never leave the screen and do not overlap", () => {
  const sizes = Array.from({ length: 7 }, (_, i) => ({ width: 500 + i * 20, height: 380 }));
  const r = G.packPopups(sizes, sizes.map(() => ({ width: 200, height: 150 })), area, 8).map(R);
  r.forEach((p) => assert(p[0] >= 0 && p[1] >= 0 && p[0] + p[2] <= 1920 && p[1] + p[3] <= 1046, "on screen: " + p));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert(!overlap(r[i], r[j]), r[i] + " / " + r[j]);
});
test("popup size: not the smallest allowed size, a sensible one", () => {
  const floor = { width: 480, height: 300 }, none = { width: 0, height: 0 };
  const s = G.popupSize({ width: 220, height: 120 }, { width: 200, height: 100 }, none, area, floor, false);
  assert.deepStrictEqual([s.width, s.height], [480, 300]);
  const big = G.popupSize({ width: 900, height: 700 }, none, none, area, floor, false);
  assert.deepStrictEqual([big.width, big.height], [900, 700], "bigger wishes are kept");
  const fixed = G.popupSize({ width: 300, height: 150 }, none, { width: 300, height: 150 }, area, floor, false);
  assert.deepStrictEqual([fixed.width, fixed.height], [300, 150], "the app's maximal size wins");
  const exact = G.popupSize({ width: 320, height: 200 }, none, none, area, floor, true);
  assert.deepStrictEqual([exact.width, exact.height], [320, 200], "a size the user gave it is kept");
  const huge = G.popupSize({ width: 5000, height: 5000 }, none, none, area, floor, false);
  assert(huge.width <= 1920 * 0.85 && huge.height <= 1046 * 0.85);
});
test("quickview: square and centered, or the remembered size", () => {
  const none = { width: 0, height: 0 };
  assert.deepStrictEqual(R(G.quickviewRect(area, 0.07, 0.03, null, none, none)), [469, 32, 983, 983]);
  assert.deepStrictEqual(R(G.quickviewRect(area, 0.07, 0.03, { w: 0.5, h: 0.5 }, none, none)), [480, 262, 960, 523]);
});

/* ------------------------------------------------------------------ runtime */
const runtime = vm.runInContext("(api) => new KWinRuntime(api)", ctx)(api);
const konsole = client("konsole");
const dialog = (owner, w, h, cls) => {
  const d = client(cls || owner.resourceClass);
  Object.assign(d, { dialog: true, normalWindow: false, transient: true, transientFor: owner, modal: false,
    frameGeometry: rect(10, 10, w, h), clientGeometry: rect(10, 40, w, h - 30) });
  return d;
};
const open = (c) => { addClient(c); runTimers(400); };
const close = (c) => { c.deleted = true; ws.stackingOrder = ws.stackingOrder.filter((x) => x !== c); ws.windowRemoved.emit(c); runTimers(50); };

test("start: a tiled window fills the screen", () => {
  runtime.start();
  runTimers(100);
  open(konsole);
  assert.deepStrictEqual(geo(konsole), [0, 0, 1920, 1080]);
});
let d1, d2;
test("a dialog opens in the middle at a sensible size, above the tiles; the tiles stay", () => {
  d1 = dialog(konsole, 260, 140);
  open(d1);
  assert.deepStrictEqual(geo(d1), [720, 390, 480, 300]);
  assert.strictEqual(d1.keepAbove, true, "popup layer is above the tiles");
  assert.deepStrictEqual(geo(konsole), [0, 0, 1920, 1080], "not tiled, the tile is untouched");
});
test("a second popup: both side by side around the middle", () => {
  d2 = dialog(client("dolphin"), 700, 500, "dolphin");
  open(d2);
  const p = geo(d1), q = geo(d2);
  assert(!overlap(p, q), p + " / " + q);
  assert.strictEqual(p[0] + p[2] + 8, q[0]);
  assert(Math.abs((p[0] + q[0] + q[2]) / 2 - 960) <= 1, "the pair is centered");
});
test("closing one: the other moves back to the middle", () => {
  close(d1);
  runTimers(50);
  assert.deepStrictEqual(geo(d2), [610, 290, 700, 500]);
});
test("a popup moved by hand stays where it was dropped", () => {
  d2.move = true; d2.moveResizedChanged.emit();
  d2.frameGeometry = rect(50, 60, 700, 500);
  d2.move = false; d2.moveResizedChanged.emit();
  runTimers(50);
  const d3 = dialog(konsole, 600, 400);
  open(d3);
  assert.deepStrictEqual(geo(d2), [50, 60, 700, 500]);
  assert.deepStrictEqual(geo(d3), [660, 340, 600, 400], "the new one alone in the middle");
  close(d3); close(d2);
});
test("an app that insists on another size is not fought", () => {
  const d = dialog(konsole, 260, 140);
  open(d);
  d.frameGeometry = rect(geo(d)[0], geo(d)[1], 260, 140); // refuses 480x300
  d.frameGeometryChanged.emit(); runTimers(400);
  assert.deepStrictEqual(geo(d), [830, 470, 260, 140], "its size, centered");
  d.frameGeometryChanged.emit(); runTimers(400);
  assert.deepStrictEqual(geo(d), [830, 470, 260, 140], "stable");
  close(d);
});

test("a transient normal window (managed by the engine as floating) stays where the popup layer put it", () => {
  const d = client("konsole");
  Object.assign(d, { transient: true, transientFor: konsole, frameGeometry: rect(5, 5, 640, 420), clientGeometry: rect(5, 35, 640, 390) });
  open(d);
  assert.deepStrictEqual(geo(d), [640, 330, 640, 420]);
  assert.deepStrictEqual(geo(konsole), [0, 0, 1920, 1080], "it floats, the tile stays");
  close(d);
});
const bw = client("bitwarden");
test("tray quickview: the shortcut takes the app out of the tiles, square and centered above everything", () => {
  open(bw);
  assert(geo(bw)[2] < 1920, "tiled first");
  focus(bw);
  press("ToggleQuickviewSC"); runTimers(50);
  assert.deepStrictEqual(geo(bw), [453, 33, 1015, 1015]);
  assert.strictEqual(bw.keepAbove, true);
  assert.strictEqual(ws.activeWindow, bw);
  assert.deepStrictEqual(geo(konsole), [0, 0, 1920, 1080], "the tiles close the gap");
  assert(/Quickview on/.test(notes[notes.length - 1]), notes[notes.length - 1]);
  assert(shellCmds.some((c) => /--key QuickviewClasses "bitwarden(,telegram)?"/.test(c)), "the effect knows the app");
});
test("its own dialogs do not close it, a click on another window does", () => {
  const pw = dialog(bw, 400, 200);
  open(pw);
  assert.strictEqual(bw.closed, false);
  close(pw);
  focus(bw);
  focus(konsole);
  assert.strictEqual(bw.closed, true, "closed back into the tray");
  close(bw);
});
test("it comes back as quickview when the app shows it again (tray click or on its own)", () => {
  const again = client("bitwarden");
  ws.activeWindow = konsole;
  ws.stackingOrder.push(again); ws.windowAdded.emit(again); runTimers(50);
  assert.deepStrictEqual(geo(again), [453, 33, 1015, 1015]);
  assert.strictEqual(ws.activeWindow, again, "it gets the focus");
  assert.deepStrictEqual(geo(konsole), [0, 0, 1920, 1080], "never tiled");
  /* only one quickview: another tray app (window rule) replaces it */
  const tg = client("telegram");
  ws.stackingOrder.push(tg); ws.windowAdded.emit(tg); runTimers(50);
  assert.strictEqual(again.closed, true, "the first went back");
  assert.deepStrictEqual(geo(tg), [453, 33, 1015, 1015]);
  close(again);
  /* a resized quickview keeps its size next time */
  tg.resize = true; tg.moveResizedChanged.emit();
  tg.frameGeometry = rect(453, 33, 800, 600);
  tg.resize = false; tg.moveResizedChanged.emit();
  assert.deepStrictEqual(geo(tg), [560, 240, 800, 600], "re-centered at the new size");
  focus(konsole);
  close(tg);
  const tg2 = client("telegram");
  open(tg2);
  assert.deepStrictEqual(geo(tg2), [560, 240, 800, 600], "remembered");
  focus(konsole);
  close(tg2);
});
test("the quickview apps are saved", () => {
  runTimers(2500);
  const st = JSON.parse(disk);
  assert.deepStrictEqual(st.layers.quickview, ["bitwarden"]);
  assert(st.layers.quickviewSizes.telegram, "remembered quickview size");
});
test("the shortcut again: the app is tiled again", () => {
  const b2 = client("bitwarden");
  open(b2);
  press("ToggleQuickviewSC"); runTimers(50);
  assert(/Quickview off/.test(notes[notes.length - 1]), notes[notes.length - 1]);
  assert.strictEqual(b2.keepAbove, false);
  assert(geo(b2)[2] < 1920 && geo(konsole)[2] < 1920, "two tiles: " + geo(b2) + " " + geo(konsole));
});
test("the runtime shuts down cleanly", () => {
  runtime.dispose();
  runTimers(100);
});

console.log(failed === 0 ? "\nall layer tests passed" : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
