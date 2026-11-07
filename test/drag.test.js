// Live drag & drop preview across two monitors, with the real Smart layout.
// Run: npx tsc && node test/drag.test.js
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

let active = null, preview = null, moved = null;
const commits = {};
let n = 0;
function win(cls, out, minW = 0, minH = 0) {
  const id = cls + ++n;
  const w = {
    id, windowClassName: cls, fullScreen: false, maximized: false, minimized: false, shouldIgnore: false,
    shouldFloat: false, weight: null, placement: null, hasPreferredFloatGeometry: false,
    minSize: { width: minW, height: minH }, maxSize: { width: 99999, height: 99999 },
    geometry: R(0, 0, 100, 100), out,
    get surface() { return this.out === outA ? sA : sB; }, set surface(s) {},
    commit(g) { if (g) { commits[id] = [g.x, g.y, g.width, g.height]; this.geometry = g; } },
    visible(s) { return s.output === this.out; },
    getInitFloatGeometry: () => R(0, 0, 400, 300), moveMouseToFocus() {}, rememberFloatGeometry() {},
  };
  return vm.runInContext("(w) => new WindowClass(w)", ctx)(w);
}
const drv = {
  backend: "test", get currentSurfaces() { return [sA, sB]; }, cursorPosition: [0, 0],
  get currentSurface() { return active ? active.surface : sA; }, set currentSurface(v) {},
  get currentWindow() { return active; }, set currentWindow(w) { active = w; },
  isMetaMode: false, isPaused: false, setTimeout() {}, showNotification() {}, metaPushed() {}, stateMaybeChanged() {},
  showDropPreview(r, swap) { preview = r && { r: [r.x, r.y, r.width, r.height], swap }; },
  moveWindowsToScreen(list) { const [out, ws] = list[0]; ws.forEach((w) => (w.window.out = out)); moved = out.name; engine.arrange(drv, "moved"); },
};
const engine = vm.runInContext("new TilingEngine()", ctx);
const control = vm.runInContext("(e) => new TilingController(e)", ctx)(engine);

let failed = 0;
const test = (name, f) => { try { f(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); } };
const g = (w) => commits[w.id];

// monitor A: 3 windows (master + 2 stacked), monitor B: 2 windows
const a1 = win("a1", outA), a2 = win("a2", outA), a3 = win("a3", outA);
const b1 = win("b1", outB), b2 = win("b2", outB);
[a1, a2, a3, b1, b2].forEach((w) => engine.manage(w));
active = a1;
engine.arrange(drv, "init");

const drag = (w, x, y) => { drv.cursorPosition = [x, y]; control.onWindowDragging(drv, w, w.actualGeometry); };

