/**
 * Testy charakteryzacyjne silnika kosztow treningu - wartosci zweryfikowane
 * pomiarami z gry (287 pomiarow cen z tabelek treningowych, 0 naruszen
 * modelu; tests/dane-empiryczne.json).
 *
 * Model gry: koszt treningu z poziomu i na i+1 = max(1, trunc(F(i)*k/100)),
 * F(i) = 3*i*i - 3*i + 1, k = procent ceny umiejetnosci w %.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KOSZT_BAZOWY,
  UMIEJETNOSCI,
  naMiedz,
  zMiedzi,
  obecnyPoziom,
  kosztPrzedzialu,
} from '../src/treningi/index.js';

interface Pomiar { koszt_mdz: number; poziomy: number[] }
interface Golden {
  meta: { model: string; spojnosc: string };
  umiejetnosci: Record<string, { procentCeny: number | null; pomiary: Pomiar[] }>;
}

const golden = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'dane-empiryczne.json'), 'utf-8')
) as Golden;

const K_PO_NAZWIE = Object.fromEntries(UMIEJETNOSCI.map(u => [u.nazwa, u.procentCeny]));

test('tabela bazowa = czysty wzor 3i^2-3i+1', () => {
  assert.equal(KOSZT_BAZOWY.length, 101);
  assert.equal(KOSZT_BAZOWY[0], 0);
  for (let i = 1; i <= 100; i++) {
    assert.equal(KOSZT_BAZOWY[i], 3 * i * i - 3 * i + 1, `poziom ${i}`);
  }
});

test('wspinaczka ma procent ceny 50', () => {
  assert.equal(K_PO_NAZWIE['wspinaczka'], 50);
});

test('nazwy zgodne z gra', () => {
  assert.ok(K_PO_NAZWIE['kieszonkostwo']);
  assert.ok(K_PO_NAZWIE['targowanie sie']);
  assert.ok(K_PO_NAZWIE['ukrywanie sie']);
});

test('nowe umiejetnosci z gry z pomierzonymi procentami ceny', () => {
  assert.equal(K_PO_NAZWIE['blokowanie wyjscia'], 100);
  assert.equal(K_PO_NAZWIE['mierzony cios'], 100);
  assert.equal(K_PO_NAZWIE['rozkazy'], 100);
  assert.equal(K_PO_NAZWIE['walka bez broni'], 90);
  assert.equal(K_PO_NAZWIE['walka pokazowa'], 100);
  assert.equal(K_PO_NAZWIE['walka w szyku'], 100);
  assert.equal(K_PO_NAZWIE['zaslanianie'], 100);
});

test('brak pozycji specjal 50/75/100 - nie istnieja w grze', () => {
  assert.ok(!Object.keys(K_PO_NAZWIE).some(n => n.startsWith('specjal')));
});

test('magiczne zwoje pominiete - niezmierzony procent ceny', () => {
  assert.ok(!K_PO_NAZWIE['magiczne zwoje']);
});

test('waluta: 1 zloto = 240 miedzi, 1 srebro = 12 miedzi', () => {
  assert.equal(naMiedz({ zloto: 1, srebro: 0, miedz: 0 }), 240);
  assert.equal(naMiedz({ zloto: 0, srebro: 1, miedz: 0 }), 12);
  assert.equal(naMiedz({ zloto: 2, srebro: 3, miedz: 5 }), 521);
});

test('rozbicie miedzi na nominaly', () => {
  assert.deepEqual(zMiedzi(45236), {
    miedziRazem: 45236, mithryl: 1, zloto: 88, srebro: 9, miedz: 8,
  });
});

test('minimalna cena treningu to 1 mdz', () => {
  // poziom 0->1 przy k=50%: trunc(1*0.5)=0, ale gra bierze 1 mdz
  const w = kosztPrzedzialu(0, 0, 50);
  assert.equal(w?.miedziRazem, 1);
});

test('ZLOTY ZESTAW: kazdy pomiar z logow pasuje do modelu i poziomu', () => {
  let sprawdzone = 0;
  for (const [nazwa, dane] of Object.entries(golden.umiejetnosci)) {
    if (dane.procentCeny === null) continue; // magiczne zwoje - niezmierzone
    const k = K_PO_NAZWIE[nazwa];
    assert.ok(k !== undefined, `brak umiejetnosci w silniku: ${nazwa}`);
    assert.equal(k, dane.procentCeny, `procent ceny ${nazwa}`);
    for (const p of dane.pomiary) {
      // model forward: koszt musi byc osiagalny z tabeli przy tym procencie ceny
      const poziomyModelu: number[] = [];
      for (let i = 0; i <= 100; i++) {
        if (Math.max(1, Math.trunc(KOSZT_BAZOWY[i] * k / 100)) === p.koszt_mdz) {
          poziomyModelu.push(i);
        }
      }
      assert.ok(
        poziomyModelu.length > 0,
        `${nazwa}: koszt ${p.koszt_mdz} mdz nieosiagalny przy k=${k}%`
      );
      // rekonstrukcja poziomu przez silnik (tryb 'nastepny' - tabelka
      // pokazuje koszt treningu przy obecnym poziomie)
      const poziom = obecnyPoziom({ zloto: 0, srebro: 0, miedz: p.koszt_mdz }, k, 'nastepny');
      assert.ok(
        p.poziomy.includes(poziom),
        `${nazwa}: koszt ${p.koszt_mdz} mdz -> silnik daje poziom ${poziom}, gra pokazywala ${p.poziomy}`
      );
      sprawdzone++;
    }
  }
  assert.equal(sprawdzone, 287, 'złoty zestaw ma 287 pomiarow');
});

test('obecny poziom — tryby ostatni/nastepny', () => {
  // 7 mdz przy k=100: koszt treningu z poziomu 2 na 3
  assert.equal(obecnyPoziom({ zloto: 0, srebro: 0, miedz: 7 }, 100, 'ostatni'), 3);
  assert.equal(obecnyPoziom({ zloto: 0, srebro: 0, miedz: 7 }, 100, 'nastepny'), 2);
  // 1 mdz (clamp) przy k=50: trenujesz z poziomu 0 lub 1
  assert.equal(obecnyPoziom({ zloto: 0, srebro: 0, miedz: 1 }, 50, 'nastepny'), 0);
});

test('obecny poziom — obcinanie do 100', () => {
  assert.equal(obecnyPoziom({ zloto: 9999, srebro: 0, miedz: 0 }, 100, 'ostatni'), 100);
});

test('koszt przedzialu — suma włacznie z oboma koncami, clamp per trening', () => {
  // poziomy 0..9 przy k=100: per trening max(1, F(i))
  const suma = 1 + 1 + 7 + 19 + 37 + 61 + 91 + 127 + 169 + 217;
  const w = kosztPrzedzialu(0, 9, 100);
  assert.equal(w?.miedziRazem, suma);
  // 50..60 przy k=46 (sztylety): trunc per skladnik
  const suma46 = Array.from({ length: 11 }, (_, j) => 50 + j)
    .reduce((a, i) => a + Math.max(1, Math.trunc((3 * i * i - 3 * i + 1) * 46 / 100)), 0);
  assert.equal(kosztPrzedzialu(50, 60, 46)?.miedziRazem, suma46);
});

test('od > do -> null', () => {
  assert.equal(kosztPrzedzialu(20, 10, 100), null);
});
