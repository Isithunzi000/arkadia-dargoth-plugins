/**
 * Treningi - kalkulator kosztow treningu Arkadii, plugin do klienta Dargoth.
 * Alias: /treningi (otwiera/zamyka okienko). Menu wtyczek: "Treningi".
 * Klawisze w stopce: Pomoc (instrukcja) i Tabela zawodow (poziomy
 * maksymalne wg zawodu).
 *
 * Model gry: cena treningu z poziomu i na i+1 =
 * max(1, trunc(F(i) * procentCeny / 100)), F(i) = 3*i*i - 3*i + 1.
 * Wszystkie wartosci zweryfikowane pomiarami z gry (tests/).
 *
 * Plugin w pelni zgodny z regulaminem gry - czysty kalkulator,
 * zero automatyki, zero wysylania komend.
 */

// ==========================================================================
// SILNIK KOSZTOW (matematyka, dane umiejetnosci)
// ==========================================================================

/** Waluta: 1 złoto = 20 srebra = 240 miedzi; 1 srebro = 12 miedzi; 1 mithryl = 100 złota. */
export const MIEDZ_NA_SREBRO = 12;
export const MIEDZ_NA_ZLOTO = 240;
export const ZLOTE_NA_MITHRYL = 100;

/** Gra pobiera minimum 1 mdz nawet tam, gdzie wzor daje 0 (poziomy 0-1). */
export const MIN_CENA_TRENINGU = 1;

/**
 * Bazowy koszt treningu z poziomu i na i+1, w miedzi, dla procentu ceny 100%.
 * Indeks 0 = 0 (wartownik). Wzor zweryfikowany z gra: 3*i*i - 3*i + 1.
 */
export const KOSZT_BAZOWY: readonly number[] = [
  0,
  ...Array.from({ length: 100 }, (_, j) => {
    const i = j + 1;
    return 3 * i * i - 3 * i + 1;
  }),
];

/**
 * Umiejetnosci i ich procenty ceny (%). Procenty zmierzone z logow gry
 * 2026-08-26, poza: szacowanie (z oryginalnego kalkulatora, niezmierzone).
 */
export const UMIEJETNOSCI: ReadonlyArray<{ nazwa: string; procentCeny: number }> = [
  { nazwa: 'akrobatyka', procentCeny: 70 },
  { nazwa: 'alchemia', procentCeny: 70 },
  { nazwa: 'blokowanie wyjscia', procentCeny: 100 },
  { nazwa: 'bronie drzewcowe', procentCeny: 80 },
  { nazwa: 'kieszonkostwo', procentCeny: 70 },
  { nazwa: 'lowiectwo', procentCeny: 50 },
  { nazwa: 'maczugi', procentCeny: 50 },
  { nazwa: 'miecze', procentCeny: 100 },
  { nazwa: 'mierzony cios', procentCeny: 100 },
  { nazwa: 'mloty', procentCeny: 80 },
  { nazwa: 'ocena obiektu', procentCeny: 50 },
  { nazwa: 'ocena przeciwnika', procentCeny: 50 },
  { nazwa: 'opieka nad zwierzetami', procentCeny: 50 },
  { nazwa: 'otwieranie zamkow', procentCeny: 70 },
  { nazwa: 'parowanie', procentCeny: 80 },
  { nazwa: 'plywanie', procentCeny: 50 },
  { nazwa: 'rozkazy', procentCeny: 100 },
  { nazwa: 'skradanie sie', procentCeny: 70 },
  { nazwa: 'spostrzegawczosc', procentCeny: 50 },
  { nazwa: 'szacowanie', procentCeny: 50 },
  { nazwa: 'sztylety', procentCeny: 46 },
  { nazwa: 'tarczownictwo', procentCeny: 80 },
  { nazwa: 'targowanie sie', procentCeny: 50 },
  { nazwa: 'topory', procentCeny: 70 },
  { nazwa: 'tropienie', procentCeny: 50 },
  { nazwa: 'ukrywanie sie', procentCeny: 70 },
  { nazwa: 'uniki', procentCeny: 80 },
  { nazwa: 'walka bez broni', procentCeny: 90 },
  { nazwa: 'walka dwiema bronmi', procentCeny: 100 },
  { nazwa: 'walka pokazowa', procentCeny: 100 },
  { nazwa: 'walka w ciemnosci', procentCeny: 95 },
  { nazwa: 'walka w szyku', procentCeny: 100 },
  { nazwa: 'wspinaczka', procentCeny: 50 },
  { nazwa: 'wyczucie kierunku', procentCeny: 50 },
  { nazwa: 'wykrywanie pulapek', procentCeny: 70 },
  { nazwa: 'zaslanianie', procentCeny: 100 },
  { nazwa: 'zielarstwo', procentCeny: 70 },
  { nazwa: 'znajomosc jezykow', procentCeny: 50 },
];

/** Tryb podanego kosztu: 'ostatni' = koszt ostatniego treningu, 'nastepny' = koszt następnego. */
export type TrybKosztu = 'ostatni' | 'nastepny';

/**
 * Cios specjalny (umiejetnosc specjalna z zawodu). Cena zawsze 100% tabeli
 * (zmierzone: mierzony cios, walka pokazowa - czyste wartosci tabeli).
 * Poziom maksymalny: 75 bez polecenia stowarzyszenia, 100 z poleceniem —
 * jako jedyna kategoria treningowa moze przekroczyc limity zawodowe.
 * (wiki: "Wysokosc treningu ciosow specjalnych ... polecona 100,
 * nie polecona 75"; logi 2026-08-26 potwierdzaja.)
 */
export const CIOS_SPECJALNY = {
  procentCeny: 100,
  poziomMaksymalnyBezPolecenia: 75,
  poziomMaksymalnyZPoleceniem: 100,
} as const;

export interface Koszt {
  zloto: number;
  srebro: number;
  miedz: number;
}

export interface WynikPrzedzialu {
  /** Suma w miedzi. */
  miedziRazem: number;
  mithryl: number;
  zloto: number;
  srebro: number;
  miedz: number;
  /** Ustawione, gdy przedzial obcieto do poziomu maksymalnego. */
  obcietyDo?: number;
}

/** Zamiana na miedź: zł*240 + sr*12 + mdz. */
export function naMiedz(k: Koszt): number {
  return k.zloto * MIEDZ_NA_ZLOTO + k.srebro * MIEDZ_NA_SREBRO + k.miedz;
}

/** Rozbicie kwoty w miedzi na mithryl/złoto/srebro/miedź. */
export function zMiedzi(miedzi: number): WynikPrzedzialu {
  const zloteRazem = Math.trunc(miedzi / MIEDZ_NA_ZLOTO);
  const reszta = miedzi % MIEDZ_NA_ZLOTO;
  return {
    miedziRazem: miedzi,
    mithryl: Math.trunc(zloteRazem / ZLOTE_NA_MITHRYL),
    zloto: zloteRazem % ZLOTE_NA_MITHRYL,
    srebro: Math.trunc(reszta / MIEDZ_NA_SREBRO),
    miedz: reszta % MIEDZ_NA_SREBRO,
  };
}

/**
 * Cena treningu z poziomu i na i+1 przy procencie ceny k (%).
 * Dokladnie tak liczy gra: max(1, trunc(KOSZT_BAZOWY[i] * k / 100)).
 */
export function cenaTreningu(poziom: number, procentCeny: number): number {
  return Math.max(
    MIN_CENA_TRENINGU,
    Math.trunc(KOSZT_BAZOWY[poziom] * procentCeny / 100)
  );
}

/**
 * Obecny poziom umiejetnosci na podstawie kosztu treningu.
 * Szuka pierwszego poziomu i, dla ktorego cenaTreningu(i, k) >= podany koszt;
 * poziom = i+1 dla 'ostatni', i dla 'nastepny', obciety do 100.
 * Koszt powyzej maksymalnej ceny -> 100.
 */
