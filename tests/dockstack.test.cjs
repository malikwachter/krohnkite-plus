/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

const SOURCES = [
  'src/util/rect.ts',
  'src/dock/dockcommon.ts',
  'src/dock/dockdefaultcfg.ts',
  'src/dock/dock.ts',
  'src/dock/dockslot.ts',
  'src/dock/dockentry.ts',
  'src/dock/dockstore.ts',
];

const DEFAULT_CONFIG = {
  dockOrder: [1, 2, 3, 4],
  dockHHeight: 20,
  dockHWide: 100,
  dockHGap: 0,
  dockHEdgeGap: 0,
  dockHAlignment: 1,
  dockHEdgeAlignment: 1,
  dockVHeight: 100,
  dockVWide: 20,
  dockVGap: 0,
  dockVEdgeGap: 0,
  dockVAlignment: 1,
  dockVEdgeAlignment: 1,
  dockTopDragZone: 15,
  dockBottomDragZone: 15,
  dockLeftDragZone: 15,
  dockRightDragZone: 15,
};

function buildDockScene(config = {}) {
  const context = vm.createContext({ __config: { ...DEFAULT_CONFIG, ...config } });
  vm.runInContext(
    `
    var CONFIG = __config;
    var WindowState = { Tiled: 'Tiled', Docked: 'Docked' };
    var RectParts = { Top: 0, Bottom: 1, Left: 2, Right: 3, Whole: 4 };
    var KrohnkiteAction = {
      MoveLeft: 'MoveLeft',
      MoveUp: 'MoveUp',
      MoveRight: 'MoveRight',
      MoveDown: 'MoveDown',
    };
    class Err {
      constructor(message) { this.message = message; }
    }
    function warning() {}
    function getTime() { return 1; }
    function parseDockUserSurfacesCfg() { return []; }
    function parseDockUserWindowClassesCfg() { return {}; }
    var DriverWindow = { isContain: () => false };
    function validateNumber(value, min, max) {
      if (typeof value !== 'number' || Number.isNaN(value))
        return new Err('invalid');
      if (min !== undefined && value < min) return new Err('invalid');
      if (max !== undefined && value > max) return new Err('invalid');
      return value;
    }
    `,
    context,
  );

  const source = SOURCES.map((file) =>
    fs.readFileSync(path.join(ROOT, file), 'utf8'),
  ).join('\n');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      removeComments: true,
    },
  }).outputText;
  vm.runInContext(transpiled, context);
  vm.runInContext(
    `this.__api = {
      DockEntry,
      DockStore,
      Dock,
      DefaultDockCfg,
      Rect,
      DockPosition,
      KrohnkiteAction,
    };`,
    context,
  );

  const api = context.__api;
  return {
    api,
    makeEntry(cfg = {}) {
      const entryCfg = api.DefaultDockCfg.instance.cloneAndUpdate(cfg);
      return new api.DockEntry(entryCfg, 'srf-1');
    },
    makeSurface(id = 'srf-1') {
      return {
        id,
        output: { name: id },
        workingArea: new api.Rect(0, 0, 1000, 1000),
        isFit: () => false,
      };
    },
    makeStore() {
      return new api.DockStore();
    },
    makeWindow(
      id,
      position = null,
      cfg = {},
      minSize = { width: 100, height: 100 },
      initialState = 'Docked',
    ) {
      const dock = new api.Dock(
        api.DefaultDockCfg.instance.cloneAndUpdate(cfg),
      );
      dock.position = position;
      return {
        id,
        windowClassName: id,
        state: initialState,
        previousState: initialState,
        dock,
        geometry: null,
        minSize,
        setTransientState(state) {
          this.state = state;
        },
        isAlive() {
          return true;
        },
        moveMouseToFocus() {},
      };
    },
  };
}

function slotOf(entry, position) {
  return entry.slots.find((slot) => slot.position === position);
}

function windowsOf(entry, position) {
  const slot = slotOf(entry, position);
  assert.ok(slot, `slot ${position} exists`);
  return slot.windows;
}

function geometryOf(window) {
  return [
    window.geometry.x,
    window.geometry.y,
    window.geometry.width,
    window.geometry.height,
  ];
}

function arrange(scene, entry, windows, area = { x: 0, y: 0, width: 1000, height: 1000 }) {
  const rect = new scene.api.Rect(area.x, area.y, area.width, area.height);
  return entry.arrange(windows, rect);
}

