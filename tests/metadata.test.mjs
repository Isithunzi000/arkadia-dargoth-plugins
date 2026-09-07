// Straznik metadanych pluginow (node:test, zero deps).
// Czyta PRAWDZIWE najnowsze zipy z releases/ (nie fixture'y): publiczna
// tozsamosc pluginu (author, opis) musi byc spojna z zalozeniami katalogu
// i wolna od placeholderow edytora. Wybor najnowszego zipa per plugin:
// sortowanie semantyczne jak w scripts/build.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RELEASES = path.join(REPO, 'releases');

const EXPECTED = {
  imperium_cal: {
    author: 'Isithunzi000',
    description: 'Kalendarz Imperium wylicza czas RL dla wydarzeń domeny bazując na czasie IG uzyskanym z gry (alias /imperium).',
  },
  ishtar_cal: {
    author: 'Isithunzi000',
    description: 'Kalendarz Ishtar wylicza czas RL dla wydarzeń domeny bazując na czasie IG uzyskanym z gry (alias /ishtar).',
  },
  truwer: {
    author: 'Isithunzi000',
    description: 'Truwer to asystent odgrywania sekwencyjnego, śpiewanie piosenek, deklamowanie wierszy, odgrywanie scen lub rytuałów (alias /truwer). Plugin w pełni zgodny z regulaminem gry — wszystkie komendy wysyłane świadomie przez gracza, bez automatyki.',
  },
};

const PLACEHOLDERS = ['Plugin Editor', 'Created with Plugin Editor', '"AI"'];

function splitZip(zip) {
  const m = zip.match(/^(.+?)_(\d+(?:_\d+)*)\.zip$/);
  if (!m) return null;
  return { name: m[1], ver: m[2].split('_').map(Number) };
}
function verCmp(a, b) { // malejaco: nowsza wersja najpierw (jak build.js)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return y - x;
  }
  return 0;
}
function latestZipPerPlugin() {
  const out = {};
  for (const zip of fs.readdirSync(RELEASES).filter((f) => f.endsWith('.zip'))) {
    const parsed = splitZip(zip);
    if (!parsed) continue;
    const cur = out[parsed.name];
    if (!cur || verCmp(parsed.ver, splitZip(cur).ver) < 0) out[parsed.name] = zip;
  }
  return out;
}
function unzipText(zip, entry) {
  return execSync(`unzip -p "${path.join(RELEASES, zip)}" "${entry}"`, { encoding: 'utf8' });
}

const latest = latestZipPerPlugin();

for (const [plugin, want] of Object.entries(EXPECTED)) {
  test(`metadata: ${plugin} — author/opis/wersja spojne z tozsamoscia publiczna`, () => {
    const zip = latest[plugin];
    assert.ok(zip, `brak zipa dla ${plugin} w releases/`);
    const zipVer = splitZip(zip).ver.join('.');

    const ts = unzipText(zip, `${plugin}/index.ts`);
    const pj = JSON.parse(unzipText(zip, `${plugin}/plugin.json`));

    // 1. author w PluginInfo (to widzi katalog) i w plugin.json
    const mAuthor = ts.match(/author:\s*"([^"]+)"/);
    assert.ok(mAuthor, `${plugin}: brak author w PluginInfo`);
    assert.equal(mAuthor[1], want.author, `${plugin}: PluginInfo.author`);
    assert.equal(pj.metadata.author, want.author, `${plugin}: plugin.json metadata.author`);

    // 2. opis katalogowy: identyczny w PluginInfo i plugin.json
    const mDesc = ts.match(/description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/);
    assert.ok(mDesc, `${plugin}: brak description w PluginInfo`);
    const tsDesc = JSON.parse('"' + mDesc[1] + '"');
    assert.equal(tsDesc, want.description, `${plugin}: PluginInfo.description`);
    assert.equal(pj.metadata.description, want.description, `${plugin}: plugin.json metadata.description`);

    // 3. zero placeholderow edytora i dawnego autora w obu plikach
    for (const bad of PLACEHOLDERS) {
      assert.ok(!ts.includes(bad), `${plugin}: index.ts zawiera ${bad}`);
      assert.ok(!JSON.stringify(pj).includes(bad), `${plugin}: plugin.json zawiera ${bad}`);
    }

    // 4. spojnosc wersji: nazwa zipa == PLUGIN_VERSION == plugin.json (oba pola)
    const mPv = ts.match(/const PLUGIN_VERSION = "([^"]+)"/);
    assert.ok(mPv, `${plugin}: brak PLUGIN_VERSION`);
    assert.equal(mPv[1], zipVer, `${plugin}: PLUGIN_VERSION != nazwa zipa`);
    assert.equal(pj.metadata.version, zipVer, `${plugin}: plugin.json metadata.version != nazwa zipa`);
    if (pj.version !== undefined) {
      assert.equal(pj.version, zipVer, `${plugin}: plugin.json version (top-level) != nazwa zipa`);
    }
  });
}