export function obecnyPoziom(koszt: Koszt, procentCeny: number, tryb: TrybKosztu): number {
  const miedzi = naMiedz(koszt);
  for (let i = 0; i < KOSZT_BAZOWY.length; i++) {
    if (cenaTreningu(i, procentCeny) >= miedzi) {
      return Math.min(tryb === 'ostatni' ? i + 1 : i, 100);
    }
  }
  return 100;
}

/**
 * Łączny koszt treningow w przedziale [od, do] WLACZNIE, dla danego
 * procentu ceny. Kazdy trening liczony osobno: max(1, trunc(...)).
 * poziomMaksymalny (opcjonalny): koniec przedzialu powyzej poziomu
 * maksymalnego jest obcinany (wynik.obcietyDo); przedzial w calosci
 * powyzej -> null. Zwraca null tez, gdy 'do' < 'od'.
 */
export function kosztPrzedzialu(
  od: number,
  do_: number,
  procentCeny: number,
  poziomMaksymalny?: number
): WynikPrzedzialu | null {
  if (do_ - od < 0) return null;
  if (poziomMaksymalny !== undefined && od > poziomMaksymalny) return null;
  const doRzeczywiste =
    poziomMaksymalny !== undefined ? Math.min(do_, poziomMaksymalny) : do_;
  let suma = 0;
  for (let i = od; i <= doRzeczywiste; i++) {
    suma += cenaTreningu(i, procentCeny);
  }
  const wynik = zMiedzi(suma);
  if (doRzeczywiste !== do_) wynik.obcietyDo = doRzeczywiste;
  return wynik;
}

// ==========================================================================
// LOGIKA UI (sanityzacja, clamp, przedzial, formatowanie)
// ==========================================================================

/** Maksymalna kwota w polu pieniedzy (realny koszt treningu to ~65 tys. mdz; limit z zapasem, daleko od 32-bitowego przelania oryginalu). */
export const MAKS_KWOTA = 999_999;
/** Poziom umiejetnosci: 0-100 (tabela kosztow ma 101 wpisow). */
export const MAKS_POZIOM = 100;

/**
 * Zamienia dowolny wpis uzytkownika na liczbe calkowita z zakresu [0, maks].
 * - biale znaki obcinane; pusty wpis -> 0
 * - przecinek/kropka obcina reszte ("12,5" -> 12)
 * - z nie-separatorowych smieci zostaja same cyfry ("1 234 mdz" -> 1234)
 * - zera wiodace normalizowane, wynik clampowany do [0, maks]
 */
export function sanitizujLiczbe(wpis: string, maks: number): number {
  const czysty = wpis.trim();
  if (!czysty) return 0;
  const sep = czysty.search(/[.,]/);
  const czescCalkowita = sep >= 0 ? czysty.slice(0, sep) : czysty;
  const cyfry = czescCalkowita.replace(/\D+/g, '');
  if (!cyfry) return 0;
  const n = Number(cyfry);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.trunc(n), 0), maks);
}

/** Przedzial [od, do] porzadkowany rosnaco - kolejnosc wpisow nie ma znaczenia. */
export function porzadkujPrzedzial(od: number, do_: number): [number, number] {
  return od <= do_ ? [od, do_] : [do_, od];
}

/**
 * Zamienia wpis w polu "poziom maksymalny" na limit albo undefined (bez
 * limitu). Pusty wpis, smieci lub wartosc >= 100 = brak limitu (i tak nie da
 * sie wytrenowac powyzej 100). Wartosci 1-99 zwracane jako limit.
 */
export function limitZWpisu(wpis: string): number | undefined {
  const czysty = wpis.trim();
  if (!czysty) return undefined;
  const sep = czysty.search(/[.,]/);
  const czesc = sep >= 0 ? czysty.slice(0, sep) : czysty;
  const cyfry = czesc.replace(/\D+/g, '');
  if (!cyfry) return undefined;
  const n = Number(cyfry);
  if (!Number.isFinite(n)) return undefined;
  if (n >= MAKS_POZIOM) return undefined;
  return Math.max(1, Math.trunc(n));
}

/** Grupowanie tysiecy wg pl-PL (1234567 -> "1 234 567"). */
export function formatujLiczbe(n: number): string {
  return n.toLocaleString('pl-PL');
}

// ==========================================================================
// POZIOMY MAKSYMALNE WG ZAWODU (dane + limitDla)
// ==========================================================================

export const ZAWODY: readonly string[] = ["Partyzant", "Fanatyk", "Legionista", "Gladiator", "Korsarz", "Strażnik", "Lancknecht", "Nożownik", "Barbarzyńca", "Myśliwy", "Kupiec", "Odkrywca", "Gildia Podróżników"];

export interface WierszPoziomow {
  umiejetnosc: string;
  /** Wartosci w kolejnosci ZAWODY; null = zawod nie oferuje umiejetnosci. */
  limity: ReadonlyArray<number | null>;
}

export const TABELA_POZIOMOW: readonly WierszPoziomow[] = [
  { umiejetnosc: "broń", limity: [70, 74, 71, 75, 73, 74, 71, 72, 71, 65, null, 60, 30] },
  { umiejetnosc: "uniki", limity: [60, 45, 30, 42, 40, 50, 51, 70, 45, 55, null, 34, 25] },
  { umiejetnosc: "walka dwiema brońmi", limity: [50, 65, null, null, null, null, null, 55, null, null, null, null, 19] },
  { umiejetnosc: "tarczownictwo", limity: [null, null, 75, 60, 71, null, null, null, null, null, null, null, 25] },
  { umiejetnosc: "parowanie", limity: [40, 45, 50, 41, null, 71, 71, null, 55, null, null, 45, 25] },
  { umiejetnosc: "zasłanianie", limity: [45, 46, 41, 40, 60, 60, 40, 40, 41, null, null, null, 20] },
  { umiejetnosc: "blokowanie wyjścia", limity: [38, 44, null, null, 41, 55, null, 51, 45, null, null, null, 20] },
  { umiejetnosc: "rozkazy", limity: [30, null, 55, 30, 40, 50, 55, null, null, null, null, null, 15] },
  { umiejetnosc: "walka w szyku", limity: [null, 35, 75, 35, 45, 55, 50, null, 31, null, null, null, 15] },
  { umiejetnosc: "walka bez broni", limity: [null, null, 60, 55, 55, null, null, null, 60, null, null, null, 17] },
  { umiejetnosc: "walka w ciemności", limity: [null, null, 60, 55, 55, null, null, null, null, null, null, null, 15] },
  { umiejetnosc: "ukrywanie", limity: [80, null, null, null, null, null, null, 70, null, 80, null, null, 30] },
  { umiejetnosc: "skradanie", limity: [80, null, null, null, null, null, null, 70, null, 80, null, null, 24] },
  { umiejetnosc: "tropienie", limity: [60, 50, null, null, null, null, null, null, null, 75, null, null, 30] },
  { umiejetnosc: "zielarstwo", limity: [null, null, null, null, null, null, null, null, null, 59, 55, 41, 18] },
  { umiejetnosc: "spostrzegawczość", limity: [70, null, null, null, null, 65, null, 70, null, 75, 60, 71, 50] },
  { umiejetnosc: "wyczucie kierunku", limity: [60, null, null, null, 45, null, null, null, null, 60, null, 84, 30] },
  { umiejetnosc: "pływanie", limity: [55, null, null, null, 85, null, null, null, null, 55, null, 71, 42] },
  { umiejetnosc: "wspinaczka", limity: [60, null, null, null, 60, null, null, null, null, 60, null, 71, 50] },
  { umiejetnosc: "ocena przeciwnika", limity: [null, 50, 65, 85, 60, 65, 65, 85, 55, 54, 50, 50, 21] },
  { umiejetnosc: "ocena obiektu", limity: [null, null, 50, 50, 45, 55, 50, 50, 35, 40, 85, 41, 21] },
  { umiejetnosc: "łowiectwo", limity: [40, null, null, null, null, null, null, null, null, 77, null, 41, 25] },
  { umiejetnosc: "opieka nad zwierzetami", limity: [null, null, null, null, null, null, null, null, null, 74, null, 44, 24] },
  { umiejetnosc: "wykrywanie pulapek", limity: [null, null, null, null, null, null, null, null, null, 55, null, 55, 22] },
  { umiejetnosc: "otwieranie zamkow", limity: [null, null, null, null, null, null, null, 50, null, null, null, null, 15] },
  { umiejetnosc: "znajomosc jezykow", limity: [null, null, null, null, null, null, null, null, null, null, 70, 85, 40] },
  { umiejetnosc: "targowanie sie", limity: [null, null, null, null, null, null, null, null, null, null, 55, 42, 30] },
  { umiejetnosc: "szacowanie", limity: [null, null, null, null, null, null, null, null, null, null, 80, 50, 30] },
  { umiejetnosc: "alchemia", limity: [null, null, null, null, null, null, null, null, null, null, null, null, 20] },
  { umiejetnosc: "akrobatyka", limity: [null, null, null, null, null, null, null, null, null, null, null, null, 13] },
];

