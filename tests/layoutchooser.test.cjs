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
const chooser = fs.readFileSync(path.join(ROOT, 'res/layoutchooser.qml'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'res/main.qml'), 'utf8');
const shortcuts = fs.readFileSync(path.join(ROOT, 'res/shortcuts.qml'), 'utf8');
const shortcutMap = fs.readFileSync(
  path.join(ROOT, 'src/driver/kwinshortcut.ts'),
  'utf8',
);

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
}

test('LayoutChooser action opens the chooser and does not arrange', () => {
  const context = vm.createContext({
    CONFIG: { movePointerOnFocus: false },
    KrohnkiteAction: new Proxy({}, { get: (_target, action) => String(action) }),
    getMethodName: () => 'test',
  });
  const source = `${transpile('src/engine/engine.ts')}\n${transpile('src/engine/control.ts')}`;
  const calls = vm.runInContext(`${source}\n(() => {
    const calls = [];
    const engine = Object.create(TilingEngine.prototype);
    engine.handleDockWinShortcut = () => false;
    engine.handleFloatWinShortcut = () => false;
    engine.handleLayoutShortcut = () => false;
    engine.handleTiledWinShortcut = () => false;
    engine.arrange = () => calls.push(['arrange']);
    const controller = Object.create(TilingController.prototype);
    controller.engine = engine;
    const ctx = {
      currentWindow: null,
      showLayoutChooser: () => calls.push(['chooser']),
      handleLayoutChooserShortcut: () => false,
    };
    controller.onShortcut(ctx, KrohnkiteAction.LayoutChooser, 'keyboard');
    return calls;
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['chooser']]);
});

test('focus shortcuts consumed by the chooser neither move window focus nor arrange', () => {
  const context = vm.createContext({
    CONFIG: { movePointerOnFocus: false },
    KrohnkiteAction: new Proxy({}, { get: (_target, action) => String(action) }),
    getMethodName: () => 'test',
  });
  const source = `${transpile('src/engine/engine.ts')}\n${transpile('src/engine/control.ts')}`;
  const calls = vm.runInContext(`${source}\n(() => {
    const calls = [];
    const engine = Object.create(TilingEngine.prototype);
    engine.handleDockWinShortcut = () => false;
    engine.handleFloatWinShortcut = () => false;
    engine.handleLayoutShortcut = () => false;
    engine.handleTiledWinShortcut = () => false;
    engine.focusDir = (_ctx, direction) => { calls.push(['focusDir', direction]); return true; };
    engine.arrange = () => calls.push(['arrange']);
    const controller = Object.create(TilingController.prototype);
    controller.engine = engine;
    const ctx = {
      currentWindow: null,
      showLayoutChooser: () => calls.push(['chooser']),
      handleLayoutChooserShortcut: (action) => action === 'FocusLeft',
    };
    controller.onShortcut(ctx, KrohnkiteAction.FocusLeft, 'keyboard');
    controller.onShortcut(ctx, KrohnkiteAction.FocusRight, 'keyboard');
    return calls;
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['focusDir', 'right'],
    ['arrange'],
  ]);
});

test('chooser receives enabled layouts, the current layout and the hide delay', () => {
  const calls = [];
  const context = vm.createContext({
    CONFIG: {
      notificationDuration: 0,
      layoutOrder: ['TileLayout', 'SpiralLayout'],
    },
    layoutChooserDialog: {
      isOpen: () => false,
      showLayouts: (...args) => calls.push(args),
    },
    DBUS: {
      moveMouseToScreenCenter: () => {},
    },
  });
  vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    Object.defineProperty(driver, 'currentSurface', { value: { id: 'srf-1' } });
    driver.engine = {
      layouts: { getCurrentLayout: () => ({ classID: 'SpiralLayout' }) },
    };
    driver.showLayoutChooser();
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [
      [
        { id: 'TileLayout', name: 'Tile', icon: 'tile' },
        { id: 'SpiralLayout', name: 'Spiral', icon: 'spiral' },
      ],
      'SpiralLayout',
      0,
    ],
  ]);
});

