// Testy skryptow release'owych dargoth-plugins (node:test).
// Fixture: tymczasowe drzewo <tmp>/{scripts,releases}. build.js wymaga
// esbuild — podpinany przez NODE_PATH (wspolna instalacja, zero deps w repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NODE_PATH = process.env.DARGOTH_TEST_NODE_PATH || '/tmp/esbuild-deps/node_modules';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dargoth-build-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'releases'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', 'build.js'), path.join(root, 'scripts', 'build.js'));
  fs.copyFileSync(
    path.join(REPO, 'scripts', 'make_release_zip.py'),
    path.join(root, 'scripts', 'make_release_zip.py')
  );
  return root;
}

function runBuild(root) {
  const r = spawnSync('node', [path.join(root, 'scripts', 'build.js')], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function makeGoodZip(root, name) {
  // Prawdziwy zip z index.ts (python3 jest wymagane i tak przez make_release_zip).
  const r = spawnSync('python3', [
    '-c',
    'import sys, zipfile; zf = zipfile.ZipFile(sys.argv[1], "w"); ' +
      'zf.writestr("index.ts", "export async function init() {}"); zf.close()',
    path.join(root, 'releases', name),
  ]);
  assert.equal(r.status, 0, 'nie udalo sie zlozyc fixture-zipa');
}

test('D4b: pusty releases/ konczy sie bledem (deploy pustego dist/ niedopuszczalny)', () => {
  const root = makeFixture();
  const r = runBuild(root);
  assert.notEqual(r.status, 0, 'pusty releases/ musi dac exit != 0, jest: ' + r.status);
});

test('D4: uszkodzony zip -> POMINIETY + exit != 0, ale dobry plugin sie buduje (petla zyje)', () => {
  const root = makeFixture();
  fs.writeFileSync(path.join(root, 'releases', 'zepsuty_9_9_9.zip'), 'to nie jest zip');
  makeGoodZip(root, 'dobry_1_0_0.zip');
  const r = runBuild(root);
  const log = r.stdout + r.stderr;
  assert.ok(log.includes('POMINIETY (uszkodzony zip): zepsuty_9_9_9.zip'), 'brak POMINIETY w logu: ' + log);
  assert.notEqual(r.status, 0, 'uszkodzony zip musi dac exit != 0, jest: ' + r.status);
  assert.ok(log.includes('Gotowe:'), 'petla umarla przed podsumowaniem: ' + log);
  assert.ok(
    fs.existsSync(path.join(root, 'dist', 'dobry.js')),
    'dobry plugin nie zbudowal sie: ' + fs.readdirSync(path.join(root, 'dist')).join(',')
  );
});

test('R3: make_release_zip odrzuca wersje nie-X.Y.Z (1.2.3.4, 1..2)', () => {
  for (const bad of ['1.2.3.4', '1..2']) {
    const root = makeFixture();
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'jakis'), { recursive: true });
    fs.writeFileSync(path.join(src, 'jakis', 'index.ts'), 'export {}');
    fs.writeFileSync(path.join(src, 'jakis', 'plugin.json'), '{}');
    const r = spawnSync(
      'python3',
      [path.join(root, 'scripts', 'make_release_zip.py'), src, 'jakis', bad],
      { encoding: 'utf8' }
    );
    assert.notEqual(r.status ?? 1, 0, 'wersja ' + bad + ' musi byc odrzucona');
  }
});

test('R3 kontrolnie: wersja 1.2.3 przechodzi', () => {
  const root = makeFixture();
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'jakis'), { recursive: true });
  fs.writeFileSync(path.join(src, 'jakis', 'index.ts'), 'export {}');
    fs.writeFileSync(path.join(src, 'jakis', 'plugin.json'), '{}');
  const r = spawnSync(
    'python3',
    [path.join(root, 'scripts', 'make_release_zip.py'), src, 'jakis', '1.2.3'],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(root, 'releases', 'jakis_1_2_3.zip')));
});
