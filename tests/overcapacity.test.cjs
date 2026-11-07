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

function loadHelpers() {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(ROOT, 'src/util/overcapacity.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context;
}

function windowAt(srfTime, focusTime = 0) {
  return { window: { srfTime }, focusTime };
}

test('resolveSurfaceCapacity follows the stricter surface/layout limit', () => {
  const context = loadHelpers();
  const resolve = (layout, surface) =>
    vm.runInContext(`resolveSurfaceCapacity(${layout}, ${surface})`, context);

  assert.equal(resolve('null', 'null'), null);
  assert.equal(resolve('undefined', 'null'), null);
  assert.equal(resolve('undefined', '5'), 5);
  assert.equal(resolve('4', 'null'), 4);
  assert.equal(resolve('3', '5'), 3);
  assert.equal(resolve('5', '3'), 3);
});

test('lastFocused policy evicts the most recently focused window', () => {
  const context = loadHelpers();
  const older = windowAt(1, 300);
  const newer = windowAt(2, 100);
  const newest = windowAt(3, 200);
  const tiles = [older, newer, newest];
  context.tiles = tiles;

  const lastFocused = vm.runInContext(
    'selectOverCapacityWindows(tiles, 2, "lastFocused")',
    context,
  );
  assert.equal(lastFocused.overCapacity.length, 1);
  assert.equal(lastFocused.overCapacity[0], older);
  assert.equal(lastFocused.tileables.length, 2);
  assert.equal(lastFocused.tileables[0], newer);
  assert.equal(lastFocused.tileables[1], newest);
  assert.equal(lastFocused.freeSlots, 0);

  const tie = [windowAt(1, 100), windowAt(2, 100)];
  context.tie = tie;
  const tieResult = vm.runInContext(
    'selectOverCapacityWindows(tie, 1, "lastFocused")',
    context,
  );
  assert.equal(tieResult.overCapacity[0], tie[1]);
});

test('oldest policy evicts the window that appeared first', () => {
  const context = loadHelpers();
  const older = windowAt(1, 300);
  const newer = windowAt(2, 100);
  const newest = windowAt(3, 200);
  context.tiles = [older, newer, newest];

  const oldest = vm.runInContext(
    'selectOverCapacityWindows(tiles, 2, "oldest")',
    context,
  );
  assert.equal(oldest.overCapacity.length, 1);
  assert.equal(oldest.overCapacity[0], older);
  assert.equal(oldest.tileables.length, 2);
  assert.equal(oldest.tileables[0], newer);
  assert.equal(oldest.tileables[1], newest);
});

test('selectOverCapacityWindows reports free slots and leaves input intact', () => {
  const context = loadHelpers();
  const tiles = [windowAt(1), windowAt(2)];
  context.tiles = tiles;

  const result = vm.runInContext(
    'selectOverCapacityWindows(tiles, 5, "oldest")',
    context,
  );
  assert.equal(result.overCapacity.length, 0);
  assert.equal(result.tileables.length, 2);
  assert.equal(result.tileables[0], tiles[0]);
  assert.equal(result.tileables[1], tiles[1]);
  assert.equal(result.freeSlots, 3);
  assert.equal(tiles.length, 2);

  const unlimited = vm.runInContext(
    'selectOverCapacityWindows(tiles, null, "oldest")',
    context,
  );
  assert.equal(unlimited.freeSlots, null);
});

test('resolveAvailableSlots handles full and overfilled targets', () => {
  const context = loadHelpers();
  const slots = (capacity, awaitToMove, overCapacity, allowOverfill) =>
    vm.runInContext(
      `resolveAvailableSlots(${capacity}, ${awaitToMove}, ${overCapacity}, ${allowOverfill})`,
      context,
    );

  assert.equal(slots('null', 0, 3, false), 3);
  assert.equal(slots(2, 0, 3, false), 2);
  assert.equal(slots(2, 1, 3, false), 1);
  assert.equal(slots(0, 0, 1, false), 0);
  assert.equal(slots(0, 0, 1, true), 1);
  assert.equal(slots(-1, 0, 1, true), 1);
});

test('a protected window survives the overcapacity selection', () => {
  const context = loadHelpers();
  const older = windowAt(1, 100);
  const middle = windowAt(2, 200);
  const newest = windowAt(3, 300);
  const tiles = [older, middle, newest];
  context.tiles = tiles;

  context.protectedOldest = [older];
  const oldest = vm.runInContext(
    'selectOverCapacityWindows(tiles, 2, "oldest", protectedOldest)',
    context,
  );
  assert.equal(oldest.overCapacity.length, 1);
  assert.equal(oldest.overCapacity[0], middle);
  assert.equal(oldest.tileables.length, 2);
  assert.equal(oldest.tileables[0], older);
  assert.equal(oldest.tileables[1], newest);

  context.protectedNewest = [newest];
  const lastFocused = vm.runInContext(
    'selectOverCapacityWindows(tiles, 2, "lastFocused", protectedNewest)',
    context,
  );
  assert.equal(lastFocused.overCapacity.length, 1);
  assert.equal(lastFocused.overCapacity[0], middle);
  assert.equal(lastFocused.tileables.length, 2);
  assert.equal(lastFocused.tileables[0], older);
  assert.equal(lastFocused.tileables[1], newest);
});

test('minimize mode is disabled when minimizing is prevented', () => {
  const context = loadHelpers();
  assert.equal(
    vm.runInContext(
      'isMinimizeOvercapacityMode("minimize", false)',
      context,
    ),
    true,
  );
  assert.equal(
    vm.runInContext('isMinimizeOvercapacityMode("float", false)', context),
    false,
  );
});

test('restore picks hidden windows in LIFO order for the requested surface', () => {
  const context = loadHelpers();
  const a = { name: 'a', surface: { id: 'A' } };
  const b = { name: 'b', surface: { id: 'A' } };
  const c = { name: 'c', surface: { id: 'A' } };
  const other = { name: 'other', surface: { id: 'B' } };
  context.hidden = [a, b, c, other];

  const one = vm.runInContext(
    "selectRestorableWindows(hidden, 'A', 1, false)",
    context,
  );
  assert.equal(one.length, 1);
  assert.equal(one[0], c);

  const two = vm.runInContext(
    "selectRestorableWindows(hidden, 'A', 2, false)",
    context,
  );
  assert.equal(two.length, 2);
  assert.equal(two[0], c);
  assert.equal(two[1], b);

  const unlimited = vm.runInContext(
    "selectRestorableWindows(hidden, 'A', null, false)",
    context,
  );
  assert.equal(unlimited.length, 3);
  assert.equal(unlimited[0], c);
  assert.equal(unlimited[1], b);
  assert.equal(unlimited[2], a);

  const restoreAll = vm.runInContext(
    "selectRestorableWindows(hidden, 'A', 0, true)",
    context,
  );
  assert.equal(restoreAll.length, 3);
  assert.equal(restoreAll[0], c);
  assert.equal(restoreAll[1], b);
  assert.equal(restoreAll[2], a);

  const otherSurface = vm.runInContext(
    "selectRestorableWindows(hidden, 'B', 1, false)",
    context,
  );
  assert.equal(otherSurface.length, 1);
  assert.equal(otherSurface[0], other);
});

test('a new active window records focus before the first arrange', () => {
  const driver = fs.readFileSync(
    path.join(ROOT, 'src/driver/kwindriver.ts'),
    'utf8',
  );
  const addWindow = driver.match(/private addWindow\([\s\S]*?\n  \}\n/);
  assert.ok(addWindow, 'addWindow method missing');

  const focusIndex = addWindow[0].indexOf('this.control.onWindowFocused(');
  const arrangeIndex = addWindow[0].indexOf('this.control.onWindowAdded(');
  assert.ok(focusIndex >= 0, 'addWindow must record focus');
  assert.ok(arrangeIndex >= 0, 'addWindow must trigger the first arrange');
  assert.ok(
    focusIndex < arrangeIndex,
    'focus must be recorded before the overcapacity selection runs',
  );
});

test('the overcapacity mode is wired through xml, ui, types and kwinconfig', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'res/config.xml'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');
  const types = fs.readFileSync(path.join(ROOT, 'src/_types.ts'), 'utf8');
  const common = fs.readFileSync(path.join(ROOT, 'src/common.ts'), 'utf8');
  const kwinconfig = fs.readFileSync(
    path.join(ROOT, 'src/driver/kwinconfig.ts'),
    'utf8',
  );

  assert.match(
    xml,
    /<entry name="srfOvercapacityMode" type="Int">\s*<label>[^<]+<\/label>\s*<default>1<\/default>\s*<\/entry>/,
  );
  assert.match(types, /\bsrfOvercapacityMode: "srfOvercapacityMode"/);
  assert.match(common, /\bsrfOvercapacityMode: OvercapacityMode;/);
  assert.match(
    kwinconfig,
    /readConfig\(\s*"srfOvercapacityMode",\s*1\s*\)/,
  );

  const combo = ui.match(
    /<widget class="QComboBox" name="kcfg_srfOvercapacityMode">[\s\S]*?<\/widget>/,
  );
  assert.ok(combo, 'kcfg_srfOvercapacityMode combo missing');
  assert.match(combo[0], /<string>Float<\/string>/);
  assert.match(combo[0], /<string>Minimize<\/string>/);
  assert.match(
    combo[0],
    /<property name="currentIndex">\s*<number>1<\/number>\s*<\/property>/,
  );

  assert.match(
    xml,
    /<entry name="srfOvercapacityEviction" type="Int">\s*<label>[^<]+<\/label>\s*<default>1<\/default>\s*<\/entry>/,
  );
  assert.match(
    types,
    /\bsrfOvercapacityEviction: "srfOvercapacityEviction"/,
  );
  assert.match(
    common,
    /\bsrfOvercapacityEviction: OvercapacityEvictionPolicy;/,
  );
  assert.match(
    kwinconfig,
    /readConfig\(\s*"srfOvercapacityEviction",\s*1\s*\)/,
  );

  const evictionCombo = ui.match(
    /<widget class="QComboBox" name="kcfg_srfOvercapacityEviction">[\s\S]*?<\/widget>/,
  );
  assert.ok(evictionCombo, 'kcfg_srfOvercapacityEviction combo missing');
  assert.match(evictionCombo[0], /<string>last focused<\/string>/);
  assert.match(evictionCombo[0], /<string>oldest windows<\/string>/);
  assert.match(
    evictionCombo[0],
    /<property name="currentIndex">\s*<number>1<\/number>\s*<\/property>/,
  );

  assert.match(
    xml,
    /<entry name="srfAllowShortcutMoveToFullSurface" type="Bool">\s*<label>[^<]+<\/label>\s*<default>false<\/default>\s*<\/entry>/,
  );
  assert.match(
    types,
    /\bsrfAllowShortcutMoveToFullSurface: "srfAllowShortcutMoveToFullSurface"/,
  );
  assert.match(
    common,
    /\bsrfAllowShortcutMoveToFullSurface: boolean;/,
  );
  assert.match(
    kwinconfig,
    /readConfig\(\s*"srfAllowShortcutMoveToFullSurface",\s*false,?\s*\)/,
  );

  const fullSurfaceCheckbox = ui.match(
    /<widget class="QCheckBox" name="kcfg_srfAllowShortcutMoveToFullSurface">[\s\S]*?<\/widget>/,
  );
  assert.ok(
    fullSurfaceCheckbox,
    'kcfg_srfAllowShortcutMoveToFullSurface checkbox missing',
  );
  assert.match(
    fullSurfaceCheckbox[0],
    /<string>allow shortcut moves to a full surface<\/string>/,
  );
});

