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
  'src/util/func.ts',
  'src/util/rect.ts',
  'src/util/rectdelta.ts',
  'src/layouts/layoututils.ts',
  'src/layouts/dwindletree.ts',
  'src/layouts/btreelayout.ts',
];

const ACTIONS = [
  'MoveLeft',
  'MoveRight',
  'MoveUp',
  'MoveDown',
  'SwapUp',
  'SwapDown',
  'Rotate',
  'RotatePart',
  'SetMaster',
];

function buildScene() {
  const context = vm.createContext({ print: () => {} });
  vm.runInContext(
    `
    var RectParts = { Top: 0, Bottom: 1, Left: 2, Right: 3, Whole: 4 };
    var WindowState = { Tiled: 'Tiled' };
    var KrohnkiteAction = {
      ${ACTIONS.map((action) => `${action}: '${action}'`).join(',\n      ')}
    };
    var CONFIG = { newWindowPosition: 'last' };
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
      BinaryTreeLayout,
      Rect,
      RectDelta,
      DwindleTree,
      CONFIG,
      KrohnkiteAction,
    };`,
    context,
  );

  const api = context.__api;
  const windows = new Map();
  const ctx = {
    currentWindow: null,
    getWindowById: (id) => windows.get(id) ?? null,
    showNotification: () => {},
  };

  return {
    api,
    ctx,
    windows,
    layout: new api.BinaryTreeLayout(null),
    area: new api.Rect(0, 0, 1600, 900),
    gap: 10,
  };
}

function addWindow(scene, id, options = {}) {
  const window = {
    id,
    focusTime: options.focusTime ?? 0,
    minSize: {
      width: options.minWidth ?? 1,
      height: options.minHeight ?? 1,
    },
    state: 'Undecided',
    geometry: null,
    isTiled: true,
  };
  scene.windows.set(id, window);
  return window;
}

function applyLayout(scene, ids, area, gap) {
  const tiles = ids.map((id) => {
    const window = scene.windows.get(id);
    assert.ok(window, `window ${id} is not registered`);
    return window;
  });
  scene.layout.apply(
    scene.ctx,
    tiles,
    area ?? scene.area,
    gap ?? scene.gap,
  );
  return tiles;
}

function geometryOf(window) {
  assert.ok(window.geometry, `window ${window.id} has no geometry`);
  return [
    window.geometry.x,
    window.geometry.y,
    window.geometry.width,
    window.geometry.height,
  ];
}

function geometriesOf(scene, ids) {
  return ids.map((id) => geometryOf(scene.windows.get(id)));
}

function shortcut(scene, window, action) {
  scene.ctx.currentWindow = window;
  return scene.layout.handleShortcut(scene.ctx, action);
}

function makeDragAction(scene, window, x, y, area) {
  const pointer = { x, y };
  return {
    result: { isProcessed: false, isArrangeNeeded: false },
    actionTime: 0,
    srf: {},
    initialSrfId: '',
    workingArea: area ?? scene.area,
    tilesArea: null,
    window,
    dockTarget: null,
    mousePointer: pointer,
    middlePointer: pointer,
    neighbors: { left: false, right: false, up: false, down: false },
    neighborsSrfId: null,
    dockSnapshots: {},
    initialState: 'Tiled',
    isLayoutHasDragStep: true,
  };
}

test('a single window fills the tiling area', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');

  applyLayout(scene, ['a']);

  assert.deepEqual(geometryOf(a), [0, 0, 1600, 900]);
  assert.equal(a.state, 'Tiled');
});

test('landscape windows split left and right with one gap', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 2 });
  const b = addWindow(scene, 'b', { focusTime: 1 });

  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(a), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(b), [805, 0, 795, 900]);
});

test('portrait windows split top and bottom', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');

  applyLayout(scene, ['a', 'b'], new scene.api.Rect(0, 0, 800, 1200));

  assert.deepEqual(geometryOf(a), [0, 0, 800, 595]);
  assert.deepEqual(geometryOf(b), [0, 605, 800, 595]);
});

test('newWindowPosition "first" puts the new window in the first half', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  scene.api.CONFIG.newWindowPosition = 'first';

  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(a), [805, 0, 795, 900]);
  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);
});

