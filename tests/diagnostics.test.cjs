const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'tools/collect-diagnostics.py');
const fixtures = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeExecutable(filename, content) {
  fs.writeFileSync(filename, content);
  fs.chmodSync(filename, 0o755);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fixture({ withQdbus = true, withKscreen = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'krohnkite diagnostics '));
  fixtures.push(directory);

  const home = path.join(directory, 'home');
  const config = path.join(home, '.config');
  const data = path.join(home, '.local/share');
  const out = path.join(directory, 'out');
  const bin = path.join(directory, 'bin');
  for (const directoryName of [
    config,
    path.join(data, 'kwin/scripts/krohnkite'),
    path.join(data, 'kwin/scripts/huake'),
    out,
    bin,
  ]) {
    fs.mkdirSync(directoryName, { recursive: true });
  }

  const username = 'fixtureuser';
  const hostname = os.hostname();
  const privateUuid = '01234567-89ab-cdef-0123-456789abcdef';
  const privateIp = '10.0.0.1';
  const privateMac = 'aa:bb:cc:dd:ee:ff';
  const privateEmail = 'user@example.com';

  const kwinrc = `[Plugins]
krohnkiteEnabled=true
huakeEnabled=true
blurEnabled=true

[Script-krohnkite]
tileLayoutEnabled=true
ignoreTitle=Top Secret Project
floatConfig=secretapp:Top Secret Window
screenDefaultLayout=DP-2:${privateUuid}:Secret Desktop:spread
ignoreActivity=Secret Activity
ignoreVDesktop=Secret Desktop
ignoreScreen=DP-2
logFilterStr=Top Secret Filter
ignoreClass=example,${privateIp},${privateMac},${privateEmail},${home},${username},hosttoken ${hostname}
debugActiveWin=true
floatingTitle=Legacy Secret Caption
`;
  fs.writeFileSync(path.join(config, 'kwinrc'), kwinrc);

  const shortcuts = String.raw`[kwin]
KrohnkiteFocusNext=Meta+.\tMeta+Ctrl+F10,none,Krohnkite: Focus Next
KrohnkiteFocusPrev=Meta+\\,\tMeta+Ctrl+F9,none,Krohnkite: Focus Previous
KrohnkiteFocusDown=Meta+J,none,Krohnkite: Focus Down
OtherFocus=Meta+J,none,Other: Focus
`;
  fs.writeFileSync(path.join(config, 'kglobalshortcutsrc'), shortcuts);

  fs.writeFileSync(
    path.join(data, 'kwin/scripts/krohnkite/metadata.json'),
    JSON.stringify({
      KPlugin: {
        Name: 'Krohnkite',
        Version: '0.9.11.0',
        Description: 'A dynamic tiling script for KWin (4197587)',
      },
    }),
  );
  fs.writeFileSync(
    path.join(data, 'kwin/scripts/huake/metadata.json'),
    JSON.stringify({
      KPlugin: { Name: 'Huake', Version: '1.0.0' },
    }),
  );

  const kscreen = `
\x1b[01;32mOutput: \x1b[0;0m1 DP-2 ${privateUuid}
\tenabled
\tconnected
\tpriority 1
\tGeometry: 0,0 3440x1440
\tScale: 1
\tRotation: 1
\tModel: Secret Monitor
\tSerial: SECRET-SERIAL
\tEDID: SECRET-EDID
\tModes: 30:3440x1440@50.00 34:3440x1440@60.00*
\x1b[01;32mOutput: \x1b[0;0m2 HDMI-A-1 11111111-2222-3333-4444-555555555555
\tenabled
\tconnected
\tpriority 2
\tGeometry: 3440,0 1920x1080
\tScale: 1.25
\tRotation: 2
\tModes: 1:1920x1080@60.00*!
`;
  if (withKscreen) {
    writeExecutable(
      path.join(bin, 'kscreen-doctor'),
      `#!/bin/sh\ncat <<'KROHNKITE_EOF'\n${kscreen}\nKROHNKITE_EOF\n`,
    );
  } else {
    writeExecutable(path.join(bin, 'kscreen-doctor'), "#!/bin/sh\nexit 1\n");
  }

  const supportInfo = `
Version
=======
KWin version: 6.8.2
Qt Version: 6.12.0
Qt compile version: 6.12.0
Operation Mode: Wayland

Compositing
===========
Compositing is active
Compositing Type: OpenGL ES
OpenGL vendor string: AMD
OpenGL renderer string: AMD Radeon RX 6800
Mesa version: 26.2.5
Linux kernel version: 7.2.11
Loaded Effects:
---------------
shakecursor

Options
=======
focusPolicy: FocusFollowsMouse
placement: 5
borderlessMaximizedWindows: false

Screens
=======
Number of Screens: 2

Screen 0:
Name: DP-2
Geometry: 0,0,3440x1440
Scale: 1
Refresh Rate: 59999
`;
  if (withQdbus) {
    writeExecutable(
      path.join(bin, 'qdbus6'),
      `#!/bin/sh
case "$*" in
  *supportInformation*)
    cat <<'KROHNKITE_EOF'
${supportInfo}
KROHNKITE_EOF
    ;;
  *isScriptLoaded*)
    echo true
    ;;
  *)
    exit 1
    ;;
esac
`,
    );
  } else {
    writeExecutable(path.join(bin, 'qdbus6'), "#!/bin/sh\nexit 1\n");
  }

  writeExecutable(path.join(bin, 'plasmashell'), "#!/bin/sh\necho 'plasmashell 6.8.2'\n");
  writeExecutable(path.join(bin, 'kwin_wayland'), "#!/bin/sh\necho 'kwin 6.8.2'\n");
  writeExecutable(path.join(bin, 'qmake6'), "#!/bin/sh\necho '6.12.0'\n");

  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_DATA_DIRS: path.join(directory, 'empty-system-data'),
    USER: username,
    LOGNAME: username,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };

  const run = (args = []) =>
    spawnSync('python3', [helper, ...args], {
      cwd: out,
      env,
      encoding: 'utf8',
    });

  return {
    directory,
    home,
    hostname,
    privateUuid,
    out,
    run,
  };
}

