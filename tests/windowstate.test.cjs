/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

function transpile(...relativePaths) {
  return relativePaths
    .map(
      (relativePath) =>
        ts.transpileModule(
          fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
          { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
        ).outputText,
    )
    .join("\n");
}

/* The engine needs a driver window and a few globals that only the running
 * KWin session provides. Only the state transitions are exercised here, so the
 * driver is a plain object that records the calls the engine makes. */
function setup() {
  const context = vm.createContext({
    CONFIG: {},
    LOG: undefined,
    LogModules: {},
    WindowLayer: { Normal: 0 },
    RectDelta: { fromRects: () => null },
    DefaultDockCfg: { instance: {} },
    Dock: class {
      clone() {
        return this;
      }
    },
  });
  return vm.runInContext(
    `${transpile("src/util/rect.ts", "src/_types.ts", "src/engine/window.ts")}
    ({ WindowClass, WindowState, Rect })`,
    context,
  );
}

function fakeWindow(Rect) {
  return {
    id: "w1",
    geometry: new Rect(10, 10, 800, 600),
    floatGeometry: new Rect(100, 100, 400, 300),
    minSize: { width: 0, height: 0 },
    maxSize: { width: 1e9, height: 1e9 },
    shouldFloat: false,
    shouldIgnore: false,
    fullScreen: false,
    maximized: false,
    forgets: 0,
    forgetRequestedGeometry() {
      this.forgets++;
    },
  };
}

test("leaving the floating state forgets the committed geometry", () => {
  const { WindowClass, WindowState, Rect } = setup();
  const driver = fakeWindow(Rect);
  const window = new WindowClass(driver);

  window.state = WindowState.Floating;
  assert.equal(driver.forgets, 0);

  window.state = WindowState.Tiled;
  assert.equal(driver.forgets, 1);
  assert.equal(window.state, WindowState.Tiled);
  assert.equal(driver.floatGeometry, driver.geometry);
});

test("entering the floating state keeps the committed geometry", () => {
  const { WindowClass, WindowState, Rect } = setup();
  const driver = fakeWindow(Rect);
  const window = new WindowClass(driver);

  window.state = WindowState.Tiled;
  window.state = WindowState.Floating;

  assert.equal(driver.forgets, 0);
});

test("docking a floating window forgets the committed geometry", () => {
  const { WindowClass, WindowState, Rect } = setup();
  const driver = fakeWindow(Rect);
  const window = new WindowClass(driver);

  window.state = WindowState.Floating;
  window.state = WindowState.Docked;

  assert.equal(driver.forgets, 1);
});

test("repeating the same state does not forget again", () => {
  const { WindowClass, WindowState, Rect } = setup();
  const driver = fakeWindow(Rect);
  const window = new WindowClass(driver);

  window.state = WindowState.Floating;
  window.state = WindowState.Tiled;
  window.state = WindowState.Tiled;

  assert.equal(driver.forgets, 1);
});