test('opening the chooser centers the pointer on the screen after showing it', () => {
  const events = [];
  const context = vm.createContext({
    CONFIG: {
      notificationDuration: 0,
      layoutOrder: ['TileLayout'],
    },
    layoutChooserDialog: {
      isOpen: () => false,
      showLayouts: () => events.push('showLayouts'),
    },
    DBUS: {
      moveMouseToCenter: () => events.push('moveMouseToCenter'),
      moveMouseToFocus: () => events.push('moveMouseToFocus'),
      moveMouseToScreenCenter: (delay) =>
        events.push(['moveMouseToScreenCenter', delay]),
    },
  });
  vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    Object.defineProperty(driver, 'currentSurface', { value: {} });
    driver.engine = {
      layouts: { getCurrentLayout: () => ({ classID: 'TileLayout' }) },
    };
    driver.showLayoutChooser();
  })()`, context);
  assert.equal(events[0], 'showLayouts');
  assert.equal(events[1][0], 'moveMouseToScreenCenter');
  assert.equal(typeof events[1][1], 'number');
  assert.equal(events.length, 2);
});

test('an empty layout list neither opens the chooser nor moves the pointer', () => {
  const events = [];
  const context = vm.createContext({
    CONFIG: { notificationDuration: 0, layoutOrder: ['DisabledLayout'] },
    layoutChooserDialog: {
      isOpen: () => false,
      showLayouts: () => events.push('showLayouts'),
    },
    DBUS: { moveMouseToScreenCenter: () => events.push('moveMouseToScreenCenter') },
  });
  vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    Object.defineProperty(driver, 'currentSurface', { value: {} });
    driver.engine = {};
    driver.showLayoutChooser();
  })()`, context);
  assert.deepEqual(events, []);
});

test('the chooser shortcut toggles the chooser off on the same surface', () => {
  const events = [];
  const context = vm.createContext({
    CONFIG: { notificationDuration: 500, layoutOrder: ['TileLayout'] },
    layoutChooserDialog: {
      isOpen: () => true,
      hide: () => events.push('hide'),
      showLayouts: () => events.push('showLayouts'),
    },
    DBUS: {
      moveMouseToScreenCenter: () => events.push('moveMouseToScreenCenter'),
    },
  });
  vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    Object.defineProperty(driver, 'currentSurface', { value: { id: 'srf-1' } });
    driver._layoutChooserSurfaceId = 'srf-1';
    driver.engine = {
      layouts: { getCurrentLayout: () => ({ classID: 'TileLayout' }) },
    };
    driver.showLayoutChooser();
  })()`, context);
  assert.deepEqual(events, ['hide']);
});

test('the chooser opens on another surface even when it is already open', () => {
  const events = [];
  const context = vm.createContext({
    CONFIG: { notificationDuration: 500, layoutOrder: ['TileLayout'] },
    layoutChooserDialog: {
      isOpen: () => true,
      hide: () => events.push('hide'),
      showLayouts: () => events.push('showLayouts'),
    },
    DBUS: {
      moveMouseToScreenCenter: () => events.push('moveMouseToScreenCenter'),
    },
  });
  vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    Object.defineProperty(driver, 'currentSurface', { value: { id: 'srf-2' } });
    driver._layoutChooserSurfaceId = 'srf-1';
    driver.engine = {
      layouts: { getCurrentLayout: () => ({ classID: 'TileLayout' }) },
    };
    driver.showLayoutChooser();
  })()`, context);
  assert.deepEqual(events, ['showLayouts', 'moveMouseToScreenCenter']);
});

test('focus shortcuts navigate the open chooser instead of the windows', () => {
  const calls = [];
  const context = vm.createContext({
    KrohnkiteAction: new Proxy({}, { get: (_target, action) => String(action) }),
    layoutChooserDialog: {
      isOpen: () => true,
      navigate: (dx, dy) => calls.push([dx, dy]),
    },
  });
  const handled = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    const actions = ['FocusLeft', 'FocusRight', 'FocusUp', 'FocusDown', 'DWMLeft', 'DWMRight'];
    return actions.map(action => driver.handleLayoutChooserShortcut(action));
  })()`, context);
  assert.deepEqual(Array.from(handled), [true, true, true, true, true, true]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]);
});

test('focus shortcuts are left alone when the chooser is closed', () => {
  const calls = [];
  const context = vm.createContext({
    KrohnkiteAction: new Proxy({}, { get: (_target, action) => String(action) }),
    layoutChooserDialog: {
      isOpen: () => false,
      navigate: (dx, dy) => calls.push([dx, dy]),
    },
  });
  const handled = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    return driver.handleLayoutChooserShortcut('FocusLeft');
  })()`, context);
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});

