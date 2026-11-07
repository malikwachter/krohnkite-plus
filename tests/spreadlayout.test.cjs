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

const SOURCES = ['src/util/rect.ts', 'src/layouts/spreadlayout.ts'];

function buildScene(space = 4) {
  const context = vm.createContext({
    KWINCONFIG: { spreadLayoutSpace: space },
    WindowState: { Tiled: 'Tiled' },
    KrohnkiteAction: { Decrease: 'Decrease', Increase: 'Increase' },
    RectParts: { Top: 0, Bottom: 1, Left: 2, Right: 3, Whole: 4 },
    print: () => {},
  });
  const source = SOURCES.map((file) =>
    fs.readFileSync(path.join(ROOT, file), 'utf8'),
  ).join('\n');
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2015 },
    }).outputText,
    context,
  );
  vm.runInContext('this.Rect = Rect; this.SpreadLayout = SpreadLayout;', context);

  let nextId = 0;
  const makeWindow = (stackingOrder) => ({
    id: `w${nextId++}`,
    state: 'Undecided',
    geometry: null,
    window: { stackingOrder },
  });
  const makeContext = (currentWindow = null) => {
    const raised = [];
    const ctx = {
      currentWindow,
      raised,
      raiseWindow: (window) => raised.push(window),
    };
    return ctx;
  };

  return {
    api: context,
    layout: new context.SpreadLayout(null),
    area: new context.Rect(0, 0, 1000, 500),
    makeWindow,
    makeContext,
  };
}

test('apply lays windows out in window-store order, not stacking order', () => {
  const { layout, area, makeWindow, makeContext } = buildScene();
  const a = makeWindow(100);
  const b = makeWindow(0);
  const c = makeWindow(50);
  const ctx = makeContext();

  layout.apply(ctx, [a, b, c], area, 0);

  // 4% of 1000 = 40px strips, cards are 920px wide. The last window in the
  // store is the front (leftmost) card.
  assert.deepEqual(
    [a, b, c].map((window) => window.geometry.x),
    [80, 40, 0],
  );
  [a, b, c].forEach((window) => {
    assert.equal(window.geometry.width, 920);
    assert.equal(window.geometry.height, 500);
    assert.equal(window.state, 'Tiled');
  });
});

test('restack raises the focused window last and its neighbors before the rest', () => {
  const { layout, makeWindow, makeContext } = buildScene();
  const a = makeWindow(0);
  const b = makeWindow(1);
  const c = makeWindow(2);
  const ctx = makeContext(b);

  layout.restack(ctx, [a, b, c], b);

  assert.deepEqual(
    ctx.raised.map((window) => window.id),
    [a.id, c.id, b.id],
  );
});

test('restack does nothing when the stack already is a pyramid', () => {
  const { layout, makeWindow, makeContext } = buildScene();
  const a = makeWindow(0);
  const b = makeWindow(2);
  const c = makeWindow(1);
  const ctx = makeContext(b);

  layout.restack(ctx, [a, b, c], b);

  assert.equal(ctx.raised.length, 0);
});

test('restack keeps the front slot on top when the focus is not a spread tile', () => {
  const { layout, makeWindow, makeContext } = buildScene();
  const a = makeWindow(2);
  const b = makeWindow(1);
  const c = makeWindow(0);
  const ctx = makeContext(null);

  layout.restack(ctx, [a, b, c], null);

  // Anchor is the last window (c), so the pyramid is rebuilt from a to c.
  assert.deepEqual(
    ctx.raised.map((window) => window.id),
    [a.id, b.id, c.id],
  );
});

test('restack survives a synchronous callback from raiseWindow', () => {
  const { layout, makeWindow, makeContext } = buildScene();
  const a = makeWindow(0);
  const b = makeWindow(1);
  const c = makeWindow(2);
  const ctx = makeContext(b);
  ctx.raiseWindow = (window) => {
    ctx.raised.push(window);
    layout.restack(ctx, [a, b, c], b);
  };

  layout.restack(ctx, [a, b, c], b);

  assert.deepEqual(
    ctx.raised.map((window) => window.id),
    [a.id, c.id, b.id],
  );
});

test('apply establishes the pyramid around the current window', () => {
  const { layout, area, makeWindow, makeContext } = buildScene();
  const a = makeWindow(0);
  const b = makeWindow(1);
  const c = makeWindow(2);
  const ctx = makeContext(b);

  layout.apply(ctx, [a, b, c], area, 0);

  assert.deepEqual(
    ctx.raised.map((window) => window.id),
    [a.id, c.id, b.id],
  );
});
