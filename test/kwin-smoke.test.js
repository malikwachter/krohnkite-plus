// Smoke test of KWinConfig + KWinWindow against a fake KWin API.
// Run: npx tsc && node test/kwin-smoke.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const ctx = { print() {}, console, Qt: { rect: (x, y, width, height) => ({ x, y, width, height }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "krohnkite.js"), "utf8"), ctx);
vm.runInContext(`
  KWIN = { readConfig: (k, d) => d };
  KWINCONFIG = CONFIG = new KWinConfig();
`, ctx);
const out = { name: "DP-1", geometry: { x: 0, y: 0, width: 2560, height: 1440 } };
const ws = {
  currentDesktop: {}, currentActivity: "a",
  clientArea: () => ({ x: 0, y: 0, width: 2560, height: 1400 }),
};
ctx.out = out; ctx.ws = ws;
const mk = (o) => {
  ctx.win = Object.assign({
    internalId: { toString: () => Math.random().toString() },
    resourceClass: "app", resourceName: "app", desktopFileName: "", caption: "", windowRole: "",
    output: out, minSize: { width: 0, height: 0 }, maxSize: { width: 99999, height: 99999 },
    frameGeometry: { x: 0, y: 0, width: 800, height: 630 }, clientGeometry: { x: 0, y: 30, width: 800, height: 600 },
    width: 800, height: 630, noBorder: false, keepAbove: false, skipTaskbar: false, skipPager: false,
    normalWindow: true, modal: false, transient: false, resizeable: true, dialog: false, splash: false,
    utility: false, specialWindow: false, deleted: false, activities: [], desktops: [],
  }, o);
  return vm.runInContext("new WindowClass(new KWinWindow(win, ws, { getSurface: () => ({ id: \"s1\" }) }))", ctx);
};
let failed = 0;
const test = (n, f) => { try { f(); console.log("ok   " + n); } catch (e) { failed++; console.log("FAIL " + n + "\n     " + e.stack); } };

