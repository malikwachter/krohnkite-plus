// Run: npx tsc && node test/smart.test.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const code = fs.readFileSync(path.join(__dirname, "..", "krohnkite.js"), "utf8");
const ctx = { print() {}, console };
vm.createContext(ctx);
vm.runInContext(
  code +
    "\n;this.SmartLayout=SmartLayout;this.WindowRules=WindowRules;this.Rect=Rect;this.RectDelta=RectDelta;this.setConfig=(c)=>{CONFIG=c;};",
  ctx,
);
const { SmartLayout, WindowRules, Rect, RectDelta } = ctx;
// objects come from another vm realm -> compare structurally via JSON
assert.deepStrictEqual = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
ctx.setConfig({ smartTargetAspect: 1.3 });

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + "\n     " + e.message);
  }
}
const tile = (minW = 0, minH = 0, weight = 1) => ({
  minSize: { width: minW, height: minH },
  weight,
  state: 0,
  geometry: null,
});
const area = new Rect(0, 0, 1920, 1080);
const rects = (layout, tiles, a = area, gap = 0) =>
  layout.compute(tiles, a, gap).map((r) => [r.x, r.y, r.width, r.height]);
const overlap = (a, b) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
function checkTiling(rs, a = area) {
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    assert(r[0] >= a.x && r[1] >= a.y, "inside " + r);
    assert(r[0] + r[2] <= a.x + a.width && r[1] + r[3] <= a.y + a.height, "inside " + r);
    for (let j = i + 1; j < rs.length; j++)
      assert(!overlap(r, rs[j]), `overlap ${r} / ${rs[j]}`);
  }
}

test("2 windows on 16:9 -> side by side halves", () => {
  const r = rects(new SmartLayout(), [tile(), tile()]);
  assert.deepStrictEqual(r, [[0, 0, 960, 1080], [960, 0, 960, 1080]]);
});
test("3 windows -> quarter style master + 2 stacked", () => {
  const r = rects(new SmartLayout(), [tile(), tile(), tile()]);
  assert.deepStrictEqual(r, [[0, 0, 960, 1080], [960, 0, 960, 540], [960, 540, 960, 540]]);
});
test("4 windows -> 2x2 grid", () => {
  const r = rects(new SmartLayout(), [tile(), tile(), tile(), tile()]);
  assert.deepStrictEqual(r, [[0, 0, 960, 540], [0, 540, 960, 540], [960, 0, 960, 540], [960, 540, 960, 540]]);
});
test("5..8 windows -> no overlap, all tiled, at most 3 columns on 16:9", () => {
  for (let n = 5; n <= 8; n++) {
    const l = new SmartLayout();
    const r = rects(l, Array.from({ length: n }, () => tile()), area, 8);
    checkTiling(r);
    const xs = new Set(r.map((x) => x[0]));
    assert(xs.size <= 3, `n=${n} cols=${xs.size}`);
  }
});
test("portrait screen stacks vertically", () => {
  const a = new Rect(0, 0, 1080, 1920);
  const r = rects(new SmartLayout(), [tile(), tile()], a);
  assert.deepStrictEqual(r, [[0, 0, 1080, 960], [0, 960, 1080, 960]]);
});
test("ultrawide with 3 windows stays tiled without overlap", () => {
  const a = new Rect(0, 0, 3440, 1440);
  checkTiling(rects(new SmartLayout(), [tile(), tile(), tile()], a), a);
});
test("min width is respected (no overlap into neighbour)", () => {
  const r = rects(new SmartLayout(), [tile(1300, 0), tile()]);
  assert(r[0][2] >= 1300, "width " + r[0][2]);
  checkTiling(r);
});
test("big min height moves window out of a stacked column", () => {
  // 3rd window needs 800px height -> cannot share a column 540/540
  const r = rects(new SmartLayout(), [tile(), tile(), tile(0, 800)]);
  assert(r[2][3] >= 800, JSON.stringify(r));
  checkTiling(r);
});
test("weights give a bigger share", () => {
  const r = rects(new SmartLayout(), [tile(0, 0, 2), tile()]);
  assert.strictEqual(r[0][2], 1280);
});
test("gaps are applied between tiles", () => {
  const r = rects(new SmartLayout(), [tile(), tile()], area, 10);
  assert.deepStrictEqual(r, [[0, 0, 955, 1080], [965, 0, 955, 1080]]);
});
test("resize is remembered per window count", () => {
  const l = new SmartLayout();
  const t3 = [tile(), tile(), tile()];
  rects(l, t3);
  l.adjust(area, t3, t3[0], new RectDelta(192, 0, 0, 0), 0); // master +10%
  assert.strictEqual(rects(l, t3)[0][2], 1152);
  const t4 = [...t3, tile()];
  assert.strictEqual(rects(l, t4)[0][2], 960, "4 windows use own sizes");
  assert.strictEqual(rects(l, t3)[0][2], 1152, "back to 3 restores");
});
test("vertical resize inside a column", () => {
  const l = new SmartLayout();
  const t3 = [tile(), tile(), tile()];
  rects(l, t3);
  l.adjust(area, t3, t3[1], new RectDelta(0, 0, 108, 0), 0);
  const r = rects(l, t3);
  assert.strictEqual(r[1][3], 648);
  assert.strictEqual(r[2][1], 648);
});
test("column offset shortcut changes column count", () => {
  const l = new SmartLayout();
  const t4 = [tile(), tile(), tile(), tile()];
  l.handleShortcut({ showNotification() {} }, ctx.Shortcut ? ctx.Shortcut.Increase : vm.runInContext("Shortcut.Increase", ctx));
  const xs = new Set(rects(l, t4).map((x) => x[0]));
  assert.strictEqual(xs.size, 3);
});
test("distribute honours mins and reports overflow", () => {
  const d = SmartLayout.distribute(1000, [0.5, 0.5], [700, 0]);
  assert.deepStrictEqual(Array.from(d.sizes), [700, 300]);
  assert.strictEqual(SmartLayout.distribute(1000, [0.5, 0.5], [700, 700]).overflow, 400);
});