test('collects the environment and every Krohnkite setting without private data', () => {
  const current = fixture();
  const result = current.run(['--stdout']);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;

  assert.match(output, /^Krohnkite diagnostics$/m);
  assert.match(output, /^Package: user install$/m);
  assert.match(output, /^Version: 0\.9\.11\.0$/m);
  assert.match(output, /^Revision: 4197587$/m);
  assert.match(output, /^Enabled in kwinrc: yes$/m);
  assert.match(output, /^Loaded in KWin: yes$/m);

  assert.match(output, /huake 1\.0\.0 \(user\)/);
  assert.match(output, /krohnkite 0\.9\.11\.0 \(user\)/);
  assert.match(output, /Other enabled plugins\/effects:/);
  assert.match(output, /^  blur$/m);

  assert.match(output, /DP-2/);
  assert.match(output, /mode 3440x1440@60\.00/);
  assert.match(output, /mode 1920x1080@60\.00/);
  assert.match(output, /rotation 90 degrees/);
  assert.doesNotMatch(output, /\x1b/);

  assert.match(output, /KWin version: 6\.8\.2/);
  assert.match(output, /Compositing is active/);
  assert.match(output, /focusPolicy: FocusFollowsMouse/);
  assert.doesNotMatch(output, /Loaded Effects:/);

  assert.ok(
    output.includes('KrohnkiteFocusPrev = "Meta+,, Meta+Ctrl+F9"'),
  );
  assert.ok(output.includes('KrohnkiteFocusNext = "Meta+., Meta+Ctrl+F10"'));
  assert.match(output, /Conflicts with other KWin shortcuts:/);
  assert.match(output, /KrohnkiteFocusDown \(Krohnkite: Focus Down\)/);
  assert.match(output, /OtherFocus \(Other: Focus\)/);

  const configXml = fs.readFileSync(path.join(root, 'res/config.xml'), 'utf8');
  for (const match of configXml.matchAll(/<entry\s+[^>]*name="([^"]+)"/g)) {
    assert.match(
      output,
      new RegExp(`^${escapeRegExp(match[1])} = `, 'm'),
      `missing setting ${match[1]}`,
    );
  }

  assert.match(output, /^ignoreTitle = "<hidden: \d+ chars>" \[set\]$/m);
  assert.match(output, /^floatConfig = "<hidden: \d+ chars>" \[set\]$/m);
  assert.match(output, /^screenDefaultLayout = "<hidden: \d+ chars>" \[set\]$/m);
  assert.match(output, /^logFilterStr = "<hidden: \d+ chars>" \[set\]$/m);
  assert.match(
    output,
    /^floatingTitle = "<hidden: \d+ chars>" \[unknown\/legacy\]$/m,
  );
  assert.match(output, /^debugActiveWin = "true" \[unknown\/legacy\]$/m);

  assert.doesNotMatch(output, /Top Secret/);
  assert.doesNotMatch(output, /Secret Activity/);
  assert.doesNotMatch(output, /Secret Desktop/);
  assert.doesNotMatch(output, /Legacy Secret Caption/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(current.privateUuid)));
  assert.doesNotMatch(output, /10\.0\.0\.1/);
  assert.doesNotMatch(output, /aa:bb:cc:dd:ee:ff/);
  assert.doesNotMatch(output, /user@example\.com/);
  assert.doesNotMatch(output, /Secret Monitor/);
  assert.doesNotMatch(output, /SECRET-SERIAL/);
  assert.doesNotMatch(output, /SECRET-EDID/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(current.home)));
  assert.doesNotMatch(output, /fixtureuser/);
  if (current.hostname.length >= 3) {
    assert.match(output, /hosttoken \$HOST/);
    assert.doesNotMatch(
      output,
      new RegExp(`hosttoken ${escapeRegExp(current.hostname)}`),
    );
  }

  assert.match(output, /\$HOME/);
  assert.match(output, /\$USER/);
  assert.match(output, /<ip>/);
  assert.match(output, /<mac>/);
  assert.match(output, /<email>/);

  assert.deepEqual(
    fs.readdirSync(current.out).filter((name) => name.startsWith('krohnkite-diagnostics-')),
    [],
  );
});

