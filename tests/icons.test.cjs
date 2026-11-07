/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const INSTALLER = path.join(ROOT, 'tools/install-icons.py');
const PYTHON = process.env.PYTHON || 'python3';
const APP_ICON = 'krohnkite';
const APP_ICON_SOURCE = path.join(ROOT, 'res/appicon', `${APP_ICON}.svg`);
const LAYOUTS = [
  'tile', 'monocle', 'threecolumn', 'spiral', 'quarter', 'stacked',
  'columns', 'spread', 'floating', 'stair', 'binarytree', 'cascade',
];
const LAYOUT_LABELS = {
  tile: 'Tile',
  monocle: 'Monocle',
  threecolumn: 'Three Column',
  spiral: 'Spiral',
  quarter: 'Quarter',
  stacked: 'Stacked',
  columns: 'Columns',
  spread: 'Spread',
  floating: 'Floating',
  stair: 'Stair',
  binarytree: 'Binary Tree',
  cascade: 'Cascade',
};
const MARKER = 'icons/hicolor/.krohnkite-icons.pending';
const LEGACY_MARKER = 'icons/hicolor/.krohnkite-layout-icons.pending';
const REFRESH_ARGS = ['forceupdate', '--mode', 'user', '--theme', 'hicolor'];
const WORKING_REFRESH_STUB = `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.ICON_REFRESH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`;
const FAILING_REFRESH_STUB = '#!/usr/bin/env node\nprocess.exit(1);\n';

function withSandbox(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'krohnkite-icons-'));
  const dataHome = path.join(directory, 'data');
  const bin = path.join(directory, 'bin');
  const refreshLog = path.join(directory, 'refresh.log');
  fs.mkdirSync(bin);
  const refreshStub = path.join(bin, 'xdg-icon-resource');
  fs.writeFileSync(refreshStub, WORKING_REFRESH_STUB);
  fs.chmodSync(refreshStub, 0o755);
  const env = {
    ...process.env,
    XDG_DATA_HOME: dataHome,
    ICON_REFRESH_LOG: refreshLog,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
  };
  const spawnInstaller = (installer, ...args) => spawnSync(PYTHON, [installer, ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env,
  });
  const invoke = (...args) => spawnInstaller(INSTALLER, ...args);
  try {
    run({ directory, dataHome, refreshLog, refreshStub, invoke, spawnInstaller });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function refreshes(log) {
  return fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
}

function iconDirectory(dataHome) {
  return path.join(dataHome, 'icons/hicolor/scalable/actions');
}

function appIconDirectory(dataHome) {
  return path.join(dataHome, 'icons/hicolor/scalable/apps');
}

function stagePackage(directory) {
  const packageRoot = path.join(directory, 'package');
  const codeDirectory = path.join(packageRoot, 'contents/code');
  const layoutDirectory = path.join(packageRoot, 'contents/ui/layouts');
  const appDirectory = path.join(packageRoot, 'contents/ui/appicon');
  fs.mkdirSync(codeDirectory, { recursive: true });
  fs.mkdirSync(layoutDirectory, { recursive: true });
  fs.mkdirSync(appDirectory, { recursive: true });

  const installer = path.join(codeDirectory, 'install-icons.py');
  fs.copyFileSync(INSTALLER, installer);
  for (const name of LAYOUTS) {
    fs.copyFileSync(
      path.join(ROOT, 'res/layouts', `${name}.svg`),
      path.join(layoutDirectory, `${name}.svg`),
    );
  }
  fs.copyFileSync(APP_ICON_SOURCE, path.join(appDirectory, `${APP_ICON}.svg`));
  return installer;
}

test('installs original SVG bytes under every theme name', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    for (const name of LAYOUTS) {
      const installed = path.join(iconDirectory(dataHome), `krohnkite-layout-${name}.svg`);
      assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(ROOT, 'res/layouts', `${name}.svg`)));
    }
    assert.deepEqual(
      fs.readFileSync(path.join(appIconDirectory(dataHome), `${APP_ICON}.svg`)),
      fs.readFileSync(APP_ICON_SOURCE),
    );
    assert.match(result.stdout, /13 updated/);
    const refreshCalls = refreshes(refreshLog);
    assert.equal(refreshCalls.length, 1);
    assert.deepEqual(refreshCalls[0], REFRESH_ARGS);
    assert.equal(fs.existsSync(path.join(dataHome, 'icons/hicolor/index.theme')), false);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), false);
  });
});

