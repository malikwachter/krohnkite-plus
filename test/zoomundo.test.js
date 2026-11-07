// Zoom (Meta+Z) and Undo/Redo (Meta+Ctrl+Z / Meta+Ctrl+Y), real engine + Smart layout.
// Run: npx tsc && node test/zoomundo.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const ctx = { print() {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "krohnkite.js"), "utf8"), ctx);
vm.runInContext(`KWIN = { readConfig: (k, d) => k === "smartFocusGrow" ? 0 : d }; KWINCONFIG = CONFIG = new KWinConfig();`, ctx);

const R = (x, y, w, h) => vm.runInContext(`new Rect(${x},${y},${w},${h})`, ctx);
const outA = { name: "DP-2", geometry: { x: 0, y: 0, width: 1920, height: 1080 } };
const outB = { name: "HDMI-A-1", geometry: { x: 1920, y: 0, width: 1920, height: 1080 } };
const desk = { id: "d1", name: "Desktop 1" };
const srf = (out) => ({
  id: out.name, layoutId: out.name, output: out, activity: "a", vDesktop: desk, ignore: false, capacity: null,
  workingArea: R(out.geometry.x, 0, 1920, 1080), next: () => null, getParams: () => [out.name, "a", desk.name],
});
const sA = srf(outA), sB = srf(outB);
const ABOVE = 2, BELOW = 0;

let active = null, note = "";
const commits = {}, layers = {};
let n = 0;
function win(cls, out, owner) {
  const id = cls + ++n;
  const w = {
    id, windowClassName: cls, fullScreen: false, maximized: false, minimized: false, shouldIgnore: false,
    shouldFloat: false, weight: null, placement: null, hasPreferredFloatGeometry: false,
    minSize: { width: 0, height: 0 }, maxSize: { width: 99999, height: 99999 },
    geometry: R(0, 0, 100, 100), out, owner,
    get surface() { return this.out === outA ? sA : sB; }, set surface(s) {},
    commit(g, nb, layer) { if (g) { commits[id] = [g.x, g.y, g.width, g.height]; this.geometry = g; } if (layer !== undefined) layers[id] = layer; },
    visible(s) { return s.output === this.out; },
    isTransientOf(o) { return this.owner === o; },
    getInitFloatGeometry: () => R(100, 100, 400, 300), moveMouseToFocus() {}, rememberFloatGeometry() {},
  };
  return vm.runInContext("(w) => new WindowClass(w)", ctx)(w);
}
const drv = {
  backend: "test", get currentSurfaces() { return [sA, sB]; }, cursorPosition: [0, 0],
  get currentSurface() { return active ? (active.window.out === outA ? sA : sB) : sA; }, set currentSurface(v) {},
  get currentWindow() { return active; }, set currentWindow(w) { active = w; },
  isMetaMode: false, isPaused: false, setTimeout() {}, showNotification(t) { note = t; }, metaPushed() {}, stateMaybeChanged() {},
  showDropPreview() {},
  moveWindowsToScreen(list) { list.forEach(([out, ws]) => ws.forEach((w) => (w.window.out = out))); engine.arrange(drv, "moveWindowsToScreen"); },
};
const engine = vm.runInContext("new TilingEngine()", ctx);
const control = vm.runInContext("(e) => new TilingController(e)", ctx)(engine);
const key = (k) => control.onShortcut(drv, k);
const focus = (w) => { active = w; control.onWindowFocused(drv, w); };

let failed = 0;
const test = (name, f) => { try { f(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); } };
const g = (w) => commits[w.id];
const ZOOM = [134, 32, 1652, 1016]; // 7 % left/right, 3 % top/bottom of 1920x1080

const a1 = win("a1", outA), a2 = win("a2", outA), a3 = win("a3", outA);
const b1 = win("b1", outB);
[a1, a2, a3, b1].forEach((w) => engine.manage(w));
active = a1;
engine.arrange(drv, "init");
const home = { a1: g(a1), a2: g(a2), a3: g(a3) };

