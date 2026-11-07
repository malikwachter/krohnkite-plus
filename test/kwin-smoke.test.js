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
console.log(failed ? `\n${failed} failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