/**
 * Poziom maksymalny umiejetnosci dla danej sytuacji postaci.
 * zawod = null -> czyste GP (kolumna GP).
 * zawod oferuje umiejetnosc: z poleceniem = wartosc zawodu,
 *   bez = GP + 75% roznicy (zaokraglone).
 * zawod nie oferuje: szacunek GP + 75% roznicy do 100.
 * Nieznana umiejetnosc -> undefined.
 */
export function limitDla(
  umiejetnosc: string,
  zawod: string | null,
  polecenie: boolean
): number | undefined {
  const w = TABELA_POZIOMOW.find(x => x.umiejetnosc === umiejetnosc);
  if (!w) return undefined;
  const gp = w.limity[ZAWODY.length - 1];
  if (gp === null || gp === undefined) return undefined;
  if (zawod === null) return gp;
  const idx = ZAWODY.indexOf(zawod);
  if (idx < 0) return undefined;
  const z = w.limity[idx];
  // zawod nie oferuje umiejetnosci (kreska) -> limit taki sam jak GP
  if (z === null || z === undefined) {
    return gp;
  }
  return polecenie ? z : Math.round(gp + 0.75 * (z - gp));
}

/**
 * Limit do wyswietlenia w tabeli zawodow w danym trybie.
 * Z poleceniem: wartosc zawodu (dokladna). Bez: kolumna GP i kreski
 * dokladne, reszta przyblizona (GP + 75% roznicy, zaokraglone).
 * undefined = brak danych.
 */
export function limitWyswietlany(
  umiejetnosc: string,
  zawod: string,
  polecenie: boolean
): { wartosc: number; przyblizona: boolean } | undefined {
  const w = TABELA_POZIOMOW.find(x => x.umiejetnosc === umiejetnosc);
  if (!w) return undefined;
  const idx = ZAWODY.indexOf(zawod);
  if (idx < 0) return undefined;
  const gp = w.limity[ZAWODY.length - 1];
  if (gp === null || gp === undefined) return undefined;
  const z = w.limity[idx];
  const czyGP = idx === ZAWODY.length - 1;
  if (polecenie) {
    const v = z ?? gp;
    return { wartosc: v, przyblizona: false };
  }
  if (czyGP || z === null || z === undefined) {
    return { wartosc: gp, przyblizona: false };
  }
  return { wartosc: Math.round(gp + 0.75 * (z - gp)), przyblizona: true };
}

// ==========================================================================
// UI PLUGINU (popup, lista, pola, wyniki, stopka)
// ==========================================================================

const PLUGIN_VERSION = "1.6.8";
const PLUGIN_BUILD_DATE = "24-09-2026";

const POPUP_ID = "treningi";
const LS_KEY = "arkadia_treningi_stan_v1";

// ---------------------------------------------------------------------------
// Minimalne typy API klienta (strukturalne, zgodne z plugin-types Dargotha)
// ---------------------------------------------------------------------------

interface PopupOkno {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  onClose(cb: () => void): void;
}

interface UchwytMenu {
  remove(): void;
}

interface PluginApi {
  ui: {
    registerPersistentPopup(config: {
      id: string;
      title: string;
      createContent: () => HTMLElement;
      headerActions?: HTMLElement;
      initialWidth?: number | string;
      initialHeight?: number | string;
    }): Promise<PopupOkno>;
    addPopupMenuEntry(label: string, onSelect: () => void): UchwytMenu;
  };
  aliases: {
    register(pattern: RegExp, callback: () => boolean): unknown;
    remove(id: unknown): void;
  };
}

interface PluginInfo {
  name: string;
  version: string;
  author: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Stan
// ---------------------------------------------------------------------------

type Tryb = "ostatni" | "nastepny";

interface Stan {
  umiejetnosc: number; // indeks w UMIEJETNOSCI; -1 = nic; INNA_IDX = "inna umiejetnosc"
  tryb: Tryb;
  zloto: string;
  srebro: string;
  miedz: string;
  od: string;
  do_: string;
  filtr: string;
  innaProcent: string; // procent ceny dla "innej umiejetnosci" (1-100)
  innaMaxPoziom: string; // poziom maksymalny dla "innej umiejetnosci" (pusty = bez limitu)
  polecenie: boolean; // dla "ciosu specjalnego": z poleceniem (maks. 100%) lub bez (maks. 75%)
}

const CIOS_IDX = UMIEJETNOSCI.length;
const INNA_IDX = UMIEJETNOSCI.length + 1;

const STAN_DOMYSLNY: Stan = {
  umiejetnosc: -1,
  tryb: "ostatni",
  zloto: "",
  srebro: "",
  miedz: "",
  od: "",
  do_: "",
  filtr: "",
  innaProcent: "100",
  innaMaxPoziom: "",
  polecenie: false,
};

let stan: Stan = { ...STAN_DOMYSLNY };

function wczytajStan(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<Stan>;
    stan = {
      ...STAN_DOMYSLNY,
      ...s,
      umiejetnosc:
        typeof s.umiejetnosc === "number" &&
        s.umiejetnosc >= 0 &&
        s.umiejetnosc <= UMIEJETNOSCI.length + 1
          ? s.umiejetnosc
          : -1,
      tryb: s.tryb === "nastepny" ? "nastepny" : "ostatni",
      polecenie: s.polecenie === true,
      innaMaxPoziom:
        typeof s.innaMaxPoziom === "string" &&
        limitZWpisu(s.innaMaxPoziom) !== undefined
          ? String(limitZWpisu(s.innaMaxPoziom))
          : "",
      innaProcent:
        typeof s.innaProcent === "string" &&
        sanitizujLiczbe(s.innaProcent, 100) >= 1
          ? String(sanitizujLiczbe(s.innaProcent, 100))
          : "100",
      filtr: "",
    };
  } catch {
    stan = { ...STAN_DOMYSLNY };
  }
}