test("layout before zooming", () => {
  assert.deepStrictEqual(home.a1, [0, 0, 960, 1080]);
  assert.strictEqual(layers[a1.id], BELOW);
});
test("zoom: centered, almost fullscreen, above the others; the others stay", () => {
  key("Zoom");
  assert.deepStrictEqual(g(a1), ZOOM);
  assert.strictEqual(layers[a1.id], ABOVE);
  assert.deepStrictEqual(g(a2), home.a2);
  assert.deepStrictEqual(g(a3), home.a3);
  assert.strictEqual(a1.state, vm.runInContext("WindowState.Tiled", ctx), "never really floating");
});
test("arranging keeps the zoom", () => {
  engine.arrange(drv, "something");
  assert.deepStrictEqual(g(a1), ZOOM);
});
test("pressing the key again puts it back into its place", () => {
  key("Zoom");
  assert.deepStrictEqual(g(a1), home.a1);
  assert.strictEqual(layers[a1.id], BELOW);
});
test("focusing another window ends the zoom", () => {
  key("Zoom");
  assert.deepStrictEqual(g(a1), ZOOM);
  focus(a2);
  assert.deepStrictEqual(g(a1), home.a1);
  assert.strictEqual(engine.zoomWindow, null);
});
test("a dialog of the zoomed window does not end the zoom", () => {
  active = a1;
  key("Zoom");
  const dlg = win("dialog", outA, a1.window);
  focus(dlg);
  assert.deepStrictEqual(g(a1), ZOOM);
  control.onForeignFocus(drv, true); // unmanaged dialog
  assert.deepStrictEqual(g(a1), ZOOM);
});
test("clicking the desktop / an unmanaged app ends the zoom", () => {
  active = a1;
  control.onForeignFocus(drv, false);
  assert.deepStrictEqual(g(a1), home.a1);
});
test("zoom on another monitor uses that monitor", () => {
  active = b1;
  key("Zoom");
  assert.deepStrictEqual(g(b1), [1920 + 134, 32, 1652, 1016]);
  key("Zoom");
  assert.deepStrictEqual(g(b1), [1920, 0, 1920, 1080]);
});
test("floating windows cannot be zoomed", () => {
  active = a3;
  key("ToggleFloat");
  key("Zoom");
  assert.strictEqual(engine.zoomWindow, null);
  assert.strictEqual(note, "Zoom: only tiled windows");
  key("ToggleFloat");
});
test("closing the zoomed window clears the zoom", () => {
  const t = win("tmp", outA);
  engine.manage(t);
  engine.arrange(drv, "add");
  active = t;
  key("Zoom");
  control.onWindowRemoved(drv, t);
  assert.strictEqual(engine.zoomWindow, null);
  assert.deepStrictEqual(g(a1), home.a1);
});

/* ------------------------------------------------------------ undo / redo */
const order = () => [...engine.windows.list.filter((w) => w.window.out === outA && w.isTiled).map((w) => w.windowClassName)];

test("undo / redo a swap", () => {
  const before = order();
  active = a3;
  key("SetMaster"); // a3 becomes master
  const after = order();
  assert.notDeepStrictEqual(after, before);
  key("Undo");
  assert.deepStrictEqual(order(), before);
  assert.deepStrictEqual(g(a1), home.a1);
  key("Redo");
  assert.deepStrictEqual(order(), after);
  key("Undo");
  assert.deepStrictEqual(order(), before);
});
test("undo floating a window", () => {
  active = a2;
  key("ToggleFloat");
  assert(a2.isFloating);
  key("Undo");
  assert(a2.isTiled);
  assert.deepStrictEqual(g(a2), home.a2);
});
test("opening and closing windows is not an undo step", () => {
  const steps = engine.undoSteps, redo = engine.redoSteps;
  const t = win("tmp", outA);
  engine.manage(t);
  engine.arrange(drv, "add");
  control.onWindowRemoved(drv, t);
  engine.arrange(drv, "removed");
  assert.strictEqual(engine.undoSteps, steps);
  assert.strictEqual(engine.redoSteps, redo, "redo survives windows opening");
});
test("undo a move to the other monitor", () => {
  active = a3;
  engine.markUserAction();
  drv.moveWindowsToScreen([[outB, [a3]]]);
  assert.strictEqual(a3.window.out, outB);
  key("Undo");
  assert.strictEqual(a3.window.out, outA);
  assert.deepStrictEqual(order(), ["a1", "a2", "a3"]);
  assert.deepStrictEqual(g(a3), home.a3, JSON.stringify([g(a1), g(a2), g(a3)]));
});
test("undo a layout change and a size change", () => {
  active = a1;
  const cur = () => engine.layouts.getCurrentLayout(sA).classID;
  const before = cur();
  key("NextLayout");
  assert.notStrictEqual(cur(), before);
  key("Undo");
  assert.strictEqual(cur(), before);
  key("GrowWidth");
  const grown = g(a1);
  assert.notDeepStrictEqual(grown, home.a1, "grow changed the size");
  key("Undo");
  assert.deepStrictEqual(g(a1), home.a1);
  key("Redo");
  assert.deepStrictEqual(g(a1), grown);
  key("Undo");
});
test("focus keys are no undo steps; empty stacks say so", () => {
  const e = vm.runInContext("new TilingEngine()", ctx);
  const c = vm.runInContext("(e) => new TilingController(e)", ctx)(e);
  const x = win("x", outA), y = win("y", outA);
  e.manage(x); e.manage(y);
  active = x;
  e.arrange(drv, "init");
  c.onShortcut(drv, "FocusNext");
  c.onShortcut(drv, "Undo");
  assert.strictEqual(note, "Nothing to undo");
  c.onShortcut(drv, "Redo");
  assert.strictEqual(note, "Nothing to redo");
});
test("live mouse resizing becomes one step at the end", () => {
  active = a1;
  const steps = engine.undoSteps;
  control.onWindowResizeStart(a1);
  engine.arrange(drv, "onWindowResize");
  engine.arrange(drv, "onWindowResize");
  control.onWindowResizeOver(drv, a1);
  assert(engine.undoSteps <= steps + 1);
});