test('two windows on the left stack vertically and share one strip', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');

  const tilesArea = arrange(scene, entry, [a, b]);

  assert.deepEqual(
    Array.from(windowsOf(entry, 'left'), (w) => w.id),
    ['a', 'b'],
  );
  assert.deepEqual(geometryOf(a), [0, 0, 200, 500]);
  assert.deepEqual(geometryOf(b), [0, 500, 200, 500]);
  assert.deepEqual([tilesArea.x, tilesArea.y, tilesArea.width, tilesArea.height], [
    200,
    0,
    800,
    1000,
  ]);
});

test('two windows on top lay out left to right and share one strip', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'top');
  const b = scene.makeWindow('b', 'top');

  const tilesArea = arrange(scene, entry, [a, b]);

  assert.deepEqual(geometryOf(a), [0, 0, 500, 200]);
  assert.deepEqual(geometryOf(b), [500, 0, 500, 200]);
  assert.deepEqual([tilesArea.x, tilesArea.y, tilesArea.width, tilesArea.height], [
    0,
    200,
    1000,
    800,
  ]);
});

test('along-axis settings act as proportional weights for multiple windows', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', { vHeight: 60 });
  const b = scene.makeWindow('b', 'left', { vHeight: 40 });

  arrange(scene, entry, [a, b]);

  assert.deepEqual(geometryOf(a), [0, 0, 200, 600]);
  assert.deepEqual(geometryOf(b), [0, 600, 200, 400]);
});

test('gaps are applied between stacked windows', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', { vGap: 10 });
  const b = scene.makeWindow('b', 'left', { vGap: 10 });

  arrange(scene, entry, [a, b]);

  assert.deepEqual(geometryOf(a), [0, 10, 200, 485]);
  assert.deepEqual(geometryOf(b), [0, 505, 200, 485]);
});

test('minimum sizes are kept when proportional weights would squeeze a window', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow(
    'a',
    'left',
    { vHeight: 10 },
    { width: 100, height: 300 },
  );
  const b = scene.makeWindow(
    'b',
    'left',
    { vHeight: 90 },
    { width: 100, height: 300 },
  );

  arrange(scene, entry, [a, b]);

  assert.deepEqual(geometryOf(a), [0, 0, 200, 300]);
  assert.deepEqual(geometryOf(b), [0, 300, 200, 700]);
});

test('a single docked window keeps the absolute size and alignment behaviour', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', {
    vHeight: 50,
    vAlignment: 2,
  });

  const tilesArea = arrange(scene, entry, [a]);

  assert.deepEqual(geometryOf(a), [0, 0, 200, 500]);
  assert.deepEqual([tilesArea.x, tilesArea.y, tilesArea.width, tilesArea.height], [
    200,
    0,
    800,
    1000,
  ]);
});

test('a single docked window can be centered along its side', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', {
    vHeight: 50,
    vAlignment: 1,
  });

  arrange(scene, entry, [a]);

  assert.deepEqual(geometryOf(a), [0, 250, 200, 500]);
});

test('a single docked window can be aligned to the far edge', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', {
    vHeight: 50,
    vAlignment: 3,
  });

  arrange(scene, entry, [a]);

  assert.deepEqual(geometryOf(a), [0, 500, 200, 500]);
});

test('opposite dock strips are capped at 70 percent together', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', { vWide: 50 });
  const b = scene.makeWindow('b', 'right', { vWide: 50 });

  const tilesArea = arrange(scene, entry, [a, b]);

  assert.equal(a.geometry.width, 350);
  assert.equal(b.geometry.width, 350);
  assert.equal(tilesArea.width, 300);
});

test('a capped dominant side leaves room for the opposite side', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', { vWide: 70 });
  const b = scene.makeWindow('b', 'right', { vWide: 20 });

  const tilesArea = arrange(scene, entry, [a, b]);

  assert.equal(a.geometry.width, 500);
  assert.equal(b.geometry.width, 200);
  assert.equal(tilesArea.width, 300);
});

test('a single dock strip is capped at 70 percent', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left', { vWide: 80 });

  const tilesArea = arrange(scene, entry, [a]);

  assert.equal(a.geometry.width, 700);
  assert.equal(tilesArea.width, 300);
});

