/**
 * Testy logiki UI kalkulatora treningow.
 * Kazda reguła z macierzy edge-case'ow ma swoj test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKS_KWOTA,
  MAKS_POZIOM,
  sanitizujLiczbe,
  porzadkujPrzedzial,
  formatujLiczbe,
  limitZWpisu,
} from '../src/treningi/index.js';

test('sanitizujLiczbe: pusty i biale znaki -> 0', () => {
  assert.equal(sanitizujLiczbe('', MAKS_KWOTA), 0);
  assert.equal(sanitizujLiczbe('   ', MAKS_KWOTA), 0);
});

test('sanitizujLiczbe: czyste cyfry przechodza', () => {
  assert.equal(sanitizujLiczbe('0', MAKS_KWOTA), 0);
  assert.equal(sanitizujLiczbe('7', MAKS_KWOTA), 7);
  assert.equal(sanitizujLiczbe('123456', MAKS_KWOTA), 123456);
});

test('sanitizujLiczbe: litery i smieci z wklejenia znikaja, cyfry zostaja', () => {
  assert.equal(sanitizujLiczbe('abc', MAKS_KWOTA), 0);
  assert.equal(sanitizujLiczbe('12zl', MAKS_KWOTA), 12);
  assert.equal(sanitizujLiczbe('1 234 mdz', MAKS_KWOTA), 1234);
});

test('sanitizujLiczbe: separator dziesietny obcina ulamek', () => {
  assert.equal(sanitizujLiczbe('12,5', MAKS_KWOTA), 12);
  assert.equal(sanitizujLiczbe('12.5', MAKS_KWOTA), 12);
  assert.equal(sanitizujLiczbe('0,9', MAKS_KWOTA), 0);
});

test('sanitizujLiczbe: minus i znaki sa ignorowane', () => {
  assert.equal(sanitizujLiczbe('-50', MAKS_KWOTA), 50);
  assert.equal(sanitizujLiczbe('--', MAKS_KWOTA), 0);
});

test('sanitizujLiczbe: zera wiodace normalizowane', () => {
  assert.equal(sanitizujLiczbe('007', MAKS_KWOTA), 7);
});

test('sanitizujLiczbe: clamp do maksimum', () => {
  assert.equal(sanitizujLiczbe('999999999999', MAKS_KWOTA), MAKS_KWOTA);
  assert.equal(sanitizujLiczbe('250', MAKS_POZIOM), MAKS_POZIOM);
  assert.equal(sanitizujLiczbe('100', MAKS_POZIOM), 100);
});

test('porzadkujPrzedzial: od > do zamieniane na [min, max]', () => {
  assert.deepEqual(porzadkujPrzedzial(60, 40), [40, 60]);
  assert.deepEqual(porzadkujPrzedzial(40, 60), [40, 60]);
  assert.deepEqual(porzadkujPrzedzial(50, 50), [50, 50]);
  assert.deepEqual(porzadkujPrzedzial(0, 100), [0, 100]);
});

test('formatujLiczbe: grupowanie pl-PL', () => {
  assert.equal(formatujLiczbe(0), '0');
  assert.equal(formatujLiczbe(729), '729');
  assert.equal(formatujLiczbe(45236), '45 236');
  assert.equal(formatujLiczbe(1234567), '1 234 567');
});

test('limitZWpisu: pusty i 100 -> bez limitu', () => {
  assert.equal(limitZWpisu(''), undefined);
  assert.equal(limitZWpisu('   '), undefined);
  assert.equal(limitZWpisu('100'), undefined);
});

test('limitZWpisu: 1-99 -> limit', () => {
  assert.equal(limitZWpisu('1'), 1);
  assert.equal(limitZWpisu('64'), 64);
  assert.equal(limitZWpisu('99'), 99);
});

test('limitZWpisu: smieci i przekroczenia', () => {
  assert.equal(limitZWpisu('abc'), undefined);
  assert.equal(limitZWpisu('0'), 1);
  assert.equal(limitZWpisu('250'), undefined);
  assert.equal(limitZWpisu('64,5'), 64);
});