test('the old oldest-windows checkbox is removed', () => {
  const files = [
    'res/config.xml',
    'res/config.ui',
    'src/_types.ts',
    'src/common.ts',
    'src/driver/kwinconfig.ts',
    'src/engine/engine.ts',
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(content, /srfIsMoveOldestWindows/, file);
  }
});

test('screen and desktop relocation are off by default', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'res/config.xml'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');
  const kwinconfig = fs.readFileSync(
    path.join(ROOT, 'src/driver/kwinconfig.ts'),
    'utf8',
  );

  for (const key of ['srfExceededToScreen', 'srfExceededToVDesktop']) {
    assert.match(
      xml,
      new RegExp(
        `<entry name="${key}" type="Bool">\\s*` +
          `<label>[^<]+</label>\\s*<default>false</default>\\s*</entry>`,
      ),
      key,
    );
    assert.match(
      kwinconfig,
      new RegExp(`readConfig\\(\\s*"${key}",\\s*false,?\\s*\\)`),
      key,
    );
  }

  const screenCheckbox = ui.match(
    /<widget class="QCheckBox" name="kcfg_srfExceededToScreen">[\s\S]*?<\/widget>/,
  );
  const vdesktopCheckbox = ui.match(
    /<widget class="QCheckBox" name="kcfg_srfExceededToVDesktop">[\s\S]*?<\/widget>/,
  );
  assert.ok(screenCheckbox, 'kcfg_srfExceededToScreen checkbox missing');
  assert.ok(
    vdesktopCheckbox,
    'kcfg_srfExceededToVDesktop checkbox missing',
  );
  assert.match(
    screenCheckbox[0],
    /<property name="checked">\s*<bool>false<\/bool>\s*<\/property>/,
  );
  assert.match(
    vdesktopCheckbox[0],
    /<property name="checked">\s*<bool>false<\/bool>\s*<\/property>/,
  );
});

