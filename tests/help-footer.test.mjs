// Straznik stopki pomocy kalendarzy (node:test, zero deps).
// Czyta PRAWDZIWE najnowsze zipy z releases/ (jak metadata.test.mjs).
// Stopka w buildHelpContent kalendarzy jest pozycjonowana absolutnie
// (position:absolute; bottom:6px) wzgledem roota (position:relative) —
// bez padding-bottom na roocie zachodzi na ostatni akapit pomocy.
// Root MUSI rezerwowac miejsce: paddingBottom >= 20 px
// (stopka 11 px * line-height + bottom 6 px + margines bezpieczenstwa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RELEASES = path.join(REPO, 'releases');

const MIN_PADDING_PX = 20;
const PLUGINS = ['imperium_cal'];

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

for (const plugin of PLUGINS) {
  test(`help-footer: ${plugin} — root pomocy rezerwuje miejsce pod absolutna stopke`, () => {
    const zip = latest[plugin];
    assert.ok(zip, `brak zipa dla ${plugin} w releases/`);
    const ts = unzipText(zip, `${plugin}/index.ts`);

    // stopka faktycznie absolutna (warunek wstepny: jak ktos ja zmieni
    // na statyczna, straznik ma zglosic, ze rezerwa niepotrzebna/nie ma co pilnowac)
    const foot = ts.match(/footer\.style\.position\s*=\s*"absolute"/);
    assert.ok(foot, `${plugin}: stopka nie jest juz absolute — straznik do rewizji`);

    const m = ts.match(/root\.style\.paddingBottom\s*=\s*"(\d+)px"/);
    assert.ok(m, `${plugin}: brak root.style.paddingBottom — stopka nachodzi na ostatni akapit`);
    const px = Number(m[1]);
    assert.ok(
      px >= MIN_PADDING_PX,
      `${plugin}: paddingBottom ${px}px < ${MIN_PADDING_PX}px (stopka 11px + bottom 6px + margines)`,
    );
  });
}
