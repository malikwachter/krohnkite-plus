// Tests the Krohnkite Smooth effect against a fake KWin effect API.
// Plasma 6: window signals live on each EffectWindow; older KWin: on `effects`.
// Run: node test/effect.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const signal = () => { const fns = []; return { connect: (f) => fns.push(f), emit: (...a) => fns.forEach((f) => f(...a)), get count() { return fns.length; } }; };
const code = fs.readFileSync(path.join(__dirname, "..", "effect", "contents", "code", "main.js"), "utf8");

function setup(plasma6, initialWindows = []) {
  const env = { calls: [], cancelled: [], config: { Duration: 150 }, nextId: 1, logs: [] };
  const effects = plasma6
    ? { windowAdded: signal(), windowDeleted: signal(), stackingOrder: initialWindows }
    : { windowFrameGeometryChanged: signal(), windowMaximizedStateAboutToChange: signal(),
        windowFullScreenChanged: signal(), windowDeleted: signal() };
  const ctx = {
    print: (s) => env.logs.push(s), Map, Set, Number, Math, isFinite,
    Effect: { Size: "Size", Translation: "Translation" }, QEasingCurve: { OutCubic: "OutCubic" },
    animate: (o) => { env.calls.push(o); return env.nextId++; },
    cancel: (id) => env.cancelled.push(id),
    effect: { readConfig: (k, d) => (k in env.config ? env.config[k] : d), configChanged: signal(), animationEnded: signal() },
    effects,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  env.ctx = ctx;
  env.change = (w, old) => (plasma6 ? w.windowFrameGeometryChanged.emit(w, old) : effects.windowFrameGeometryChanged.emit(w, old));
  env.maximize = (w) => (plasma6 ? w.windowMaximizedStateAboutToChange.emit(w, true, true) : effects.windowMaximizedStateAboutToChange.emit(w, true, true));
  env.add = (w) => { if (plasma6) effects.windowAdded.emit(w); return w; };
  return env;
}
const rect = (x, y, width, height) => ({ x, y, width, height });
const win = (g, extra = {}) => Object.assign({
  geometry: g, visible: true, normalWindow: true, move: false, resize: false, windowClass: "test",
  windowFrameGeometryChanged: signal(), windowMaximizedStateAboutToChange: signal(),
  windowMaximizedStateChanged: signal(), windowFullScreenChanged: signal(), windowStartUserMovedResized: signal(),
}, extra);

let failed = 0;
const test = (n, f) => { try { f(); console.log("ok   " + n); } catch (e) { failed++; console.log("FAIL " + n + "\n     " + e.stack.split("\n").slice(0, 2).join("\n     ")); } };

[true, false].forEach((plasma6) => {
  const tag = plasma6 ? "[plasma 6] " : "[old kwin] ";
  test(tag + "focus grow: window resizes smoothly from old to new geometry", () => {
    const e = setup(plasma6);
    const w = e.add(win(rect(0, 0, 1152, 1080)));
    e.change(w, rect(0, 0, 960, 1080));
    assert.strictEqual(e.calls.length, 1);
    const a = e.calls[0];
    assert.strictEqual(a.duration, 150);
    assert.strictEqual(a.curve, "OutCubic");
    const size = a.animations.find((x) => x.type === "Size");
    const tr = a.animations.find((x) => x.type === "Translation");
    assert.deepStrictEqual([size.from.value1, size.to.value1], [960, 1152]);
    assert.deepStrictEqual([tr.from.value1, tr.from.value2, tr.to.value1], [-96, 0, 0], "starts at the old centre");
  });
  test(tag + "dropped window glides from the drop position into its slot", () => {
    const e = setup(plasma6);
    const w = e.add(win(rect(960, 0, 960, 540)));
    e.change(w, rect(400, 300, 960, 540));
    const tr = e.calls[0].animations.find((x) => x.type === "Translation");
    assert.deepStrictEqual([tr.from.value1, tr.from.value2], [-560, 300]);
  });
  test(tag + "no animation while the user drags or resizes the window", () => {
    const e = setup(plasma6);
    e.change(e.add(win(rect(10, 10, 500, 500), { move: true })), rect(0, 0, 500, 500));
    e.change(e.add(win(rect(10, 10, 600, 500), { resize: true })), rect(10, 10, 500, 500));
    assert.strictEqual(e.calls.length, 0);
  });
  test(tag + "no animation for maximize, fullscreen, panels, popups and tiny corrections", () => {
    const e = setup(plasma6);
    const m = e.add(win(rect(0, 0, 1920, 1080)));
    e.maximize(m);
    e.change(m, rect(100, 100, 800, 600));
    e.change(e.add(win(rect(0, 0, 1920, 1080), { fullScreen: true })), rect(0, 0, 800, 600));
    e.change(e.add(win(rect(0, 0, 1920, 40), { dock: true, normalWindow: false })), rect(0, 0, 1000, 40));
    e.change(e.add(win(rect(0, 0, 300, 300), { popupWindow: true })), rect(50, 50, 300, 300));
    e.change(e.add(win(rect(0, 0, 801, 600))), rect(0, 0, 800, 600));
    assert.strictEqual(e.calls.length, 0);
    e.change(m, rect(0, 0, 960, 1080));
    assert.strictEqual(e.calls.length, 1, "only the maximize step itself is skipped");
  });
  test(tag + "a new change on a running animation replaces it", () => {
    const e = setup(plasma6);
    const w = e.add(win(rect(0, 0, 900, 900)));
    e.change(w, rect(0, 0, 500, 500));
    const first = e.nextId - 1;
    w.geometry = rect(0, 0, 700, 700);
    e.change(w, rect(0, 0, 900, 900));
    assert(e.cancelled.indexOf(first) >= 0, "first animation cancelled");
    assert.strictEqual(e.calls.length, 2);
  });
  test(tag + "duration comes from the config, 0 turns animations off", () => {
    const e = setup(plasma6);
    e.config.Duration = 300;
    e.ctx.effect.configChanged.emit();
    const w = e.add(win(rect(0, 0, 900, 900)));
    e.change(w, rect(0, 0, 500, 500));
    assert.strictEqual(e.calls[0].duration, 300);
    e.config.Duration = 0;
    e.ctx.effect.configChanged.emit();
    e.change(w, rect(0, 0, 300, 300));
    assert.strictEqual(e.calls.length, 1);
  });
});
test("[plasma 6] windows that already exist when the effect starts are animated too", () => {
  const existing = win(rect(0, 0, 1152, 1080));
  const e = setup(true, [existing]);
  e.change(existing, rect(0, 0, 960, 1080));
  assert.strictEqual(e.calls.length, 1);
  assert(e.logs.some((l) => /per-window signals \(1 windows\)/.test(l)), e.logs.join(" | "));
});
test("[plasma 6] a window is only connected once", () => {
  const e = setup(true);
  const w = win(rect(0, 0, 1152, 1080));
  e.add(w); e.add(w);
  assert.strictEqual(w.windowFrameGeometryChanged.count, 1);
});
console.log(failed ? `\n${failed} failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
