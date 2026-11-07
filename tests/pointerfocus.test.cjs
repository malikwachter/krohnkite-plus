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

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
}

/* A KWinDriver with only what the pointer path touches. Timers are queued
 * instead of run so a test can flush them explicitly, and no layout pass is
 * active until the test opens one. */
function setup(config = {}) {
  const env = {
    now: 10000,
    toWindow: 0,
    toScreen: 0,
    timers: [],
  };
  const context = vm.createContext({
    CONFIG: { movePointerOnFocus: true, movePointerOnResize: false, ...config },
    DBUS: {
      moveMouseToFocus: () => env.toWindow++,
      moveMouseToCenter: () => env.toScreen++,
    },
    LOG: undefined,
    getTime: () => env.now,
  });
  const driver = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    driver._lastInteractiveMoveResize = 0;
    driver._pointerRequest = null;
    driver._pointerCenterPending = false;
    driver._layoutPassActive = false;
    return driver;
  })()`, context);
  driver.setTimeout = (func) => env.timers.push(func);
  env.flush = () => {
    for (const func of env.timers.splice(0)) func();
  };
  return { driver, env };
}

test('a focus change moves the pointer once the layout settles', () => {
  const { driver, env } = setup();
  driver.onLayoutStart();
  driver.requestPointerOnFocus("window", true);
  assert.equal(env.toWindow, 0);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.toWindow, 1);
});

test('a focus change without a layout pass takes effect on its own', () => {
  const { driver, env } = setup();
  assert.equal(driver._layoutPassActive, false);
  driver.requestPointerOnFocus("window", true);
  env.flush();
  assert.equal(env.toWindow, 1);
});

test('a screen focus request centers on the screen, not the window', () => {
  const { driver, env } = setup();
  driver.onLayoutStart();
  driver.requestPointerOnFocus("screen", true);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.toScreen, 1);
  assert.equal(env.toWindow, 0);
});

test('focus and resize requests from one pass produce one move', () => {
  const resize = setup({ movePointerOnResize: true });
  resize.driver.onLayoutStart();
  resize.driver.onWindowSizeCommitted({
    active: true,
    move: false,
    resize: false,
  });
  resize.driver.requestPointerOnFocus("window", true);
  resize.driver.onLayoutSettled();
  resize.env.flush();
  assert.equal(resize.env.toWindow, 1);
});

test('a focus request wins over a resize request from the same pass', () => {
  const { driver, env } = setup({ movePointerOnResize: true });
  driver.onLayoutStart();
  driver.requestPointerOnFocus("screen", true);
  driver.onWindowSizeCommitted({
    active: true,
    move: false,
    resize: false,
  });
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.toScreen, 1);
  assert.equal(env.toWindow, 0);
});

test('the latest focus request in the pending window wins', () => {
  const { driver, env } = setup();
  driver.requestPointerOnFocus("window", true); // settled immediately
  driver.requestPointerOnFocus("screen", true); // replaces it while queued
  env.flush();
  assert.equal(env.toScreen, 1);
  assert.equal(env.toWindow, 0);
});

test('shortcuts-only ignores focus KWin granted on its own', () => {
  const shortcuts = { movePointerOnFocusShortcutsOnly: true };
  const external = setup(shortcuts);
  external.driver.requestPointerOnFocus("screen", false);
  external.env.flush();
  assert.equal(external.env.toScreen + external.env.toWindow, 0);

  const shortcut = setup(shortcuts);
  shortcut.driver.requestPointerOnFocus("screen", true);
  shortcut.env.flush();
  assert.equal(shortcut.env.toScreen, 1);
});

test('the pointer stays put when movePointerOnFocus is off', () => {
  const { driver, env } = setup({ movePointerOnFocus: false });
  driver.onLayoutStart();
  driver.requestPointerOnFocus("window", true);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.toWindow + env.toScreen, 0);
});

test('a move queued by one pass uses the request of the next', () => {
  const { driver, env } = setup();
  driver.requestPointerOnFocus("window", true); // settled immediately
  env.now += 10;
  driver.onLayoutStart();
  driver.requestPointerOnFocus("screen", true);
  driver.onLayoutSettled();
  env.flush();
  /* The queued move ran once and landed on the newer request. */
  assert.equal(env.toScreen, 1);
  assert.equal(env.toWindow, 0);
});

test('a focus shortcut still moves the pointer right after a mouse resize', () => {
  const { driver, env } = setup();
  driver._lastInteractiveMoveResize = env.now;
  driver.requestPointerOnFocus("window", true);
  env.flush();
  assert.equal(env.toWindow, 1);
});

test('only the driver consults the focus pointer option', () => {
  const allowed = new Set([
    'src/_types.ts',
    'src/common.ts',
    'src/driver/kwinconfig.ts',
    'src/driver/kwindriver.ts',
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const relative = path.relative(ROOT, full);
        if (allowed.has(relative)) continue;
        if (/CONFIG\.movePointerOnFocus\b/.test(fs.readFileSync(full, 'utf8')))
          offenders.push(relative);
      }
    }
  };
  walk(path.join(ROOT, 'src'));

  assert.deepEqual(offenders, []);
});

test('only the driver calls the pointer-move DBus actions', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        if (/DBUS\.moveMouse(ToFocus|ToCenter)\(/.test(source)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, 'src'));

  assert.deepEqual(offenders, [path.join('src', 'driver', 'kwindriver.ts')]);
});
