/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const KEY = 'movePointerOnFocusShortcutsOnly';

test(`${KEY} is wired through xml, ui, ConfigVariables and kwinconfig`, () => {
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
    new RegExp(
      `<entry name="${KEY}" type="Bool">\\s*` +
        `<label>[^<]+</label>\\s*<default>false</default>\\s*</entry>`,
    ),
    KEY,
  );

  const checkboxBlock = ui.match(
    new RegExp(`<widget class="QCheckBox" name="kcfg_${KEY}">[\\s\\S]*?</widget>`),
  );
  assert.ok(checkboxBlock, `kcfg_${KEY} checkbox missing`);
  assert.match(
    checkboxBlock[0],
    /<property name="enabled">\s*<bool>false<\/bool>\s*<\/property>/,
    'dependent option must start disabled',
  );
  assert.match(
    checkboxBlock[0],
    /<property name="text">\s*<string>[^<]+<\/string>\s*<\/property>/,
    'checkbox text missing',
  );

  assert.match(
    ui,
    new RegExp(
      `<connection>\\s*<sender>kcfg_movePointerOnFocus</sender>\\s*` +
        `<signal>toggled\\(bool\\)</signal>\\s*` +
        `<receiver>kcfg_${KEY}</receiver>\\s*` +
        `<slot>setEnabled\\(bool\\)</slot>\\s*</connection>`,
    ),
    'dependent option must follow its parent checkbox',
  );

  assert.match(types, new RegExp(`\\b${KEY}: "${KEY}"`));
  assert.match(common, new RegExp(`\\b${KEY}: boolean;`));
  assert.match(
    kwinconfig,
    new RegExp(`readConfig\\(\\s*"${KEY}",\\s*false,?\\s*\\)`),
    'config entry must be read with the same default as config.xml',
  );
});

test(`${KEY} suppresses the automatic focus warp`, () => {
  const driver = fs.readFileSync(
    path.join(ROOT, 'src/driver/kwindriver.ts'),
    'utf8',
  );

  /* Presence check only: the shared focus funnel must drop a focus change
   * that did not come from a shortcut, otherwise the option would have no
   * effect. */
  assert.match(
    driver,
    /CONFIG\.movePointerOnFocusShortcutsOnly && !byShortcut/,
  );
});