let zapisTimer: number | null = null;
function zapiszStan(): void {
  if (zapisTimer !== null) window.clearTimeout(zapisTimer);
  zapisTimer = window.setTimeout(() => {
    try {
      const { ...doZapisu } = stan;
      localStorage.setItem(LS_KEY, JSON.stringify(doZapisu));
    } catch {
      /* brak miejsca / tryb prywatny - ignorujemy */
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

const CSS = `
.trng { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; color: #e6e6f0; font-size: 13px; min-width: 300px; }
.trng * { box-sizing: border-box; }
.trng .trng-sekcja { display: flex; flex-direction: column; gap: 8px; }
.trng .trng-tytul { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #9a9ab5; }
.trng input[type="text"] { background: #23233a; border: 1px solid #3d3d5c; border-radius: 8px; color: #e6e6f0; padding: 7px 10px; font-size: 14px; outline: none; font-variant-numeric: tabular-nums; transition: border-color .15s; }
.trng input[type="text"]:focus { border-color: #7aa2f7; }
.trng input::placeholder { color: #8c8ca8; }
.trng-lista { max-height: 168px; overflow-y: auto; border: 1px solid #3d3d5c; border-radius: 8px; background: #1d1d30; }
.trng-lista button { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 7px 10px; background: none; border: none; border-bottom: 1px solid #26263e; color: #d8d8e8; font-size: 13px; cursor: pointer; text-align: left; }
.trng-lista button:last-child { border-bottom: none; }
.trng-lista button:hover { background: #2a2a44; }
.trng-lista button.trng-wybrana { background: #31437a; color: #fff; }
.trng-chip { display: inline-flex; flex-direction: column; align-items: center; padding: 2px 7px; border-radius: 7px; background: #34345a; color: #b9b9d6; font-variant-numeric: tabular-nums; line-height: 1.1; }
.trng-chip b { font-size: 11px; font-weight: 600; }
.trng-chip small { font-size: 8px; opacity: .75; }
.trng-wybrana .trng-chip { background: #4660a8; color: #fff; }
.trng-kwoty { display: flex; gap: 8px; }
.trng-pole { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.trng-pole label { font-size: 11px; color: #9a9ab5; display: flex; align-items: center; gap: 5px; }
.trng-kropka { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.trng-kropka.zl { background: #d4af37; }
.trng-kropka.sr { background: #b8b8c0; }
.trng-kropka.mz { background: #b5724a; }
.trng-pole input { width: 100%; text-align: right; }
.trng-radio { display: flex; gap: 8px; }
.trng-radio button { flex: 1; padding: 7px 6px; border-radius: 8px; border: 1px solid #3d3d5c; background: #23233a; color: #b9b9d6; font-size: 12px; cursor: pointer; transition: all .15s; }
.trng-radio button.trng-aktywne { background: #31437a; border-color: #7aa2f7; color: #fff; }
.trng-poziom { display: flex; align-items: baseline; justify-content: space-between; background: #1d1d30; border: 1px solid #3d3d5c; border-radius: 8px; padding: 10px 12px; }
.trng-poziom .trng-wartosc { font-size: 26px; font-weight: 700; color: #7aa2f7; font-variant-numeric: tabular-nums; }
.trng-poziom .trng-opis { font-size: 11px; color: #9a9ab5; }
.trng-zakres { display: flex; gap: 8px; }
.trng-spin { position: relative; display: flex; align-items: stretch; }
.trng .trng-spin input { padding-right: 26px; }
.trng-spin-guziki { position: absolute; right: 3px; top: 3px; bottom: 3px; display: flex; flex-direction: column; }
.trng-spin-guziki button { width: 18px; flex: 1; border: none; background: #34345a; color: #b9b9d6; font-size: 9px; line-height: 1; cursor: pointer; padding: 0; }
.trng-spin-guziki button:first-child { border-radius: 5px 5px 0 0; margin-bottom: 1px; }
.trng-spin-guziki button:last-child { border-radius: 0 0 5px 5px; }
.trng-spin-guziki button:hover { background: #4660a8; color: #fff; }
.trng-wynik { background: #1d1d30; border: 1px solid #3d3d5c; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.trng-nominaly { display: flex; flex-wrap: wrap; gap: 6px; }
.trng-nominal { font-size: 12px; padding: 3px 9px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.trng-nominal.mth { background: #2c3d66; color: #9fc0ff; }
.trng-nominal.zl { background: #4d4020; color: #ffd766; }
.trng-nominal.sr { background: #3c3c46; color: #d5d5e0; }
.trng-nominal.mz { background: #4a3128; color: #e8a87c; }
.trng-razem { font-size: 11px; color: #9a9ab5; }
.trng-notka { font-size: 11px; color: #8c8ca8; font-style: italic; }
.trng-podpowiedz { font-size: 12px; color: #8c8ca8; text-align: center; padding: 6px 0; }
.trng-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid #2c2c44; padding-top: 8px; margin-top: 2px; }
.trng-footer-btns { display: flex; gap: 6px; }
.trng-ghost { background: none; border: 1px solid #3d3d5c; border-radius: 7px; color: #9a9ab5; font-size: 11px; padding: 4px 10px; cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 5px; }
.trng-ghost:hover { border-color: #7aa2f7; color: #cdd6f4; }
.trng-hdr-btns { display: inline-flex; gap: 5px; }
.trng-ghost.trng-hdr { font-size: 10px; padding: 2px 8px; border-color: transparent; }
.trng-ghost.trng-hdr:hover { border-color: #7aa2f7; }
.trng-wybrana-teraz { font-size: 12px; color: #9fc0ff; background: #23233a; border: 1px solid #3d3d5c; border-radius: 7px; padding: 5px 10px; }
.trng-wybrana-teraz b { color: #cdd6f4; }
.trng-tab-tryb { display: flex; gap: 6px; margin-bottom: 8px; }
.trng-tab-tryb button { flex: 0 0 auto; padding: 5px 12px; border-radius: 7px; border: 1px solid #3d3d5c; background: #23233a; color: #b9b9d6; font-size: 11px; cursor: pointer; transition: all .15s; }
.trng-tab-tryb button.trng-aktywne { background: #31437a; border-color: #7aa2f7; color: #fff; }
.trng-tab td.trng-przybl { color: #8ea6e8; }
.trng-tab td.trng-przygas { color: #8c8ca8; font-style: italic; }
.trng-wersja { font-size: 10px; color: #8c8ca8; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trng-pomoc { background: #1d1d30; border: 1px solid #3d3d5c; border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.55; color: #c9c9dc; display: flex; flex-direction: column; gap: 6px; }
.trng-pomoc code { background: #31437a; color: #fff; border-radius: 5px; padding: 1px 7px; font-family: ui-monospace, monospace; font-size: 12px; }
.trng-pomoc b { color: #e6e6f0; }
.trng-tab-wrap { overflow: auto; border: 1px solid #3d3d5c; border-radius: 8px; position: relative; }
.trng-tab-wrap::after { content: ""; display: block; position: sticky; bottom: 0; height: 16px; margin-top: -16px; background: linear-gradient(transparent, rgba(12,12,24,.85)); pointer-events: none; }
.trng-tab-wrap.trng-na-dole::after { display: none; }
.trng-tab { border-collapse: collapse; font-size: 10px; font-variant-numeric: tabular-nums; }
.trng-tab th, .trng-tab td { padding: 2px 6px; border-bottom: 1px solid #26263e; white-space: nowrap; }
.trng-tab thead th { position: sticky; top: 0; background: #23233a; color: #b9b9d6; font-size: 10px; text-align: center; z-index: 2; }
.trng-tab tbody th { position: sticky; left: 0; background: #1d1d30; text-align: left; font-weight: 400; color: #d8d8e8; z-index: 1; }
.trng-tab tbody tr:nth-child(odd) td { background: #20203a; }
.trng-tab tbody tr:nth-child(even) td { background: #1b1b2e; }
.trng-tab td { text-align: center; color: #c9c9dc; }
.trng-tab td.trng-brak { color: #4c4c66; }
.trng-tab td.trng-gp, .trng-tab thead th.trng-gp { background: #31437a; color: #fff; }
.trng-tab-intro { font-size: 12px; color: #c9c9dc; margin-bottom: 8px; }
.trng-tab-legenda { font-size: 11px; color: #9a9ab5; margin-top: 8px; line-height: 1.5; }
`;

// ---------------------------------------------------------------------------
// Budowa UI
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let rootEl: HTMLElement | null = null;
let listaEl: HTMLElement | null = null;
let poziomWartoscEl: HTMLElement | null = null;
let wynikEl: HTMLElement | null = null;
let podpowiedzEl: HTMLElement | null = null;
let innaRowEl: HTMLElement | null = null;
let ciosRowEl: HTMLElement | null = null;
let wybranaEl: HTMLElement | null = null;

function aktualnyProcentCeny(): number {
  if (stan.umiejetnosc === INNA_IDX) {
    return Math.max(1, sanitizujLiczbe(stan.innaProcent, 100));
  }
  if (stan.umiejetnosc === CIOS_IDX) {
    return CIOS_SPECJALNY.procentCeny;
  }
  return UMIEJETNOSCI[stan.umiejetnosc]?.procentCeny ?? 100;
}

/** Poziom maksymalny dla wybranej pozycji; undefined = bez limitu. */
function aktualnyPoziomMaksymalny(): number | undefined {
  if (stan.umiejetnosc === INNA_IDX) return limitZWpisu(stan.innaMaxPoziom);
  if (stan.umiejetnosc !== CIOS_IDX) return undefined;
  return stan.polecenie
    ? CIOS_SPECJALNY.poziomMaksymalnyZPoleceniem
    : CIOS_SPECJALNY.poziomMaksymalnyBezPolecenia;
}

function aktualizuj(): void {
  if (!poziomWartoscEl || !wynikEl || !podpowiedzEl) return;

  if (innaRowEl) {
    innaRowEl.style.display = stan.umiejetnosc === INNA_IDX ? "" : "none";
  }
  if (ciosRowEl) {
    ciosRowEl.style.display = stan.umiejetnosc === CIOS_IDX ? "" : "none";
  }

  if (stan.umiejetnosc < 0) {
    poziomWartoscEl.textContent = "–";
    wynikEl.style.display = "none";
    podpowiedzEl.style.display = "";
    podpowiedzEl.textContent = "Wybierz umiejętność z listy powyżej.";
    if (wybranaEl) wybranaEl.style.display = "none";
    return;
  }
  podpowiedzEl.style.display = "none";
  const k = aktualnyProcentCeny();
  if (wybranaEl) {
    wybranaEl.style.display = "";
    const nazwaWybranej =
      stan.umiejetnosc === CIOS_IDX
        ? "cios specjalny"
        : stan.umiejetnosc === INNA_IDX
          ? "inna umiejętność"
          : UMIEJETNOSCI[stan.umiejetnosc].nazwa;
    wybranaEl.replaceChildren();
    wybranaEl.appendChild(document.createTextNode("Wybrana: "));
    wybranaEl.appendChild(el("b", "", nazwaWybranej));
    wybranaEl.appendChild(
      document.createTextNode(" · " + k + "% ceny bazowej")
    );
  }

  const koszt = {
    zloto: sanitizujLiczbe(stan.zloto, MAKS_KWOTA),
    srebro: sanitizujLiczbe(stan.srebro, MAKS_KWOTA),
    miedz: sanitizujLiczbe(stan.miedz, MAKS_KWOTA),
  };
  const poziom = obecnyPoziom(koszt, k, stan.tryb);
  poziomWartoscEl.textContent = poziom + "%";

  const od = sanitizujLiczbe(stan.od, MAKS_POZIOM);
  const do_ = sanitizujLiczbe(stan.do_, MAKS_POZIOM);
  const [odP, doP] = porzadkujPrzedzial(od, do_);
  const maks = aktualnyPoziomMaksymalny();
  const wynik = kosztPrzedzialu(odP, doP, k, maks);

  wynikEl.style.display = "";
  wynikEl.replaceChildren();
  if (!wynik) {
    if (maks !== undefined && odP > maks) {
      wynikEl.appendChild(
        el(
          "div",
          "trng-notka",
          "Ten zakres jest poza zasięgiem — poziom maksymalny to " +
            maks +
            "%."
        )
      );
    }
    return;
  }

  const nominaly = el("div", "trng-nominaly");
  const czesci: Array<[string, number, string]> = [
    ["mth", wynik.mithryl, "mithryl"],
    ["zl", wynik.zloto, "złoto"],
    ["sr", wynik.srebro, "srebro"],
    ["mdz", wynik.miedz, "miedź"],
  ];
  for (const [klasa, ile, nazwa] of czesci) {
    if (ile <= 0) continue;
    const chip = el("span", "trng-nominal " + klasa, ile + " " + klasa);
    chip.title = nazwa;
    nominaly.appendChild(chip);
  }
  if (!nominaly.hasChildNodes()) {
    nominaly.appendChild(el("span", "trng-nominal mz", "0 mdz"));
  }
  wynikEl.appendChild(nominaly);

  const razem = el(
    "div",
    "trng-razem",
    "razem: " + formatujLiczbe(wynik.miedziRazem) + " mdz"
  );
  wynikEl.appendChild(razem);

  if (wynik.obcietyDo !== undefined) {
    wynikEl.appendChild(
      el(
        "div",
        "trng-notka",
        "poziom maksymalny to " +
          wynik.obcietyDo +
          "% — policzono " +
          odP +
          "% → " +
          wynik.obcietyDo +
          "%"
      )
    );
  }

  if (od !== odP || do_ !== doP) {
    wynikEl.appendChild(
      el("div", "trng-notka", "policzono " + odP + "% → " + doP + "%")
    );
  }
}

function zmiana(czesc: Partial<Stan>): void {
  stan = { ...stan, ...czesc };
  zapiszStan();
  aktualizuj();
}

function poleSpin(
  label: string,
  kropkaCls: string | null,
  pobierz: () => string,
  ustaw: (v: string) => void,
  maks: number,
  tooltip: string
): HTMLElement {
  const pole = el("div", "trng-pole");
  const lab = el("label", "", label);
  if (kropkaCls) {
    const k = el("span", "trng-kropka " + kropkaCls);
    lab.prepend(k);
  }
  pole.appendChild(lab);

  const spin = el("div", "trng-spin");
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.placeholder = "0";
  input.title = tooltip;
  input.setAttribute("aria-label", label);
  input.value = pobierz();
  input.style.width = "100%";

  const zastosuj = (v: number) => {
    const n = Math.min(Math.max(v, 0), maks);
    input.value = n === 0 && pobierz() === "" ? "" : String(n);
    ustaw(input.value);
  };

  input.addEventListener("input", () => {
    ustaw(input.value);
  });
  input.addEventListener("blur", () => {
    const n = sanitizujLiczbe(input.value, maks);
    input.value = input.value.trim() === "" ? "" : String(n);
    ustaw(input.value);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      zastosuj(sanitizujLiczbe(input.value, maks) + 1);
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      zastosuj(sanitizujLiczbe(input.value, maks) - 1);
    }
  });

  const guziki = el("div", "trng-spin-guziki");
  const mkGuzik = (tekst: string, delta: number) => {
    const b = el("button", "", tekst);
    b.type = "button";
    b.tabIndex = -1;
    b.title = tooltip;
    let timer: number | null = null;
    let opoznienie: number | null = null;
    const krok = () => zastosuj(sanitizujLiczbe(input.value, maks) + delta);
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      if (opoznienie !== null) window.clearTimeout(opoznienie);
      timer = null;
      opoznienie = null;
    };
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      krok();
      opoznienie = window.setTimeout(() => {
        timer = window.setInterval(krok, 120);
      }, 400);
    });
    b.addEventListener("pointerup", stop);
    b.addEventListener("pointerleave", stop);
    b.addEventListener("pointercancel", stop);
    return b;
  };
  guziki.appendChild(mkGuzik("▲", 1));
  guziki.appendChild(mkGuzik("▼", -1));
  spin.appendChild(input);
  spin.appendChild(guziki);
  pole.appendChild(spin);
  return pole;
}

