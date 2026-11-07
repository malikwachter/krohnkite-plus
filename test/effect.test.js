// Tests the Krohnkite Smooth effect against a fake KWin effect API.
// Run: node test/effect.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const signal = () => { const fns = []; return { connect: (f) => fns.push(f), emit: (...a) => fns.forEach((f) => f(...a)) }; };
const calls = [], cancelled = [];
let nextId = 1, config = { Duration: 150 };
const ctx = {
  print() {}, Map, Set, Number, Math, isFinite,
  Effect: { Size: "Size", Translation: "Translation" }, QEasingCurve: { OutCubic: "OutCubic" },
  animate: (o) => { calls.push(o); return nextId++; },
  cancel: (id) => cancelled.push(id),
  effect: { readConfig: (k, d) => (k in config ? config[k] : d), configChanged: signal(), animationEnded: signal() },
  effects: {
    windowFrameGeometryChanged: signal(), windowMaximizedStateAboutToChange: signal(),
    windowFullScreenChanged: signal(), windowDeleted: signal(),
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "effect", "contents", "code", "main.js"), "utf8"), ctx);

let failed = 0;
const test = (n, f) => { try { calls.length = 0; f(); console.log("ok   " + n); } catch (e) { failed++; console.log("FAIL " + n + "\n     " + e.message); } };
const win = (g, extra = {}) => Object.assign({ frameGeometry: g, visible: true, normalWindow: true, move: false, resize: false }, extra);
const rect = (x, y, width, height) => ({ x, y, width, height });
const change = (w, old) => ctx.effects.windowFrameGeometryChanged.emit(w, old);

test("focus grow: window resizes smoothly from old to new geometry", () => {
  const w = win(rect(0, 0, 1152, 1080));
  change(w, rect(0, 0, 960, 1080));
  assert.strictEqual(calls.length, 1);
  const a = calls[0];
  assert.strictEqual(a.duration, 150);
  assert.strictEqual(a.curve, "OutCubic");
  const size = a.animations.find((x) => x.type === "Size");
  const tr = a.animations.find((x) => x.type === "Translation");
  assert.deepStrictEqual([size.from.value1, size.to.value1], [960, 1152]);
  assert.deepStrictEqual([tr.from.value1, tr.from.value2, tr.to.value1], [-96, 0, 0], "starts at the old centre");
});
test("dropped window glides from the drop position into its slot", () => {
  const w = win(rect(960, 0, 960, 540));
  change(w, rect(400, 300, 960, 540));
  const tr = calls[0].animations.find((x) => x.type === "Translation");
  assert.deepStrictEqual([tr.from.value1, tr.from.value2], [-560, 300]);
});
test("no animation while the user drags or resizes the window", () => {
  change(win(rect(10, 10, 500, 500), { move: true }), rect(0, 0, 500, 500));
  change(win(rect(10, 10, 600, 500), { resize: true }), rect(10, 10, 500, 500));
  assert.strictEqual(calls.length, 0);
});
test("no animation for maximize, fullscreen, panels, popups and tiny corrections", () => {
  const m = win(rect(0, 0, 1920, 1080));
  ctx.effects.windowMaximizedStateAboutToChange.emit(m, true, true);
  change(m, rect(100, 100, 800, 600));
  change(win(rect(0, 0, 1920, 1080), { fullScreen: true }), rect(0, 0, 800, 600));
  change(win(rect(0, 0, 1920, 40), { dock: true, normalWindow: false }), rect(0, 0, 1000, 40));
  change(win(rect(0, 0, 300, 300), { popupWindow: true }), rect(50, 50, 300, 300));
  change(win(rect(0, 0, 801, 600)), rect(0, 0, 800, 600));
  assert.strictEqual(calls.length, 0);
  change(m, rect(0, 0, 960, 1080));
  assert.strictEqual(calls.length, 1, "only the maximize step itself is skipped");
});
test("a new change on a running animation replaces it", () => {
  const w = win(rect(0, 0, 900, 900));
  change(w, rect(0, 0, 500, 500));
  const first = nextId - 1;
  w.frameGeometry = rect(0, 0, 700, 700);
  change(w, rect(0, 0, 900, 900));
  assert(cancelled.indexOf(first) >= 0, "first animation cancelled");
  assert.strictEqual(calls.length, 2);
});
test("duration comes from the config, 0 turns animations off", () => {
  config.Duration = 300;
  ctx.effect.configChanged.emit();
  change(win(rect(0, 0, 900, 900)), rect(0, 0, 500, 500));
  assert.strictEqual(calls[0].duration, 300);
  config.Duration = 0;
  ctx.effect.configChanged.emit();
  change(win(rect(0, 0, 900, 900)), rect(0, 0, 500, 500));
  assert.strictEqual(calls.length, 1);
  config.Duration = 150;
  ctx.effect.configChanged.emit();
});
console.log(failed ? `\n${failed} failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
