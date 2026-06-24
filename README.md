# Pluginy do klienta Dargoth — Arkadia MUD

Trzy pluginy do przeglądarowego klienta Dargoth dla gry Arkadia MUD.  
Instalujesz raz przez URL — aktualizacje przychodzą automatycznie przy każdym odświeżeniu klienta.

---

## Kalendarz Imperium — `/imperium`

Wypisuje do okna gry przybliżony czas do najbliższych wydarzeń w domenie Imperium:

- nów i pełnia Mannslieb (z godziną widoczności sierpa po zachodzie słońca)
- najbliższe wydarzenie sezonowe (wiosna, lato, jesień, zima)
- wszystkie święta interkalarne: Hexentag, Mitterfruhl, Sonnstill, Mittherbst, Mondstille
- Hexennacht i Geheimnisnacht

Jeśli event właśnie trwa — zamiast czasu oczekiwania zobaczysz **TRWA TERAZ** z godziną zakończenia.

**Użycie:** wpisz `/imperium` w linii poleceń klienta.  
**Pomoc:** kliknij **Kalendarz Imperium** w menu wtyczek klienta.

**URL do instalacji:**
```
https://isithunzi000.github.io/arkadia-dargoth-plugins/imperium_cal.js
```

---

## Kalendarz Ishtar — `/ishtar`

Wypisuje do okna gry przybliżony czas do najbliższych wydarzeń w domenie Ishtar:

- główne święta magiczne: Belleteyn i Saovine
- święta astronomiczne i magiczne: Midinvaerne, Birke, Midaete, Velen, Imbaelk, Lammas
- pełnia księżyca (okno 2 dni)
- Festyn w Eysenlaan — dwa najbliższe wystąpienia z przedziałem od–do

Jeśli event właśnie trwa — zobaczysz **TRWA TERAZ** z godziną zakończenia.

**Użycie:** wpisz `/ishtar` w linii poleceń klienta.  
**Pomoc:** kliknij **Kalendarz Ishtar** w menu wtyczek klienta.

**URL do instalacji:**
```
https://isithunzi000.github.io/arkadia-dargoth-plugins/ishtar_cal.js
```

---

## Truwer — `/truwer`

Asystent odgrywania scen. Pozwala przygotować scenę jako listę kroków (komend gry) i odegrać ją we własnym tempie, krok po kroku. **Plugin nigdy nic nie wysyła sam** — każda wysyłka to Twój świadomy klik.

Co możesz zrobić:

- tworzyć sceny z kroków: komend gry, pauz z odliczaniem i notatek tylko dla siebie
- w jednej komendzie podać kilka wariantów oddzielonych `|` — przy odgrywaniu plugin losuje jeden z nich
- importować sceny z pliku `.txt` lub `.json`, eksportować je z powrotem
- trzymać osobną bibliotekę scen dla każdej postaci

Przy odgrywaniu widzisz listę kroków, aktywny jest podświetlony. Możesz edytować tekst tuż przed wysłaniem bez trwałej zmiany sceny.

**Użycie:** wpisz `/truwer` w linii poleceń klienta, albo kliknij **Truwer** w menu wtyczek.  
**Pomoc:** przycisk **Pomoc** wewnątrz okienka pluginu.

**URL do instalacji:**
```
https://isithunzi000.github.io/arkadia-dargoth-plugins/truwer.js
```

---

## Jak zainstalować

1. Kliknij przycisk **Skrypty** w kliencie Dargoth
2. Wpisz URL wybranego pluginu i kliknij **Dodaj**
3. Gotowe — wtyczka ładuje się przy każdym odświeżeniu klienta, zawsze aktualna

Możesz zainstalować jeden, dwa lub wszystkie trzy pluginy — niezależnie od siebie.

---

## Uwagi

- Kalendarze działają na bazie komendy `czas` — plugin automatycznie ją wysyła i parsuje odpowiedź serwera
- Przelicznik czasu: **2 sekundy RL = 1 minuta IG** (120 sek RL = 1 godz IG)
- Jeśli serwer nie odpowie na `czas` w ciągu 3,5 sekundy, plugin wyświetli komunikat o błędzie zamiast zgadywać

---

*Pluginy działają wyłącznie z klientem Dargoth (przeglądarkowym). Nie są przeznaczone dla innych klientów MUD.*