/* Minimal DBusCall stand-in: `call()` reports itself and then emits `finished`,
 * which is how KWin's DBusCall behaves. */
function dbusCallStub(log, name) {
  return {
    finished: {
      handlers: [],
      connect(fn) {
        this.handlers.push(fn);
      },
      disconnect() {},
    },
    failed: {
      connect() {},
      disconnect() {},
    },
    call() {
      log.push(['call', name]);
      for (const handler of this.finished.handlers.slice()) handler();
    },
  };
}

test('moving the pointer to the screen center is not chained to the focused window', () => {
  const log = [];
  const context = vm.createContext({
    KWinSetTimeout: () => {},
    info: () => {},
    warning: () => {},
    LOG: undefined,
  });
  vm.runInContext(transpile('src/driver/kwindbus.ts'), context);
  context.__qml = {
    getDBusExists: () => dbusCallStub(log, 'exists'),
    getDBusMoveMouseToFocus: () => dbusCallStub(log, 'focus'),
    getDBusMoveMouseToCenter: () => dbusCallStub(log, 'center'),
    getDBusMoveMouseToScreenCenter: () => dbusCallStub(log, 'screenCenter'),
    getDBusVirtualKeyboardVisible: () => dbusCallStub(log, 'vk'),
  };
  const manager = vm.runInContext('new DBusManager(__qml)', context);

  /* The old center path deliberately falls through to the focused window. */
  log.splice(0);
  manager.moveMouseToCenter();
  assert.deepEqual(log, [['call', 'center'], ['call', 'focus']]);

  log.splice(0);
  manager.moveMouseToScreenCenter();
  assert.deepEqual(log, [['call', 'screenCenter']]);
});

test('chooser selection ignores disabled layouts and the current layout', () => {
  const context = vm.createContext({
    CONFIG: { layoutOrder: ['TileLayout', 'SpiralLayout'] },
  });
  const calls = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    let current = 'TileLayout';
    const calls = [];
    const driver = Object.create(KWinDriver.prototype);
    driver._disposed = false;
    Object.defineProperty(driver, 'currentSurface', { value: {} });
    driver.engine = {
      layouts: { getCurrentLayout: () => ({ classID: current }) },
      setLayout: (_ctx, id) => { current = id; calls.push(['setLayout', id]); },
      arrange: () => calls.push(['arrange']),
    };
    driver.selectLayoutFromOSD('DisabledLayout');
    driver.selectLayoutFromOSD('TileLayout');
    driver.selectLayoutFromOSD('SpiralLayout');
    return calls;
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['setLayout', 'SpiralLayout'],
    ['arrange'],
  ]);
});

