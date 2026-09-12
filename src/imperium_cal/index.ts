import PluginApi, {
  PluginInfo,
  AnsiAwareBuffer,
} from "plugin-api";

const PLUGIN_NAME = "imperium_cal";
const TAG = "imperium_cal";

const PLUGIN_VERSION = "1.8.24";
const PLUGIN_BUILD_DATE = "07-09-2026";

const REAL_MS_PER_GAME_MINUTE = 2000;
const YEAR_LENGTH_DAYS = 400;
const GAME_MINUTES_PER_DAY = 24 * 60;
const ANCHOR_STORAGE_KEY = "dargoth.imperium_cal.anchor.v2";

type GameTime = {
  dayOfYear: number;
  hour: number;
  minute: number;
};

type TimeAnchor = {
  scheme: string;
  dayOfYear: number;
  hour: number;
  minute: number;
  rlTimestampMs: number;
};

type MonthDay = {
  month: string;
  dayOfMonth: number;
};

type MonthDayNamed = MonthDay & {
  name: string;
};

type NachtResult = {
  trwa: boolean;
  deltaMin: number;
  nightDoy: number;
};

// Kalendarz Imperium 1:1 z clock.ts (Empire): brak Geheimnistag, Nachgeheim 33 dni,
// rok 400 dni. Godziny wschodu/zachodu (czas Arkadii) takze przepisane z clock.ts.
const IMP_MONTHS: {
  name: string;
  days: number;
  sunrise: number;
  sunset: number;
}[] = [
  { name: "Hexenstag", days: 1, sunrise: 8, sunset: 17 },
  { name: "Nachexen", days: 32, sunrise: 8, sunset: 17 },
  { name: "Jahrdrung", days: 33, sunrise: 7, sunset: 18 },
  { name: "Mitterfruhl", days: 1, sunrise: 7, sunset: 18 },
  { name: "Pflugzeit", days: 33, sunrise: 6, sunset: 19 },
  { name: "Sigmarzeit", days: 33, sunrise: 5, sunset: 20 },
  { name: "Sommerzeit", days: 33, sunrise: 5, sunset: 21 },
  { name: "Sonnstill", days: 1, sunrise: 5, sunset: 22 },
  { name: "Vorgeheim", days: 33, sunrise: 4, sunset: 22 },
  { name: "Nachgeheim", days: 33, sunrise: 5, sunset: 21 },
  { name: "Erntezeit", days: 33, sunrise: 5, sunset: 20 },
  { name: "Mittherbst", days: 1, sunrise: 5, sunset: 20 },
  { name: "Brauzeit", days: 33, sunrise: 6, sunset: 19 },
  { name: "Kaldezeit", days: 33, sunrise: 6, sunset: 18 },
  { name: "Ulriczeit", days: 33, sunrise: 7, sunset: 17 },
  { name: "Mondstille", days: 1, sunrise: 8, sunset: 16 },
  { name: "Vorhexen", days: 33, sunrise: 8, sunset: 16 },
];

// Mapowanie wariantow pisowni nazw miesiecy/swiat do kanonicznych nazw uzywanych przez plugin.
// Klucze i wartosci: lowercase, bez polskich znakow.
const MONTH_ALIASES_TO_CANON: Record<string, string> = {
  // miesiace - warianty
  nachhexen: "nachexen",
  sigmarszeit: "sigmarzeit",
  kaltezeit: "kaldezeit",
  ulrichszeit: "ulriczeit",

  // swieta - warianty
  sonnenstill: "sonnstill",
  sonnenstil: "sonnstill",
  sonnenstille: "sonnstill",
  mondstill: "mondstille",
  mitterherbst: "mittherbst",
  hexensnacht: "hexenstag",
};

function normalizeMonthKey(raw: string): string {
  const k = raw.trim().toLowerCase();
  return MONTH_ALIASES_TO_CANON[k] ?? k;
}

const MONTH_INDEX: Record<string, number> = (() => {
  const idx: Record<string, number> = {};

  // 1) kanoniczne nazwy
  IMP_MONTHS.forEach((m, i) => {
    idx[m.name.toLowerCase()] = i;
  });

  // 2) aliasy -> kanon
  for (const [alias, canon] of Object.entries(MONTH_ALIASES_TO_CANON)) {
    const canonIdx = idx[canon];
    if (typeof canonIdx === "number") idx[alias] = canonIdx;
  }

  return idx;
})();

const MONTH_PREFIX_DAYS: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const m of IMP_MONTHS) {
    out.push(acc);
    acc += m.days;
  }
  return out;
})();

const MSG_INTERNAL = [
  "[imperium_cal] Blad wewnetrzny kalendarza Imperium - nie mozna wyliczyc danych.",
];
const MSG_GN_COLDSTART = [
  "[imperium_cal] Trwa Geheimnisnacht - komenda 'czas' nie podaje teraz daty.",
  "To pierwsze uzycie w tej sesji, wiec nie mam zapamietanej daty do wyliczenia.",
  "Uruchom /imperium raz poza Geheimnisnacht (gdy 'czas' pokazuje date) - potem zadziala tez w trakcie eventu.",
];
const MSG_TIMEOUT = [
  "[imperium_cal] Brak odpowiedzi na komende 'czas' (timeout) i nie mam zapamietanej daty.",
  "Sprawdz, czy 'czas' dziala, i sprobuj ponownie.",
];
// Zla domena (A3) - komunikat 1:1 z klientem WWW.
const MSG_CROSS_DOMAIN = [
  "[imperium_cal] Otrzymano czas Ishtar - postac jest w domenie Ishtar.",
  "Uzyj /ishtar zamiast /imperium.",
];

const MSG_CROSS_NO_ANCHOR = [
  "[imperium_cal] Nie mam zapamietanej daty domeny Imperium - nie moge wyliczyc raportu.",
  "Bedac w domenie Imperium, uzyj komendy /imperium - odczyt zapisze date na przyszlosc.",
];

const MSG_RESET_DONE = [
  "[imperium_cal] Kotwica Imperium wyczyszczona. Uzyj /imperium na zewnatrz, zeby zapisac nowa.",
];