test('unchanged installation preserves files and does not refresh icons', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    assert.equal(invoke().status, 0);
    const installed = path.join(iconDirectory(dataHome), 'krohnkite-layout-tile.svg');
    const originalContent = fs.readFileSync(installed);
    const before = fs.statSync(installed);
    const refreshCount = refreshes(refreshLog).length;
    const result = invoke();
    const after = fs.statSync(installed);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'Kröhnkite SVG theme icons: 0 updated');
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ino, before.ino);
    assert.deepEqual(fs.readFileSync(installed), originalContent);
    assert.equal(refreshes(refreshLog).length, refreshCount);
  });
});

test('repairs a corrupted installed icon and refreshes once', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    assert.equal(invoke().status, 0);
    const installed = path.join(iconDirectory(dataHome), 'krohnkite-layout-tile.svg');
    fs.writeFileSync(installed, '<svg>corrupted</svg>');
    const refreshCount = refreshes(refreshLog).length;
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(ROOT, 'res/layouts/tile.svg')));
    assert.equal(refreshes(refreshLog).length, refreshCount + 1);
  });
});

test('retries a failed icon cache refresh on the next run', () => {
  withSandbox(({ dataHome, refreshLog, refreshStub, invoke }) => {
    fs.writeFileSync(refreshStub, FAILING_REFRESH_STUB);
    fs.chmodSync(refreshStub, 0o755);

    const failed = invoke();
    assert.equal(failed.status, 0, failed.stderr);
    assert.match(failed.stderr, /could not refresh the icon cache/);
    assert.equal(refreshes(refreshLog).length, 0);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), true);

    fs.writeFileSync(refreshStub, WORKING_REFRESH_STUB);
    fs.chmodSync(refreshStub, 0o755);

    const retried = invoke();
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(refreshes(refreshLog).length, 1);
    assert.deepEqual(refreshes(refreshLog)[0], REFRESH_ARGS);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), false);
  });
});

test('retries a failed cache refresh on uninstall', () => {
  withSandbox(({ dataHome, refreshLog, refreshStub, invoke }) => {
    assert.equal(invoke().status, 0);
    const refreshesAfterInstall = refreshes(refreshLog).length;

    fs.writeFileSync(refreshStub, FAILING_REFRESH_STUB);
    fs.chmodSync(refreshStub, 0o755);
    const failed = invoke('--uninstall');
    assert.equal(failed.status, 0, failed.stderr);
    assert.match(failed.stderr, /could not refresh the icon cache/);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), true);

    fs.writeFileSync(refreshStub, WORKING_REFRESH_STUB);
    fs.chmodSync(refreshStub, 0o755);
    const retried = invoke('--uninstall');
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(refreshes(refreshLog).length, refreshesAfterInstall + 1);
    assert.deepEqual(refreshes(refreshLog).at(-1), REFRESH_ARGS);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), false);
  });
});

test('uninstall removes only Krohnkite icons and is idempotent', () => {
  withSandbox(({ dataHome, invoke }) => {
    assert.equal(invoke().status, 0);
    const unrelated = path.join(iconDirectory(dataHome), 'other-application.svg');
    const unrelatedApp = path.join(appIconDirectory(dataHome), 'other-application.svg');
    const metadata = path.join(dataHome, 'icons/hicolor/index.theme');
    const obsolete = path.join(iconDirectory(dataHome), 'krohnkite-layout-obsolete.svg');
    fs.writeFileSync(unrelated, 'keep icon');
    fs.writeFileSync(unrelatedApp, 'keep icon');
    fs.writeFileSync(metadata, 'keep theme metadata');
    fs.writeFileSync(obsolete, 'obsolete icon');
    const removed = invoke('--uninstall');
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(removed.stdout.trim(), 'Kröhnkite SVG theme icons: 14 removed');
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep icon');
    assert.equal(fs.readFileSync(unrelatedApp, 'utf8'), 'keep icon');
    assert.equal(fs.readFileSync(metadata, 'utf8'), 'keep theme metadata');
    assert.equal(fs.existsSync(obsolete), false);
    assert.equal(fs.existsSync(path.join(appIconDirectory(dataHome), `${APP_ICON}.svg`)), false);
    const second = invoke('--uninstall');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), 'Kröhnkite SVG theme icons: 0 removed');
  });
});

test('metadata publishes the installed app icon name', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'res/metadata.json'), 'utf8'));
  assert.equal(metadata.KPlugin.Icon, APP_ICON);
});

test('a pending refresh from an earlier release is replaced by the current marker', () => {
  withSandbox(({ dataHome, refreshStub, invoke }) => {
    const legacy = path.join(dataHome, LEGACY_MARKER);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '');
    fs.writeFileSync(refreshStub, FAILING_REFRESH_STUB);
    fs.chmodSync(refreshStub, 0o755);
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), true);
  });
});