test('every new window splits the previously inserted one', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  const c = addWindow(scene, 'c');

  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(a), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(b), [805, 0, 795, 445]);
  assert.deepEqual(geometryOf(c), [805, 455, 795, 445]);
});

test('a new window splits the window that was focused before it', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 5 });
  const b = addWindow(scene, 'b', { focusTime: 10 });
  applyLayout(scene, ['a', 'b']);

  /* b was the focused window and now sits on the left. */
  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);

  /* The new window already has the greatest focusTime by the time a
   * deferred arrange runs: it must not be used as its own anchor. */
  const c = addWindow(scene, 'c', { focusTime: 100 });
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(b), [0, 0, 795, 445]);
  assert.deepEqual(geometryOf(c), [0, 455, 795, 445]);
  assert.deepEqual(geometryOf(a), [805, 0, 795, 900]);
});

test('closing a window collapses its slot and grows the sibling', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  addWindow(scene, 'b');
  const c = addWindow(scene, 'c');
  applyLayout(scene, ['a', 'b', 'c']);

  scene.windows.delete('b');
  applyLayout(scene, ['a', 'c']);

  assert.deepEqual(geometryOf(a), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(c), [805, 0, 795, 900]);
});

test('a minimized or floating window keeps its slot and gets it back', () => {
  const scene = buildScene();
  addWindow(scene, 'a');
  addWindow(scene, 'b');
  const c = addWindow(scene, 'c');
  applyLayout(scene, ['a', 'b', 'c']);
  const original = geometriesOf(scene, ['a', 'b', 'c']);

  /* b still exists, but is not tiled: minimized, floating or on another
   * desktop. */
  applyLayout(scene, ['a', 'c']);
  assert.deepEqual(geometryOf(c), [805, 0, 795, 900]);

  applyLayout(scene, ['a', 'b', 'c']);
  assert.deepEqual(geometriesOf(scene, ['a', 'b', 'c']), original);
});

test('reapplying the same tiling is idempotent', () => {
  const scene = buildScene();
  addWindow(scene, 'a');
  addWindow(scene, 'b');
  addWindow(scene, 'c');

  applyLayout(scene, ['a', 'b', 'c']);
  const first = geometriesOf(scene, ['a', 'b', 'c']);

  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometriesOf(scene, ['a', 'b', 'c']), first);
});

test('minimum sizes are respected when splitting', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { minWidth: 600 });
  const b = addWindow(scene, 'b', { minWidth: 300 });

  applyLayout(scene, ['a', 'b'], new scene.api.Rect(0, 0, 1000, 600));

  assert.equal(a.geometry.width, 600);
  assert.equal(b.geometry.width, 390);
  assert.equal(b.geometry.x, 610);
});

test('resizing a window changes the ratio of its parent split', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);

  scene.layout.adjust(
    scene.area,
    [a, b],
    a,
    new scene.api.RectDelta(100, 0, 0, 0),
    scene.gap,
  );
  applyLayout(scene, ['a', 'b']);

  assert.ok(a.geometry.width > 795, `a must grow, got ${a.geometry.width}`);
  assert.ok(b.geometry.width < 795, `b must shrink, got ${b.geometry.width}`);
  assert.equal(a.geometry.width + b.geometry.width + scene.gap, 1600);

  const ratioBefore =
    a.geometry.width / (a.geometry.width + b.geometry.width);
  applyLayout(scene, ['a', 'b'], new scene.api.Rect(0, 0, 1200, 800));
  const ratioAfter =
    a.geometry.width / (a.geometry.width + b.geometry.width);
  assert.ok(
    Math.abs(ratioAfter - ratioBefore) < 0.02,
    'the ratio must survive an area change',
  );
});

test('resizing a vertical split changes the ratio', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  const area = new scene.api.Rect(0, 0, 800, 1200);
  applyLayout(scene, ['a', 'b'], area);

  scene.layout.adjust(
    area,
    [a, b],
    a,
    new scene.api.RectDelta(0, 0, 100, 0),
    scene.gap,
  );
  applyLayout(scene, ['a', 'b'], area);

  assert.ok(a.geometry.height > 595, `a must grow, got ${a.geometry.height}`);
  assert.ok(b.geometry.height < 595, `b must shrink, got ${b.geometry.height}`);
  assert.equal(a.geometry.height + b.geometry.height + scene.gap, 1200);
});

