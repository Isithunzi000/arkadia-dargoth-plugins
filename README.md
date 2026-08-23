# Pluginy do klienta Dargoth — Arkadia MUD

Trzy pluginy do przeglądarowego klienta Dargoth dla gry Arkadia MUD.  
Instalujesz raz — aktualizacje przychodzą automatycznie, nic nie musisz robić.

---

## Jak zainstalować

1. W kliencie Dargoth otwórz menu i kliknij **Skrypty**
2. Wpisz URL pluginu który chcesz zainstalować i kliknij **Dodaj**
3. Gotowe

Możesz zainstalować jeden, dwa lub wszystkie trzy — niezależnie od siebie.

---

## Kalendarz Imperium

**URL:**
```
https://isithunzi000.github.io/arkadia-dargoth-plugins/imperium_cal.js
```

Wpisz `/imperium` żeby zobaczyć wyniki.

Pokazuje przybliżony czas do najbliższych wydarzeń w domenie Imperium:

- nów i pełnia Mannslieb (z godziną widoczności sierpa po zachodzie słońca)
- najbliższe wydarzenie sezonowe (wiosna, lato, jesień, zima)
- święta interkalarne: Hexentag, Mitterfruhl, Sonnstill, Mittherbst, Mondstille
- Hexennacht i Geheimnisnacht

Jeśli event właśnie trwa — zobaczysz **TRWA TERAZ** z godziną zakończenia.

Pomoc: kliknij **Kalendarz Imperium** w menu klienta.

---

## Kalendarz Ishtar

**URL:**
```
https://isithunzi000.github.io/arkadia-dargoth-plugins/ishtar_cal.js
```

Wpisz `/ishtar` żeby zobaczyć wyniki.

Pokazuje przybliżony czas do najbliższych wydarzeń w domenie Ishtar:

- główne święta magiczne: Belleteyn i Saovine
- święta astronomiczne i magiczne: Midinvaerne, Birke, Midaete, Velen, Imbaelk, Lammas
- pełnia księżyca (okno 2 dni)
- Festyn w Eysenlaan — dwa najbliższe wystąpienia z przedziałem od–do

Jeśli event właśnie trwa — zobaczysz **TRWA TERAZ** z godziną zakończenia.

Pomoc: kliknij **Kalendarz Ishtar** w menu klienta.

---

## Truwer

**URL:**
```
https://isithunzi000.github.io/arkadia-dargoth-plugins/truwer.js
```

Wpisz `/truwer` żeby otworzyć okno pluginu (albo kliknij **Truwer** w menu Skrypty).

Asystent odgrywania scen. Pozwala przygotować scenę jako listę kroków i odegrać ją krok po kroku. **Plugin nigdy nic nie wysyła sam** — każda wysyłka to Twój świadomy klik.

Co możesz zrobić:

- tworzyć sceny z kroków: komend gry, pauz z odliczaniem i notatek tylko dla siebie
- w jednej komendzie podać kilka wariantów oddzielonych `|` — przy odgrywaniu plugin losuje jeden z nich
- importować sceny z pliku `.txt` lub `.json`, eksportować je z powrotem
- trzymać osobną bibliotekę scen dla każdej postaci

Pomoc: przycisk **Pomoc** wewnątrz okna pluginu.

---

## Uwagi

- Kalendarze działają na bazie komendy `czas` — plugin wysyła ją automatycznie i parsuje odpowiedź serwera
- Przelicznik czasu: 2 sekundy RL = 1 minuta IG
- Jeśli serwer nie odpowie na `czas` w ciągu 3,5 s, plugin pokaże wyniki z zapisanej daty (jeśli ją ma), a dopiero gdy jej nie ma — komunikat o błędzie

---

## Dla maintainera

Nowa wersja pluginu: edytuj `index.ts` i `plugin.json` (źródła to zawartość najnowszego zipa danego pluginu w `releases/`), potem `python3 scripts/make_release_zip.py <katalog_źródłowy> <plugin> X.Y.Z` → commit z nowym zipem w `releases/` → push. Workflow Pages sam buduje `dist/` i `index.json` — odpala się wyłącznie przy zmianie `releases/*.zip`. Build jest deterministyczny: te same źródła = identyczny SHA-256 zipa.

---

*Pluginy działają wyłącznie z klientem Dargoth (przeglądarkowym).*
