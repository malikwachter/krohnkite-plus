// Tests the Krohnkite Smooth effect against a fake KWin effect API.
// Plasma 6: window signals live on each EffectWindow; older KWin: on `effects`.
// Run: node test/effect.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const signal = () => { const fns = []; return { connect: (f) => fns.push(f), emit: (...a) => fns.forEach((f) => f(...a)), get count() { return fns.length; } }; };
const code = fs.readFileSync(path.join(__dirname, "..", "effect", "contents", "code", "main.js"), "utf8");

function setup(plasma6, initialWindows = [], extraConfig = {}) {
  const env = { calls: [], cancelled: [], config: Object.assign({ Duration: 150 }, extraConfig), nextId: 1, logs: [], grabs: [] };
  const effects = plasma6
    ? { windowAdded: signal(), windowDeleted: signal(), windowClosed: signal(), stackingOrder: initialWindows, cursorPos: { x: 0, y: 0 } }
    : { windowFrameGeometryChanged: signal(), windowMaximizedStateAboutToChange: signal(),
        windowFullScreenChanged: signal(), windowDeleted: signal(), windowClosed: signal(),
        windowMinimized: signal(), windowUnminimized: signal(), stackingOrder: initialWindows, cursorPos: { x: 0, y: 0 } };
  const ctx = {
    print: (s) => env.logs.push(s), Map, Set, Number, Math, isFinite,
    Effect: { Size: "Size", Translation: "Translation", Scale: "Scale", Opacity: "Opacity",
      WindowAddedGrabRole: "added", WindowClosedGrabRole: "closed", WindowMinimizedGrabRole: "min", WindowUnminimizedGrabRole: "unmin" },
    QEasingCurve: { OutCubic: "OutCubic", InCubic: "InCubic" },
    animate: (o) => { env.calls.push(o); return env.nextId++; },
    cancel: (id) => env.cancelled.push(id),
    effect: { readConfig: (k, d) => (k in env.config ? env.config[k] : d), configChanged: signal(), animationEnded: signal(),
      grab: (w, role) => { env.grabs.push(role); return true; } },
    effects,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  env.ctx = ctx;
  env.change = (w, old) => (plasma6 ? w.windowFrameGeometryChanged.emit(w, old) : effects.windowFrameGeometryChanged.emit(w, old));
  env.maximize = (w) => (plasma6 ? w.windowMaximizedStateAboutToChange.emit(w, true, true) : effects.windowMaximizedStateAboutToChange.emit(w, true, true));
  env.add = (w) => { if (plasma6) effects.windowAdded.emit(w); return w; };
  env.effects = effects;
  env.clock = 100000;
  ctx.krohnkiteSmooth.now = () => env.clock;
  return env;
}
const rect = (x, y, width, height) => ({ x, y, width, height });
const win = (g, extra = {}) => Object.assign({
  geometry: g, visible: true, normalWindow: true, move: false, resize: false, windowClass: "test",
  windowFrameGeometryChanged: signal(), windowMaximizedStateAboutToChange: signal(),
  windowMaximizedStateChanged: signal(), windowFullScreenChanged: signal(), windowStartUserMovedResized: signal(),
  windowMinimized: signal(), windowUnminimized: signal(),
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

/* ------------------------------------------------------------ tray layer */
const panel = () => win(rect(0, 1040, 1920, 40), { dock: true, normalWindow: false, windowClass: "plasmashell plasmashell" });
const anim = (call, type) => call.animations.find((a) => a.type === type);
test("[plasma 6] a quickview grows out of the tray icon the mouse clicked", () => {
  const e = setup(true, [panel()], { QuickviewClasses: "bitwarden" });
  e.effects.cursorPos = { x: 1700, y: 1060 }; // on the panel, over the tray icon
  const w = e.add(win(rect(560, 40, 800, 800), { windowClass: "bitwarden Bitwarden" }));
  assert.strictEqual(e.calls.length, 1);
  const a = e.calls[0];
  assert.deepStrictEqual([anim(a, "Scale").from.value1, anim(a, "Scale").to.value1], [0.06, 1]);
  assert.deepStrictEqual([anim(a, "Translation").from.value1, anim(a, "Translation").from.value2], [1700 - 960, 1060 - 440]);
  assert.deepStrictEqual([anim(a, "Opacity").from, anim(a, "Opacity").to], [0, 1]);
  assert(a.duration >= 220);
  assert(e.grabs.indexOf("added") >= 0, "other open animations are kept out");
  // closing it (back to the tray) shrinks it into the same icon, even if the mouse is elsewhere now
  e.effects.cursorPos = { x: 900, y: 500 };
  e.effects.windowClosed.emit(w);
  const c = e.calls[1];
  assert.deepStrictEqual([anim(c, "Scale").from.value1, anim(c, "Scale").to.value1], [1, 0.06]);
  assert.deepStrictEqual([anim(c, "Translation").to.value1, anim(c, "Translation").to.value2], [740, 620]);
  assert.deepStrictEqual([anim(c, "Opacity").to], [0]);
  assert(e.grabs.indexOf("closed") >= 0);
});
test("[plasma 6] a quickview that opens on its own comes out of the tray end of the panel", () => {
  const e = setup(true, [panel()], { QuickviewClasses: "bitwarden" });
  e.effects.cursorPos = { x: 300, y: 300 }; // the mouse is not on the panel
  e.add(win(rect(560, 40, 800, 800), { windowClass: "bitwarden Bitwarden" }));
  const t = anim(e.calls[0], "Translation").from;
  assert.deepStrictEqual([t.value1 + 960, t.value2 + 440], [1920 - 120, 1060]);
});
test("[plasma 6] the script moving a growing quickview into place restarts the growth towards it", () => {
  const e = setup(true, [panel()], { QuickviewClasses: "bitwarden" });
  e.effects.cursorPos = { x: 1700, y: 1060 };
  const w = e.add(win(rect(0, 0, 400, 300), { windowClass: "bitwarden Bitwarden" }));
  w.geometry = rect(560, 40, 800, 800);
  e.clock += 30;
  e.change(w, rect(0, 0, 400, 300));
  assert.strictEqual(e.calls.length, 2);
  assert(anim(e.calls[1], "Scale"), "still a tray animation, not a slide from the old place");
  assert.deepStrictEqual([anim(e.calls[1], "Translation").from.value1], [1700 - 960]);
});
test("[plasma 6] minimized quickviews go into the tray and come back out of it", () => {
  const e = setup(true, [panel()], { QuickviewClasses: "telegram" });
  e.effects.cursorPos = { x: 1650, y: 1060 };
  const w = e.add(win(rect(560, 40, 800, 800), { windowClass: "telegram-desktop telegram" }));
  e.clock += 1000;
  w.windowMinimized.emit(w);
  assert.strictEqual(anim(e.calls[1], "Opacity").to, 0);
  e.clock += 1000;
  w.windowUnminimized.emit(w);
  assert.strictEqual(anim(e.calls[2], "Opacity").to, 1);
});
test("[plasma 6] other windows are not tray animated; a new dialog's first placement does not slide", () => {
  const e = setup(true, [panel()], { QuickviewClasses: "bitwarden" });
  const w = e.add(win(rect(0, 0, 800, 600), { windowClass: "dolphin org.kde.dolphin" }));
  e.effects.windowClosed.emit(w);
  const d = e.add(win(rect(700, 400, 500, 300), { windowClass: "dolphin org.kde.dolphin", dialog: true, normalWindow: false }));
  e.change(d, rect(0, 0, 500, 300)); // placed by the popup layer right away
  assert.strictEqual(e.calls.length, 0);
  e.clock += 1000;
  d.geometry = rect(400, 400, 500, 300);
  e.change(d, rect(700, 400, 500, 300)); // another popup opened: it makes room smoothly
  assert.strictEqual(e.calls.length, 1);
  assert(anim(e.calls[0], "Translation"));
});
test("[old kwin] a quickview minimized globally is animated once", () => {
  const e = setup(false, [panel()], { QuickviewClasses: "bitwarden" });
  const w = win(rect(560, 40, 800, 800), { windowClass: "bitwarden Bitwarden" });
  e.effects.windowMinimized.emit(w);
  assert.strictEqual(e.calls.length, 1);
});
test("tray animations follow the speed, 0 turns them off", () => {
  const e = setup(true, [panel()], { QuickviewClasses: "bitwarden", Duration: 0 });
  e.add(win(rect(560, 40, 800, 800), { windowClass: "bitwarden Bitwarden" }));
  assert.strictEqual(e.calls.length, 0);
});
console.log(failed ? `\n${failed} failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