const REQUEST_TIMEOUT_MS = 3500;
const NEW_MOONS: MonthDay[] = [
  { dayOfMonth: 13, month: "Nachexen" },
  { dayOfMonth: 6, month: "Jahrdrung" },
  { dayOfMonth: 31, month: "Jahrdrung" },
  { dayOfMonth: 22, month: "Pflugzeit" },
  { dayOfMonth: 14, month: "Sigmarzeit" },
  { dayOfMonth: 6, month: "Sommerzeit" },
  { dayOfMonth: 31, month: "Sommerzeit" },
  { dayOfMonth: 22, month: "Vorgeheim" },
  { dayOfMonth: 13, month: "Nachgeheim" },
  { dayOfMonth: 6, month: "Erntezeit" },
  { dayOfMonth: 31, month: "Erntezeit" },
  { dayOfMonth: 22, month: "Brauzeit" },
  { dayOfMonth: 14, month: "Kaldezeit" },
  { dayOfMonth: 6, month: "Ulriczeit" },
  { dayOfMonth: 31, month: "Ulriczeit" },
  { dayOfMonth: 22, month: "Vorhexen" },
];

const FULL_MOONS: MonthDay[] = [
  { dayOfMonth: 25, month: "Nachexen" },
  { dayOfMonth: 18, month: "Jahrdrung" },
  { dayOfMonth: 9, month: "Pflugzeit" },
  { dayOfMonth: 2, month: "Sigmarzeit" },
  { dayOfMonth: 26, month: "Sigmarzeit" },
  { dayOfMonth: 18, month: "Sommerzeit" },
  { dayOfMonth: 9, month: "Vorgeheim" },
  { dayOfMonth: 1, month: "Nachgeheim" },
  { dayOfMonth: 26, month: "Nachgeheim" },
  { dayOfMonth: 18, month: "Erntezeit" },
  { dayOfMonth: 9, month: "Brauzeit" },
  { dayOfMonth: 1, month: "Kaldezeit" },
  { dayOfMonth: 26, month: "Kaldezeit" },
  { dayOfMonth: 18, month: "Ulriczeit" },
  { dayOfMonth: 9, month: "Vorhexen" },
];

// Granice por roku 1:1 z clock.ts (Empire, SEASON_BOUNDARIES) jako absolutny dzien roku.
const SEASONAL_EVENTS: { dayOfYear: number; name: string }[] = [
  { dayOfYear: 18, name: "Pierwszy dzien wiosny" },
  { dayOfYear: 118, name: "Pierwszy dzien lata" },
  { dayOfYear: 218, name: "Pierwszy dzien jesieni" },
  { dayOfYear: 319, name: "Pierwszy dzien zimy" },
];

const INTERCALARY_EVENTS: MonthDayNamed[] = [
  { month: "Hexenstag", dayOfMonth: 1, name: "Hexentag" },
  { month: "Mitterfruhl", dayOfMonth: 1, name: "Mitterfruhl" },
  { month: "Sonnstill", dayOfMonth: 1, name: "Sonnstill" },
  { month: "Mittherbst", dayOfMonth: 1, name: "Mittherbst" },
  { month: "Mondstille", dayOfMonth: 1, name: "Mondstille" },
];

const INTERCALARY_MONTHS = new Set(
  INTERCALARY_EVENTS.map((e) => normalizeMonthKey(e.month))
);

// Geheimnisnacht: event GM-owy. Kandydaci = jesienne pelnie Mannslieba (te same,
// co w FULL_MOONS). MG synchronizuje zegar tak, by noc pelni wypadla w wieczornym
// prime time RL; event to sama noc pelni (bez przesuwania o dni). Potwierdzone
// empirycznie: 11.08.2026 ok. 20:00 = noc pelni 1 Nachgeheim (zachod 19:57 PL).
const GEHEIMNISNACHT_FULLS: MonthDay[] = [
  { dayOfMonth: 1, month: "Nachgeheim" },   // doy 201
  { dayOfMonth: 26, month: "Nachgeheim" },  // doy 226
  { dayOfMonth: 18, month: "Erntezeit" },   // doy 251
  { dayOfMonth: 9, month: "Brauzeit" },     // doy 276
  { dayOfMonth: 1, month: "Kaldezeit" },    // doy 301
];

// Okno RL w minutach od polnocy zegara EUROPE/WARSAW. MG celuja w prime time PL,
// wiec okno jest liczone wg czasu polskiego (przez Intl) - niezaleznie od strefy
// czasowej przegladarki gracza i od zmiany czasu letni/zimowy.
const GN_WINDOW_START_MIN = 19 * 60;      // 19:00 = 1140
const GN_WINDOW_END_MIN = 21 * 60;        // 21:00 = 1260
const GN_PRIME_MIN = 20 * 60;             // 20:00 = 1200 (srodek okna)
const GN_SCAN_YEARS = 4;                  // ile kolejnych lat IG przeszukac (zapas)
const GN_CLUSTER_MS = 180 * 60 * 1000;    // 3 h RL: prog "ten sam cykl" przy wyborze nocy

// Zegar Europe/Warsaw do filtra okna GN (patrz komentarz przy stalej okna).
const GN_CLOCK_FORMATTER = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function warsawClockMinutes(realMs: number): number {
  const parts = GN_CLOCK_FORMATTER.formatToParts(new Date(realMs));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = parseInt(p.value, 10);
    else if (p.type === "minute") m = parseInt(p.value, 10);
  }
  return h * 60 + m;
}

function normalizeDayOfYear(dayOfYear: number): number {
  const m =
    (((dayOfYear - 1) % YEAR_LENGTH_DAYS) + YEAR_LENGTH_DAYS) %
    YEAR_LENGTH_DAYS;
  return m + 1;
}

// Godzina zachodu slonca per dzien roku, wyliczona z tabeli miesiecy (clock.ts).
const SUNSET_BY_DOY: number[] = (() => {
  const out: number[] = new Array(YEAR_LENGTH_DAYS + 1).fill(0);
  IMP_MONTHS.forEach((m, i) => {
    const start = MONTH_PREFIX_DAYS[i] + 1;
    for (let d = 0; d < m.days; d++) out[start + d] = m.sunset;
  });
  return out;
})();

function sunsetHourForDoy(dayOfYear: number): number {
  return SUNSET_BY_DOY[normalizeDayOfYear(dayOfYear)];
}

const SUNRISE_BY_DOY: number[] = (() => {
  const out: number[] = new Array(YEAR_LENGTH_DAYS + 1).fill(0);
  IMP_MONTHS.forEach((m, i) => {
    const start = MONTH_PREFIX_DAYS[i] + 1;
    for (let d = 0; d < m.days; d++) out[start + d] = m.sunrise;
  });
  return out;
})();

