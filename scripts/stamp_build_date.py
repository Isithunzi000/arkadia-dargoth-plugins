#!/usr/bin/env python3
"""Stamp daty builda: nadpisuje stempel dzisiejsza data (DD-MM-YYYY).

Odpalac PRZED buildem/tagiem (zip == zrodlo bajtowo; determinizm
make_release_zip nienaruszony - FIXED_DATE, STORED, sort).
Wzorzec stempla musi trafic dokladnie raz, inaczej exit 1.
Re-run tego samego dnia = no-op.

Uzycie:
  python3 scripts/stamp_build_date.py [katalog_zrodlowy]
Katalog zrodlowy z <plugin>/index.ts (zrodlo prawdy w zipach;
  stamp na rozpakowanym drzewie przed make_release_zip.py)."""
import os
import re
import sys
from datetime import date

TODAY = date.today().strftime("%d-%m-%Y")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGETS = [
    ('ishtar_cal/index.ts',
     re.compile(r'const PLUGIN_BUILD_DATE = "\d{2}-\d{2}-\d{4}"'),
     'const PLUGIN_BUILD_DATE = "%s"'),
    ('imperium_cal/index.ts',
     re.compile(r'const PLUGIN_BUILD_DATE = "\d{2}-\d{2}-\d{4}"'),
     'const PLUGIN_BUILD_DATE = "%s"'),
    ('truwer/index.ts',
     re.compile(r'const PLUGIN_BUILD_DATE = "\d{2}-\d{2}-\d{4}"'),
     'const PLUGIN_BUILD_DATE = "%s"'),
]

# tryb "strict": brak pliku = blad; tryb "scan": brak pliku = pomijamy
# (drzewo zrodel moze zawierac tylko czesc pakietow), ale gdy nie
# znaleziono ZADNEGO celu -> exit 1.
STRICT = False


def stamp_file(root, rel, rx, template):
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        if STRICT:
            raise SystemExit("BLAD: brak pliku " + path)
        print("pomijam: " + rel + " (brak w drzewie zrodel)")
        return None
    with open(path, encoding="utf-8", newline="") as f:
        s = f.read()
    hits = rx.findall(s)
    if len(hits) != 1:
        raise SystemExit(
            "BLAD: wzorzec stempla w %s: %d trafien (oczekiwano 1)"
            % (rel, len(hits)))
    new = template % TODAY
    if hits[0] == new:
        print("bez zmian: %s (juz %s)" % (rel, TODAY))
        return False
    s = s.replace(hits[0], new, 1)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    print("stamp: %s: %s -> %s" % (rel, hits[0], new))
    return True


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else HERE
    wyniki = [stamp_file(root, *t) for t in TARGETS]
    znalezione = [w for w in wyniki if w is not None]
    if not znalezione:
        raise SystemExit("BLAD: nie znaleziono zadnego celu w " + root)
    print("gotowe: zmieniono %d plik(ow)" % sum(znalezione))


if __name__ == "__main__":
    main()