test('missing source fails before creating data directories or refreshing icons', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    const result = invoke('--source', path.join(os.tmpdir(), `missing-layouts-${process.pid}`));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing SVG icon/);
    assert.equal(fs.existsSync(dataHome), false);
    assert.equal(refreshes(refreshLog).length, 0);

    const missingApp = invoke('--app-source', path.join(os.tmpdir(), `missing-appicon-${process.pid}`));
    assert.notEqual(missingApp.status, 0);
    assert.match(missingApp.stderr, /Missing SVG icon/);
    assert.equal(fs.existsSync(dataHome), false);
    assert.equal(refreshes(refreshLog).length, 0);
  });
});

test('installs from the packaged contents/ui sources', () => {
  withSandbox(({ directory, dataHome, refreshLog, spawnInstaller }) => {
    const packagedInstaller = stagePackage(directory);
    const result = spawnInstaller(packagedInstaller);

    assert.equal(result.status, 0, result.stderr);
    for (const name of LAYOUTS) {
      assert.deepEqual(
        fs.readFileSync(path.join(iconDirectory(dataHome), `krohnkite-layout-${name}.svg`)),
        fs.readFileSync(path.join(ROOT, 'res/layouts', `${name}.svg`)),
      );
    }
    assert.deepEqual(
      fs.readFileSync(path.join(appIconDirectory(dataHome), `${APP_ICON}.svg`)),
      fs.readFileSync(APP_ICON_SOURCE),
    );
    assert.match(result.stdout, /13 updated/);
    assert.equal(refreshes(refreshLog).length, 1);
    assert.equal(fs.existsSync(path.join(dataHome, MARKER)), false);
  });
});