function budujListe(): void {
  if (!listaEl) return;
  listaEl.replaceChildren();
  const filtr = stan.filtr.trim().toLowerCase();
  let pokazane = 0;
  UMIEJETNOSCI.forEach((u, idx) => {
    if (filtr && !u.nazwa.toLowerCase().includes(filtr)) return;
    const b = el("button", idx === stan.umiejetnosc ? "trng-wybrana" : "");
    b.type = "button";
    b.appendChild(el("span", "", u.nazwa));
    const chip = el("span", "trng-chip");
    const chipB = el("b", "", u.procentCeny + "%");
    chip.appendChild(chipB);
    chip.appendChild(el("small", "", "ceny baz."));
    chip.title =
      "Trening tej umiejętności kosztuje " +
      u.procentCeny +
      "% ceny bazowej (standardowej).";
    b.appendChild(chip);
    b.addEventListener("click", () => {
      zmiana({ umiejetnosc: idx });
      budujListe();
      const sel = listaEl?.querySelector(".trng-wybrana");
      if (sel) sel.scrollIntoView({ block: "nearest" });
    });
    listaEl!.appendChild(b);
    pokazane++;
  });
  if (!pokazane) {
    listaEl.appendChild(
      el("div", "trng-podpowiedz", "Brak umiejętności pasujących do filtra.")
    );
  }
  // pozycja "inna umiejetnosc" - dla umiejetnosci spoza listy (reczny procent)
  const pokazCios = !filtr || "cios specjalny".includes(filtr);
  if (pokazCios) {
    const b = el("button", stan.umiejetnosc === CIOS_IDX ? "trng-wybrana" : "");
    b.type = "button";
    b.appendChild(el("span", "", "cios specjalny…"));
    const chip = el("span", "trng-chip");
    chip.appendChild(el("b", "", "100%"));
    chip.appendChild(el("small", "", "ceny baz."));
    chip.title =
      "Cios specjalny z zawodu: cena zawsze standardowa (100%). Poziom maksymalny zależy od polecenia — wybierzesz poniżej.";
    b.appendChild(chip);
    b.addEventListener("click", () => {
      zmiana({ umiejetnosc: CIOS_IDX });
      budujListe();
      const sel = listaEl?.querySelector(".trng-wybrana");
      if (sel) sel.scrollIntoView({ block: "nearest" });
    });
    listaEl.appendChild(b);
  }

  const pokazInna = !filtr || "inna umiejętność".includes(filtr);
  if (pokazInna) {
    const b = el("button", stan.umiejetnosc === INNA_IDX ? "trng-wybrana" : "");
    b.type = "button";
    b.appendChild(el("span", "", "inna umiejętność…"));
    const chip = el("span", "trng-chip");
    chip.appendChild(el("b", "", Math.max(1, sanitizujLiczbe(stan.innaProcent, 100)) + "%"));
    chip.appendChild(el("small", "", "ceny baz."));
    chip.title = "Umiejętność spoza listy — sam wybierasz procent ceny poniżej.";
    b.appendChild(chip);
    b.addEventListener("click", () => {
      zmiana({ umiejetnosc: INNA_IDX });
      budujListe();
      const sel = listaEl?.querySelector(".trng-wybrana");
      if (sel) sel.scrollIntoView({ block: "nearest" });
    });
    listaEl.appendChild(b);
  }
}

