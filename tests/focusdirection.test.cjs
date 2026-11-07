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
const TILED_DOCKED_FLOAT = 7;

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
}

function makeWindow(internalId, outputName, x, y, width, height) {
  return {
    internalId,
    caption: `window-${internalId}`,
    resourceClass: 'test',
    frameGeometry: { x, y, width, height },
    output: { name: outputName },
  };
}

function makeSurface(outputName, x, y, width, height) {
  return {
    output: {
      name: outputName,
      geometry: { x, y, width, height },
    },
  };
}

/* A KWinDriver with only the focus path stubbed out. Window wrappers mimic the
 * DriverWindow -> KwinWindow chain that _getWindowsByDirection unwraps, and
 * each surface sees only the windows assigned to its output. */
function setup(windows) {
  const context = vm.createContext({
    WinTypes: { tiled: 1, docked: 2, float: 4, surfaces: 8, special: 16 },
    getTime: () => 0,
  });
  vm.runInContext(transpile('src/util/rect.ts'), context);
  vm.runInContext(transpile('src/util/kwinutil.ts'), context);
  vm.runInContext(transpile('src/driver/kwindriver.ts'), context);

  const driver = vm.runInContext('Object.create(KWinDriver.prototype)', context);
  const byClient = new Map();
  const byId = new Map();
  const wrapped = windows.map((client) => {
    const window = { window: { window: client }, focusTime: 0 };
    byClient.set(client, window);
    byId.set(String(client.internalId), window);
    return window;
  });
  const visibleOn = (surface) =>
    wrapped.filter(
      (window) => window.window.window.output.name === surface.output.name,
    );

  driver.workspace = { activeWindow: null };
  driver.windowMap = { get: (client) => byClient.get(client) ?? null };
  driver.engine = {
    windows: {
      getVisibleWindows: visibleOn,
      getVisibleTiles: visibleOn,
      getVisibleFloat: visibleOn,
      getVisibleDocked: visibleOn,
      getVisibleTilesOrFloat: visibleOn,
      getVisibleTilesOrDocked: visibleOn,
      getVisibleFloatOrDocked: visibleOn,
      getWindowById: (id) => byId.get(id) ?? null,
    },
  };

  return { driver };
}

test('focus right includes a tile flush with the target screen edge', () => {
  const leftTile = makeWindow(11, 'DP-2', 1920, 0, 960, 1080);
  const rightTile = makeWindow(12, 'DP-2', 2880, 0, 960, 1080);
  const { driver } = setup([leftTile, rightTile]);
  const target = makeSurface('DP-2', 1920, 0, 1920, 1080);

  const found = driver._setFocusOnSurface(
    null,
    target,
    'right',
    TILED_DOCKED_FLOAT,
  );

  assert.equal(found, true);
  assert.equal(driver.workspace.activeWindow, leftTile);
});

test('focus right focuses the only tile even when it is flush with the edge', () => {
  const onlyTile = makeWindow(21, 'DP-2', 1920, 0, 1920, 1080);
  const { driver } = setup([onlyTile]);
  const target = makeSurface('DP-2', 1920, 0, 1920, 1080);

  const found = driver._setFocusOnSurface(
    null,
    target,
    'right',
    TILED_DOCKED_FLOAT,
  );

  assert.equal(found, true);
  assert.equal(driver.workspace.activeWindow, onlyTile);
});

test('focus down includes a tile flush with the target screen edge', () => {
  const topTile = makeWindow(31, 'DP-2', 0, 1080, 1920, 540);
  const bottomTile = makeWindow(32, 'DP-2', 0, 1620, 1920, 540);
  const { driver } = setup([topTile, bottomTile]);
  const target = makeSurface('DP-2', 0, 1080, 1920, 1080);

  const found = driver._setFocusOnSurface(
    null,
    target,
    'down',
    TILED_DOCKED_FLOAT,
  );

  assert.equal(found, true);
  assert.equal(driver.workspace.activeWindow, topTile);
});

test('focus left and up still select the tile nearest the shared edge', () => {
  const leftA = makeWindow(41, 'DP-1', 0, 0, 960, 1080);
  const leftB = makeWindow(42, 'DP-1', 960, 0, 960, 1080);
  const upA = makeWindow(43, 'DP-3', 0, 0, 1920, 540);
  const upB = makeWindow(44, 'DP-3', 0, 540, 1920, 540);
  const { driver } = setup([leftA, leftB, upA, upB]);

  assert.equal(
    driver._setFocusOnSurface(
      null,
      makeSurface('DP-1', 0, 0, 1920, 1080),
      'left',
      TILED_DOCKED_FLOAT,
    ),
    true,
  );
  assert.equal(driver.workspace.activeWindow, leftB);

  assert.equal(
    driver._setFocusOnSurface(
      null,
      makeSurface('DP-3', 0, 0, 1920, 1080),
      'up',
      TILED_DOCKED_FLOAT,
    ),
    true,
  );
  assert.equal(driver.workspace.activeWindow, upB);
});

test('same-surface focus still skips the source window', () => {
  const source = makeWindow(51, 'DP-2', 0, 0, 960, 1080);
  const neighbor = makeWindow(52, 'DP-2', 960, 0, 960, 1080);
  const { driver } = setup([source, neighbor]);
  const surface = makeSurface('DP-2', 0, 0, 1920, 1080);
  const localWindows = [source, neighbor];

  const found = driver._setFocusOnSurface(
    source,
    surface,
    'right',
    TILED_DOCKED_FLOAT,
    localWindows,
  );

  assert.equal(found, true);
  assert.equal(driver.workspace.activeWindow, neighbor);
});