function makeDragAction(scene, srf, window, x, y, initialState = 'Tiled') {
  return {
    result: { isProcessed: false, isArrangeNeeded: false },
    actionTime: 0,
    srf,
    initialSrfId: srf.id,
    workingArea: srf.workingArea,
    tilesArea: null,
    window,
    dockTarget: null,
    mousePointer: { x, y },
    middlePointer: { x, y },
    neighbors: { left: false, right: false, up: false, down: false },
    neighborsSrfId: srf.id,
    dockSnapshots: {},
    initialState,
    isLayoutHasDragStep: false,
  };
}

function slotWindows(store, position, surfaceId = 'srf-1') {
  const entry = store.store[surfaceId];
  const slot = entry.slots.find((candidate) => candidate.position === position);
  return Array.from(slot.windows, (window) => window.id);
}

test('dropping in the top quarter of a vertical dock inserts before it', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  const c = scene.makeWindow('c', null, {}, undefined, 'Tiled');
  store.render(srf, [a, b], srf.workingArea);

  store.drag(makeDragAction(scene, srf, c, 100, 100));

  assert.deepEqual(slotWindows(store, 'left'), ['c', 'a', 'b']);
});

test('dropping in the bottom quarter of a vertical dock inserts after it', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  const c = scene.makeWindow('c', null, {}, undefined, 'Tiled');
  store.render(srf, [a, b], srf.workingArea);

  store.drag(makeDragAction(scene, srf, c, 100, 400));

  assert.deepEqual(slotWindows(store, 'left'), ['a', 'c', 'b']);
});

test('dropping in the middle of a vertical dock swaps a tiled window in', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  const c = scene.makeWindow('c', null, {}, undefined, 'Tiled');
  store.render(srf, [a, b], srf.workingArea);
  a.previousState = 'Tiled';

  const action = makeDragAction(scene, srf, c, 100, 250);
  store.drag(action);
  store.finishDrag(action);

  assert.deepEqual(slotWindows(store, 'left'), ['c', 'b']);
  assert.equal(a.state, 'Tiled');
  assert.equal(a.previousState, 'Docked');
});

test('dropping in the left quarter of a horizontal dock inserts before it', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'top');
  const b = scene.makeWindow('b', 'top');
  const c = scene.makeWindow('c', null, {}, undefined, 'Tiled');
  store.render(srf, [a, b], srf.workingArea);

  store.drag(makeDragAction(scene, srf, c, 600, 100));

  assert.deepEqual(slotWindows(store, 'top'), ['a', 'c', 'b']);
});

test('repeated drag ticks keep the tiled window docked after a swap', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', null, {}, undefined, 'Tiled');
  store.render(srf, [a, b], srf.workingArea);
  const action = makeDragAction(scene, srf, b, 100, 250, 'Tiled');

  store.drag(action);
  assert.deepEqual(slotWindows(store, 'left'), ['b']);
  assert.equal(b.state, 'Docked');
  assert.equal(a.state, 'Tiled');

  /* The engine has laid the evicted window out in the tiles area since the
   * previous tick; the dock target geometry must not leak into the next hit
   * test. */
  a.geometry = new scene.api.Rect(600, 0, 400, 1000);
  action.result = { isProcessed: false, isArrangeNeeded: false };
  store.drag(action);

  assert.deepEqual(slotWindows(store, 'left'), ['b']);
  assert.equal(b.state, 'Docked');
  assert.equal(a.state, 'Tiled');
  assert.equal(action.result.isProcessed, true);
  assert.equal(action.result.isArrangeNeeded, true);
});

test('dragging a docked window to the bottom quarter reorders it', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  store.render(srf, [a, b], srf.workingArea);

  store.drag(makeDragAction(scene, srf, a, 100, 900, 'Docked'));

  assert.deepEqual(slotWindows(store, 'left'), ['b', 'a']);
});

test('leaving the dock zone cancels an insertion preview', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  const c = scene.makeWindow('c', null, {}, undefined, 'Tiled');
  store.render(srf, [a, b], srf.workingArea);
  const action = makeDragAction(scene, srf, c, 100, 100);
  store.drag(action);
  assert.deepEqual(slotWindows(store, 'left'), ['c', 'a', 'b']);
  assert.equal(c.state, 'Docked');

  action.mousePointer = { x: 500, y: 500 };
  action.middlePointer = { x: 500, y: 500 };
  action.result = { isProcessed: false, isArrangeNeeded: false };
  store.drag(action);
  store.finishDrag(action);

  assert.deepEqual(slotWindows(store, 'left'), ['a', 'b']);
  assert.equal(c.state, 'Tiled');
  assert.equal(c.previousState, 'Tiled');
  assert.equal(action.result.isProcessed, true);
  assert.equal(action.result.isArrangeNeeded, true);
});