test("drag & drop with the mouse is one undo step", () => {
  const before = order();
  active = a1;
  control.onWindowMoveStart(a1);
  drv.cursorPosition = [1500, 800]; // over the bottom right tile
  control.onWindowDragging(drv, a1, a1.actualGeometry);
  control.onWindowMoveOver(drv, a1);
  assert.notDeepStrictEqual(order(), before, "dropped somewhere else");
  key("Undo");
  assert.deepStrictEqual(order(), before);
  assert.deepStrictEqual(g(a1), home.a1);
});
test("moving a floating window with the mouse can be undone", () => {
  active = a2;
  key("ToggleFloat");
  const start = g(a2).slice();
  control.onWindowMoveStart(a2);
  a2.window.geometry = R(start[0] + 300, start[1] + 200, start[2], start[3]); // the user moved it
  control.onWindowMoveOver(drv, a2);
  key("Undo");
  assert.deepStrictEqual(g(a2), start, "back where it was");
  key("Undo"); // and tiled again
  assert(a2.isTiled);
});
test("no snapshots are taken by plain arranges", () => {
  let snaps = 0;
  const h = engine.history, orig = h.snapshot;
  h.snapshot = function () { snaps++; return orig.call(this); };
  for (let i = 0; i < 20; i++) engine.arrange(drv, "plain");
  h.snapshot = orig;
  assert.strictEqual(snaps, 0);
});

test("a key without effect, then windows opening that make one float: no step", () => {
  const e = vm.runInContext("new TilingEngine()", ctx);
  const c = vm.runInContext("(e) => new TilingController(e)", ctx)(e);
  const x = win("x", outA), y = win("y", outA);
  e.manage(x); e.manage(y);
  active = x;
  e.arrange(drv, "init");
  c.onShortcut(drv, "FocusNext"); // user action that changes nothing
  const z = win("z", outA);
  z.window.minSize = { width: 1200, height: 700 };
  e.manage(z);
  e.arrange(drv, "added");
  assert(z.isTiled, "z fits");
  const w2 = win("w2", outA);
  w2.window.minSize = { width: 900, height: 600 }; // z and w2 cannot share the screen: z floats
  e.manage(w2);
  e.arrange(drv, "added");
  assert(z.isFloating, "z was floated automatically");
  assert.strictEqual(e.undoSteps, 0, "automatic floating is not the user's step");
});
test("grow/shrink keys change dock sizes (vertical: v*, horizontal: h*), else resize", () => {
  const P = vm.runInContext("DockPosition", ctx), Docked = vm.runInContext("WindowState.Docked", ctx);
  const mk = (pos) => ({ state: Docked, dock: { position: pos, cfg: { vWide: 10, hWide: 10, vHeight: 10, hHeight: 10 } } });
  const left = mk(P.left), top = mk(P.top);
  control.resizeDockOrWindow(left, "width", 1);
  control.resizeDockOrWindow(left, "height", -1);
  control.resizeDockOrWindow(top, "width", -1);
  control.resizeDockOrWindow(top, "height", 1);
  assert.deepStrictEqual({ ...left.dock.cfg }, { vWide: 11, hWide: 10, vHeight: 9, hHeight: 10 });
  assert.deepStrictEqual({ ...top.dock.cfg }, { vWide: 10, hWide: 9, vHeight: 10, hHeight: 11 });
  const calls = [];
  const orig = engine.resizeWindow;
  engine.resizeWindow = (w, dir, step) => calls.push(dir + step);
  control.resizeDockOrWindow(a1, "width", -1);
  control.resizeDockOrWindow(a1, "height", 1);
  engine.resizeWindow = orig;
  assert.deepStrictEqual(calls, ["east-1", "south1"]);
});

console.log(failed === 0 ? "\nall zoom/undo tests passed" : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