test("initial layout", () => {
  assert.deepStrictEqual(g(a1), [0, 0, 960, 1080]);
  assert.deepStrictEqual(g(a2), [960, 0, 960, 540]);
  assert.deepStrictEqual(g(b1), [1920, 0, 960, 1080]);
});
test("hovering a tile on the same monitor: silhouette there, that tile moves away", () => {
  drag(a1, 100, 100); // still home
  assert.deepStrictEqual(preview.r, [0, 0, 960, 1080]);
  assert.strictEqual(preview.swap, false);
  drag(a1, 1500, 800); // over a3 (bottom right)
  assert.deepStrictEqual(preview.r, [960, 540, 960, 540], "silhouette where a3 was");
  assert.deepStrictEqual(g(a3), [0, 0, 960, 1080], "a3 moved to a1's place already");
  assert.strictEqual(preview.swap, true);
});
test("four places: each tile is a separate target, hit-testing uses the slots at drag start", () => {
  drag(a1, 1500, 200); // over a2 (top right) - a3 is now drawn at the left, must not matter
  assert.deepStrictEqual(preview.r, [960, 0, 960, 540]);
  assert.deepStrictEqual(g(a2), [0, 0, 960, 1080]);
  assert.deepStrictEqual(g(a3), [960, 540, 960, 540], "a3 back in its own place");
});
test("normal arranging pauses while dragging", () => {
  engine.arrange(drv, "outputChanged");
  assert.deepStrictEqual(g(a2), [0, 0, 960, 1080], "not reset by an arrange");
});
test("dragging onto the other monitor: it makes room, the old one closes the gap", () => {
  drag(a1, 2300, 500); // over b1 on monitor B
  assert(preview.r[0] >= 1920, "silhouette on monitor B: " + preview.r);
  assert.deepStrictEqual(preview.r, [1920, 0, 960, 1080], "a1 takes b1's place");
  assert.deepStrictEqual(g(b1), [2880, 0, 960, 540], "b1 moved aside");
  assert.deepStrictEqual(g(a2), [0, 0, 960, 1080], "monitor A without a1: a2 is master");
  assert.deepStrictEqual(g(a3), [960, 0, 960, 1080], "a3 takes the other half");
});
test("drop on the other monitor does exactly what the preview showed", () => {
  control.onWindowMoveOver(drv, a1);
  assert.strictEqual(moved, "HDMI-A-1");
  assert.strictEqual(preview, null, "preview hidden");
  assert.deepStrictEqual(g(a1), [1920, 0, 960, 1080]);
  assert.deepStrictEqual(g(b1), [2880, 0, 960, 540]);
  assert.deepStrictEqual(g(a2), [0, 0, 960, 1080]);
  assert.strictEqual(engine.dragWindow, null);
});
test("drop on the same monitor swaps with the hovered tile", () => {
  drag(a2, 1500, 500); // a2 over a3
  control.onWindowMoveOver(drv, a2);
  assert.deepStrictEqual(g(a2), [960, 0, 960, 1080]);
  assert.deepStrictEqual(g(a3), [0, 0, 960, 1080]);
});
test("drop back home restores everything", () => {
  drag(b2, 2300, 500); // over a1 (now on B)
  drag(b2, 3300, 800); // back over its own slot
  control.onWindowMoveOver(drv, b2);
  assert.deepStrictEqual(g(b2), [2880, 540, 960, 540]);
  assert.deepStrictEqual(g(a1), [1920, 0, 960, 1080]);
});
test("screenshot case: the window lands under the cursor on every tile, even with big min sizes", () => {
  // one 1920x1045 monitor like the screenshot; System Settings and the window
  // top right cannot share a column, so a plain swap would not put dolphin there
  sA.workingArea = R(0, 0, 1920, 1045);
  const centre = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
  ["systemsettings", "claude", "konsole"].forEach((targetName) => {
    const e2 = vm.runInContext("new TilingEngine()", ctx);
    const c2 = vm.runInContext("(e) => new TilingController(e)", ctx)(e2);
    const settings = win("systemsettings", outA, 930, 678), dolphin = win("dolphin", outA, 225, 193);
    const claude = win("claude", outA, 600, 500), konsole = win("konsole", outA, 300, 200);
    [settings, dolphin, claude, konsole].forEach((w) => e2.manage(w));
    const d2 = Object.assign({}, drv, { get currentSurfaces() { return [sA]; },
      moveWindowsToScreen() { throw new Error("no monitor change expected"); } });
    active = dolphin;
    e2.arrange(d2, "init");
    const target = { systemsettings: settings, claude, konsole }[targetName];
    const [x, y] = centre(g(target));
    d2.cursorPosition = [x, y];
    c2.onWindowDragging(d2, dolphin, dolphin.actualGeometry);
    const p = preview.r;
    assert(p[0] <= x && x < p[0] + p[2] && p[1] <= y && y < p[1] + p[3],
      `over ${targetName}: silhouette ${p} not under cursor ${x},${y}`);
    c2.onWindowMoveOver(d2, dolphin);
    const r = g(dolphin);
    assert(r[0] <= x && x < r[0] + r[2] && r[1] <= y && y < r[1] + r[3],
      `dropped on ${targetName}: landed at ${r}, cursor ${x},${y}`);
  });
  sA.workingArea = R(0, 0, 1920, 1080);
});
test("order search: a plain swap would put the window elsewhere, the search puts it under the cursor", () => {
  // found by exploring: with these min sizes the swapped order makes the Smart
  // layout switch to three columns and dolphin would land at the far right
  vm.runInContext("CONFIG.smartFocusGrow = 0", ctx);
  const e3 = vm.runInContext("new TilingEngine()", ctx);
  const smart = vm.runInContext("new SmartLayout()", ctx);
  const t = (name, w, h) => ({ name, minSize: { width: w, height: h }, weight: 1 });
  const settings = t("settings", 930, 678), dolphin = t("dolphin", 225, 193);
  const claude = t("claude", 600, 500), konsole = t("konsole", 300, 200);
  const area = R(0, 0, 1920, 1045);
  const swapped = [settings, claude, dolphin, konsole];
  const pos = [1440, 261]; // centre of claude's old slot (top right)
  const plain = smart.compute(swapped, area, 0, 2)[2];
  assert(!plain.includesPoint(pos), "precondition: plain swap misses (" + [plain.x, plain.width] + ")");
  const order = e3.orderLandingAt(smart, swapped, dolphin, pos, area, 0);
  const r = smart.compute(order, area, 0, order.indexOf(dolphin))[order.indexOf(dolphin)];
  assert(r.includesPoint(pos), `found order ${order.map((x) => x.name)} lands at ${[r.x, r.y, r.width, r.height]}`);
});
console.log(failed ? `\n${failed} failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