test('resizing cannot squeeze a neighbor below its minimum', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b', { minWidth: 700 });
  applyLayout(scene, ['a', 'b']);

  scene.layout.adjust(
    scene.area,
    [a, b],
    a,
    new scene.api.RectDelta(1000, 0, 0, 0),
    scene.gap,
  );
  applyLayout(scene, ['a', 'b']);

  assert.ok(
    b.geometry.width >= 700,
    `b must stay >= 700, got ${b.geometry.width}`,
  );
});

test('move right trades sides with a lone sibling', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.MoveRight), true);
  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(a), [805, 0, 795, 900]);
});

test('moving toward a lone sibling resets the split ratio', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);
  scene.layout.adjust(
    scene.area,
    [a, b],
    a,
    new scene.api.RectDelta(200, 0, 0, 0),
    scene.gap,
  );
  applyLayout(scene, ['a', 'b']);
  assert.ok(a.geometry.width > 795);

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.MoveRight), true);
  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(a), [805, 0, 795, 900]);
  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);
});

test('an outer tile at the edge is left to the cross-surface move', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.MoveLeft), false);
});

test('moving a nested window at the edge creates an outer tile', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  /* b joins the left column and becomes its top tile. */
  assert.equal(shortcut(scene, b, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ['a', 'b', 'c']);
  assert.deepEqual(geometryOf(b), [0, 0, 795, 445]);

  /* b is at the left edge, but nested in the left subtree: another left
   * move turns it into the outer left tile instead of leaving the surface. */
  assert.equal(shortcut(scene, b, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(a), [805, 0, 795, 445]);
  assert.deepEqual(geometryOf(c), [805, 455, 795, 445]);
});

test('a perpendicular root split lets an edge move create an outer tile', () => {
  const scene = buildScene();
  const area = new scene.api.Rect(0, 0, 800, 1200);
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a'], area);
  applyLayout(scene, ['a', 'b'], area);

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ['a', 'b'], area);

  assert.deepEqual(geometryOf(a), [0, 0, 395, 1200]);
  assert.deepEqual(geometryOf(b), [405, 0, 395, 1200]);
});

test('move down trades sides with a lone sibling', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b'], new scene.api.Rect(0, 0, 800, 1200));

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.MoveDown), true);
  applyLayout(scene, ['a', 'b'], new scene.api.Rect(0, 0, 800, 1200));

  assert.deepEqual(geometryOf(b), [0, 0, 800, 595]);
  assert.deepEqual(geometryOf(a), [0, 605, 800, 595]);
});

test('move left joins the column of the window it enters', () => {
  const scene = buildScene();
  addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.equal(shortcut(scene, b, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(b), [0, 0, 795, 445]);
  assert.deepEqual(geometryOf(scene.windows.get('a')), [0, 455, 795, 445]);
  assert.deepEqual(geometryOf(c), [805, 0, 795, 900]);
});

test('move left splits the first window along its long edge', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.equal(shortcut(scene, c, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(a), [0, 0, 795, 445]);
  assert.deepEqual(geometryOf(c), [0, 455, 795, 445]);
  assert.deepEqual(geometryOf(b), [805, 0, 795, 900]);
});

test('move up trades sides with the sibling above', () => {
  const scene = buildScene();
  addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.equal(shortcut(scene, c, scene.api.KrohnkiteAction.MoveUp), true);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(c), [805, 0, 795, 445]);
  assert.deepEqual(geometryOf(b), [805, 455, 795, 445]);
});

