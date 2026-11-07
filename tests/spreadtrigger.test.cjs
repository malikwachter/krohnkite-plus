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
  'src/layouts/spreadlayout.ts',
  'src/engine/control.ts',
];

function buildController() {
  const context = vm.createContext({
    KWINCONFIG: { spreadLayoutSpace: 4 },
    WindowState: { Tiled: 'Tiled' },
    KrohnkiteAction: new Proxy(
      {},
      { get: (_target, property) => String(property) },
    ),
    RectParts: { Top: 0, Bottom: 1, Left: 2, Right: 3, Whole: 4 },
    print: () => {},
    getMethodName: () => 'test',
    getTime: () => 12345,
    LOG: undefined,
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
  vm.runInContext(
    'this.SpreadLayout = SpreadLayout; this.TilingController = TilingController;',
    context,
  );

  const spread = new context.SpreadLayout(null);
  const restackCalls = [];
  const arrangeCalls = [];
  const focusRestackCalls = [];
  const engine = {
    layouts: { getCurrentLayout: () => spread },
    restackSpread: (...args) => restackCalls.push(args),
    restackSpreadOnFocus: (...args) => focusRestackCalls.push(args),
    arrange: (...args) => arrangeCalls.push(args),
  };
  return {
    api: context,
    spread,
    engine,
    restackCalls,
    arrangeCalls,
    focusRestackCalls,
    controller: new context.TilingController(engine),
  };
}

test('a raise in the spread layout restacks instead of rearranging', () => {
  const { controller, restackCalls, arrangeCalls } = buildController();
  const ctx = {};
  const surface = { id: 'surface' };
  const window = { isTiled: true, surface };

  controller.onStackingOrderChanged(ctx, window);

  assert.equal(arrangeCalls.length, 0);
  assert.equal(restackCalls.length, 1);
  assert.deepEqual(restackCalls[0], [ctx, surface, window]);
});

test('a raise outside the spread layout does nothing', () => {
  const { controller, engine, restackCalls, arrangeCalls } = buildController();
  engine.layouts.getCurrentLayout = () => ({});
  const window = { isTiled: true, surface: { id: 'surface' } };

  controller.onStackingOrderChanged({}, window);

  assert.equal(restackCalls.length, 0);
  assert.equal(arrangeCalls.length, 0);
});

test('a raised floating window does not restack the spread', () => {
  const { controller, restackCalls, arrangeCalls } = buildController();
  const window = { isTiled: false, surface: { id: 'surface' } };

  controller.onStackingOrderChanged({}, window);

  assert.equal(restackCalls.length, 0);
  assert.equal(arrangeCalls.length, 0);
});

test('a focused tile asks the engine to restack the spread', () => {
  const { controller, focusRestackCalls } = buildController();
  const ctx = {};
  const window = { isTiled: true, focusTime: 0, surface: { id: 'surface' } };

  controller.onWindowFocused(ctx, window);

  assert.notEqual(window.focusTime, 0);
  assert.equal(focusRestackCalls.length, 1);
  assert.deepEqual(focusRestackCalls[0], [ctx, window]);
});

test('a focused floating window only records the focus time', () => {
  const { controller, focusRestackCalls } = buildController();
  const window = { isTiled: false, focusTime: 0, surface: { id: 'surface' } };

  controller.onWindowFocused({}, window);

  assert.notEqual(window.focusTime, 0);
  assert.equal(focusRestackCalls.length, 0);
});