let popupZawody: PopupOkno | null = null;
let popupPomoc: PopupOkno | null = null;

function budujPomoc(): HTMLElement {
  const p = el("div", "trng-pomoc");
  const t1 = el("div");
  t1.appendChild(document.createTextNode(
    "Kalkulator liczy koszty treningów umiejętności. Wybierz umiejętność, "
  ));
  const b1 = el("b", "", "podaj cenę treningu");
  t1.appendChild(b1);
  t1.appendChild(document.createTextNode(
    " — dostaniesz obecny poziom. Wybierz "
  ));
  const b2 = el("b", "", "przedział poziomów");
  t1.appendChild(b2);
  t1.appendChild(document.createTextNode(" — dostaniesz łączny koszt."));
  p.appendChild(t1);
  const t2 = el("div");
  t2.appendChild(document.createTextNode("Okienko otwierasz komendą "));
  const kod = document.createElement("code");
  kod.textContent = "/treningi";
  t2.appendChild(kod);
  t2.appendChild(
    document.createTextNode(" albo klawiszem Treningi w menu wtyczek.")
  );
  p.appendChild(t2);
  p.appendChild(
    el(
      "div",
      "",
      "Wszystko przelicza się na żywo. Pola wpisujesz z klawiatury albo klikasz strzałkami."
    )
  );
  return p;
}