test("config builds, smart layout is first", () => {
  assert.strictEqual(ctx.CONFIG_ORDER = vm.runInContext("CONFIG.layoutOrder[0]", ctx), "SmartLayout");
  assert.strictEqual(vm.runInContext("CONFIG.layoutOrder.length", ctx), 13);
  assert.strictEqual(vm.runInContext("KWINCONFIG.windowRules.errors.length", ctx), 0);
});
test("normal window tiles", () => {
  const w = mk({});
  assert.strictEqual(w.shouldFloat, false);
  assert.strictEqual(w.weight, 1);
});
test("PiP floats bottom-right at 30%", () => {
  const w = mk({ resourceClass: "firefox", caption: "Bild-im-Bild" });
  assert.strictEqual(w.shouldFloat, true);
  const g = w.floatGeometry;
  assert.strictEqual(g.width, 768);
  assert.strictEqual(g.x + g.width, 2560 - 8);
});
test("keep-above alone does not float (Krohnkite sets it itself)", () => assert.strictEqual(mk({ keepAbove: true }).shouldFloat, false));
test("overlay hidden from taskbar and pager floats", () => assert.strictEqual(mk({ skipTaskbar: true, skipPager: true, normalWindow: false }).shouldFloat, true));
test("fixed-size window floats", () => assert.strictEqual(mk({ minSize: { width: 400, height: 300 }, maxSize: { width: 400, height: 300 } }).shouldFloat, true));
test("min size includes decoration", () => {
  const w = mk({ minSize: { width: 900, height: 500 } });
  assert.strictEqual(w.minSize.width, 900);
  assert.strictEqual(w.minSize.height, 530);
});
test("float geometry is remembered per class", () => {
  const w = mk({ resourceClass: "org.pulseaudio.pavucontrol" });
  assert.strictEqual(w.shouldFloat, true);
  w.window.rememberFloatGeometry(vm.runInContext("new Rect(100, 200, 640, 480)", ctx));
  const g = mk({ resourceClass: "org.pulseaudio.pavucontrol" }).floatGeometry;
  assert.deepStrictEqual([g.x, g.y, g.width, g.height], [100, 200, 640, 480]);
});
test("min size is learned from a window that refuses to shrink (Steam)", () => {
  ctx.out.geometry; // workingArea comes from the surface stub
  const w = mk({ resourceClass: "steam", frameGeometry: { x: 0, y: 0, width: 1280, height: 800 },
                 clientGeometry: { x: 0, y: 0, width: 1280, height: 800 } });
  w.window._surfaceStore = { getSurface: () => ({ id: "s1", workingArea: { width: 2560, height: 1400 } }) };
  w.geometry = vm.runInContext("new Rect(0, 0, 1280, 700)", ctx);
  assert.strictEqual(w.isTooBigFor(w.geometry), true);
  assert.strictEqual(w.learnMinSize(), true);
  assert.strictEqual(w.minSize.height, 800);
  assert.strictEqual(w.learnMinSize(), false, "no growth -> no re-arrange loop");
  // a new Steam window knows it immediately
  assert.strictEqual(mk({ resourceClass: "steam" }).minSize.height, 800);
});
test("learned min size is lowered when the window shrinks later", () => {
  const w = mk({ resourceClass: "steam", frameGeometry: { x: 0, y: 0, width: 1280, height: 600 },
                 clientGeometry: { x: 0, y: 0, width: 1280, height: 600 } });
  w.state = vm.runInContext("WindowState.Tiled", ctx);
  w.observeSize();
  assert.strictEqual(w.minSize.height, 600);
});
test("no min size is learned from a window that ignores resizing", () => {
  const w = mk({ resourceClass: "bigapp", frameGeometry: { x: 0, y: 0, width: 2560, height: 1400 },
                 clientGeometry: { x: 0, y: 0, width: 2560, height: 1400 } });
  w.window._surfaceStore = { getSurface: () => ({ id: "s1", workingArea: { width: 2560, height: 1400 } }) };
  w.geometry = vm.runInContext("new Rect(0, 0, 1280, 700)", ctx);
  assert.strictEqual(w.learnMinSize(), false);
  assert.strictEqual(w.minSize.width, 0);
});
test("dialog opens at its minimal size, centered on the screen", () => {
  // Konsole settings dialog: transient, min 760x540 (client) + 30px title bar
  const w = mk({ resourceClass: "org.kde.konsole", transient: true, dialog: true,
                 minSize: { width: 760, height: 540 }, width: 900, height: 700,
                 frameGeometry: { x: 100, y: 100, width: 900, height: 700 },
                 clientGeometry: { x: 100, y: 130, width: 900, height: 670 } });
  assert.strictEqual(w.shouldFloat, true);
  const g = w.floatGeometry;
  assert.deepStrictEqual([g.width, g.height], [760, 570]);
  assert.deepStrictEqual([g.x, g.y], [Math.round((2560 - 760) / 2), Math.round((1400 - 570) / 2)]);
});
test("dialog without a useful min size keeps its size, still centered", () => {
  const w = mk({ transient: true, minSize: { width: 0, height: 0 }, width: 400, height: 200,
                 frameGeometry: { x: 0, y: 0, width: 400, height: 200 }, clientGeometry: { x: 0, y: 0, width: 400, height: 200 } });
  const g = w.floatGeometry;
  assert.deepStrictEqual([g.x, g.y, g.width, g.height], [1080, 600, 400, 200]);
});
test("unmanaged dialog (Konsole settings) is placed centered at its min size", () => {
  const client = { deleted: false, fullScreen: false, moveable: true, resizeable: true, output: out,
    frameGeometry: { x: 300, y: 200, width: 1000, height: 800 }, clientGeometry: { x: 300, y: 230, width: 1000, height: 770 },
    minSize: { width: 700, height: 500 } };
  let later = null;
  const fakeDriver = { workspace: ws, setTimeout: (f) => (later = f) };
  vm.runInContext("(d, c) => KWinDriver.prototype.centerDialog.call(d, c)", ctx)(fakeDriver, client);
  const g = client.frameGeometry;
  assert.deepStrictEqual([g.x, g.y, g.width, g.height], [930, 435, 700, 530]);
  assert(later, "second placement scheduled for late size hints");
});
/* ---------------------------------------------------------------- gaming mode */
test("Steam/Proton games are never tiled", () => {
  const g = mk({ resourceClass: "steam_app_1172470", resourceName: "steam_app_1172470" });
  assert.strictEqual(g.shouldIgnore, true);
  assert.strictEqual(mk({ resourceClass: "steam" }).shouldIgnore, false, "the Steam client itself still tiles");
  assert.strictEqual(mk({ resourceClass: "gamescope" }).shouldIgnore, true);
});

