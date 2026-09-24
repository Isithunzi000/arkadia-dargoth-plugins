/**
 * Testy Fali 3: cios specjalny (poziom maksymalny 75 bez polecenia / 100
 * z poleceniem, cena zawsze 100% tabeli) + słownik "procent ceny".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UMIEJETNOSCI,
  CIOS_SPECJALNY,
  cenaTreningu,
  kosztPrzedzialu,
} from '../src/treningi/index.js';

test('cios specjalny: cena 100% tabeli (zmierzone z gry)', () => {
  assert.equal(CIOS_SPECJALNY.procentCeny, 100);
});

test('cios specjalny: poziom maksymalny 75 bez polecenia, 100 z poleceniem', () => {
  assert.equal(CIOS_SPECJALNY.poziomMaksymalnyBezPolecenia, 75);
  assert.equal(CIOS_SPECJALNY.poziomMaksymalnyZPoleceniem, 100);
});

test('lista umiejetnosci ma pole procentCeny (nie "kosztownosc")', () => {
  for (const u of UMIEJETNOSCI) {
    assert.ok(typeof u.procentCeny === 'number', u.nazwa);
    assert.ok(!('kosztownosc' in u), u.nazwa);
  }
});

test('przedzial z poziomem maksymalnym: obcina i raportuje', () => {
  // cios specjalny bez polecenia, przedzial 70-90 -> liczone 70-75
  const w = kosztPrzedzialu(70, 90, 100, 75);
  assert.ok(w);
  assert.equal(w.obcietyDo, 75);
  const suma7075 = [70, 71, 72, 73, 74, 75]
    .reduce((a, i) => a + cenaTreningu(i, 100), 0);
  assert.equal(w.miedziRazem, suma7075);
});

test('przedzial w calosci poza poziomem maksymalnym -> null', () => {
  assert.equal(kosztPrzedzialu(80, 90, 100, 75), null);
});

test('przedzial bez poziomu maksymalnego -> bez zmian', () => {
  const w = kosztPrzedzialu(70, 90, 100);
  assert.ok(w);
  assert.equal(w.obcietyDo, undefined);
});

test('przedzial dokladnie do poziomu maksymalnego -> bez obcinania', () => {
  const w = kosztPrzedzialu(70, 75, 100, 75);
  assert.ok(w);
  assert.equal(w.obcietyDo, undefined);
});
