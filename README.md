# Arkadia Dargoth Plugins

Pluginy do klienta Dargoth (Arkadia MUD).  
GitHub Actions automatycznie buduje i wdraża pluginy po każdym push zipa do `releases/`.

## URL pluginów

```
https://isithunzi000.github.io/arkadia-dargoth-plugins/imperium_cal.js
https://isithunzi000.github.io/arkadia-dargoth-plugins/ishtar_cal.js
https://isithunzi000.github.io/arkadia-dargoth-plugins/truwer.js
```

## Jak dodać plugin w Dargoth

W ustawieniach klienta podaj wybrany URL jako adres pluginu.  
Od tej chwili aktualizacje przychodzą automatycznie przy każdym odświeżeniu klienta.  
Możesz dodać jeden, dwa lub wszystkie trzy — niezależnie od siebie.

## Jak wgrać aktualizację

1. Wrzuć nowy ZIP do folderu `releases/` (konwencja: `pluginname_wersja.zip`)
2. Zrób commit i push
3. GitHub Actions automatycznie buduje i wdraża (~30–60 sek)

## Struktura repo

```
releases/           <- tu wgrywasz ZIPy
scripts/
  build.js          <- skrypt budujący (nie zmieniaj)
.github/workflows/
  build.yml         <- definicja CI/CD (nie zmieniaj)
dist/               <- generowane automatycznie przez Actions
  imperium_cal.js
  ishtar_cal.js
  truwer.js
  index.json
```

## Ustawienie GitHub Pages (jednorazowo)

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: **gh-pages** / root
3. Save