/* ---------------------------------------------------------------- persistence */
test("state store: loads valid state, ignores broken or old files", () => {
  const Store = vm.runInContext("StateStore", ctx);
  const runOut = (out) => ({ run: (cmd, cb) => cb(0, out, "") });
  let got = "unset";
  new Store(runOut(JSON.stringify({ version: 1, learnedMin: {}, floatMemory: {}, layouts: {} })), (f) => f()).load((s) => (got = s));
  assert.strictEqual(got.version, 1);
  new Store(runOut("{not json"), (f) => f()).load((s) => (got = s));
  assert.strictEqual(got, null);
  new Store(runOut(JSON.stringify({ version: 99 })), (f) => f()).load((s) => (got = s));
  assert.strictEqual(got, null);
  new Store(null, (f) => f()).load((s) => (got = s));
  assert.strictEqual(got, null);
});
test("state store: writes only when something changed", () => {
  const Store = vm.runInContext("StateStore", ctx);
  const cmds = [];
  const store = new Store({ run: (cmd, cb) => { cmds.push(cmd); cb(0, "", ""); } }, (f) => f());
  const st = { version: 1, learnedMin: { steam: { width: 1010, height: 600 } }, floatMemory: {}, layouts: {} };
  store.saveSoon(st);
  store.saveSoon(JSON.parse(JSON.stringify(st)));
  assert.strictEqual(cmds.length, 1);
  assert(/base64 -d/.test(cmds[0]) && !/1010/.test(cmds[0]), "payload is base64 encoded");
  st.learnedMin.steam.width = 1100;
  store.saveSoon(st);
  assert.strictEqual(cmds.length, 2);
});
test("base64 matches the system tool, umlauts included", () => {
  const b64 = vm.runInContext("StateStore", ctx).base64('{"Arbeitsfläche 1":"ü€😀"}');
  assert.strictEqual(Buffer.from(b64, "base64").toString("utf8"), '{"Arbeitsfläche 1":"ü€😀"}');
});
test("learned min sizes and float memory survive export/import", () => {
  vm.runInContext("WindowClass.importLearnedMin({ discord: { width: 940, height: 500 }, bad: { width: 'x' } })", ctx);
  assert.strictEqual(mk({ resourceClass: "discord" }).minSize.width, 940);
  const out = vm.runInContext("WindowClass.exportLearnedMin()", ctx);
  assert.strictEqual(out.discord.width, 940);
  assert.strictEqual(out.bad, undefined);
  vm.runInContext("KWinWindow.importFloatMemory({ 'vlc||': { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })", ctx);
  const g = mk({ resourceClass: "vlc", keepAbove: false }).window.getInitFloatGeometry();
  assert.deepStrictEqual([g.x, g.y, g.width, g.height], [640, 360, 1280, 720]);
});
test("layout store restores the layout and splits of a surface created later", () => {
  const store = vm.runInContext("new LayoutStore()", ctx);
  const srf = { layoutId: "DP-2@a#d1", ignore: false, output: { name: "DP-2" }, vDesktop: { name: "D1", id: "d1" }, activity: "a" };
  store.importState({ "DP-2@a#d1": { current: "QuarterLayout" }, "other": { current: "TileLayout" } });
  assert.strictEqual(store.getCurrentLayout(srf).classID, "QuarterLayout");
  const exp = store.exportState();
  assert.strictEqual(exp["DP-2@a#d1"].current, "QuarterLayout");
  assert.strictEqual(exp.other.current, "TileLayout", "other desktops are kept");
  store.importState({ x: { current: "NoSuchLayout" } });
  const srf2 = Object.assign({}, srf, { layoutId: "x" });
  assert.strictEqual(store.getCurrentLayout(srf2).classID, "SmartLayout", "unknown layout ignored");
});

/* ---------------------------------------------------------------- engine: pause, drop target */
test("arrange is skipped while paused and caught up later", () => {
  const engine = vm.runInContext("new TilingEngine()", ctx);
  let arranged = 0;
  const drv = { isPaused: true, currentSurfaces: [], stateMaybeChanged() { arranged++; } };
  engine.arrange(drv, "test");
  assert.strictEqual(engine.pendingArrange, true);
  assert.strictEqual(arranged, 0);
  drv.isPaused = false;
  drv.updateScrollBar = () => {};
  engine.arrange(drv, "test");
  assert.strictEqual(engine.pendingArrange, false);
  assert.strictEqual(arranged, 1);
});
test("drop target is the tile under the cursor", () => {
  const engine = vm.runInContext("new TilingEngine()", ctx);
  const R = (x, y, w, h) => vm.runInContext(`new Rect(${x},${y},${w},${h})`, ctx);
  const fake = (id, rect) => ({ id, actualGeometry: rect, geometry: rect, isTiled: true });
  const a = fake("a", R(0, 0, 960, 1080)), b = fake("b", R(960, 0, 960, 1080));
  engine.windows.getVisibleTiles = () => [a, b];
  assert.strictEqual(engine.dropTarget({ cursorPosition: [1500, 500], currentSurface: {} }, a), b);
  assert.strictEqual(engine.dropTarget({ cursorPosition: [100, 500], currentSurface: {} }, a), null, "own tile is not a target");
});
test("drop preview goes to the overlay of the monitor under the box", () => {
  const outB = { name: "HDMI-A-1", geometry: { x: 2560, y: 0, width: 2560, height: 1440 } };
  const calls = [];
  const fake = {
    workspace: Object.assign({}, ws, { screens: [out, outB], activeScreen: out,
      clientArea: (opt, o) => ({ x: o.geometry.x, y: 30, width: o.geometry.width, height: o.geometry.height - 30 }) }),
    previewObject: () => ({ show: (...a) => calls.push(a), hide: () => calls.push(["hide"]) }),
  };
  const R = (x, y, w, h) => vm.runInContext(`new Rect(${x},${y},${w},${h})`, ctx);
  const show = vm.runInContext("(d, r, s) => KWinDriver.prototype.showDropPreview.call(d, r, s)", ctx);
  show(fake, R(3000, 30, 1280, 1410), true);
  assert.deepStrictEqual(calls[0], ["HDMI-A-1", 2560, 30, 2560, 1410, 3000, 30, 1280, 1410, true]);
  show(fake, null, false);
  assert.deepStrictEqual(calls[1], ["hide"]);
});
console.log(failed ? `\n${failed} failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