function budujTabeleZawodow(): HTMLElement {
  const SKROTY: Record<string, string> = {
    "Partyzant": "Part", "Fanatyk": "Fan", "Legionista": "Leg",
    "Gladiator": "Glad", "Korsarz": "Kors", "Strażnik": "Straż",
    "Lancknecht": "Lanc", "Nożownik": "Noż", "Barbarzyńca": "Barb",
    "Myśliwy": "Myśl", "Kupiec": "Kup", "Odkrywca": "Odkr",
    "Gildia Podróżników": "GP",
  };
  let bezPolecenia = false;

  const root = el("div", "trng");
  root.appendChild(
    el(
      "div",
      "trng-tab-intro",
      "Poziom maksymalny umiejętności w danym zawodzie. 1 trening = 1%."
    )
  );

  // przelacznik trybu: z poleceniem (dokladne wartosci) / bez (przyblizone)
  const trybRow = el("div", "trng-tab-tryb");
  const tab = document.createElement("table");
  tab.className = "trng-tab";
  const tbody = document.createElement("tbody");

  const przeliczTabele = () => {
    tbody.replaceChildren();
    for (const w of TABELA_POZIOMOW) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = w.umiejetnosc;
      tr.appendChild(th);
      ZAWODY.forEach((z, idx) => {
        const td = document.createElement("td");
        const wyn = limitWyswietlany(w.umiejetnosc, z, !bezPolecenia);
        if (!wyn) {
          td.textContent = "—";
          td.className = "trng-brak";
        } else if (w.limity[idx] === null) {
          // kreska w tabeli zrodlowej: zawod nie oferuje -> limit jak w GP,
          // pokazujemy wartosc GP przygaszona
          td.textContent = String(wyn.wartosc);
          td.className = "trng-przygas";
          td.title = "Zawód nie oferuje tej umiejętności — limit taki sam jak w GP.";
        } else {
          td.textContent = String(wyn.wartosc);
        }
        if (idx === ZAWODY.length - 1) td.classList.add("trng-gp");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  };

  const mkTryb = (bez: boolean, tekst: string, tooltip: string) => {
    const b = el(
      "button",
      bez === bezPolecenia ? "trng-aktywne" : "",
      tekst
    );
    b.type = "button";
    b.title = tooltip;
    b.addEventListener("click", () => {
      bezPolecenia = bez;
      trybRow.querySelectorAll("button").forEach((x) => {
        x.classList.toggle("trng-aktywne", x === b);
      });
      przeliczTabele();
      legPrzybl.style.display = bez ? "" : "none";
    });
    return b;
  };
  trybRow.appendChild(
    mkTryb(false, "z poleceniem", "Dokładne wartości — limit dla członka stowarzyszenia z poleceniem.")
  );
  trybRow.appendChild(
    mkTryb(true, "bez polecenia", "Przybliżone: GP + 75% różnicy między zawodem a GP.")
  );
  root.appendChild(trybRow);

  const wrap = el("div", "trng-tab-wrap");
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = "Umiejętność";
  th0.style.textAlign = "left";
  htr.appendChild(th0);
  for (const z of ZAWODY) {
    const th = document.createElement("th");
    th.textContent = SKROTY[z] || z;
    th.title = z;
    if (z === "Gildia Podróżników") {
      th.className = "trng-gp";
      th.title = "Gildia Podróżników — tyle treningów zrobisz bez zawodu";
    }
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  tab.appendChild(thead);
  przeliczTabele();
  tab.appendChild(tbody);
  wrap.appendChild(tab);
  // cien na dole znika, gdy doscrollowano do konca
  const cienCheck = () => {
    wrap.classList.toggle(
      "trng-na-dole",
      wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2
    );
  };
  wrap.addEventListener("scroll", cienCheck);
  window.requestAnimationFrame(cienCheck);
  root.appendChild(wrap);

  const leg = el("div", "trng-tab-legenda");
  leg.appendChild(
    el(
      "div",
      "",
      "Przygaszone = limit jak w GP · ciosy specjalne: 75% bez polecenia, 100% z poleceniem."
    )
  );
  const legPrzybl = el(
    "div",
    "",
    "Wartości w tym trybie są przybliżone (GP + 75% różnicy między zawodem a GP)."
  );
  legPrzybl.style.display = bezPolecenia ? "" : "none";
  leg.appendChild(legPrzybl);
  root.appendChild(leg);
  return root;
}

function budujKlawiszeNaglowka(): HTMLElement {
  const wrap = el("span", "trng-hdr-btns");
  const bPomoc = el("button", "popup-btn popup-btn--control popup-btn--sm popup-btn--ghost trng-hdr", "Pomoc");
  bPomoc.type = "button";
  bPomoc.title = "Krótka instrukcja obsługi.";
  bPomoc.addEventListener("click", () => {
    if (!popupPomoc) return;
    if (popupPomoc.isOpen) popupPomoc.close();
    else popupPomoc.open();
  });
  const bZawody = el("button", "popup-btn popup-btn--control popup-btn--sm popup-btn--ghost trng-hdr", "Tabela zawodów");
  bZawody.type = "button";
  bZawody.title = "Tabela poziomów maksymalnych umiejętności wg zawodu.";
  bZawody.addEventListener("click", () => {
    if (!popupZawody) return;
    if (popupZawody.isOpen) popupZawody.close();
    else popupZawody.open();
  });
  wrap.appendChild(bPomoc);
  wrap.appendChild(bZawody);
  return wrap;
}

function budujZawartosc(): HTMLElement {
  const root = el("div", "trng");
  rootEl = root;

  // Sekcja 1: umiejetnosc
  const sekcjaUm = el("div", "trng-sekcja");
  const tytulUm = el("div", "trng-tytul", "Umiejętność");
  tytulUm.title =
    "Treningi różnych umiejętności mają różne ceny — procent mówi, jak droga jest ta umiejętność.";
  sekcjaUm.appendChild(tytulUm);
  const filtr = document.createElement("input");
  filtr.type = "text";
  filtr.placeholder = "wpisz nazwę, np. miecze";
  filtr.title = "Filtruje listę umiejętności.";
  filtr.setAttribute("aria-label", "Szukaj umiejętności");
  filtr.addEventListener("input", () => {
    stan = { ...stan, filtr: filtr.value };
    budujListe();
  });
  sekcjaUm.appendChild(filtr);
  listaEl = el("div", "trng-lista");
  sekcjaUm.appendChild(listaEl);

  // przelacznik polecenia dla "ciosu specjalnego" (widoczny gdy wybrany)
  ciosRowEl = el("div", "trng-sekcja");
  ciosRowEl.style.display = "none";
  const ciosTytul = el("div", "trng-tytul", "Polecenie stowarzyszenia");
  ciosTytul.title =
    "Z poleceniem stowarzyszenia cios specjalny trenujesz do 100%, bez polecenia — do 75%.";
  ciosRowEl.appendChild(ciosTytul);
  const ciosGuziki = el("div", "trng-radio");
  const odswiezCios = () => {
    ciosGuziki.querySelectorAll("button").forEach((x) => {
      const b = x as HTMLButtonElement;
      b.classList.toggle(
        "trng-aktywne",
        (b.dataset.polecenie === "tak") === stan.polecenie
      );
    });
  };
  const mkPolecenie = (jest: boolean, tekst: string, tooltip: string) => {
    const b = el("button", "", tekst);
    b.type = "button";
    b.dataset.polecenie = jest ? "tak" : "nie";
    b.title = tooltip;
    b.addEventListener("click", () => {
      zmiana({ polecenie: jest });
      odswiezCios();
    });
    return b;
  };
  ciosGuziki.appendChild(
    mkPolecenie(
      false,
      "bez polecenia · maks. 75%",
      "Bez polecenia stowarzyszenia cios specjalny trenujesz maksymalnie do poziomu 75%."
    )
  );
  ciosGuziki.appendChild(
    mkPolecenie(
      true,
      "z poleceniem · maks. 100%",
      "Z poleceniem stowarzyszenia cios specjalny trenujesz do poziomu 100%."
    )
  );
  ciosRowEl.appendChild(ciosGuziki);
  sekcjaUm.appendChild(ciosRowEl);

  // wybor procenta dla "innej umiejetnosci" (widoczny tylko gdy wybrana)
  innaRowEl = el("div", "trng-sekcja");  innaRowEl.style.display = "none";
  const innaTytul = el(
    "div",
    "trng-tytul",
    "Jaki procent standardowej ceny?"
  );
  innaTytul.title =
    "Sprawdzisz to w grze: wpisz 'trenuj' u trenera i porównaj cenę z listą. Standard to 100%.";
  innaRowEl.appendChild(innaTytul);
  const innaGuziki = el("div", "trng-radio");
  const odswiezInne = () => {
    innaGuziki.querySelectorAll("button").forEach((x) => {
      const b = x as HTMLButtonElement;
      b.classList.toggle(
        "trng-aktywne",
        b.dataset.procent === String(sanitizujLiczbe(stan.innaProcent, 100))
      );
    });
  };
  for (const p of [50, 75, 100]) {
    const b = el("button", "", p + "%");
    b.type = "button";
    b.dataset.procent = String(p);
    b.title = "Trening tej umiejętności kosztuje " + p + "% ceny standardowej.";
    b.addEventListener("click", () => {
      zmiana({ innaProcent: String(p) });
      innaInput.value = "";
      odswiezInne();
      budujListe();
    });
    innaGuziki.appendChild(b);
  }
  const innaInput = document.createElement("input");
  innaInput.type = "text";
  innaInput.inputMode = "numeric";
  innaInput.placeholder = "własny %";
  innaInput.title = "Własny procent ceny standardowej (1-100).";
  innaInput.setAttribute("aria-label", "Własny procent ceny");
  innaInput.style.width = "90px";
  innaInput.addEventListener("input", () => {
    zmiana({ innaProcent: innaInput.value });
    odswiezInne();
  });
  innaInput.addEventListener("blur", () => {
    const n = Math.max(1, sanitizujLiczbe(innaInput.value, 100));
    innaInput.value = innaInput.value.trim() === "" ? "" : String(n);
    zmiana({ innaProcent: innaInput.value === "" ? "100" : String(n) });
    odswiezInne();
    budujListe();
  });
  innaGuziki.appendChild(innaInput);
  innaRowEl.appendChild(innaGuziki);

  // opcjonalny poziom maksymalny dla "innej umiejetnosci"
  const innaMaxPole = el("div", "trng-pole");
  const innaMaxLab = el("label", "", "poziom maksymalny");
  innaMaxPole.appendChild(innaMaxLab);
  const innaMaxInput = document.createElement("input");
  innaMaxInput.type = "text";
  innaMaxInput.inputMode = "numeric";
  innaMaxInput.placeholder = "100";
  innaMaxInput.title =
    "Najwyższy poziom, do którego możesz wytrenować tę umiejętność. Jeśli nie znasz limitu, zostaw puste — kalkulator policzy cały zakres.";
  innaMaxInput.setAttribute("aria-label", "Poziom maksymalny (opcjonalnie)");
  innaMaxInput.value = stan.innaMaxPoziom;
  innaMaxInput.style.width = "90px";
  innaMaxInput.addEventListener("input", () => {
    zmiana({ innaMaxPoziom: innaMaxInput.value });
  });
  innaMaxInput.addEventListener("blur", () => {
    const lim = limitZWpisu(innaMaxInput.value);
    innaMaxInput.value = lim === undefined ? "" : String(lim);
    zmiana({ innaMaxPoziom: innaMaxInput.value });
  });
  innaMaxPole.appendChild(innaMaxInput);
  innaRowEl.appendChild(innaMaxPole);
  sekcjaUm.appendChild(innaRowEl);
  root.appendChild(sekcjaUm);
  odswiezInne();
  odswiezCios();

  // linijka stanu: co jest wybrane
  wybranaEl = el("div", "trng-wybrana-teraz");
  wybranaEl.style.display = "none";
  root.appendChild(wybranaEl);

  // Sekcja 2: koszt treningu -> obecny poziom
  const sekcjaKoszt = el("div", "trng-sekcja");
  sekcjaKoszt.appendChild(el("div", "trng-tytul", "Koszt treningu"));
  const kwoty = el("div", "trng-kwoty");
  kwoty.appendChild(
    poleSpin(
      "złoto",
      "zl",
      () => stan.zloto,
      (v) => zmiana({ zloto: v }),
      MAKS_KWOTA,
      "Ile złotych monet zapłaciłeś za trening."
    )
  );
  kwoty.appendChild(
    poleSpin(
      "srebro",
      "sr",
      () => stan.srebro,
      (v) => zmiana({ srebro: v }),
      MAKS_KWOTA,
      "Ile srebrnych monet zapłaciłeś za trening."
    )
  );
  kwoty.appendChild(
    poleSpin(
      "miedź",
      "mz",
      () => stan.miedz,
      (v) => zmiana({ miedz: v }),
      MAKS_KWOTA,
      "Ile miedzianych monet zapłaciłeś za trening."
    )
  );
  sekcjaKoszt.appendChild(kwoty);

  const radio = el("div", "trng-radio");
  const mkTryb = (tryb: Tryb, tekst: string, tooltip: string) => {
    const b = el(
      "button",
      stan.tryb === tryb ? "trng-aktywne" : "",
      tekst
    );
    b.type = "button";
    b.title = tooltip;
    b.addEventListener("click", () => {
      zmiana({ tryb });
      radio.querySelectorAll("button").forEach((x) => {
        x.classList.toggle("trng-aktywne", x === b);
      });
    });
    return b;
  };
  radio.appendChild(
    mkTryb(
      "ostatni",
      "ostatni trening",
      "Podajesz koszt treningu, który już zrobiłeś."
    )
  );
  radio.appendChild(
    mkTryb(
      "nastepny",
      "następny trening",
      "Podajesz koszt treningu, który dopiero zrobisz."
    )
  );
  sekcjaKoszt.appendChild(radio);

  const poziom = el("div", "trng-poziom");
  poziom.appendChild(el("span", "trng-opis", "Obecny poziom"));
  poziomWartoscEl = el("span", "trng-wartosc", "–");
  poziom.appendChild(poziomWartoscEl);
  sekcjaKoszt.appendChild(poziom);
  root.appendChild(sekcjaKoszt);

  // Sekcja 3: przedzial
  const sekcjaPrzedzial = el("div", "trng-sekcja");
  const tytulPrz = el("div", "trng-tytul", "Koszt przedziału treningów");
  tytulPrz.title =
    "Ile razem zapłacisz za treningi od jednego poziomu do drugiego (włącznie).";
  sekcjaPrzedzial.appendChild(tytulPrz);
  const zakres = el("div", "trng-zakres");
  zakres.appendChild(
    poleSpin(
      "od poziomu %",
      null,
      () => stan.od,
      (v) => zmiana({ od: v }),
      MAKS_POZIOM,
      "Poziom, od którego liczymy koszt."
    )
  );
  zakres.appendChild(
    poleSpin(
      "do poziomu %",
      null,
      () => stan.do_,
      (v) => zmiana({ do_: v }),
      MAKS_POZIOM,
      "Poziom, do którego liczymy koszt (włącznie)."
    )
  );
  sekcjaPrzedzial.appendChild(zakres);
  wynikEl = el("div", "trng-wynik");
  sekcjaPrzedzial.appendChild(wynikEl);
  root.appendChild(sekcjaPrzedzial);

  podpowiedzEl = el("div", "trng-podpowiedz");
  root.appendChild(podpowiedzEl);

  const footer = el("div", "trng-footer");
  footer.style.justifyContent = "flex-end";
  footer.appendChild(
    el("span", "trng-wersja", "v" + PLUGIN_VERSION + " | " + PLUGIN_BUILD_DATE)
  );
  root.appendChild(footer);

  budujListe();
  aktualizuj();
  return root;
}

// ---------------------------------------------------------------------------
// Cykl zycia pluginu
// ---------------------------------------------------------------------------

let apiRef: PluginApi | null = null;
let popup: PopupOkno | null = null;
let menuHandle: UchwytMenu | null = null;
let aliasId: unknown = null;
let stylWstrzykniety = false;

function wstrzyknijStyle(): void {
  if (stylWstrzykniety) return;
  stylWstrzykniety = true;
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.appendChild(s);
}

function przełaczOkno(): void {
  if (!popup) return;
  if (popup.isOpen) {
    popup.close();
  } else {
    popup.open();
  }
}

export async function init(api: PluginApi): Promise<PluginInfo> {
  apiRef = api;
  wczytajStan();
  wstrzyknijStyle();

  popup = await api.ui.registerPersistentPopup({
    id: POPUP_ID,
    title: "Treningi — kalkulator kosztów",
    createContent: () => budujZawartosc(),
    headerActions: budujKlawiszeNaglowka(),
    initialWidth: 400,
    initialHeight: 720,
  });

  popupZawody = await api.ui.registerPersistentPopup({
    id: "treningi-zawody",
    title: "Poziomy maksymalne wg zawodu",
    createContent: () => budujTabeleZawodow(),
    initialWidth: "content",
    initialHeight: "content",
  });

  popupPomoc = await api.ui.registerPersistentPopup({
    id: "treningi-pomoc",
    title: "Treningi — pomoc",
    createContent: () => budujPomoc(),
    initialWidth: 440,
    initialHeight: "content",
  });

  menuHandle = api.ui.addPopupMenuEntry("Treningi", () => przełaczOkno());

  aliasId = api.aliases.register(/^\/treningi$/i, () => {
    przełaczOkno();
    return true;
  });

  return {
    name: "treningi",
    version: PLUGIN_VERSION,
    author: "Isithunzi000",
    description:
      "Kalkulator cen treningow dla gry Arkadia (alias /treningi): obecny poziom umiejetnosci z kosztu treningu i koszt przedzialu treningow. Plugin w pelni zgodny z regulaminem gry - czysty kalkulator, zero automatyki, zero wysylania komend.",
  };
}

export function destroy(): void {
  if (zapisTimer !== null) window.clearTimeout(zapisTimer);
  if (menuHandle) menuHandle.remove();
  menuHandle = null;
  if (aliasId !== null && apiRef) apiRef.aliases.remove(aliasId);
  aliasId = null;
  if (popup) popup.close();
  popup = null;
  if (popupZawody) popupZawody.close();
  popupZawody = null;
  if (popupPomoc) popupPomoc.close();
  popupPomoc = null;
  rootEl = null;
}