test('cancelling a cross-side swap restores the untouched window', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'top');
  store.render(srf, [a, b], srf.workingArea);
  const action = makeDragAction(scene, srf, a, 600, 100, 'Docked');

  store.drag(action);
  assert.deepEqual(slotWindows(store, 'left'), ['b']);
  assert.deepEqual(slotWindows(store, 'top'), ['a']);

  action.mousePointer = { x: 500, y: 500 };
  action.middlePointer = { x: 500, y: 500 };
  action.result = { isProcessed: false, isArrangeNeeded: false };
  store.drag(action);

  assert.deepEqual(slotWindows(store, 'left'), []);
  assert.deepEqual(slotWindows(store, 'top'), ['b']);
  assert.equal(b.dock.position, 'top');
  assert.equal(a.state, 'Tiled');
  assert.equal(action.result.isProcessed, true);
  assert.equal(action.result.isArrangeNeeded, true);
});

test('shortcut reorder moves a docked window one position', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  const c = scene.makeWindow('c', 'left');
  arrange(scene, entry, [a, b, c]);

  assert.equal(
    entry.handleShortcut(a, scene.api.KrohnkiteAction.MoveDown),
    true,
  );
  assert.deepEqual(Array.from(windowsOf(entry, 'left'), (w) => w.id), [
    'b',
    'a',
    'c',
  ]);
});

test('shortcut reorder at the edge moves the window to the next side', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  arrange(scene, entry, [a, b]);

  assert.equal(
    entry.handleShortcut(a, scene.api.KrohnkiteAction.MoveUp),
    true,
  );
  assert.deepEqual(Array.from(windowsOf(entry, 'left'), (w) => w.id), ['b']);
  assert.deepEqual(Array.from(windowsOf(entry, 'top'), (w) => w.id), ['a']);
});

test('setCrossSize synchronizes the strip thickness across a side', () => {
  const scene = buildDockScene();
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  arrange(scene, entry, [a, b]);

  assert.equal(entry.setCrossSize(a, 30), true);
  assert.equal(a.dock.cfg.vWide, 30);
  assert.equal(b.dock.cfg.vWide, 30);
});

test('resizing one window synchronizes the thickness of its whole side', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  a.surface = srf;
  b.surface = srf;
  store.render(srf, [a, b], srf.workingArea);

  store.adjust(a, 100, 0);

  assert.equal(a.dock.cfg.vWide, 30);
  assert.equal(b.dock.cfg.vWide, 30);
});

test('resizing a stacked window along its side changes its share', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', 'left');
  a.surface = srf;
  b.surface = srf;
  store.render(srf, [a, b], srf.workingArea);

  assert.equal(a.geometry.height, 500);
  store.adjust(a, 0, 1000);
  store.render(srf, [a, b], srf.workingArea);

  assert.ok(Math.abs(a.geometry.height - 2000 / 3) < 0.0001);
  assert.ok(Math.abs(b.geometry.height - 1000 / 3) < 0.0001);
});

test('a single docked window still cannot exceed the full side', () => {
  const scene = buildDockScene();
  const store = scene.makeStore();
  const srf = scene.makeSurface();
  const a = scene.makeWindow('a', 'left');
  a.surface = srf;
  store.render(srf, [a], srf.workingArea);

  store.adjust(a, 0, 100);
  store.render(srf, [a], srf.workingArea);

  assert.equal(a.geometry.height, 1000);
});

test('windows on a disabled side are reassigned to an enabled side', () => {
  const scene = buildDockScene({ dockOrder: [0, 2, 3, 4] });
  const entry = scene.makeEntry();
  const a = scene.makeWindow('a', 'left');
  const b = scene.makeWindow('b', null);
  arrange(scene, entry, [a, b]);

  const top = windowsOf(entry, 'top');
  assert.deepEqual(Array.from(top, (w) => w.id), ['a', 'b']);
});