function sunriseHourForDoy(dayOfYear: number): number {
  return SUNRISE_BY_DOY[normalizeDayOfYear(dayOfYear)];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatRealDate(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function truncateToMinute(d: Date): Date {
  // Obcinamy do minuty na epoce (DST-safe): czas lokalny przy fall-back przesuwalby instant.
  return new Date(Math.floor(d.getTime() / 60000) * 60000);
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampGameTime(t: GameTime): GameTime {
  return {
    dayOfYear: clampInt(t.dayOfYear, 1, YEAR_LENGTH_DAYS),
    hour: clampInt(t.hour, 0, 23),
    minute: clampInt(t.minute, 0, 59),
  };
}

function isValidGameTime(t: GameTime | null | undefined): t is GameTime {
  if (!t) return false;
  return (
    Number.isFinite(t.dayOfYear) &&
    Number.isFinite(t.hour) &&
    Number.isFinite(t.minute) &&
    t.dayOfYear >= 1 &&
    t.dayOfYear <= YEAR_LENGTH_DAYS &&
    t.hour >= 0 &&
    t.hour <= 23 &&
    t.minute >= 0 &&
    t.minute <= 59
  );
}

function deltaGameMinutes(from: GameTime, to: GameTime): number {
  const fromTotal =
    (from.dayOfYear - 1) * GAME_MINUTES_PER_DAY + from.hour * 60 + from.minute;
  const toTotal =
    (to.dayOfYear - 1) * GAME_MINUTES_PER_DAY + to.hour * 60 + to.minute;
  const yearTotal = YEAR_LENGTH_DAYS * GAME_MINUTES_PER_DAY;

  let diff = toTotal - fromTotal;
  if (diff < 0) diff += yearTotal;
  return diff;
}

function formatRealDeltaFromGameMinutes(deltaGameMinutesValue: number): string {
  const totalMinutesReal = Math.max(
    0,
    Math.round((deltaGameMinutesValue * REAL_MS_PER_GAME_MINUTE) / 60000)
  );
  const days = Math.floor(totalMinutesReal / (60 * 24));
  const hours = Math.floor((totalMinutesReal % (60 * 24)) / 60);
  const minutes = totalMinutesReal % 60;

  return `${days}d ${hours}h ${minutes}m`;
}

function dayOfYearFromMonthDay(
  monthName: string,
  dayOfMonth: number
): number | null {
  const idx = MONTH_INDEX[normalizeMonthKey(monthName)];
  if (idx === undefined) return null;

  const maxDay = IMP_MONTHS[idx].days;
  if (dayOfMonth < 1 || dayOfMonth > maxDay) return null;

  return MONTH_PREFIX_DAYS[idx] + dayOfMonth;
}

function nextFromSortedList(now: GameTime, sortedList: number[]): number {
  const nowDoy = normalizeDayOfYear(now.dayOfYear);
  const atMidnight = now.hour === 0 && now.minute === 0;

  for (const d of sortedList) {
    if (d > nowDoy) return d;
    if (d === nowDoy && atMidnight) return d;
  }

  return sortedList[0] ?? 1;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sanitizeCzasLine(line: string): string {
  let s = stripAnsi(line);

  const bracketIdx = s.indexOf("[");
  if (bracketIdx >= 0) s = s.slice(0, bracketIdx);

  s = s.replace(/^\s*>\s*/, "");

  const arrowIdx = s.indexOf("\u2192");
  if (arrowIdx >= 0) {
    const before = s.slice(0, arrowIdx).trim();
    if (before === "" || before === ">" || before.endsWith(">")) {
      s = s.slice(0, arrowIdx);
    }
  }

  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function isLikelyImperiumCzasLine(raw: string): boolean {
  const lc = raw.toLowerCase();
  if (!lc.startsWith("jest w przyblizeniu")) return false;
  return lc.includes("kalendarza imperialnego");
}

function isLikelyIshtarCzasLine(raw: string): boolean {
  const lc = raw.toLowerCase();
  if (!lc.startsWith("jest w przyblizeniu")) return false;
  return lc.includes("wedlug rachuby czasu starszego ludu");
}

function parsePolishOrdinalDay(words: string): number | null {
  const key = words
    .trim()
    .toLowerCase()
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ");

  const map: Record<string, number> = {
    pierwszy: 1,
    drugi: 2,
    trzeci: 3,
    czwarty: 4,
    piaty: 5,
    szosty: 6,
    siodmy: 7,
    osmy: 8,
    dziewiaty: 9,
    dziesiaty: 10,
    jedenasty: 11,
    dwunasty: 12,
    trzynasty: 13,
    czternasty: 14,
    pietnasty: 15,
    szesnasty: 16,
    siedemnasty: 17,
    osiemnasty: 18,
    dziewietnasty: 19,
    dwudziesty: 20,
    "dwudziesty pierwszy": 21,
    "dwudziesty drugi": 22,
    "dwudziesty trzeci": 23,
    "dwudziesty czwarty": 24,
    "dwudziesty piaty": 25,
    "dwudziesty szosty": 26,
    "dwudziesty siodmy": 27,
    "dwudziesty osmy": 28,
    "dwudziesty dziewiaty": 29,
    trzydziesty: 30,
    "trzydziesty pierwszy": 31,
    "trzydziesty drugi": 32,
    "trzydziesty trzeci": 33,
  };

  return map[key] ?? null;
}

// Mapa wartosci godzin = DESCRIPTIVE_TIME klienta.
const HOUR_WORD_VALUE: Record<string, number> = {
  polnoc: 0,
  pierwsza: 1,
  druga: 2,
  trzecia: 3,
  czwarta: 4,
  piata: 5,
  szosta: 6,
  siodma: 7,
  osma: 8,
  dziewiata: 9,
  dziesiata: 10,
  jedenasta: 11,
  dwunasta: 12,
  poludnie: 12,
};

// Godzina 1:1 z klientem: regex klienta (godzina + pozycyjna pora dnia) + reguly PM.
function parseHourFromCzasLine(line: string): number | null {
  const m = line
    .toLowerCase()
    .match(
      /^jest w przyblizeniu (\w+)(?: (?:|w|po|przed|nad|poznym)\s*(dzien|nocy|poludniu|poludniem|poludnie|rano|ranem|wieczorem))?/
    );
  if (!m) return null;

  const value = HOUR_WORD_VALUE[m[1]];
  if (typeof value !== "number") return null;

  const daytime = m[2] ?? "";
  let hours = value;
  if (
    daytime === "poludniu" ||
    daytime === "wieczorem" ||
    (daytime === "nocy" && value >= 6)
  ) {
    hours += 12;
  }
  if (hours > 23) hours = 0;
  return hours;
}

function matchMonthNameFromText(monthKey: string): string | null {
  const idx = MONTH_INDEX[normalizeMonthKey(monthKey)];
  return idx === undefined ? null : IMP_MONTHS[idx].name;
}

function tryParseCzasOutput(text: string): GameTime | null {
  const hour = parseHourFromCzasLine(text);
  if (hour === null) return null;

  const t = text.toLowerCase();

  const md = t.match(
    /\b([a-z]+(?:[\s-]+[a-z]+){0,2})\s+dzien\s+miesiaca\s+([a-z]+)[\.,]?\b/i
  );
  if (md) {
    const dayOfMonth = parsePolishOrdinalDay(md[1]);
    if (!dayOfMonth) return null;

    const monthKey = md[2].replace(/[^a-z]/g, "");
    const monthName = matchMonthNameFromText(monthKey);
    if (!monthName) return null;

    const doy = dayOfYearFromMonthDay(monthName, dayOfMonth);
    if (!doy) return null;

    return { dayOfYear: doy, hour, minute: 0 };
  }

  const sd = t.match(/\b(?:dzien|noc)\s+([a-z]+)[\.,]?\s+wedlug\b/i);
  if (sd) {
    const monthKey = sd[1].replace(/[^a-z]/g, "");
    const monthName = matchMonthNameFromText(monthKey);
    if (!monthName) return null;

    const doy = dayOfYearFromMonthDay(monthName, 1);
    if (!doy) return null;

    return { dayOfYear: doy, hour, minute: 0 };
  }

  return null;
}

function toSortedDoyList(list: MonthDay[]): number[] {
  const out: number[] = [];
  for (const item of list) {
    const doy = dayOfYearFromMonthDay(item.month, item.dayOfMonth);
    if (typeof doy === "number") out.push(normalizeDayOfYear(doy));
  }
  return out.sort((a, b) => a - b);
}

function buildNewMoonDoyToIndexMap(
  sortedNewMoonDoy: number[]
): Map<number, number> {
  const map = new Map<number, number>();

  for (let i = 0; i < NEW_MOONS.length; i++) {
    const md = NEW_MOONS[i];
    const doy = dayOfYearFromMonthDay(md.month, md.dayOfMonth);
    if (typeof doy !== "number") continue;
    map.set(normalizeDayOfYear(doy), i);
  }

  for (const d of sortedNewMoonDoy) {
    if (!map.has(d)) return new Map();
  }

  return map;
}

function computeSanityAndLists(): {
  ok: boolean;
  newMoons: number[];
  fullMoons: number[];
  newMoonDoyToIndex: Map<number, number>;
} {
  const fail = () => ({
    ok: false,
    newMoons: [] as number[],
    fullMoons: [] as number[],
    newMoonDoyToIndex: new Map<number, number>(),
  });

  const totalDays = IMP_MONTHS.reduce((acc, m) => acc + m.days, 0);
  if (totalDays !== YEAR_LENGTH_DAYS) return fail();

  for (const m of IMP_MONTHS) {
    if (!Number.isFinite(m.sunrise) || m.sunrise < 0 || m.sunrise > 23) {
      return fail();
    }
    if (!Number.isFinite(m.sunset) || m.sunset < 0 || m.sunset > 23) {
      return fail();
    }
  }

  for (const ev of SEASONAL_EVENTS) {
    if (
      !Number.isFinite(ev.dayOfYear) ||
      ev.dayOfYear < 1 ||
      ev.dayOfYear > YEAR_LENGTH_DAYS
    ) {
      return fail();
    }
  }

  for (const it of [...NEW_MOONS, ...FULL_MOONS]) {
    const key = normalizeMonthKey(it.month);
    if (INTERCALARY_MONTHS.has(key)) return fail();
  }

  const lists: MonthDay[] = [
    ...NEW_MOONS,
    ...FULL_MOONS,
    ...INTERCALARY_EVENTS,
    ...GEHEIMNISNACHT_FULLS,
  ];

  for (const it of lists) {
    const doy = dayOfYearFromMonthDay(it.month, it.dayOfMonth);
    if (typeof doy !== "number") return fail();
  }

  const newMoons = toSortedDoyList(NEW_MOONS);
  const fullMoons = toSortedDoyList(FULL_MOONS);

  if (newMoons.length === 0) return fail();
  if (fullMoons.length === 0) return fail();

  const newMoonDoyToIndex = buildNewMoonDoyToIndexMap(newMoons);
  if (newMoonDoyToIndex.size === 0) return fail();

  return { ok: true, newMoons, fullMoons, newMoonDoyToIndex };
}

const SANITY = computeSanityAndLists();
const SANITY_OK = SANITY.ok;
const SORTED_NEW_MOON_DOY = SANITY.newMoons;
const SORTED_FULL_MOON_DOY = SANITY.fullMoons;
const NEW_MOON_DOY_TO_INDEX = SANITY.newMoonDoyToIndex;

function pushEventTimingLines(
  lines: string[],
  now: GameTime,
  nowReal: Date,
  doy: number
): void {
  const d = normalizeDayOfYear(doy);
  if (normalizeDayOfYear(now.dayOfYear) === d) {
    const minutesToEndOfDay = (24 - now.hour) * 60 - now.minute;
    const endReal = new Date(
      nowReal.getTime() + minutesToEndOfDay * REAL_MS_PER_GAME_MINUTE
    );
    lines.push(`    Dzis (dzien ${d})`);
    lines.push(`    TRWA TERAZ (do ${formatRealDate(endReal)})`);
    return;
  }
  const deltaMin = deltaGameMinutes(now, { dayOfYear: d, hour: 0, minute: 0 });
  const real = new Date(nowReal.getTime() + deltaMin * REAL_MS_PER_GAME_MINUTE);
  lines.push(`    Data RL: ${formatRealDate(real)}`);
  lines.push(`    Za:      ${formatRealDeltaFromGameMinutes(deltaMin)}`);
}

function monthDayFromDayOfYear(
  dayOfYear: number
): { month: string; dayOfMonth: number } | null {
  const d = normalizeDayOfYear(dayOfYear);
  for (let i = IMP_MONTHS.length - 1; i >= 0; i--) {
    if (d > MONTH_PREFIX_DAYS[i]) {
      return { month: IMP_MONTHS[i].name, dayOfMonth: d - MONTH_PREFIX_DAYS[i] };
    }
  }
  return null;
}

function computeHexennacht(now: GameTime, nowReal: Date): NachtResult {
  const sunsetH = sunsetHourForDoy(1);
  const sunriseH = sunriseHourForDoy(2);
  const nightDuration = (24 - sunsetH + sunriseH) * 60;
  const yearMin = YEAR_LENGTH_DAYS * GAME_MINUTES_PER_DAY;
  const baseDelta = deltaGameMinutes(now, { dayOfYear: 1, hour: sunsetH, minute: 0 });
  const deltaBack = baseDelta - yearMin;
  if (deltaBack > -nightDuration) {
    return { trwa: true, deltaMin: nightDuration + deltaBack, nightDoy: 1 };
  }
  return { trwa: false, deltaMin: baseDelta, nightDoy: 1 };
}

function computeGeheimnisnachtNight(
  now: GameTime,
  nowReal: Date
): NachtResult | null {
  const yearMin = YEAR_LENGTH_DAYS * GAME_MINUTES_PER_DAY;
  type GnCand = {
    deltaMin: number;
    nightDoy: number;
    realMs: number;
    dist: number;
  };
  const cands: GnCand[] = [];

  for (const f of GEHEIMNISNACHT_FULLS) {
    const fdoy = dayOfYearFromMonthDay(f.month, f.dayOfMonth);
    if (typeof fdoy !== "number") continue;

    // Noc Geheimnisnacht = sama noc pelni (offset 0 dni).
    const nightDoy = normalizeDayOfYear(fdoy);
    const sunsetH = sunsetHourForDoy(nightDoy);
    const sunriseH = sunriseHourForDoy(normalizeDayOfYear(nightDoy + 1));
    const nightDuration = (24 - sunsetH + sunriseH) * 60;

    const baseDelta = deltaGameMinutes(now, {
      dayOfYear: nightDoy,
      hour: sunsetH,
      minute: 0,
    });

    // TRWA: noc pelni zaczela sie mniej niz nightDuration temu, wiec delta do
    // nastepnego wystapienia zawinela sie przez koniec roku. Sprawdzane niezaleznie
    // od okna - jesli event trwa, pokazujemy go zawsze.
    if (baseDelta > yearMin - nightDuration && baseDelta < yearMin) {
      const deltaToEnd = baseDelta - (yearMin - nightDuration);
      return { trwa: true, deltaMin: deltaToEnd, nightDoy };
    }

    for (let k = 0; k < GN_SCAN_YEARS; k++) {
      const deltaMinAnchor = baseDelta + k * yearMin;
      const realMsAnchor = nowReal.getTime() + deltaMinAnchor * REAL_MS_PER_GAME_MINUTE;
      const clockAnchor = warsawClockMinutes(realMsAnchor);

      if (clockAnchor < GN_WINDOW_START_MIN || clockAnchor > GN_WINDOW_END_MIN) continue;

      // Przyszly event
      cands.push({
        deltaMin: deltaMinAnchor,
        nightDoy,
        realMs: realMsAnchor,
        dist: Math.abs(clockAnchor - GN_PRIME_MIN),
      });
    }
  }

  if (cands.length === 0) return null;

  let t0 = cands[0].realMs;
  for (const c of cands) if (c.realMs < t0) t0 = c.realMs;

  let best: GnCand | null = null;
  for (const c of cands) {
    if (c.realMs > t0 + GN_CLUSTER_MS) continue;
    if (
      best === null ||
      c.dist < best.dist ||
      (c.dist === best.dist && c.realMs < best.realMs)
    ) {
      best = c;
    }
  }

  return best ? { trwa: false, deltaMin: best.deltaMin, nightDoy: best.nightDoy } : null;
}

function buildReport(nowRaw: GameTime): string[] {
  const now = clampGameTime(nowRaw);
  const nowReal = truncateToMinute(new Date());
  const lines: string[] = [];

  // --- Glowne swieta interkalarne: Hexentag + Geheimnisnacht ---
  const hexDoy = dayOfYearFromMonthDay("Hexenstag", 1) ?? 1;

  lines.push("Glowne swieta interkalarne:");
  lines.push(`  *** Hexentag ***`);
  pushEventTimingLines(lines, now, nowReal, hexDoy);

  const hn = computeHexennacht(now, nowReal);
  lines.push(`  *** Hexennacht ***`);
  if (hn.trwa) {
    const hnEnd = new Date(nowReal.getTime() + hn.deltaMin * REAL_MS_PER_GAME_MINUTE);
    lines.push(`    TRWA TERAZ (do ${formatRealDate(hnEnd)})`);
  } else {
    const hnStart = new Date(nowReal.getTime() + hn.deltaMin * REAL_MS_PER_GAME_MINUTE);
    lines.push(`    Data RL: ${formatRealDate(hnStart)}`);
    lines.push(`    Za:      ${formatRealDeltaFromGameMinutes(hn.deltaMin)}`);
  }

  const gn = computeGeheimnisnachtNight(now, nowReal);
  if (gn) {
    const gnMd = monthDayFromDayOfYear(gn.nightDoy);
    const gnLabel = gnMd
      ? `${gnMd.month} ${gnMd.dayOfMonth}, dzien ${gn.nightDoy}`
      : `dzien ${gn.nightDoy}`;
    lines.push(`  *** Geheimnisnacht (${gnLabel}) ***`);
    if (gn.trwa) {
      const gnEnd = new Date(nowReal.getTime() + gn.deltaMin * REAL_MS_PER_GAME_MINUTE);
      lines.push(`    TRWA TERAZ (do ${formatRealDate(gnEnd)})`);
    } else {
      const gnStart = new Date(nowReal.getTime() + gn.deltaMin * REAL_MS_PER_GAME_MINUTE);
      lines.push(`    Data RL: ${formatRealDate(gnStart)}`);
      lines.push(`    Za:      ${formatRealDeltaFromGameMinutes(gn.deltaMin)}`);
    }
  }

  // --- Najblizsze wydarzenie sezonowe ---
  const seasonalCandidates = SEASONAL_EVENTS.map((ev) => {
    const doy = ev.dayOfYear;
    const isToday =
      normalizeDayOfYear(now.dayOfYear) === normalizeDayOfYear(doy);
    const dMin = deltaGameMinutes(now, { dayOfYear: doy, hour: 0, minute: 0 });
    return { ...ev, isToday, deltaMin: dMin };
  });
  const seasonal =
    seasonalCandidates.find((c) => c.isToday) ??
    seasonalCandidates.slice().sort((a, b) => a.deltaMin - b.deltaMin)[0];

  lines.push("");
  lines.push("Najblizsze wydarzenie sezonowe:");
  if (seasonal) {
    lines.push(`  ${seasonal.name}`);
    pushEventTimingLines(lines, now, nowReal, seasonal.dayOfYear);
  }

  // --- Najblizsze wydarzenia ksiezycowe ---
  lines.push("");
  lines.push("Najblizsze wydarzenia ksiezycowe:");

  const nowDoyForMoon = normalizeDayOfYear(now.dayOfYear);
  const todayNewMoonIdx = NEW_MOON_DOY_TO_INDEX.get(nowDoyForMoon) ?? -1;

  if (todayNewMoonIdx >= 0) {
    const sunsetHour = sunsetHourForDoy(nowDoyForMoon);
    lines.push(`  *** Now astronomiczny ***`);
    pushEventTimingLines(lines, now, nowReal, nowDoyForMoon);
    if (typeof sunsetHour === "number" && now.hour >= sunsetHour) {
      const minutesToEndOfDay = (24 - now.hour) * 60 - now.minute;
      const endReal = new Date(
        nowReal.getTime() + minutesToEndOfDay * REAL_MS_PER_GAME_MINUTE
      );
      lines.push(`  +++ Now widoczny TERAZ +++`);
      lines.push(`    TRWA TERAZ (do ${formatRealDate(endReal)})`);
      lines.push(`    Zachod:  ${pad2(sunsetHour)}:00 IG`);
    } else if (typeof sunsetHour === "number") {
      const minutesToSunset = (sunsetHour - now.hour) * 60 - now.minute;
      const sunsetReal = new Date(
        nowReal.getTime() + minutesToSunset * REAL_MS_PER_GAME_MINUTE
      );
      lines.push(`  +++ Now widoczny dzis po zachodzie slonca +++`);
      lines.push(`    Data RL: ${formatRealDate(sunsetReal)}`);
      lines.push(`    Zachod:  ${pad2(sunsetHour)}:00 IG`);
      lines.push(`    Za:      ${formatRealDeltaFromGameMinutes(minutesToSunset)}`);
    }
  } else {
    const newDoy = nextFromSortedList(now, SORTED_NEW_MOON_DOY);
    const newDeltaMin = deltaGameMinutes(now, {
      dayOfYear: newDoy,
      hour: 0,
      minute: 0,
    });
    const newReal = new Date(
      nowReal.getTime() + newDeltaMin * REAL_MS_PER_GAME_MINUTE
    );
    lines.push(`  *** Now astronomiczny ***`);
    lines.push(`    Data RL: ${formatRealDate(newReal)}`);
    lines.push(`    Za:      ${formatRealDeltaFromGameMinutes(newDeltaMin)}`);

    const sunsetHour = sunsetHourForDoy(newDoy);
    if (typeof sunsetHour === "number") {
      const sunsetDeltaMin = deltaGameMinutes(now, {
        dayOfYear: newDoy,
        hour: sunsetHour,
        minute: 0,
      });
      const sunsetReal = new Date(
        nowReal.getTime() + sunsetDeltaMin * REAL_MS_PER_GAME_MINUTE
      );
      lines.push(`  +++ Now widoczny po zachodzie slonca +++`);
      lines.push(`    Data RL: ${formatRealDate(sunsetReal)}`);
      lines.push(`    Zachod:  ${pad2(sunsetHour)}:00 IG`);
      lines.push(`    Za:      ${formatRealDeltaFromGameMinutes(sunsetDeltaMin)}`);
    }
  }

  const nowDoyForFull = normalizeDayOfYear(now.dayOfYear);
  const fullDoy = SORTED_FULL_MOON_DOY.includes(nowDoyForFull)
    ? nowDoyForFull
    : nextFromSortedList(now, SORTED_FULL_MOON_DOY);
  lines.push(`  Pelnia astronomiczna`);
  pushEventTimingLines(lines, now, nowReal, fullDoy);

  // --- Inne swieta interkalarne (bez Hexentag) ---
  const otherIntercalary = INTERCALARY_EVENTS
    .filter((ev) => {
      const low = ev.name.toLowerCase();
      return !low.includes("hexentag");
    })
    .map((ev) => {
      const doy = dayOfYearFromMonthDay(ev.month, ev.dayOfMonth) ?? 1;
      const isToday =
        normalizeDayOfYear(now.dayOfYear) === normalizeDayOfYear(doy);
      const dMin = deltaGameMinutes(now, { dayOfYear: doy, hour: 0, minute: 0 });
      return { ...ev, dayOfYear: doy, isToday, sortKey: isToday ? -1 : dMin };
    })
    .sort((a, b) => a.sortKey - b.sortKey);

  lines.push("");
  lines.push("Inne swieta interkalarne:");
  for (const ev of otherIntercalary) {
    lines.push(`  ${ev.name}`);
    pushEventTimingLines(lines, now, nowReal, ev.dayOfYear);
  }

  return lines;
}

function printFramedReport(api: PluginApi, lines: string[]): void {
  api.output.print(["", "", "---", ...lines, "---", "", ""].join("\n"));
}

function printUnable(api: PluginApi): void {
  printFramedReport(api, MSG_INTERNAL);
}

function printGnColdStart(api: PluginApi): void {
  printFramedReport(api, MSG_GN_COLDSTART);
}

function printTimeout(api: PluginApi): void {
  printFramedReport(api, MSG_TIMEOUT);
}

// Chip komendy w popupie pomocy: obie komendy (/x i /x reset) owijane
// jednakowo (monospace + ramka), wzorzec Discord ```code```.
function cmdChip(text: string): HTMLElement {
  const chip = document.createElement("span");
  chip.textContent = text;
  chip.style.fontFamily = "monospace";
  chip.style.padding = "1px 6px";
  chip.style.border = "1px solid rgba(255,255,255,0.25)";
  chip.style.borderRadius = "4px";
  chip.style.marginLeft = "4px";
  return chip;
}

function buildHelpContent(): HTMLElement {
  const root = document.createElement("div");
  root.style.whiteSpace = "pre-wrap";
  root.style.lineHeight = "1.35";
  root.style.position = "relative";

  const title = document.createElement("div");
  title.textContent = "Kalendarz Imperium";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "8px";

  const body = document.createElement("div");

  const p1 = document.createElement("div");
  p1.textContent =
    "Plugin wylicza (przybliżony) czas do najbliższych wydarzeń księżycowych, sezonowych i świąt w domenie Imperium, bazując na odpowiedzi serwera na komendę 'czas'.";

  const p2 = document.createElement("div");
  p2.style.marginTop = "10px";
  p2.appendChild(
    document.createTextNode("Aby uruchomić, wpisz w linii poleceń: ")
  );

  p2.appendChild(cmdChip("/imperium"));

  const p3 = document.createElement("div");
  p3.style.marginTop = "10px";
  p3.textContent =
    "Wyniki zawierają: najbliższy nów i pełnię (Mannslieb), najbliższe wydarzenie sezonowe oraz listę świąt interkalarnych. Hexentag, Hexennacht, Geheimnisnacht oraz nów są wyróżniane trzema gwiazdkami. Jeśli event aktualnie trwa, wyświetlany jest komunikat TRWA TERAZ z godziną zakończenia.";

  const p4 = document.createElement("div");
  p4.style.marginTop = "10px";
  p4.textContent =
    "Dodatkowo: dla nowiu pokazywana jest godzina widoczności sierpa po zachodzie słońca.";

  const p5 = document.createElement("div");
  p5.style.marginTop = "10px";
  p5.textContent =
    "Przeliczenie czasu: 120 sekund czasu rzeczywistego = 1 godzina czasu gry (przybliżenie).";

  const p6 = document.createElement("div");
  p6.style.marginTop = "10px";
  p6.textContent =
    "Jeśli odczyt 'czas' się nie powiedzie, plugin użyje ostatniej zapamiętanej daty. W Geheimnisnacht bez zapisanej daty wyświetli komunikat i nie zgaduje. Po komunikacie o złej domenie pokaże wyniki wyliczone z zapisanej daty (jeśli jest), a gdy jej nie ma — powie, jak ją zapisać.";

  const p7 = document.createElement("div");
  p7.style.marginTop = "10px";
  p7.appendChild(document.createTextNode("Komenda "));
  p7.appendChild(cmdChip("/imperium reset"));
  p7.appendChild(
    document.createTextNode(
      " czyści zapamiętaną datę (kotwicę). Plugin odnawia ją też automatycznie z każdej poprawnej odpowiedzi serwera na 'czas', nawet bez wywołania /imperium."
    )
  );

  body.appendChild(p1);
  body.appendChild(p2);
  body.appendChild(p3);
  body.appendChild(p4);
  body.appendChild(p5);
  body.appendChild(p6);
  body.appendChild(p7);

  const footer = document.createElement("div");
  footer.textContent = `v${PLUGIN_VERSION} | ${PLUGIN_BUILD_DATE}`;
  footer.style.position = "absolute";
  footer.style.right = "8px";
  footer.style.bottom = "6px";
  footer.style.fontSize = "11px";
  footer.style.opacity = "0.7";

  root.appendChild(title);
  root.appendChild(body);
  root.appendChild(footer);
  return root;
}

let apiRef: PluginApi | null = null;
let aliasId: string | null = null;
let resetAliasId: string | null = null;
let helpMenuHandle: { remove(): void } | null = null;
let helpPopup: Awaited<
  ReturnType<PluginApi["ui"]["registerPersistentPopup"]>
> | null = null;

let pendingRequest = false;
let requestStartedAtMs = 0;

function clearPending(): void {
  pendingRequest = false;
  requestStartedAtMs = 0;
}

function runImperiumReport(api: PluginApi, now: GameTime): void {
  if (!SANITY_OK) {
    printUnable(api);
    return;
  }

  try {
    printFramedReport(api, buildReport(now));
  } catch {
    printUnable(api);
  }
}

function saveTimeAnchor(dayOfYear: number, hour: number, minute: number): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const anchor: TimeAnchor = {
      scheme: "hexenstag",
      dayOfYear: clampInt(dayOfYear, 1, YEAR_LENGTH_DAYS),
      hour: clampInt(hour, 0, 23),
      minute: clampInt(minute, 0, 59),
      rlTimestampMs: Date.now(),
    };
    window.localStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(anchor));
  } catch {
    // brak dostepu do storage / quota - kotwica jest opcjonalna
  }
}

function loadTimeAnchor(): TimeAnchor | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(ANCHOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    // Rekord bez zgodnego scheme (np. zapis legacy) - ignoruj.
    if ((parsed as { scheme?: unknown }).scheme !== "hexenstag") return null;
    const dayOfYear = Number((parsed as { dayOfYear?: unknown }).dayOfYear);
    const hour = Number((parsed as { hour?: unknown }).hour);
    const minute = Number((parsed as { minute?: unknown }).minute);
    const rlTimestampMs = Number(
      (parsed as { rlTimestampMs?: unknown }).rlTimestampMs
    );
    if (
      !Number.isFinite(dayOfYear) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      !Number.isFinite(rlTimestampMs) ||
      dayOfYear < 1 ||
      dayOfYear > YEAR_LENGTH_DAYS ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      rlTimestampMs <= 0
    ) {
      return null;
    }
    return { scheme: "hexenstag", dayOfYear, hour, minute, rlTimestampMs };
  } catch {
    return null;
  }
}

function clearTimeAnchor(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(ANCHOR_STORAGE_KEY);
  } catch {
    // brak dostepu do storage - kotwica jest opcjonalna
  }
}

