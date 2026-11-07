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

const LAYOUT_CLASSES = [
  'TileLayout',
  'MonocleLayout',
  'ThreeColumnLayout',
  'SpiralLayout',
  'QuarterLayout',
  'StackedLayout',
  'ColumnsLayout',
  'SpreadLayout',
  'FloatingLayout',
  'StairLayout',
  'BinaryTreeLayout',
  'CascadeLayout',
  /* Kröhnkite-Plus */
  'SmartLayout',
];

function buildConfig(values = {}) {
  const context = vm.createContext({ __values: values });
  const definitions = fs
    .readFileSync(path.join(ROOT, 'src/_types.ts'), 'utf8')
    .match(/const ConfigVariables = \{[\s\S]*?\n\} as const;/)[0];
  const source = fs.readFileSync(
    path.join(ROOT, 'src/driver/kwinconfig.ts'),
    'utf8',
  );
  /* Kröhnkite-Plus: the configuration parses the window rules */
  const rules = fs.readFileSync(
    path.join(ROOT, 'src/engine/windowrules.ts'),
    'utf8',
  );
  const transpiled = ts.transpileModule(`${definitions}\n${source}\n${rules}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2015 },
  }).outputText;

  vm.runInContext(`${transpiled}
    class Err {
      constructor(message) { this.message = message; }
    }
    function warning() {}
    function unCapitalize(id) {
      return id.charAt(0).toLowerCase() + id.slice(1);
    }
    function separate(str, separator) {
      if (!str || typeof str !== 'string') return [];
      return str.split(separator)
        .map(part => part.trim())
        .filter(part => part !== '');
    }
    function validateNumber(value, min, max) {
      if (typeof value !== 'number' || value < min || value > max)
        return new Err('invalid');
      return value;
    }
    function validateNumberWithDefault(value, defaultValue, _message, min, max) {
      return validateNumber(value, min, max) instanceof Err
        ? defaultValue
        : value;
    }
    function parseShortcutConf() {
      return {};
    }
    function parseFloatConfig() {
      return [];
    }
    function getWindowLayer(index) {
      return index;
    }
    var KWIN = {
      readConfig: (key, fallback) =>
        Object.prototype.hasOwnProperty.call(__values, key)
          ? __values[key]
          : fallback,
    };
    for (const id of ${JSON.stringify(LAYOUT_CLASSES)}) {
      const Layout = class {
        constructor(capacity) { this.capacity = capacity; }
      };
      Layout.id = id;
      this[id] = Layout;
    }
  `, context);

  return vm.runInContext('new KWinConfig()', context);
}

test('layoutOrder contains every enabled layout exactly once', () => {
  const config = buildConfig();

  assert.equal(config.layoutOrder.length, 13);
  assert.equal(new Set(config.layoutOrder).size, 13);
  /* Kröhnkite-Plus: the Smart layout is the default layout */
  assert.equal(config.layoutOrder[0], 'SmartLayout');
});

test('layoutOrder excludes layouts disabled by the enable flag', () => {
  const config = buildConfig({
    tileLayoutEnabled: false,
    monocleLayoutOrder: 12,
  });

  assert.equal(config.layoutOrder.length, 12);
  assert.equal(new Set(config.layoutOrder).size, 12);
  assert.equal(config.layoutOrder.includes('TileLayout'), false);
  assert.equal(config.layoutOrder[0], 'SmartLayout');
  assert.equal(config.layoutOrder[1], 'ThreeColumnLayout');
  assert.ok(
    config.layoutOrder.indexOf('MonocleLayout') >
      config.layoutOrder.indexOf('BinaryTreeLayout'),
  );
});

test('layoutOrder excludes layouts disabled even when an order is set', () => {
  const config = buildConfig({
    tileLayoutEnabled: false,
    tileLayoutOrder: 1,
  });

  assert.equal(config.layoutOrder.length, 12);
  assert.equal(config.layoutOrder.includes('TileLayout'), false);
});

test('layout order zero no longer disables a layout', () => {
  const config = buildConfig({ tileLayoutOrder: 0 });

  assert.equal(config.layoutOrder.length, 13);
  assert.equal(config.layoutOrder.includes('TileLayout'), true);
  /* the invalid order falls back to 1; the Smart layout keeps 1 as well and
     wins the tie */
  assert.equal(config.layoutOrder[0], 'SmartLayout');
  assert.equal(config.layoutOrder[1], 'TileLayout');
});

test('layoutOrder falls back to TileLayout when every layout is disabled', () => {
  const values = {};
  for (const id of LAYOUT_CLASSES) {
    values[`${id.charAt(0).toLowerCase()}${id.slice(1)}Enabled`] = false;
  }

  const config = buildConfig(values);

  assert.deepEqual([...config.layoutOrder], ['TileLayout']);
});

test('layoutOrder keeps the configured cycle order', () => {
  const config = buildConfig({
    tileLayoutOrder: 2,
    cascadeLayoutOrder: 1,
    smartLayoutOrder: 13,
  });

  assert.equal(config.layoutOrder[0], 'CascadeLayout');
  assert.deepEqual(
    [...config.layoutOrder],
    [
      'CascadeLayout',
      'TileLayout',
      'MonocleLayout',
      'ThreeColumnLayout',
      'SpiralLayout',
      'QuarterLayout',
      'StackedLayout',
      'ColumnsLayout',
      'SpreadLayout',
      'FloatingLayout',
      'StairLayout',
      'BinaryTreeLayout',
      'SmartLayout',
    ],
  );
});

test('layout enable flags are wired through xml, ui and ConfigVariables', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'res/config.xml'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');
  const types = fs.readFileSync(path.join(ROOT, 'src/_types.ts'), 'utf8');

  for (const id of LAYOUT_CLASSES) {
    const prefix = `${id.charAt(0).toLowerCase()}${id.slice(1)}`;
    const enabledKey = `${prefix}Enabled`;
    const orderKey = `${prefix}Order`;

    assert.match(
      xml,
      new RegExp(
        `<entry name="${enabledKey}" type="Bool">\\s*` +
          `<label>[^<]+</label>\\s*<default>true</default>\\s*</entry>`,
      ),
      enabledKey,
    );
    assert.match(types, new RegExp(`\\b${enabledKey}: "${enabledKey}"`));
    assert.doesNotMatch(
      ui,
      new RegExp(`<widget class="QGroupBox" name="kcfg_${enabledKey}">`),
      enabledKey,
    );

    const checkboxBlock = ui.match(
      new RegExp(
        `<widget class="QCheckBox" name="kcfg_${enabledKey}">[\\s\\S]*?</widget>`,
      ),
    );
    assert.ok(checkboxBlock, `${enabledKey} checkbox missing`);
    assert.match(
      checkboxBlock[0],
      /<property name="checked">\s*<bool>true<\/bool>\s*<\/property>/,
      enabledKey,
    );
    const accessibleName = checkboxBlock[0].match(
      /<property name="accessibleName">\s*<string>([^<]+)<\/string>/,
    );
    assert.ok(accessibleName, `${enabledKey} accessibleName missing`);
    assert.equal(
      accessibleName[1],
      id.replace(/([a-z])([A-Z])/g, '$1 $2'),
      enabledKey,
    );

    const orderBlock = ui.match(
      new RegExp(
        `<widget class="QSpinBox" name="kcfg_${orderKey}">[\\s\\S]*?</widget>`,
      ),
    );
    assert.ok(orderBlock, orderKey);
    assert.match(
      orderBlock[0],
      /<property name="minimum">\s*<number>1<\/number>\s*<\/property>/,
      orderKey,
    );
    assert.doesNotMatch(orderBlock[0], /0 - to disable/, orderKey);
    assert.match(
      orderBlock[0],
      /<string>Order in layout rotation<\/string>/,
      orderKey,
    );
  }
});

test('layout settings blocks follow their enable checkbox', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');
  const pairs = [
    ['tileLayoutEnabled', 'GB_1_TileLayoutSettings'],
    ['monocleLayoutEnabled', 'GB_2_MonocleLayoutSettings'],
    ['quarterLayoutEnabled', 'GB_5_QuarterLayoutSettings'],
    ['columnsLayoutEnabled', 'GB_7_columnsLayoutSettings'],
    ['spreadLayoutEnabled', 'GB_8_spreadLayoutSettings'],
    ['stairLayoutEnabled', 'GB_a_stairLayoutSettings'],
  ];

  for (const [sender, receiver] of pairs) {
    assert.match(
      ui,
      new RegExp(
        `<connection>\\s*<sender>kcfg_${sender}</sender>\\s*` +
          `<signal>toggled\\(bool\\)</signal>\\s*` +
          `<receiver>${receiver}</receiver>\\s*` +
          `<slot>setEnabled\\(bool\\)</slot>\\s*</connection>`,
      ),
      sender,
    );
  }
});