test('the engine minimizes in minimize mode and restores via LIFO', () => {
  const engine = fs.readFileSync(
    path.join(ROOT, 'src/engine/engine.ts'),
    'utf8',
  );

  assert.match(engine, /_isMinimizeOvercapacityMode\(\)/);
  assert.match(engine, /CONFIG\.srfOvercapacityEviction/);
  assert.match(engine, /CONFIG\.srfAllowShortcutMoveToFullSurface/);
  assert.match(engine, /preserveOnSurface/);
  assert.match(engine, /setMinimizedByScript\(true\)/);
  assert.match(engine, /setMinimizedByScript\(false\)/);
  assert.match(engine, /_restoreOverCapacityMinimized\(srf\)/);
  assert.match(engine, /screenData\.overCapacity\.forEach\(\(win\) => win\.floatInPlace\(\)\)/);
});

test('ShowCurrentCapacity is wired as the RaiseSurfaceCapacity alter action', () => {
  const types = fs.readFileSync(path.join(ROOT, 'src/_types.ts'), 'utf8');
  const shortcuts = fs.readFileSync(
    path.join(ROOT, 'src/driver/kwinshortcut.ts'),
    'utf8',
  );
  const control = fs.readFileSync(
    path.join(ROOT, 'src/engine/control.ts'),
    'utf8',
  );
  const engine = fs.readFileSync(
    path.join(ROOT, 'src/engine/engine.ts'),
    'utf8',
  );
  const ui = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');

  assert.match(types, /\bShowCurrentCapacity: "ShowCurrentCapacity"/);

  const raiseShortcut = shortcuts.match(
    /RaiseSurfaceCapacitySC:\s*\{[\s\S]*?\},/,
  );
  assert.ok(raiseShortcut, 'RaiseSurfaceCapacitySC entry missing');
  assert.match(
    raiseShortcut[0],
    /defaultRegisterAction: KrohnkiteAction\.ShowCurrentCapacity/,
  );

  assert.match(control, /case KrohnkiteAction\.ShowCurrentCapacity:/);
  assert.match(control, /getCurrentSurfaceCapacity\(ctx\)/);
  assert.match(
    engine,
    /public getCurrentSurfaceCapacity\(ctx: IDriverContext\): number \| null/,
  );

  const actions = ui.match(
    /<widget class="QComboBox" name="possibleActions">[\s\S]*?<\/widget>/,
  );
  assert.ok(actions, 'possibleActions combo missing');
  assert.match(actions[0], /<string>ShowCurrentCapacity<\/string>/);
});