test('go-task packaging copies the icon installer, layout SVGs and app icon', () => {
  const taskfile = fs.readFileSync(path.join(ROOT, 'taskfile.yaml'), 'utf8');
  assert.match(taskfile, /cp tools\/install-icons\.py \{\{\.KWINPKG_DIR\}\}\/contents\/code\/install-icons\.py/);
  assert.match(taskfile, /cp -r res\/layouts \{\{\.KWINPKG_DIR\}\}\/contents\/ui\//);
  assert.match(taskfile, /cp -r res\/appicon \{\{\.KWINPKG_DIR\}\}\/contents\/ui\//);
});

test('loads the Plasma5Support icon installer through an isolated Loader', () => {
  const main = fs.readFileSync(path.join(ROOT, 'res/main.qml'), 'utf8');
  const installer = fs.readFileSync(path.join(ROOT, 'res/iconinstaller.qml'), 'utf8');
  const makefile = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');

  assert.doesNotMatch(main, /import org.kde.plasma.plasma5support/);
  assert.match(main, /id: iconInstaller/);
  assert.match(main, /source: "iconinstaller\.qml"/);
  assert.match(main, /onLoaded:\s*item\.install\(\)/);
  assert.match(main, /status === Loader\.Error/);
  assert.doesNotMatch(main, /iconInstaller\.item/);
  assert.match(installer, /import org.kde.plasma.plasma5support as Plasma5Support/);
  assert.ok(installer.includes('Qt.resolvedUrl("../code/install-icons.py")'));
  assert.ok(makefile.includes('contents/ui/iconinstaller.qml: res/iconinstaller.qml'));
  assert.ok(makefile.includes('contents/ui/appicon/%.svg: res/appicon/%.svg'));
});

test('settings use SVG theme references for every layout pictogram', () => {
  const source = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');
  assert.doesNotMatch(source, /data:image\//);
  const accessibleNames = [];
  for (const name of LAYOUTS) {
    const widget = source.match(new RegExp(`<widget\\b(?=[^>]*\\bname="${name}LayoutPictogram")[^>]*>([\\s\\S]*?)<\\/widget>`));
    assert.ok(widget, `${name} pictogram widget missing`);
    assert.match(widget[0], /class="QToolButton"/);
    assert.match(widget[1], new RegExp(`<iconset\\b[^>]*\\btheme="krohnkite-layout-${name}"`));
    assert.match(widget[1], /<property name="focusPolicy"><enum>Qt::FocusPolicy::NoFocus<\/enum><\/property>/);

    const accessibleName = widget[1].match(/<property name="accessibleName"><string>([^<]+)<\/string><\/property>/);
    assert.ok(accessibleName, `${name} accessibleName missing`);
    assert.equal(accessibleName[1], `${LAYOUT_LABELS[name]} Layout preview`);
    accessibleNames.push(accessibleName[1]);

    assert.doesNotMatch(widget[1], /<property name="toolTip">/, `${name} toolTip should be removed`);
    assert.match(widget[1], /<property name="styleSheet">\s*<string notr="true">QToolButton \{ border: none; background: transparent; \} QToolButton:hover \{ border: none; background: transparent; \} QToolButton:pressed \{ border: none; background: transparent; \}<\/string>/);
  }
  assert.equal(new Set(accessibleNames).size, LAYOUTS.length);
});

const hasPySide6 = spawnSync(PYTHON, ['-c', 'import importlib.util; print("yes" if importlib.util.find_spec("PySide6") else "no")'], { encoding: 'utf8' });
const nativeSkip = hasPySide6.status === 0 && hasPySide6.stdout.trim() === 'yes'
  ? false
  : 'Optional native Qt UI test requires PySide6';

test('Qt UI loader renders all installed theme SVGs and paints buttons without package working directory', { skip: nativeSkip }, () => {
  withSandbox(({ dataHome, invoke }) => {
    const install = invoke();
    assert.equal(install.status, 0, install.stderr);
    // Qt needs a theme index to enumerate icon directories; desktop environments
    // ship one for hicolor, an isolated test sandbox does not.
    const themeRoot = path.join(dataHome, 'icons/hicolor');
    assert.equal(fs.existsSync(path.join(themeRoot, 'index.theme')), false);
    fs.writeFileSync(path.join(themeRoot, 'index.theme'), [
      '[Icon Theme]',
      'Name=Hicolor',
      'Directories=scalable/actions,scalable/apps',
      '',
      '[scalable/actions]',
      'Size=64',
      'Type=Scalable',
      'Context=Actions',
      '',
      '[scalable/apps]',
      'Size=64',
      'Type=Scalable',
      'Context=Applications',
      '',
    ].join('\n'));
    const script = String.raw`
import os, sys
from PySide6.QtCore import QFile, QIODevice
from PySide6.QtGui import QIcon
from PySide6.QtUiTools import QUiLoader
from PySide6.QtWidgets import QApplication, QCheckBox, QGroupBox, QLabel, QSpinBox, QToolButton
root, data_home = sys.argv[1:]
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
app = QApplication.instance() or QApplication([])
QIcon.setThemeSearchPaths([os.path.join(data_home, "icons")] + QIcon.themeSearchPaths())
QIcon.setThemeName("hicolor")
app_icon = QIcon.fromTheme("krohnkite")
assert not app_icon.isNull(), "app icon is not resolved from the theme"
assert app_icon.pixmap(64, 64).toImage() == QIcon(os.path.join(root, "res/appicon/krohnkite.svg")).pixmap(64, 64).toImage(), "app icon render mismatch"
loader = QUiLoader()
ui_file = QFile(os.path.join(root, "res/config.ui"))
assert ui_file.open(QIODevice.OpenModeFlag.ReadOnly), "could not open settings UI"
form = loader.load(ui_file)
ui_file.close()
assert form is not None, loader.errorString()
layouts = [
    ("tile", "Tile Layout", "tileLayout", "GB_1_TileLayout", "GB_1_TileLayoutSettings", "label_35", "label_39", "label_41", True),
    ("monocle", "Monocle Layout", "monocleLayout", "GB_2_MonocleLayout", "GB_2_MonocleLayoutSettings", "label_36", "label_46", None, False),
    ("threecolumn", "Three Column Layout", "threeColumnLayout", "GB_3_threeColumnLayout", None, "label_37", "label_47", "label_42", True),
    ("spiral", "Spiral Layout", "spiralLayout", "GB_4_spiralLayout", None, "label_38", "label_48", "label_43", True),
    ("quarter", "Quarter Layout", "quarterLayout", "GB_5_QuarterLayout", "GB_5_QuarterLayoutSettings", "label_45", "label_49", None, False),
    ("stacked", "Stacked Layout", "stackedLayout", "GB_6_stackedLayout", None, "label_50", "label_51", "label_44", True),
    ("columns", "Columns Layout", "columnsLayout", "GB_7_columnsLayout", "GB_7_columnsLayoutSettings", "label_52", "label_53", "label_54", True),
    ("spread", "Spread Layout", "spreadLayout", "GB_8_spreadLayout", "GB_8_spreadLayoutSettings", "label_105", "label_106", "label_55", True),
    ("floating", "Floating Layout", "floatingLayout", "GB_9_floatingLayout", None, "label_103", "label_104", None, False),
    ("stair", "Stair Layout", "stairLayout", "GB_a_stairLayout", "GB_a_stairLayoutSettings", "label_109", "label_110", "label_56", True),
    ("binarytree", "Binary Tree Layout", "binaryTreeLayout", "GB_b_binaryTreeLayout", None, "label_111", "label_112", "label_57", True),
    ("cascade", "Cascade Layout", "cascadeLayout", "GB_c_cascadeLayout", None, "label_113", "label_114", "label_58", True),
]
for name, title, prefix, group_name, settings_group, title_label_name, order_label_name, capacity_label_name, has_capacity in layouts:
    button = form.findChild(QToolButton, name + "LayoutPictogram")
    assert button is not None, name
    assert button.accessibleName(), name
    assert not button.toolTip(), name
    assert "border: none" in button.styleSheet(), name
    assert "background: transparent" in button.styleSheet(), name
    assert not button.icon().isNull(), name
    image = button.icon().pixmap(48, 32).toImage()
    expected = QIcon(os.path.join(root, "res/layouts", name + ".svg")).pixmap(48, 32).toImage()
    assert not image.isNull() and image == expected, name
    assert any(image.pixelColor(x, y).alpha() > 0 for y in range(image.height()) for x in range(image.width())), name
    button.resize(56, 40)
    painted = button.grab().toImage()
    solid = next((image.pixelColor(x, y).rgb() for y in range(image.height()) for x in range(image.width()) if image.pixelColor(x, y).alpha() == 255), None)
    assert solid is not None, name
    assert any(painted.pixelColor(x, y).rgb() == solid for y in range(painted.height()) for x in range(painted.width())), name

    checkbox = form.findChild(QCheckBox, "kcfg_" + prefix + "Enabled")
    assert checkbox is not None, name
    assert checkbox.isChecked(), name
    assert checkbox.accessibleName() == title, name
    group = form.findChild(QGroupBox, group_name)
    assert group is not None, name
    assert not group.isCheckable(), name
    title_label = form.findChild(QLabel, title_label_name)
    order_label = form.findChild(QLabel, order_label_name)
    capacity_label = form.findChild(QLabel, capacity_label_name) if capacity_label_name else None
    order = form.findChild(QSpinBox, "kcfg_" + prefix + "Order")
    capacity = form.findChild(QSpinBox, "kcfg_" + prefix + "Capacity") if has_capacity else None
    settings = form.findChild(QGroupBox, settings_group) if settings_group else None
    assert title_label is not None, name
    assert title_label.text() == title, name
    assert title_label.buddy() is checkbox, name
    assert order_label is not None, name
    assert order is not None, name
    checkbox.setChecked(False)
    assert group.isEnabled(), name
    assert checkbox.isEnabled(), name
    assert not title_label.isEnabled(), name
    assert not order_label.isEnabled(), name
    assert not order.isEnabled(), name
    assert not button.isEnabled(), name
    if capacity_label is not None:
        assert not capacity_label.isEnabled(), name
    if capacity is not None:
        assert not capacity.isEnabled(), name
    if settings is not None:
        assert not settings.isEnabled(), name
    if prefix == "spreadLayout":
        space = form.findChild(QSpinBox, "kcfg_spreadLayoutSpace")
        assert space is not None, name
        assert not space.isEnabled(), name
    checkbox.setChecked(True)
    assert title_label.isEnabled(), name
    assert order_label.isEnabled(), name
    assert order.isEnabled(), name
    assert button.isEnabled(), name
    if capacity_label is not None:
        assert capacity_label.isEnabled(), name
    if capacity is not None:
        assert capacity.isEnabled(), name
    if settings is not None:
        assert settings.isEnabled(), name
    if prefix == "spreadLayout":
        assert space.isEnabled(), name
pointer_on_focus = form.findChild(QCheckBox, "kcfg_movePointerOnFocus")
shortcut_only = form.findChild(QCheckBox, "kcfg_movePointerOnFocusShortcutsOnly")
assert pointer_on_focus is not None, "kcfg_movePointerOnFocus missing"
assert shortcut_only is not None, "kcfg_movePointerOnFocusShortcutsOnly missing"
assert not shortcut_only.isEnabled(), "dependent option must start disabled"
pointer_on_focus.setChecked(True)
assert shortcut_only.isEnabled(), "dependent option must follow its parent"
pointer_on_focus.setChecked(False)
assert not shortcut_only.isEnabled(), "dependent option must follow its parent"
form.deleteLater()
`;
    const result = spawnSync(PYTHON, ['-c', script, ROOT, dataHome], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, XDG_DATA_HOME: dataHome, QT_QPA_PLATFORM: 'offscreen' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});