function extrapolateFromAnchor(
  anchor: TimeAnchor,
  nowRlMs: number
): GameTime | null {
  const elapsedRealMs = nowRlMs - anchor.rlTimestampMs;
  if (!Number.isFinite(elapsedRealMs) || elapsedRealMs < 0) return null;
  const elapsedGameMinutes = Math.floor(elapsedRealMs / REAL_MS_PER_GAME_MINUTE);
  const yearTotal = YEAR_LENGTH_DAYS * GAME_MINUTES_PER_DAY;
  const anchorTotal =
    (anchor.dayOfYear - 1) * GAME_MINUTES_PER_DAY +
    anchor.hour * 60 +
    anchor.minute;
  const nowTotal =
    (((anchorTotal + elapsedGameMinutes) % yearTotal) + yearTotal) % yearTotal;
  const rem = nowTotal % GAME_MINUTES_PER_DAY;
  return clampGameTime({
    dayOfYear: Math.floor(nowTotal / GAME_MINUTES_PER_DAY) + 1,
    hour: Math.floor(rem / 60),
    minute: rem % 60,
  });
}


// Wariant A: po komunikacie cross - raport zadanej domeny z jej wlasnej
// zapisanej daty (bez delt miedzy domenami). Zwraca false, gdy nie ma
// zapisanej daty - wtedy galaz cross wypisuje MSG_CROSS_NO_ANCHOR (S6).
function printCrossAnchorReport(api: PluginApi): boolean {
  const anchor = loadTimeAnchor();
  if (!anchor) return false;
  const now = extrapolateFromAnchor(anchor, Date.now());
  if (!isValidGameTime(now)) return false;
  printFramedReport(api, [
    "[imperium_cal] Pokazuje Imperium wyliczone z zapisanej daty (ostatni odczyt: " +
      formatRealDate(new Date(anchor.rlTimestampMs)) +
      ").",
  ]);
  runImperiumReport(api, now);
  return true;
}

