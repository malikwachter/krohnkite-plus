const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'tools/reload-script.py');
const fixtures = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(responses = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'krohnkite reload tests '));
  fixtures.push(directory);
  const pkg = path.join(directory, 'package');
  const files = {
    'metadata.json': '{}',
    'contents/ui/main.qml': 'import "../code/script.js" as K',
    'contents/code/script.js': '// fresh JavaScript',
    'contents/ui/popup.qml': '// fresh popup',
    'contents/ui/layouts/tile.svg': '<svg/>',
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(pkg, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }

  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'qdbus6');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const log = process.env.QDBUS_LOG;
const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
calls.push(process.argv.slice(2));
fs.writeFileSync(log, JSON.stringify(calls));
const queue = JSON.parse(fs.readFileSync(process.env.QDBUS_RESPONSES, 'utf8'));
const response = queue.shift();
fs.writeFileSync(process.env.QDBUS_RESPONSES, JSON.stringify(queue));
if (!response) process.exit(90);
if (response.error) { process.stderr.write(response.error); process.exit(response.code || 1); }
process.stdout.write(response.stdout || '');
`);
  fs.chmodSync(fake, 0o755);
  const responsesFile = path.join(directory, 'responses.json');
  const logFile = path.join(directory, 'calls.json');
  fs.writeFileSync(responsesFile, JSON.stringify(responses.map((response) =>
    typeof response === 'string' ? { stdout: response } : response)));
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    XDG_CACHE_HOME: path.join(directory, 'xdg-cache'),
    QDBUS_RESPONSES: responsesFile,
    QDBUS_LOG: logFile,
    HOME: directory,
  };
  const runOn = (target, args = []) =>
    spawnSync('python3', [helper, target, ...args], { cwd: directory, env, encoding: 'utf8' });
  return {
    directory, pkg, files, env, logFile,
    calls: () => fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [],
    run: (args = []) => runOn(pkg, args),
    runOn,
    responsesFile,
  };
}

function zipDirectory(source, archive) {
  const script = [
    'import pathlib, sys, zipfile',
    'source = pathlib.Path(sys.argv[1])',
    'with zipfile.ZipFile(sys.argv[2], "w") as bundle:',
    '    for path in sorted(source.rglob("*")):',
    '        if path.is_file():',
    '            bundle.write(path, path.relative_to(source).as_posix())',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script, source, archive], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return archive;
}

const output = (stdout) => ({ stdout });
const error = (stderr, code = 1) => ({ error: stderr, code });
const command = (method, ...args) => ['org.kde.KWin', '/Scripting', `org.kde.kwin.Scripting.${method}`, ...args];
const success = ['false', '42', ''];
const cacheDir = (f) => path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
const bundles = (f) => fs.existsSync(cacheDir(f))
  ? fs.readdirSync(cacheDir(f)).filter((name) => name.startsWith('reload-'))
  : [];
const stagedMain = (f) => f.calls().filter((args) => args[2].endsWith('.loadDeclarativeScript')).at(-1)[3];
const bundleDir = (main) => path.resolve(path.dirname(main), '../..');

test('stages every dependency at unique paths', () => {
  const f = fixture([...success, ...success]);
  const mains = [];
  for (let run = 0; run < 2; run += 1) {
    assert.equal(f.run().status, 0);
    const main = stagedMain(f);
    mains.push(main);
    for (const [relative, content] of Object.entries(f.files)) assert.equal(fs.readFileSync(path.join(bundleDir(main), relative), 'utf8'), content);
    assert.equal(fs.readFileSync(path.resolve(path.dirname(main), '../code/script.js'), 'utf8'), '// fresh JavaScript');
  }
  assert.notEqual(mains[0], mains[1]);
  assert.equal(bundles(f).length, 1);
});

test('superseded bundles are pruned', () => {
  const f = fixture([...success, ...success, ...success]);
  assert.equal(f.run().status, 0);
  const first = path.basename(bundleDir(stagedMain(f)));
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.deepEqual(bundles(f), [path.basename(bundleDir(stagedMain(f)))]);
  assert.notEqual(first, bundles(f)[0]);
});

test('missing package rejected before staging', () => {
  const f = fixture();
  fs.rmSync(f.pkg, { recursive: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing .*contents\/ui\/main.qml/);
  assert.equal(fs.existsSync(f.env.XDG_CACHE_HOME), false);
  assert.deepEqual(f.calls(), []);
});

test('dry run prints the plan without touching KWin or the cache', () => {
  const f = fixture();
  const result = f.run(['--dry-run']);
  assert.equal(result.status, 0);
  assert.deepEqual(f.calls(), []);
  assert.equal(fs.existsSync(f.env.XDG_CACHE_HOME), false);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^qdbus6 org\.kde\.KWin \/Scripting org\.kde\.kwin\.Scripting\.isScriptLoaded krohnkite$/);
  assert.match(lines[1], /^qdbus6 org\.kde\.KWin \/Scripting org\.kde\.kwin\.Scripting\.unloadScript krohnkite$/);
  assert.match(lines[2], /loadDeclarativeScript .*<fresh-bundle>\/contents\/ui\/main\.qml/);
  assert.match(lines[3], /^qdbus6 org\.kde\.KWin \/Scripting org\.kde\.kwin\.Scripting\.start$/);
});

test('uses exact qdbus6 argv and safe subprocess capture', () => {
  const f = fixture([output('false'), output('42'), output('')]);
  assert.equal(f.run().status, 0);
  const calls = f.calls();
  assert.deepEqual(calls[0], command('isScriptLoaded', 'krohnkite'));
  assert.deepEqual(calls[1].slice(0, 3), command('loadDeclarativeScript').slice(0, 3));
  assert.match(calls[1][3], /\/reload-[^/]+\/contents\/ui\/main\.qml$/);
  assert.equal(calls[1][4], 'krohnkite');
  assert.deepEqual(calls.slice(2), [command('start')]);
});

test('loaded script unloads, loads and runs in order with paths containing spaces', () => {
  const f = fixture([output('true'), output('true'), output('12'), output('')]);
  assert.equal(f.run().status, 0);
  const calls = f.calls();
  assert.deepEqual(calls.map((args) => args[2].split('.').at(-1)), ['isScriptLoaded', 'unloadScript', 'loadDeclarativeScript', 'start']);
  assert.match(calls[2][3], /krohnkite reload tests/);
  assert.equal(calls[2][4], 'krohnkite');
  assert.deepEqual(calls[3], command('start'));
});

test('unloaded script skips unload', () => {
  const f = fixture(success);
  assert.equal(f.run().status, 0);
  assert.equal(f.calls().some((args) => args[2].endsWith('.unloadScript')), false);
});

test('failed unload never loads replacement', () => {
  const f = fixture([output('true'), output('false')]);
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls().length, 2);
});

test('rejected load never runs', () => {
  const f = fixture([output('false'), output('-1')]);
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls().length, 2);
});

test('failed start is reported', () => {
  const f = fixture([output('false'), output('1'), error('start unavailable')]);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /start unavailable/);
});

test('successful reload atomically records bundle for future recovery', () => {
  const f = fixture(success);
  assert.equal(f.run().status, 0);
  const marker = path.join(f.env.XDG_CACHE_HOME, 'krohnkite/last-good-main-qml');
  const main = f.calls()[1][3];
  assert.equal(fs.readFileSync(marker, 'utf8'), main);
  assert.deepEqual(fs.readdirSync(path.dirname(marker)).filter((name) => name.startsWith('last-good-main-qml.tmp-')), []);
});

test('rejected replacement recovers using last-good bundle', () => {
  const f = fixture([output('true'), output('true'), output('-1'), output('31'), output('')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Recovered using prior bundle/);
  assert.equal(f.calls()[3][3], previous);
});

test('rejected bundle is removed after a failed replacement', () => {
  const f = fixture([output('true'), output('true'), output('-1'), output('31'), output('')]);
  const cache = cacheDir(f);
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(bundles(f), []);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'prior');
});

test('failed replacement keeps the recovered bundle in the cache', () => {
  const f = fixture([output('true'), output('true'), output('-1'), output('31'), output('')]);
  const cache = cacheDir(f);
  const previous = path.join(cache, 'reload-previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Recovered using prior bundle/);
  assert.deepEqual(bundles(f), ['reload-previous']);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'prior');
});

test('failed first reload leaves no staged bundle', () => {
  const f = fixture([output('false'), output('-1')]);
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(bundles(f), []);
});

test('DBus exception reports primary and recovery failure', () => {
  const f = fixture([output('true'), output('true'), error('DBus unavailable'), output('22'), error('recovery start failed')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DBus unavailable/);
  assert.match(result.stderr, /Recovery from/);
  assert.match(result.stderr, /recovery start failed/);
});

test('start failure recovers last-good bundle', () => {
  const f = fixture([output('true'), output('true'), output('12'), error('start failed'), output('13'), output('')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  assert.match(f.run().stderr, /Recovered using prior bundle/);
  assert.equal(f.calls()[4][3], previous);
});

test('first reload and missing recovery bundle report limitation', () => {
  const f = fixture([output('true'), output('true'), output('-1')]);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No known prior working bundle/);
  assert.equal(f.calls().length, 3);
});

test('initially disabled script is not recovered after failure', () => {
  const f = fixture([output('false'), output('-1')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  fs.mkdirSync(cache, { recursive: true });
  const previous = path.join(cache, 'previous.qml');
  fs.writeFileSync(previous, 'prior');
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(f.calls().length, 2);
  assert.match(result.stderr, /refused to load/);
});

test('archive is staged and reloaded like a package directory', () => {
  const f = fixture([...success, ...success]);
  const archive = zipDirectory(f.pkg, path.join(f.directory, 'build.kwinscript'));
  const result = f.runOn(archive);
  assert.equal(result.status, 0, result.stderr);
  const main = stagedMain(f);
  for (const [relative, content] of Object.entries(f.files)) {
    assert.equal(fs.readFileSync(path.join(bundleDir(main), relative), 'utf8'), content);
  }
  assert.deepEqual(f.calls(), [
    command('isScriptLoaded', 'krohnkite'),
    command('loadDeclarativeScript', main, 'krohnkite'),
    command('start'),
  ]);
  assert.equal(bundles(f).length, 1);
});

test('archive missing a required file is rejected before staging', () => {
  const f = fixture();
  const source = path.join(f.directory, 'broken');
  fs.mkdirSync(path.join(source, 'contents/ui'), { recursive: true });
  fs.writeFileSync(path.join(source, 'metadata.json'), '{}');
  fs.writeFileSync(path.join(source, 'contents/ui/main.qml'), '// main');
  const archive = zipDirectory(source, path.join(f.directory, 'broken.kwinscript'));
  const result = f.runOn(archive);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing contents\/code\/script\.js/);
  assert.equal(fs.existsSync(f.env.XDG_CACHE_HOME), false);
  assert.deepEqual(f.calls(), []);
});

test('dry run of an archive does not extract it', () => {
  const f = fixture();
  const archive = zipDirectory(f.pkg, path.join(f.directory, 'build.kwinscript'));
  const result = f.runOn(archive, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls(), []);
  assert.equal(fs.existsSync(f.env.XDG_CACHE_HOME), false);
  assert.equal(result.stdout.trim().split('\n').length, 4);
});

test('archive with a path outside the bundle is rejected', () => {
  const f = fixture();
  const archive = zipDirectory(f.pkg, path.join(f.directory, 'build.kwinscript'));
  const append = [
    'import sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1], "a") as bundle:',
    '    bundle.writestr("../evil", "x")',
  ].join('\n');
  const appended = spawnSync('python3', ['-c', append, archive], { encoding: 'utf8' });
  assert.equal(appended.status, 0, appended.stderr);
  const result = f.runOn(archive);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing unsafe path/);
  assert.deepEqual(bundles(f), []);
  assert.deepEqual(f.calls(), []);
});

test('a file that is not a zip is reported as an invalid archive', () => {
  const f = fixture();
  const archive = path.join(f.directory, 'build.kwinscript');
  fs.writeFileSync(archive, 'not a zip');
  const result = f.runOn(archive);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a valid \.kwinscript archive/);
  assert.equal(fs.existsSync(f.env.XDG_CACHE_HOME), false);
});

test('only-if-loaded skips a script that is not loaded', () => {
  const f = fixture([output('false')]);
  const archive = zipDirectory(f.pkg, path.join(f.directory, 'build.kwinscript'));
  const result = f.runOn(archive, ['--only-if-loaded']);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /Skipped: Krohnkite is not loaded/);
  assert.deepEqual(f.calls(), [command('isScriptLoaded', 'krohnkite')]);
  assert.deepEqual(bundles(f), []);
});

test('only-if-loaded reloads a loaded script', () => {
  const f = fixture([output('true'), output('true'), output('12'), output('')]);
  const archive = zipDirectory(f.pkg, path.join(f.directory, 'build.kwinscript'));
  const result = f.runOn(archive, ['--only-if-loaded']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    f.calls().map((args) => args[2].split('.').at(-1)),
    ['isScriptLoaded', 'unloadScript', 'loadDeclarativeScript', 'start'],
  );
});