/* ---------------------------------------------------------------- rules */
const props = (o) => Object.assign({ resourceClass: "", resourceName: "", caption: "", windowRole: "" }, o);
test("rule parsing and matching", () => {
  const r = new WindowRules([
    "# comment",
    'class=mpv : float, size=1280x720, pos=center',
    'class~steam title~"Friends List" : float, size=20%x70%, pos=right',
    "title/^Picture.in.Picture$/ : float, pos=bottom-right",
    "class=firefox : master, weight=2, minwidth=900",
    "class=firefox title~private : tile",
  ]);
  assert.deepStrictEqual(r.errors, []);
  const mpv = r.match(props({ resourceClass: "MPV" }));
  assert.strictEqual(mpv.state, "float");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mpv.floatWidth)), { value: 1280, percent: false });
  assert.strictEqual(r.match(props({ resourceClass: "steam", caption: "Friends List" })).floatPos, "right");
  assert.strictEqual(r.match(props({ resourceClass: "steam", caption: "Steam" })), null);
  assert.strictEqual(r.match(props({ caption: "Picture-in-Picture" })).floatPos, "bottom-right");
  const ff = r.match(props({ resourceClass: "firefox", caption: "Mozilla Firefox Private Browsing" }));
  assert.strictEqual(ff.order, "master");
  assert.strictEqual(ff.weight, 2);
  assert.strictEqual(ff.state, "tile");
  assert.strictEqual(ff.matched, "5,6");
});
test("rule errors are reported, not thrown", () => {
  const r = new WindowRules(["class=foo", "class=foo : explode", "bogus=1 : float", "class=ok : float"]);
  assert.strictEqual(r.errors.length, 3);
  assert.strictEqual(r.rules.length, 1);
});
test("default rules shipped with the script parse cleanly", () => {
  const def = vm.runInContext("DEFAULT_WINDOW_RULES", ctx);
  const r = new WindowRules(def.split("\n"));
  assert.deepStrictEqual(r.errors, []);
  assert(r.rules.length >= 8);
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
