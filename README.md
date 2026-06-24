# Arkadia Plugins

Pluginy do klienta Dargoth (Arkadia MUD). GitHub Actions automatycznie buduje
i wdraża pluginy po każdym push zipa do `releases/`.

## URL pluginów (GitHub Pages)

```
https://<twoj-login>.github.io/<nazwa-repo>/imperium_cal.js
https://<twoj-login>.github.io/<nazwa-repo>/ishtar_cal.js
https://<twoj-login>.github.io/<nazwa-repo>/truwer.js
```

## Jak dodać plugin w Dargoth

W ustawieniach klienta podaj URL jako adres pluginu — od tej chwili aktualizacje
przychodzą automatycznie przy każdym odświeżeniu klienta.

## Jak wgrać aktualizację

1. Wrzuć nowy ZIP do folderu `releases/` (konwencja: `pluginname_wersja.zip`)
2. Zrób commit i push
3. GitHub Actions automatycznie buduje i wdraża (~30–60 sek)

Stary ZIP możesz zostawić lub usunąć — liczy się tylko najnowszy dla danego pluginu.

## Struktura repo

```
releases/           <- tu wgrywasz ZIPy
  imperium_cal_1_8_11.zip
  ishtar_cal_1_8_11.zip
  truwer_1_0_2.zip
scripts/
  build.js          <- skrypt budujący (nie zmieniaj)
.github/workflows/
  build.yml         <- definicja CI/CD (nie zmieniaj)
dist/               <- generowane automatycznie (nie commituj ręcznie)
  imperium_cal.js
  ishtar_cal.js
  truwer.js
  index.json
```

## Ustawienie GitHub Pages (jednorazowo)

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: **gh-pages** / root
3. Save
