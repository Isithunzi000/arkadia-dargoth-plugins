/**
 * Testy interfejsu okna: natywny rozmiar startowy popupow klienta
 * (initialWidth/initialHeight w registerPersistentPopup; klient dowiózł
 * feature 2026-09-23) i oficjalne klasy klawiszy naglowka.
 * Strazniki regresji: znikniecie rozmiaru albo klasy = czerwono od razu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/treningi/index.ts'), 'utf-8'
);

test('glowne okno ma natywny rozmiar startowy 400x720', () => {
  assert.match(SRC, /id:\s*POPUP_ID,[\s\S]{0,200}initialWidth:\s*400/);
  assert.match(SRC, /id:\s*POPUP_ID,[\s\S]{0,200}initialHeight:\s*720/);
});

test('tabela zawodow dopasowana do tresci (content/content, bez max-height)', () => {
  assert.match(SRC, /id:\s*"treningi-zawody"[\s\S]{0,300}initialWidth:\s*"content"/);
  assert.match(SRC, /id:\s*"treningi-zawody"[\s\S]{0,300}initialHeight:\s*"content"/);
  assert.ok(!SRC.includes('max-height: 60vh'), 'wrap tabeli bez capa 60vh');
});

test('pomoc jako osobne okienko dopasowane do tresci', () => {
  assert.match(SRC, /id:\s*"treningi-pomoc"[\s\S]{0,300}initialWidth:\s*440/);
  assert.match(SRC, /id:\s*"treningi-pomoc"[\s\S]{0,300}initialHeight:\s*"content"/);
});

test('hak min-height i media query usuniete (rozmiar jest natywny)', () => {
  assert.ok(!SRC.includes('data-panel-id$='), 'bez haka na data-panel-id');
  assert.ok(!SRC.includes('@media (max-height: 700px)'), 'bez media query kompresji');
});

test('tabela kompaktowa: wszystko widac przy 720p (font 10px, padding 2px 6px)', () => {
  assert.match(SRC, /\.trng-tab \{ border-collapse: collapse; font-size: 10px;/);
  assert.match(SRC, /\.trng-tab th, \.trng-tab td \{ padding: 2px 6px;/);
});

test('legenda tabeli jednolinijkowa (miesci sie przy 720p)', () => {
  assert.ok(SRC.includes('Przygaszone = limit jak w GP · ciosy specjalne: 75% bez polecenia, 100% z poleceniem.'));
  assert.ok(!SRC.includes('Przygaszone — zawód nie oferuje tej umiejętności'), 'stara dwulinijkowa legenda zniknela');
});

test('klawisze naglowka z oficjalnymi klasami klienta', () => {
  assert.match(SRC, /popup-btn popup-btn--control popup-btn--sm popup-btn--ghost/);
  assert.match(SRC, /headerActions/);
});
