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

function buildLayoutStore() {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(ROOT, 'src/engine/layoutstore.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
  const context = vm.createContext({
    CONFIG: {
      layoutOrder: ['TileLayout'],
      layoutFactories: {},
      screenDefaultLayout: [],
    },
    FloatingLayout: { instance: {} },
    KWinSurface: { generateId: () => 'surface' },
    print: () => {},
    wrapIndex: (index, length) => ((index % length) + length) % length,
  });
  vm.runInContext(`${source}\nthis.layoutStore = new LayoutStore();`, context);
  return context;
}

test('setLayout ignores layouts that are not enabled', () => {
  const context = buildLayoutStore();

  const result = vm.runInContext(
    "this.layoutStore.setLayout({ ignore: false }, 'DisabledLayout')",
    context,
  );

  assert.equal(result, null);
});