function tryFinishRequestFromAnchor(api: PluginApi): boolean {
  if (!pendingRequest) return false;
  const anchor = loadTimeAnchor();
  if (!anchor) return false;
  const now = extrapolateFromAnchor(anchor, Date.now());
  if (!isValidGameTime(now)) return false;
  clearPending();
  printFramedReport(api, [
    "[imperium_cal] Pokazuje Imperium wyliczone z zapisanej daty (ostatni odczyt: " +
      formatRealDate(new Date(anchor.rlTimestampMs)) +
      ").",
  ]);
  runImperiumReport(api, now);
  return true;
}

function safeLineToString(lineBuf: AnsiAwareBuffer): string {
  try {
    // AnsiAwareBuffer klienta nie nadpisuje toString() (odziedziczone zwraca
    // "[object Object]"); tekst linii jest w getterze .text (plugin-api).
    const s = (lineBuf as { text?: unknown } | null | undefined)?.text;
    return typeof s === "string" ? s : "";
  } catch {
    return "";
  }
}

export async function init(api: PluginApi): Promise<PluginInfo> {
  apiRef = api;

  helpPopup = await api.ui.registerPersistentPopup({
    id: "imperium_help",
    title: "Kalendarz Imperium",
    createContent: async () => buildHelpContent(),
  });

  helpMenuHandle = api.ui.addPopupMenuEntry("Kalendarz Imperium", () => {
    if (!helpPopup) return;
    if (helpPopup.isOpen) helpPopup.close();
    else void helpPopup.open();
  });

  api.triggers.register(
    /^\s*Jest w przyblizeniu\b.*$/i,
    (lineBuf: AnsiAwareBuffer) => {
      try {
        if (!apiRef) return lineBuf;

        const raw = sanitizeCzasLine(safeLineToString(lineBuf));

        // O1: kazda poprawnie sparsowana wlasna linia 'czas' zapisuje kotwice,
        // takze bez oczekujacego zapytania (pasywny zapis, paritet z WWW).
        // Linia GN ("noc Geheimnisnacht") nie ma daty - isValidGameTime ja odrzuci.
        if (isLikelyImperiumCzasLine(raw)) {
          const parsedPassive = tryParseCzasOutput(raw);
          if (isValidGameTime(parsedPassive)) {
            // Minuty nie sa podawane w linii 'czas' — kotwica na pelnej
            // godzinie (paritet z klientami WWW i Mudlet).
            saveTimeAnchor(parsedPassive.dayOfYear, parsedPassive.hour, 0);
          }
        }

        if (!pendingRequest) return lineBuf;

        if (Date.now() - requestStartedAtMs > REQUEST_TIMEOUT_MS + 200) {
          return lineBuf;
        }

        if (!isLikelyImperiumCzasLine(raw)) {
          // Zla domena (A3, jak w kliencie WWW): komunikat + kasowanie
          // pending, linia gagowana - zamiast mylacego timeoutu.
          if (isLikelyIshtarCzasLine(raw)) {
            clearPending();
            printFramedReport(api, MSG_CROSS_DOMAIN);
            if (!printCrossAnchorReport(api)) {
              printFramedReport(api, MSG_CROSS_NO_ANCHOR);
            }
            return null;
          }
          return lineBuf;
        }

        const parsed = tryParseCzasOutput(raw);
        if (!isValidGameTime(parsed)) {
          // Rozpoznana linia 'czas' Imperium bez daty w klauzuli (event Geheimnisnacht:
          // gra podaje "noc Geheimnisnacht" zamiast "X dzien miesiaca Y"). Nie zgadujemy
          // doy. Uzywamy WYLACZNIE kotwicy (ostatni dobry odczyt, ekstrapolowany) =
          // biezaca data IG. Brak kotwicy -> nie zgadujemy.
          // Natychmiast, bez czekania na timeout.
          if (tryFinishRequestFromAnchor(api)) return null;
          clearPending();
          printGnColdStart(api);
          return null;
        }

        // Kotwica zostala juz zapisana w bloku O1 powyzej.
        const finalNow: GameTime = {
          dayOfYear: parsed.dayOfYear,
          hour: parsed.hour,
          minute: 0,
        };

        clearPending();
        runImperiumReport(api, finalNow);
        return null;
      } catch (err) {
        console.error("Imperium trigger error:", err);
        return lineBuf;
      }
    },
    TAG
  );

  aliasId = api.aliases.register(/^\/imperium$/i, () => {
    try {
      if (!SANITY_OK) {
        printUnable(api);
        return true;
      }

      if (pendingRequest) return true;

      pendingRequest = true;
      requestStartedAtMs = Date.now();

      void api.command.send("czas", false);

      window.setTimeout(() => {
        if (!apiRef) return;
        if (!pendingRequest) return;

        if (tryFinishRequestFromAnchor(api)) return;

        clearPending();
        printTimeout(api);
      }, REQUEST_TIMEOUT_MS + 50);

      return true;
    } catch (err) {
      console.error("Imperium alias error:", err);
      clearPending();
      return true;
    }
  });

  resetAliasId = api.aliases.register(/^\/imperium\s+reset$/i, () => {
    try {
      clearTimeAnchor();
      printFramedReport(api, MSG_RESET_DONE);
      return true;
    } catch (err) {
      console.error("Imperium reset alias error:", err);
      return true;
    }
  });

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    author: "Isithunzi000",
    description:
      "Kalendarz Imperium wylicza czas RL dla wydarzeń domeny bazując na czasie IG uzyskanym z gry (alias /imperium).",
  };
}

export async function destroy(): Promise<void> {
  if (!apiRef) return;

  if (aliasId) {
    try {
      apiRef.aliases.remove(aliasId);
    } catch {
      // ignore
    }
    aliasId = null;
  }

  if (resetAliasId) {
    try {
      apiRef.aliases.remove(resetAliasId);
    } catch {
      // ignore
    }
    resetAliasId = null;
  }

  try {
    apiRef.triggers.removeByTag(TAG);
  } catch {
    // ignore
  }

  try {
    if (helpPopup?.isOpen) helpPopup.close();
  } catch {
    // ignore
  }

  if (helpMenuHandle) {
    try {
      helpMenuHandle.remove();
    } catch {
      // ignore
    }
    helpMenuHandle = null;
  }

  helpPopup = null;
  clearPending();
  apiRef = null;
}
