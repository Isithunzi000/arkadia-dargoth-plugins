// Straznik rozmiarow startowych okien pluginow (node:test, zero deps).
// Czyta PRAWDZIWE najnowsze zipy z releases/ (jak metadata.test.mjs) i pilnuje
// konfigu registerPersistentPopup: initialWidth/initialHeight (API klienta
// Dargoth, feat "rozmiar startowy okien pluginow").
//
// Zalozenia katalogu (zatwierdzone wartosci):
//   imperium_cal, ishtar_cal — pomoc tekstowa: szerokosc stala 480 px,
//     wysokosc 'content' (dopasowanie do zawinietej tresci, bez scrolla).
//   truwer — okno robocze wypelniajace shell (flex, min-height:0): obie osie
//     liczbami 440x720; 'content' jest tu ZABRONIONE (korzen jest elastyczny,
//     nie ma czego mierzyc — zasada z PLUGINS.md klienta).
// Bramki klienta: min 300x150, zawsze na ekranie (margines 16 px).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RELEASES = path.join(REPO, 'releases');

const MIN_W = 300;
const MIN_H = 150;

const EXPECTED = {
  imperium_cal: { width: 480, height: 'content' },
};

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

// Wycina konfig przekazany do registerPersistentPopup — od wywolania do
// zamykajacego nawiasu (okno 4000 znakow wystarcza: konfigi sa krotkie).
function popupConfig(src) {
  const at = src.indexOf('registerPersistentPopup({');
  assert.notEqual(at, -1, 'brak wywolania registerPersistentPopup');
  return src.slice(at, at + 4000);
}

// Wartosc pola: liczba (px) albo literal string (dlugosc CSS / 'content').
// Zwraca { kind: 'number'|'string', value: number|string } albo null.
function fieldValue(config, field) {
  const m = config.match(new RegExp(field + '\\s*:\\s*(\\d+(?:\\.\\d+)?|\'[^\']*\'|"[^"]*")'));
  if (!m) return null;
  const raw = m[1];
  if (/^\d/.test(raw)) return { kind: 'number', value: Number(raw) };
  return { kind: 'string', value: raw.slice(1, -1) };
}

const latest = latestZipPerPlugin();

for (const [plugin, want] of Object.entries(EXPECTED)) {
  test(`popup-size: ${plugin} — initialWidth/initialHeight zgodne z zalozeniami`, () => {
    const zip = latest[plugin];
    assert.ok(zip, `brak zipa dla ${plugin} w releases/`);
    const ts = unzipText(zip, `${plugin}/index.ts`);
    const config = popupConfig(ts);

    const w = fieldValue(config, 'initialWidth');
    const h = fieldValue(config, 'initialHeight');
    assert.ok(w, `${plugin}: brak initialWidth w konfigu popupu`);
    assert.ok(h, `${plugin}: brak initialHeight w konfigu popupu`);

    // szerokosc: stala liczba px, rowna zalozonej, powyzej minimum klienta
    assert.equal(w.kind, 'number', `${plugin}: initialWidth ma byc liczba px (proza pomocy / okno robocze), jest: ${JSON.stringify(w)}`);
    assert.equal(w.value, want.width, `${plugin}: initialWidth`);
    assert.ok(w.value >= MIN_W, `${plugin}: initialWidth ponizej minimum klienta ${MIN_W}`);

    if (want.height === 'content') {
      // kalendarze: wysokosc dopasowana do tresci
      assert.equal(h.kind, 'string', `${plugin}: initialHeight ma byc 'content', jest: ${JSON.stringify(h)}`);
      assert.equal(h.value, 'content', `${plugin}: initialHeight`);
    } else {
      // truwer: wysokosc stala liczba px; 'content' zabronione (elastyczny korzen)
      assert.equal(h.kind, 'number', `${plugin}: initialHeight ma byc liczba px ('content' zabronione dla okna wypelniajacego), jest: ${JSON.stringify(h)}`);
      assert.equal(h.value, want.height, `${plugin}: initialHeight`);
      assert.ok(h.value >= MIN_H, `${plugin}: initialHeight ponizej minimum klienta ${MIN_H}`);
    }
  });
}