test('the vacated subtree keeps its ratios when a window leaves it', () => {
  const scene = buildScene();
  addWindow(scene, 'w1', { focusTime: 1 });
  const w2 = addWindow(scene, 'w2', { focusTime: 2 });
  addWindow(scene, 'w3', { focusTime: 3 });
  addWindow(scene, 'w4', { focusTime: 4 });
  addWindow(scene, 'w5', { focusTime: 5 });
  addWindow(scene, 'w6', { focusTime: 6 });
  applyLayout(scene, ['w1']);
  applyLayout(scene, ['w1', 'w2']);
  applyLayout(scene, ['w1', 'w2', 'w3']);
  applyLayout(scene, ['w1', 'w2', 'w3', 'w4']);
  applyLayout(scene, ['w1', 'w2', 'w3', 'w4', 'w5']);
  applyLayout(scene, ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);

  const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
  assert.equal(shortcut(scene, w2, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ids);

  /* w2 and w1 share the left column, w3 takes w2's old tile, and the
   * w3 subtree re-orients: w4 gets 50% of it, w5 and w6 25% each. */
  assert.deepEqual(geometryOf(w2), [0, 0, 795, 445]);
  assert.deepEqual(geometryOf(scene.windows.get('w1')), [0, 455, 795, 445]);
  assert.deepEqual(geometryOf(scene.windows.get('w3')), [805, 0, 795, 445]);
  assert.deepEqual(geometryOf(scene.windows.get('w4')), [805, 455, 392, 445]);
  assert.deepEqual(geometryOf(scene.windows.get('w5')), [1207, 455, 393, 217]);
  assert.deepEqual(geometryOf(scene.windows.get('w6')), [1207, 682, 393, 218]);
});

test('an unlocked split follows the longer edge when the area changes', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);
  assert.deepEqual(geometryOf(a), [0, 0, 795, 900]);

  applyLayout(scene, ['a', 'b'], new scene.api.Rect(0, 0, 800, 1200));

  assert.deepEqual(geometryOf(a), [0, 0, 800, 595]);
  assert.deepEqual(geometryOf(b), [0, 605, 800, 595]);
});

test('SwapDown exchanges windows without changing the tiles', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.SwapDown), true);
  applyLayout(scene, ['a', 'b', 'c']);

  /* b moved into a's tall tile; a took b's tile in the right column. */
  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(a), [805, 0, 795, 445]);
  assert.deepEqual(geometryOf(c), [805, 455, 795, 445]);
});

test('RotatePart toggles only the parent split', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  const c = addWindow(scene, 'c');
  applyLayout(scene, ['a', 'b', 'c']);

  assert.equal(shortcut(scene, b, scene.api.KrohnkiteAction.RotatePart), true);
  applyLayout(scene, ['a', 'b', 'c']);

  /* b/c were stacked; now they are side by side inside the right half. */
  assert.deepEqual(geometryOf(a), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(b), [805, 0, 392, 900]);
  assert.deepEqual(geometryOf(c), [1207, 0, 393, 900]);
});

test('Rotate rotates every split in the tree', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);

  assert.equal(shortcut(scene, a, scene.api.KrohnkiteAction.Rotate), true);
  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(a), [0, 0, 1600, 445]);
  assert.deepEqual(geometryOf(b), [0, 455, 1600, 445]);
});

test('SetMaster does not move focus or windows', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a', 'b']);

  assert.equal(shortcut(scene, b, scene.api.KrohnkiteAction.SetMaster), true);
  applyLayout(scene, ['a', 'b']);

  assert.equal(scene.ctx.currentWindow, b);
  assert.deepEqual(geometryOf(a), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(b), [805, 0, 795, 900]);
});

test('SwapUp exchanges windows with the previous leaf', () => {
  const scene = buildScene();
  addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  const c = addWindow(scene, 'c');
  applyLayout(scene, ['a', 'b', 'c']);

  assert.equal(shortcut(scene, c, scene.api.KrohnkiteAction.SwapUp), true);
  applyLayout(scene, ['a', 'b', 'c']);

  /* c moved above b, b takes the lower half. */
  assert.deepEqual(geometryOf(b), [805, 455, 795, 445]);
  assert.deepEqual(geometryOf(c), [805, 0, 795, 445]);
});

test('dragging onto the left half of a window makes it the left tile', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);

  const action = makeDragAction(scene, b, 200, 450);
  scene.layout.drag(scene.ctx, action);
  assert.equal(action.result.isArrangeNeeded, true);
  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(b), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(a), [805, 0, 795, 900]);
});

test('dropping below a window splits the tile along the pointer half', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  const action = makeDragAction(scene, a, 1100, 300);
  scene.layout.drag(scene.ctx, action);
  assert.equal(action.result.isArrangeNeeded, true);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(b), [0, 0, 795, 445]);
  assert.deepEqual(geometryOf(a), [0, 455, 795, 445]);
  assert.deepEqual(geometryOf(c), [805, 0, 795, 900]);
});