test('engine.setLayout can suppress the shortcut OSD after a chooser click', () => {
  const context = vm.createContext({});
  const calls = vm.runInContext(`${transpile('src/engine/engine.ts')}\n(() => {
    const engine = Object.create(TilingEngine.prototype);
    engine.layouts = {
      setLayout: (_surface, id) => ({ classID: id, description: id }),
    };
    const ctx = {
      currentSurface: {},
      showLayoutShortcut: id => calls.push(id),
    };
    const calls = [];
    engine.setLayout(ctx, 'TileLayout', false);
    engine.setLayout(ctx, 'SpiralLayout');
    return calls;
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['SpiralLayout']);
});

function runtimeFixture() {
  const context = vm.createContext({ KWIN: {} });
  vm.runInContext(transpile('src/driver/kwinruntime.ts'), context);
  return vm.runInContext(`(() => {
    const calls = [];
    const runtime = new KWinRuntime({ kwin: {} });
    runtime.config = { layoutOrder: ['TileLayout', 'SpiralLayout'] };
    runtime.driver = {
      selectLayoutFromOSD: id => calls.push(id),
    };
    return { runtime, calls };
  })()`, context);
}

test('runtime refuses disabled layouts before forwarding the selection', () => {
  const { runtime, calls } = runtimeFixture();
  assert.equal(runtime.selectLayout('MonocleLayout'), false);
  assert.equal(runtime.selectLayout('SpiralLayout'), true);
  assert.deepEqual(Array.from(calls), ['SpiralLayout']);
});

test('chooser auto-hides only after keyboard navigation starts', () => {
  assert.match(chooser, /type: PlasmaCore\.Dialog\.Normal/);
  assert.match(chooser, /flags: Qt\.FramelessWindowHint \| Qt\.WindowStaysOnTopHint \| Qt\.Tool/);
  assert.match(chooser, /outputOnly: false/);
  assert.match(chooser, /signal layoutSelected\(string id\)/);
  assert.match(chooser, /property int hideDelay: 0/);
  assert.match(chooser, /function showLayouts\(entries, selected, area, duration\)/);
  assert.match(chooser, /hideDelay = duration > 0 \? duration : 0;/);
  assert.match(chooser, /hideTimer\.stop\(\);/);
  assert.match(chooser, /layouts = entries;/);
  assert.match(chooser, /selectedLayout = selected;/);
  assert.match(chooser, /model: chooserDialog\.layouts/);
  assert.match(chooser, /chooserDialog\.layoutSelected\(layoutCard\.modelData\.id\);/);
  assert.match(chooser, /chooserDialog\.visible = false;/);
  assert.match(chooser, /Timer\s*\{/);
  assert.match(chooser, /id: hideTimer/);
  assert.match(chooser, /onTriggered: chooserDialog\.visible = false/);
  /* The timer is only armed by navigate(), never by showLayouts(). */
  assert.match(chooser, /function navigate\(dx, dy\)/);
  assert.match(chooser, /hideTimer\.restart\(\);/);
  assert.match(chooser, /onVisibleChanged: \{[\s\S]{0,80}hideTimer\.stop\(\);/);
});

test('chooser navigation moves within rows and clamps at the edges', () => {
  assert.match(chooser, /const rowStart = Math\.floor\(index \/ columns\) \* columns;/);
  assert.match(chooser, /const rowEnd = Math\.min\(layouts\.length - 1, rowStart \+ columns - 1\);/);
  assert.match(chooser, /next = Math\.min\(rowEnd, Math\.max\(rowStart, index \+ dx\)\);/);
  assert.match(chooser, /next = Math\.min\(layouts\.length - 1, Math\.max\(0, index \+ dy \* columns\)\);/);
  assert.match(chooser, /if \(next !== index\) \{[\s\S]{0,100}layoutSelected\(selectedLayout\);/);
});

test('hovering a card uses the active layout color for its border', () => {
  assert.match(
    chooser,
    /property color activeLayoutColor: Kirigami\.Theme\.highlightColor/,
  );
  assert.match(chooser, /id: cardMouseArea/);
  assert.match(chooser, /hoverEnabled: true/);
  assert.match(
    chooser,
    /border\.color: \(modelData\.id === chooserDialog\.selectedLayout[\s\S]{0,120}chooserDialog\.activeLayoutColor/,
  );
  assert.doesNotMatch(chooser, /layoutIconFrame|tintWithAlpha/);
  assert.match(chooser, /onClicked: \{[\s\S]*?layoutSelected\(layoutCard\.modelData\.id\)/);
});

test('main.qml wires chooser clicks and keyboard navigation to the runtime', () => {
  assert.match(main, /id: layoutChooserDialog[\s\S]*?source: "layoutchooser\.qml"/);
  assert.match(main, /function showLayouts\(entries, selected, duration\) \{[\s\S]*?this\.item\.showLayouts\(entries, selected, area, duration\);/);
  assert.match(main, /function isOpen\(\) \{\s*return this\.item \? this\.item\.visible : false;/);
  assert.match(main, /function hide\(\) \{\s*if \(this\.item\) this\.item\.visible = false;/);
  assert.match(main, /function navigate\(dx, dy\) \{\s*if \(this\.item\) this\.item\.navigate\(dx, dy\);/);
  assert.match(main, /target: layoutChooserDialog\.item[\s\S]*?function onLayoutSelected\(id\) \{[\s\S]*?runtime\.selectLayout\(id\);/);
});

test('LayoutChooserSC is bound to the LayoutChooser action', () => {
  const handler = shortcuts.match(/ShortcutHandler\s*\{\s*id: layoutChooser;([\s\S]*?)\n\s*\}/);
  assert.ok(handler);
  assert.match(handler[0], /name: "KrohnkiteLayoutChooser"/);
  assert.match(handler[0], /text: "Krohnkite: Layout Chooser"/);
  assert.match(handler[0], /sequence: ""/);
  assert.match(shortcuts, /\{ name: "LayoutChooserSC", hdl: layoutChooser \}/);
  assert.match(
    shortcutMap,
    /LayoutChooserSC:\s*\{\s*defaultAction: KrohnkiteAction\.LayoutChooser,\s*defaultRegisterAction: null,/,
  );
});
