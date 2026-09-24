/**
 * Testy danych tabeli poziomow maksymalnych wg zawodu (src/zawody.ts).
 * Wartosci kontrolne zweryfikowane pomiarami z gry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZAWODY, TABELA_POZIOMOW, limitDla, limitWyswietlany } from '../src/treningi/index.js';

test('tabela ma 13 zawodow (12 + GP) i 30 umiejetnosci', () => {
  assert.equal(ZAWODY.length, 13);
  assert.equal(ZAWODY[ZAWODY.length - 1], 'Gildia Podróżników');
  assert.equal(TABELA_POZIOMOW.length, 30);
  for (const w of TABELA_POZIOMOW) {
    assert.equal(w.limity.length, 13, w.umiejetnosc);
    for (const v of w.limity) {
      assert.ok(v === null || (Number.isInteger(v) && v > 0 && v <= 100), w.umiejetnosc);
    }
  }
});

test('wartosci kontrolne z pomiarow z gry', () => {
  const w = (n: string) => TABELA_POZIOMOW.find(x => x.umiejetnosc === n)!;
  assert.equal(w('broń').limity[3], 75);   // Gladiator
  assert.equal(w('broń').limity[12], 30);  // GP
  assert.equal(w('ocena przeciwnika').limity[3], 85);
  assert.equal(w('wspinaczka').limity[12], 50);
  assert.equal(w('blokowanie wyjścia').limity[12], 20);
  assert.equal(w('rozkazy').limity[12], 15);
  assert.equal(w('uniki').limity[3], 42);
  assert.equal(w('parowanie').limity[3], 41);
  assert.equal(w('tarczownictwo').limity[3], 60);
  assert.equal(w('zasłanianie').limity[3], 40);
  assert.equal(w('walka w szyku').limity[3], 35);
  assert.equal(w('walka bez broni').limity[3], 55);
  assert.equal(w('walka w ciemności').limity[3], 55);
  assert.equal(w('ocena obiektu').limity[3], 50);
});

test('limitDla: zawod bez polecenia = GP + 75% roznicy (zaokraglone)', () => {
  // bron u Gladiatora: GP 30, Glad 75 -> 30 + 0.75*45 = 63.75 -> ~64
  assert.equal(limitDla('broń', 'Gladiator', false), 64);
  // ocena przeciwnika: 21 + 0.75*64 = 69 dokladnie
  assert.equal(limitDla('ocena przeciwnika', 'Gladiator', false), 69);
  // parowanie: 25 + 0.75*16 = 37 dokladnie
  assert.equal(limitDla('parowanie', 'Gladiator', false), 37);
});

test('limitDla: zawod z poleceniem = pelna wartosc zawodu', () => {
  assert.equal(limitDla('broń', 'Gladiator', true), 75);
  assert.equal(limitDla('ocena przeciwnika', 'Gladiator', true), 85);
});

test('limitDla: czyste GP = kolumna GP', () => {
  assert.equal(limitDla('broń', null, false), 30);
  assert.equal(limitDla('wspinaczka', null, false), 50);
  assert.equal(limitDla('wspinaczka', null, true), 50); // GP bez polecenia nie ma znaczenia
});

test('limitDla: umiejetnosc spoza zawodu = tyle samo co GP', () => {
  // kreska w tabeli = zawod nie oferuje -> limit jak w kolumnie GP
  // (plywanie u Gladiatora: kreska -> GP 42)
  assert.equal(limitDla('pływanie', 'Gladiator', false), 42);
  assert.equal(limitDla('pływanie', 'Gladiator', true), 42);
  assert.equal(limitDla('blokowanie wyjścia', 'Gladiator', true), 20);
});

test('limitDla: nieznana umiejetnosc lub brak w GP -> undefined', () => {
  assert.equal(limitDla('nieistniejąca', 'Gladiator', false), undefined);
  assert.equal(limitDla('kieszonkostwo', 'Gladiator', false), undefined); // brak w tabeli
});

test('limitWyswietlany: tryb z poleceniem = wartosc zawodu (dokladna)', () => {
  assert.deepEqual(limitWyswietlany('broń', 'Gladiator', true), { wartosc: 75, przyblizona: false });
  // kreska u zawodu -> tyle co GP, dokladnie
  assert.deepEqual(limitWyswietlany('pływanie', 'Gladiator', true), { wartosc: 42, przyblizona: false });
});

test('limitWyswietlany: bez polecenia = GP + 75% roznicy, przyblizone', () => {
  // bron u Gladiatora: 30 + 0.75*45 = 63.75 -> ~64
  assert.deepEqual(limitWyswietlany('broń', 'Gladiator', false), { wartosc: 64, przyblizona: true });
  // kolumna GP zawsze dokladna
  assert.deepEqual(limitWyswietlany('broń', 'Gildia Podróżników', false), { wartosc: 30, przyblizona: false });
  // kreska u zawodu -> GP, dokladnie (nie przyblizone)
  assert.deepEqual(limitWyswietlany('pływanie', 'Gladiator', false), { wartosc: 42, przyblizona: false });
  // nieznana umiejetnosc -> undefined
  assert.equal(limitWyswietlany('kieszonkostwo', 'Gladiator', false), undefined);
});