test('--include-user-rules reveals user rules but keeps token redaction', () => {
  const current = fixture();
  const result = current.run(['--stdout', '--include-user-rules']);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;

  assert.match(output, /Top Secret Project/);
  assert.match(output, /Top Secret Window/);
  assert.match(output, /Top Secret Filter/);
  assert.match(output, /Secret Activity/);
  assert.match(output, /Secret Desktop/);
  assert.match(output, /Legacy Secret Caption/);

  assert.match(output, /<uuid>/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(current.privateUuid)));
  assert.match(output, /<ip>/);
  assert.doesNotMatch(output, /10\.0\.0\.1/);
  assert.match(output, /<mac>/);
  assert.doesNotMatch(output, /aa:bb:cc:dd:ee:ff/);
  assert.match(output, /<email>/);
  assert.doesNotMatch(output, /user@example\.com/);
  assert.doesNotMatch(output, /fixtureuser/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(current.home)));

  assert.match(result.stderr, /user-defined title\/desktop rules are included/);
});

test('writes a report file by default and honors --output', () => {
  const current = fixture();
  const first = current.run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^Wrote: /m);

  const files = fs
    .readdirSync(current.out)
    .filter((name) => name.startsWith('krohnkite-diagnostics-'));
  assert.equal(files.length, 1);
  const content = fs.readFileSync(path.join(current.out, files[0]), 'utf8');
  assert.match(content, /Krohnkite diagnostics/);
  assert.match(content, /^Krohnkite configuration$/m);

  const second = current.run(['-o', 'custom.txt']);
  assert.equal(second.status, 0, second.stderr);
  assert.ok(fs.existsSync(path.join(current.out, 'custom.txt')));
});

test('falls back when KWin D-Bus is unavailable', () => {
  const current = fixture({ withQdbus: false });
  const result = current.run(['--stdout']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Loaded in KWin: unknown$/m);
  assert.match(result.stdout, /KWin: kwin 6\.8\.2/);
  assert.match(result.stdout, /^Collector notes$/m);
  assert.match(result.stdout, /KWin support information is unavailable/);
});

test('falls back to KWin support information for displays', () => {
  const current = fixture({ withKscreen: false });
  const result = current.run(['--stdout']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Number of Screens: 2/);
  assert.match(result.stdout, /DP-2: geometry 0,0,3440x1440/);
  assert.match(result.stdout, /refresh 59999 mHz/);
  assert.match(result.stdout, /kscreen-doctor is unavailable/);
});

test('packaging copies the diagnostics collector', () => {
  const taskfile = fs.readFileSync(path.join(root, 'taskfile.yaml'), 'utf8');
  assert.match(
    taskfile,
    /cp tools\/collect-diagnostics\.py \{\{\.KWINPKG_DIR\}\}\/contents\/code\/collect-diagnostics\.py/,
  );

  const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
  assert.ok(
    makefile.includes(
      'contents/code/collect-diagnostics.py: tools/collect-diagnostics.py',
    ),
  );
});