test('dropping at the outer edge makes the window an outer tile', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a', { focusTime: 1 });
  const b = addWindow(scene, 'b', { focusTime: 2 });
  const c = addWindow(scene, 'c', { focusTime: 3 });
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);
  applyLayout(scene, ['a', 'b', 'c']);

  const action = makeDragAction(scene, b, 1595, 450);
  scene.layout.drag(scene.ctx, action);
  assert.equal(action.result.isArrangeNeeded, true);
  applyLayout(scene, ['a', 'b', 'c']);

  assert.deepEqual(geometryOf(b), [805, 0, 795, 900]);
  assert.deepEqual(geometryOf(a), [0, 0, 795, 445]);
  assert.deepEqual(geometryOf(c), [0, 455, 795, 445]);
});

test('an explicit drop stays fixed on the next arrange', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);

  const action = makeDragAction(scene, a, 1100, 200);
  scene.layout.drag(scene.ctx, action);
  assert.equal(action.result.isArrangeNeeded, true);
  applyLayout(scene, ['a', 'b']);

  assert.deepEqual(geometryOf(a), [0, 0, 1600, 445]);
  assert.deepEqual(geometryOf(b), [0, 455, 1600, 445]);

  /* The landscape area would turn an unlocked split horizontal again. */
  applyLayout(scene, ['a', 'b']);
  assert.deepEqual(geometryOf(a), [0, 0, 1600, 445]);
  assert.deepEqual(geometryOf(b), [0, 455, 1600, 445]);
});

test('dragging over the same zone again does nothing', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  const b = addWindow(scene, 'b');
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);

  const action = makeDragAction(scene, b, 200, 450);
  scene.layout.drag(scene.ctx, action);
  assert.equal(action.result.isArrangeNeeded, true);
  applyLayout(scene, ['a', 'b']);

  action.result.isArrangeNeeded = false;
  action.mousePointer = { x: 210, y: 460 };
  action.middlePointer = action.mousePointer;
  scene.layout.drag(scene.ctx, action);
  assert.equal(action.result.isArrangeNeeded, false);
});

test('dragging over its own tile changes nothing', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  addWindow(scene, 'b');
  applyLayout(scene, ['a']);
  applyLayout(scene, ['a', 'b']);

  const action = makeDragAction(scene, a, 200, 450);
  scene.layout.drag(scene.ctx, action);

  assert.equal(action.result.isArrangeNeeded, false);
});

test('dragging the only window to an edge changes nothing', () => {
  const scene = buildScene();
  const a = addWindow(scene, 'a');
  applyLayout(scene, ['a']);

  const action = makeDragAction(scene, a, 1595, 450);
  scene.layout.drag(scene.ctx, action);

  assert.equal(action.result.isArrangeNeeded, false);
});

test('moving an outer tile back enters the adjacent group', () => {
  const scene = buildScene();
  const w1 = addWindow(scene, 'w1', { focusTime: 1 });
  const w2 = addWindow(scene, 'w2', { focusTime: 2 });
  const w3 = addWindow(scene, 'w3', { focusTime: 3 });
  const w4 = addWindow(scene, 'w4', { focusTime: 4 });
  applyLayout(scene, ['w1']);
  applyLayout(scene, ['w1', 'w2']);
  applyLayout(scene, ['w1', 'w2', 'w3']);
  applyLayout(scene, ['w1', 'w2', 'w3', 'w4']);

  /* w4 becomes the right outer column; the old layout reflows into the
   * left half (w1 on top, w2/w3 below). */
  assert.equal(shortcut(scene, w4, scene.api.KrohnkiteAction.MoveRight), true);
  applyLayout(scene, ['w1', 'w2', 'w3', 'w4']);
  assert.deepEqual(geometryOf(w4), [805, 0, 795, 900]);

  /* Moving back must enter the w2/w3 group instead of jumping over it to
   * the first window. */
  assert.equal(shortcut(scene, w4, scene.api.KrohnkiteAction.MoveLeft), true);
  applyLayout(scene, ['w1', 'w2', 'w3', 'w4']);

  assert.deepEqual(geometryOf(w1), [0, 0, 795, 900]);
  assert.deepEqual(geometryOf(w2), [805, 0, 795, 445]);
  assert.deepEqual(geometryOf(w4), [805, 455, 392, 445]);
  assert.deepEqual(geometryOf(w3), [1207, 455, 393, 445]);
});
