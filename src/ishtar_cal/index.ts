import PluginApi, { PluginInfo, AnsiAwareBuffer } from "plugin-api";

const PLUGIN_NAME = "ishtar_cal";
const TAG = "ishtar_cal";

const REAL_SECONDS_PER_GAME_HOUR = 120;
const REAL_SECONDS_PER_GAME_MINUTE = REAL_SECONDS_PER_GAME_HOUR / 60; // 2s
const GAME_MINUTES_PER_DAY = 24 * 60;
const ANCHOR_STORAGE_KEY = "dargoth.ishtar_cal.anchor.v2";

// Wersja wyswietlana w pomocy (stopka)
const PLUGIN_VERSION = "1.8.23";
const PLUGIN_BUILD_DATE = "07-09-2026";

type IshtarSeason =
  | "Yule"
  | "Imbaelk"
  | "Birke"
  | "Blathe"
  | "Feainn"
  | "Lammas"
  | "Velen"
  | "Saovine";

const ISHTAR_SEASONS: IshtarSeason[] = [
  "Saovine",
  "Yule",
  "Imbaelk",
  "Birke",
  "Blathe",
  "Feainn",
  "Lammas",
  "Velen",
]; // rok od 1 Saovine (paritet z ishtar_cal 1.8.12m)

const DAYS_PER_SEASON = 45;
const DAYS_PER_YEAR = ISHTAR_SEASONS.length * DAYS_PER_SEASON; // 360

type EventKind = "astronomiczne" | "magiczne" | "ksiezycowe" | "lokalne";

interface CalendarEventDef {
  id: string;
  name: string;
  kind: EventKind;
  startDayOfYear: number;
  startHour: number;
  startMinute: number;
  emphasize?: boolean;
  windowGameMinutes: number;
}

type TimeAnchor = {
  scheme: string;
  dayOfYear: number;
  hour: number;
  minute: number;
  rlTimestampMs: number;
};

interface ParsedTimeFromText {
  hours: number;
  dayOfYear: number;
}

interface EventOccurrence {
  def: CalendarEventDef;
  deltaToStartGameMinutes: number;
  realStartDate: Date;
  activeNow: boolean;
  gameMinutesUntilEnd: number;
}

interface MergedEventOccurrence {
  id: string;
  name: string;
  kind: EventKind;
  emphasize: boolean;
  deltaToStartGameMinutes: number;
  realStartDate: Date;
  activeNow: boolean;
  windowGameMinutes: number;
  gameMinutesUntilEnd: number;
}

interface DayWindow {
  startDay: number; // inclusive, 00:00
  endDay: number; // exclusive, 00:00
}

let apiRef: PluginApi | null = null;
let aliasId: string | null = null;
let resetAliasId: string | null = null;
let helpMenuHandle: { remove(): void } | null = null;

let pendingRequest = false;
let requestStartedAtMs = 0;

function clearPending(): void {
  pendingRequest = false;
  requestStartedAtMs = 0;
}

// Funkcje walidacyjne dla czasu gry
function isValidIshtarTime(
  dayOfYear: number,
  hours: number,
  minutes: number
): boolean {
  return (
    Number.isFinite(dayOfYear) &&
    dayOfYear >= 1 &&
    dayOfYear <= DAYS_PER_YEAR &&
    Number.isFinite(hours) &&
    hours >= 0 &&
    hours <= 23 &&
    Number.isFinite(minutes) &&
    minutes >= 0 &&
    minutes <= 59
  );
}

function clampIshtarTime(
  dayOfYear: number,
  hours: number,
  minutes: number
): { dayOfYear: number; hours: number; minutes: number } {
  return {
    dayOfYear: Math.max(1, Math.min(DAYS_PER_YEAR, Math.floor(dayOfYear))),
    hours: Math.max(0, Math.min(23, Math.floor(hours))),
    minutes: Math.max(0, Math.min(59, Math.floor(minutes))),
  };
}

// Zwiekszony timeout, bo serwer potrafi zalagowac i odpowiedz na "czas" przychodzi pozniej.
const REQUEST_TIMEOUT_MS = 3500;
const MAX_EYSENLAAN_OCCURRENCES = 2;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatRealDateTime(date: Date): string {
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function wrapOutput(text: string): string {
  return `\n\n---\n${text}\n---\n\n`;
}

function clampDayOfYear(dayOfYear: number): number {
  if (!Number.isFinite(dayOfYear)) return 1;
  return Math.max(1, Math.min(DAYS_PER_YEAR, Math.floor(dayOfYear)));
}

function momentToGameMinutes(
  dayOfYear: number,
  hour: number,
  minute: number
): number {
  const dayIndex = clampDayOfYear(dayOfYear) - 1;
  return dayIndex * GAME_MINUTES_PER_DAY + hour * 60 + minute;
}

function deltaGameMinutesToRealMs(deltaGameMinutes: number): number {
  return deltaGameMinutes * REAL_SECONDS_PER_GAME_MINUTE * 1000;
}

function seasonIndexOf(season: IshtarSeason): number {
  const key = String(season).toLowerCase();
  return ISHTAR_SEASONS.findIndex((s) => s.toLowerCase() === key);
}

function seasonOfDayOfYear(dayOfYear: number): IshtarSeason {
  const d = clampDayOfYear(dayOfYear);
  const idx = Math.floor((d - 1) / DAYS_PER_SEASON);
  return ISHTAR_SEASONS[
    Math.max(0, Math.min(ISHTAR_SEASONS.length - 1, idx))
  ];
}

// Empiryczne godziny wschodu i zachodu slonca dla domeny Ishtar (per savoed).
// Uzywamy ich do liczenia zmierzchu (start swiat boundary / Belleteyn).
const SUNRISE_BY_SEASON_HOUR: Record<IshtarSeason, number> = {
  Yule: 8,
  Imbaelk: 7,
  Birke: 6,
  Blathe: 5,
  Feainn: 4,
  Lammas: 5,
  Velen: 7,
  Saovine: 6,
};

const SUNSET_BY_SEASON_HOUR: Record<IshtarSeason, number> = {
  Yule: 16,
  Imbaelk: 18,
  Birke: 19,
  Blathe: 21,
  Feainn: 20,
  Lammas: 20,
  Velen: 18,
  Saovine: 17,
};

function duskHourForDayOfYear(dayOfYear: number): number {
  const season = seasonOfDayOfYear(dayOfYear);
  return SUNSET_BY_SEASON_HOUR[season];
}

function boundaryStartDayOfYearForSeason(season: IshtarSeason): number {
  const idx = seasonIndexOf(season);
  if (idx < 0) return 1;
  const prevIdx = (idx - 1 + ISHTAR_SEASONS.length) % ISHTAR_SEASONS.length;
  return prevIdx * DAYS_PER_SEASON + DAYS_PER_SEASON;
}

const HOLIDAY_WINDOW_GAME_MINUTES = 24 * 60;

const BELLETEYN_DAY_OF_YEAR = 180 // ostatni dzien Birke (rok od 1 Saovine);

// Pelnia ksiezyca (empiryka): zakresy xx-yy oznaczaja start o 00:00 dnia xx i koniec o 00:00 dnia yy.
// Lista jest traktowana jako prawda nadrzedna (nie wyliczamy jej algorytmicznie).
const FULL_MOON_WINDOWS: DayWindow[] = [
  { startDay: 49, endDay: 51 },
  { startDay: 73, endDay: 75 },
  { startDay: 97, endDay: 99 },
  { startDay: 121, endDay: 123 },
  { startDay: 145, endDay: 147 },
  { startDay: 169, endDay: 171 },
  { startDay: 193, endDay: 195 },
  { startDay: 217, endDay: 219 },
  { startDay: 241, endDay: 243 },
  { startDay: 267, endDay: 269 },
  { startDay: 289, endDay: 291 },
  { startDay: 313, endDay: 315 },
  { startDay: 337, endDay: 339 },
  { startDay: 1, endDay: 3 },
  { startDay: 25, endDay: 27 },
]
  .map((w) => ({
    startDay: clampDayOfYear(w.startDay),
    endDay: clampDayOfYear(w.endDay),
  }))
  .filter((w) => w.endDay > w.startDay); // sanity check

const YEAR_TOTAL_GAME_MINUTES = DAYS_PER_YEAR * GAME_MINUTES_PER_DAY;

type FullMoonStart = {
  startDay: number;
  startMinuteOfYear: number;
  windowMinutes: number;
};

// Precompute startow pelni (stale dane empiryczne).
const FULL_MOON_STARTS: FullMoonStart[] = FULL_MOON_WINDOWS.map((w) => {
  const startMinuteOfYear = momentToGameMinutes(w.startDay, 0, 0);
  const windowMinutes = (w.endDay - w.startDay) * GAME_MINUTES_PER_DAY;
  return {
    startDay: w.startDay,
    startMinuteOfYear,
    windowMinutes,
  };
}).sort((a, b) => a.startMinuteOfYear - b.startMinuteOfYear);

const EYSENLAAN_FAIR_START_DAY_OF_MONTH = 6;
const EYSENLAAN_FAIR_DAYS = 3; // 6,7,8

function buildHolidayEvents(): CalendarEventDef[] {
  const defs: CalendarEventDef[] = [];

  const addBoundaryEvent = (
    id: string,
    name: string,
    kind: EventKind,
    seasonStartsAtBoundary: IshtarSeason,
    opts?: {
      emphasize?: boolean;
    }
  ) => {
    const startDayOfYear =
      boundaryStartDayOfYearForSeason(seasonStartsAtBoundary);
    const startHour = duskHourForDayOfYear(startDayOfYear);

    defs.push({
      id,
      name,
      kind,
      startDayOfYear,
      startHour,
      startMinute: 0,
      emphasize: opts?.emphasize,
      windowGameMinutes: HOLIDAY_WINDOW_GAME_MINUTES,
    });
  };

  const addFixedDayEvent = (
    id: string,
    name: string,
    kind: EventKind,
    dayOfYear: number,
    opts?: {
      emphasize?: boolean;
      hour?: number;
      minute?: number;
      windowGameMinutes?: number;
    }
  ) => {
    const startDayOfYear = clampDayOfYear(dayOfYear);
    const startHour =
      typeof opts?.hour === "number"
        ? opts.hour
        : duskHourForDayOfYear(startDayOfYear);
    const startMinute = typeof opts?.minute === "number" ? opts.minute : 0;

    defs.push({
      id,
      name,
      kind,
      startDayOfYear,
      startHour,
      startMinute,
      emphasize: opts?.emphasize,
      windowGameMinutes:
        typeof opts?.windowGameMinutes === "number"
          ? opts.windowGameMinutes
          : HOLIDAY_WINDOW_GAME_MINUTES,
    });
  };

  addBoundaryEvent("midinvaerne", "Midinvaerne", "astronomiczne", "Yule");
  addBoundaryEvent("birke", "Birke", "astronomiczne", "Birke");
  addBoundaryEvent("midaete", "Midaete", "astronomiczne", "Feainn");
  addBoundaryEvent("velen", "Velen", "astronomiczne", "Velen");

  addBoundaryEvent("imbaelk", "Imbaelk", "magiczne", "Imbaelk");
  addFixedDayEvent("belleteyn", "Belleteyn", "magiczne", BELLETEYN_DAY_OF_YEAR, {
    emphasize: true,
  });
  addBoundaryEvent("lammas", "Lammas", "magiczne", "Lammas");
  addBoundaryEvent("saovine", "Saovine", "magiczne", "Saovine", {
    emphasize: true,
  });

  return defs;
}

const HOLIDAYS: CalendarEventDef[] = buildHolidayEvents();

function isWithinWindow(
  nowGameMinutes: number,
  startGameMinutes: number,
  windowGameMinutes: number,
  yearTotalGameMinutes: number
): boolean {
  const end = startGameMinutes + windowGameMinutes;
  if (end <= yearTotalGameMinutes) {
    return nowGameMinutes >= startGameMinutes && nowGameMinutes < end;
  }

  const endWrapped = end - yearTotalGameMinutes;
  return nowGameMinutes >= startGameMinutes || nowGameMinutes < endWrapped;
}

function minutesUntilWindowEnd(
  nowGameMinutes: number,
  startGameMinutes: number,
  windowGameMinutes: number,
  yearTotalGameMinutes: number
): number {
  if (windowGameMinutes <= 0) return 0;

  const end = startGameMinutes + windowGameMinutes;
  if (end <= yearTotalGameMinutes) {
    return Math.max(0, end - nowGameMinutes);
  }

  const endWrapped = end - yearTotalGameMinutes;
  if (nowGameMinutes >= startGameMinutes) {
    return yearTotalGameMinutes - nowGameMinutes + endWrapped;
  }

  return Math.max(0, endWrapped - nowGameMinutes);
}

function makeOccurrenceFromStart(
  def: CalendarEventDef,
  nowGameMinutes: number,
  startGameMinutes: number,
  yearTotalGameMinutes: number
): EventOccurrence {
  const activeNow = isWithinWindow(
    nowGameMinutes,
    startGameMinutes,
    def.windowGameMinutes,
    yearTotalGameMinutes
  );

  let deltaToStart = startGameMinutes - nowGameMinutes;
  if (deltaToStart < 0) deltaToStart += yearTotalGameMinutes;

  if (activeNow) {
    const untilEnd = minutesUntilWindowEnd(
      nowGameMinutes,
      startGameMinutes,
      def.windowGameMinutes,
      yearTotalGameMinutes
    );
    const minutesSinceStart =
      (def.windowGameMinutes - untilEnd) % yearTotalGameMinutes;
    const realStartDate = new Date(
      Date.now() - deltaGameMinutesToRealMs(minutesSinceStart)
    );

    return {
      def,
      deltaToStartGameMinutes: 0,
      realStartDate,
      activeNow: true,
      gameMinutesUntilEnd: untilEnd,
    };
  }

  const realStartDate = new Date(
    Date.now() + deltaGameMinutesToRealMs(deltaToStart)
  );
  return {
    def,
    deltaToStartGameMinutes: deltaToStart,
    realStartDate,
    activeNow: false,
    gameMinutesUntilEnd: 0,
  };
}

function computeNextOccurrencesForFixed(
  def: CalendarEventDef,
  nowGameMinutes: number,
  yearTotalGameMinutes: number
): EventOccurrence {
  const startDayOfYear = clampDayOfYear(def.startDayOfYear);
  const start = momentToGameMinutes(
    startDayOfYear,
    def.startHour,
    def.startMinute
  );

  return makeOccurrenceFromStart(
    def,
    nowGameMinutes,
    start,
    yearTotalGameMinutes
  );
}

function computeFullMoonOccurrence(now: {
  dayOfYear: number;
  hours: number;
  minutes: number;
}): EventOccurrence {
  const nowGameMinutes = momentToGameMinutes(
    now.dayOfYear,
    now.hours,
    now.minutes
  );

  const baseDef: CalendarEventDef = {
    id: "pelnia",
    name: "Pelnia ksiezyca",
    kind: "ksiezycowe",
    startDayOfYear: 1,
    startHour: 0,
    startMinute: 0,
    emphasize: true,
    windowGameMinutes: 0,
  };

  // 1) Sprawdzamy aktywna pelnie.
  for (const w of FULL_MOON_STARTS) {
    const occ = makeOccurrenceFromStart(
      {
        ...baseDef,
        startDayOfYear: w.startDay,
        windowGameMinutes: w.windowMinutes,
      },
      nowGameMinutes,
      w.startMinuteOfYear,
      YEAR_TOTAL_GAME_MINUTES
    );

    if (occ.activeNow) return occ;
  }

  // 2) Najblizsza przyszla: wybieramy minimalna dodatnia delte (z wrapem roku).
  let best: FullMoonStart | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const w of FULL_MOON_STARTS) {
    let delta = w.startMinuteOfYear - nowGameMinutes;
    if (delta < 0) delta += YEAR_TOTAL_GAME_MINUTES;

    if (delta < bestDelta) {
      bestDelta = delta;
      best = w;
    }
  }

  if (!best) {
    // brak danych empirycznych (nie powinno sie zdarzyc)
    return computeNextOccurrencesForFixed(
      { ...baseDef, windowGameMinutes: 0 },
      nowGameMinutes,
      YEAR_TOTAL_GAME_MINUTES
    );
  }

  return makeOccurrenceFromStart(
    {
      ...baseDef,
      startDayOfYear: best.startDay,
      windowGameMinutes: best.windowMinutes,
    },
    nowGameMinutes,
    best.startMinuteOfYear,
    YEAR_TOTAL_GAME_MINUTES
  );
}

function computeNextEysenlaanFairs(now: {
  dayOfYear: number;
  hours: number;
  minutes: number;
}): EventOccurrence[] {
  const today = clampDayOfYear(now.dayOfYear);
  const nowGameMinutes = momentToGameMinutes(today, now.hours, now.minutes);

  const seasonIdx = Math.floor((today - 1) / DAYS_PER_SEASON);
  const seasonDayOfMonth = ((today - 1) % DAYS_PER_SEASON) + 1;

  const currentSeasonStart = seasonIdx * DAYS_PER_SEASON + 1;
  const nextSeasonIdx = (seasonIdx + 1) % ISHTAR_SEASONS.length;
  const nextSeasonStart = nextSeasonIdx * DAYS_PER_SEASON + 1;

  const firstStartDayOfYear =
    seasonDayOfMonth <= EYSENLAAN_FAIR_START_DAY_OF_MONTH + EYSENLAAN_FAIR_DAYS - 1
      ? currentSeasonStart + (EYSENLAAN_FAIR_START_DAY_OF_MONTH - 1)
      : nextSeasonStart + (EYSENLAAN_FAIR_START_DAY_OF_MONTH - 1);

  const firstSeasonIdx = Math.floor(
    (clampDayOfYear(firstStartDayOfYear) - 1) / DAYS_PER_SEASON
  );
  const secondSeasonStart =
    ((firstSeasonIdx + 1) % ISHTAR_SEASONS.length) * DAYS_PER_SEASON + 1;
  const secondStartDayOfYear =
    secondSeasonStart + (EYSENLAAN_FAIR_START_DAY_OF_MONTH - 1);

  const baseDef: CalendarEventDef = {
    id: "festyn_eysenlaan",
    name: "Festyn w Eysenlaan",
    kind: "lokalne",
    startDayOfYear: clampDayOfYear(firstStartDayOfYear),
    startHour: 0,
    startMinute: 0,
    emphasize: true,
    windowGameMinutes: EYSENLAAN_FAIR_DAYS * GAME_MINUTES_PER_DAY,
  };

  const startsList = [firstStartDayOfYear, secondStartDayOfYear].map(
    clampDayOfYear
  );
  const occ = startsList.map((day) => {
    const def: CalendarEventDef = { ...baseDef, startDayOfYear: day };
    const start = momentToGameMinutes(def.startDayOfYear, 0, 0);
    return makeOccurrenceFromStart(
      def,
      nowGameMinutes,
      start,
      YEAR_TOTAL_GAME_MINUTES
    );
  });

  return occ
    .sort((a, b) => a.deltaToStartGameMinutes - b.deltaToStartGameMinutes)
    .slice(0, MAX_EYSENLAAN_OCCURRENCES);
}

function computeNextOccurrences(now: {
  dayOfYear: number;
  hours: number;
  minutes: number;
}): EventOccurrence[] {
  const nowGameMinutes = momentToGameMinutes(
    now.dayOfYear,
    now.hours,
    now.minutes
  );

  const all: EventOccurrence[] = [];

  for (const def of HOLIDAYS) {
    all.push(
      computeNextOccurrencesForFixed(
        def,
        nowGameMinutes,
        YEAR_TOTAL_GAME_MINUTES
      )
    );
  }

  all.push(computeFullMoonOccurrence(now));
  all.push(...computeNextEysenlaanFairs(now));

  return all.sort(
    (a, b) => a.deltaToStartGameMinutes - b.deltaToStartGameMinutes
  );
}

function mergeOccurrences(occ: EventOccurrence[]): MergedEventOccurrence[] {
  const fixedMap = new Map<string, MergedEventOccurrence>();
  const multi: MergedEventOccurrence[] = [];

  for (const o of occ) {
    // Jedynym zdarzeniem, ktore pokazujemy wielokrotnie w wynikach, jest festyn (bo chcemy 2 najblizsze).
    const isMulti = o.def.id === "festyn_eysenlaan";

    const item: MergedEventOccurrence = {
      id: isMulti ? `${o.def.id}|${o.deltaToStartGameMinutes}` : o.def.id,
      name: o.def.name,
      kind: o.def.kind,
      emphasize: Boolean(o.def.emphasize),
      deltaToStartGameMinutes: o.deltaToStartGameMinutes,
      realStartDate: o.realStartDate,
      activeNow: o.activeNow,
      windowGameMinutes: o.def.windowGameMinutes,
      gameMinutesUntilEnd: o.gameMinutesUntilEnd,
    };

    if (isMulti) {
      multi.push(item);
      continue;
    }

    const existing = fixedMap.get(o.def.id);
    if (
      existing &&
      existing.deltaToStartGameMinutes <= o.deltaToStartGameMinutes
    ) {
      continue;
    }
    fixedMap.set(o.def.id, item);
  }

  return [...Array.from(fixedMap.values()), ...multi].sort(
    (a, b) => a.deltaToStartGameMinutes - b.deltaToStartGameMinutes
  );
}

function formatRealDelta(deltaMs: number): string {
  const totalMinutes = Math.max(0, Math.round(deltaMs / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const rest = totalMinutes - days * 60 * 24;
  const hrs = Math.floor(rest / 60);
  const mins = rest % 60;

  return `${days}d ${pad2(hrs)}h ${pad2(mins)}m`;
}

function kindLabel(kind: EventKind): string {
  if (kind === "astronomiczne") return "swieto astronomiczne";
  if (kind === "magiczne") return "swieto magiczne";
  if (kind === "lokalne") return "festyn";
  return "wydarzenie ksiezycowe";
}

function formatEventLines(item: MergedEventOccurrence): string[] {
  const {
    name,
    kind,
    emphasize,
    realStartDate,
    activeNow,
    windowGameMinutes,
    gameMinutesUntilEnd,
  } = item;

  const cleanName = name.trim().replace(/\s+/g, " ");
  const label = kindLabel(kind);
  const lines: string[] = [];

  // Linia nazwy z etykieta rodzaju.
  if (emphasize) {
    lines.push(`  *** ${cleanName} (${label}) ***`);
  } else {
    lines.push(`  ${cleanName} (${label})`);
  }

  if (activeNow) {
    if (windowGameMinutes > 0) {
      const realEnd = new Date(
        Date.now() + deltaGameMinutesToRealMs(gameMinutesUntilEnd)
      );
      lines.push(`    TRWA TERAZ (do ${formatRealDateTime(realEnd)})`);
    } else {
      lines.push(`    TRWA TERAZ`);
    }
    return lines;
  }

  const deltaToStartMs = realStartDate.getTime() - Date.now();

  if (windowGameMinutes > 0 && kind === "lokalne") {
    const realEnd = new Date(
      realStartDate.getTime() + deltaGameMinutesToRealMs(windowGameMinutes)
    );
    lines.push(`    Od:      ${formatRealDateTime(realStartDate)}`);
    lines.push(`    Do:      ${formatRealDateTime(realEnd)}`);
    lines.push(`    Za:      ${formatRealDelta(deltaToStartMs)}`);
  } else {
    lines.push(`    Data RL: ${formatRealDateTime(realStartDate)}`);
    lines.push(`    Za:      ${formatRealDelta(deltaToStartMs)}`);
  }

  return lines;
}

function formatMainMagicLines(item: MergedEventOccurrence): string[] {
  const { id, name, activeNow, realStartDate, windowGameMinutes, gameMinutesUntilEnd } = item;
  const cleanName = name.trim().replace(/\s+/g, " ");
  const lines: string[] = [];

  // Belleteyn: z numerem dnia. Saovine: bez dodatkow.
  if (id === "belleteyn") {
    lines.push(`  *** ${cleanName} (dzien ${BELLETEYN_DAY_OF_YEAR}) ***`);
  } else {
    lines.push(`  *** ${cleanName} ***`);
  }

  if (activeNow) {
    if (windowGameMinutes > 0) {
      const realEnd = new Date(
        Date.now() + deltaGameMinutesToRealMs(gameMinutesUntilEnd)
      );
      lines.push(`    TRWA TERAZ (do ${formatRealDateTime(realEnd)})`);
    } else {
      lines.push(`    TRWA TERAZ`);
    }
    return lines;
  }

  const deltaToStartMs = realStartDate.getTime() - Date.now();
  lines.push(`    Data RL: ${formatRealDateTime(realStartDate)}`);
  lines.push(`    Za:      ${formatRealDelta(deltaToStartMs)}`);

  return lines;
}

function buildResultText(now: {
  dayOfYear: number;
  hours: number;
  minutes: number;
}): string {
  const upcoming = mergeOccurrences(computeNextOccurrences(now));
  const lines: string[] = [];

  // Rozdzielenie na glowne swieta magiczne (Belleteyn, Saovine) i reszta.
  const mainMagic: MergedEventOccurrence[] = [];
  const other: MergedEventOccurrence[] = [];

  for (const item of upcoming) {
    if (item.kind === "magiczne" && item.emphasize) {
      mainMagic.push(item);
    } else {
      other.push(item);
    }
  }

  lines.push("Glowne swieta magiczne:");
  for (const item of mainMagic) {
    lines.push(...formatMainMagicLines(item));
  }

  lines.push("");
  lines.push("Inne najblizsze wydarzenia:");
  for (const ev of other) {
    lines.push(...formatEventLines(ev));
  }

  return lines.join("\n");
}

const MSG_INTERNAL =
  "[ishtar_cal] Blad wewnetrzny kalendarza Ishtar - nie mozna wyliczyc danych.";
const MSG_TIMEOUT =
  "[ishtar_cal] Brak odpowiedzi na komende 'czas' (timeout) i nie mam zapamietanej daty.\n" +
  "Sprawdz, czy 'czas' dziala, i sprobuj ponownie.";
// Zla domena (A3) - komunikat 1:1 z klientem WWW.
const MSG_CROSS_DOMAIN =
  "[ishtar_cal] Otrzymano czas Imperium - postac jest w domenie Imperium.\n" +
  "Uzyj /imperium zamiast /ishtar.";
const MSG_CROSS_NO_ANCHOR =
  "[ishtar_cal] Nie mam zapamietanej daty domeny Ishtar - nie moge wyliczyc raportu.\n" +
  "Bedac w domenie Ishtar, uzyj komendy /ishtar - odczyt zapisze date na przyszlosc.";
const MSG_RESET_DONE =
  "[ishtar_cal] Kotwica Ishtar wyczyszczona. Uzyj /ishtar na zewnatrz, zeby zapisac nowa.";


// Wariant A: po komunikacie cross - raport zadanej domeny z jej wlasnej
// zapisanej daty (bez delt miedzy domenami). Zwraca false, gdy nie ma
// zapisanej daty - wtedy galaz cross wypisuje MSG_CROSS_NO_ANCHOR (S6).
function printCrossAnchorReport(): boolean {
  if (!apiRef) return false;
  const anchor = loadTimeAnchor();
  if (!anchor) return false;
  const now = extrapolateFromAnchor(anchor, Date.now());
  if (!now || !isValidIshtarTime(now.dayOfYear, now.hours, now.minutes)) {
    return false;
  }
  apiRef.output.print(
    wrapOutput(
      "[ishtar_cal] Pokazuje Ishtar wyliczone z zapisanej daty (ostatni odczyt: " +
        formatRealDateTime(new Date(anchor.rlTimestampMs)) +
        ")."
    )
  );
  runIshtarReport(now);
  return true;
}

function printUnable(): void {
  if (!apiRef) return;
  apiRef.output.print(wrapOutput(MSG_INTERNAL));
}

function printTimeout(): void {
  if (!apiRef) return;
  apiRef.output.print(wrapOutput(MSG_TIMEOUT));
}

function runIshtarReport(time: {
  dayOfYear: number;
  hours: number;
  minutes: number;
}): void {
  if (!apiRef) return;
  try {
    apiRef.output.print(wrapOutput(buildResultText(time)));
  } catch {
    printUnable();
  }
}

function saveTimeAnchor(dayOfYear: number, hour: number, minute: number): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const anchor: TimeAnchor = {
      scheme: "saovine",
      dayOfYear: Math.max(1, Math.min(DAYS_PER_YEAR, Math.floor(dayOfYear))),
      hour: Math.max(0, Math.min(23, Math.floor(hour))),
      minute: Math.max(0, Math.min(59, Math.floor(minute))),
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
    // Rekord bez zgodnego scheme (np. legacy klucz 1.8.12, Yule-first) - ignoruj.
    if ((parsed as { scheme?: unknown }).scheme !== "saovine") return null;
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
      dayOfYear > DAYS_PER_YEAR ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      rlTimestampMs <= 0
    ) {
      return null;
    }
    return { scheme: "saovine", dayOfYear, hour, minute, rlTimestampMs };
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
): { dayOfYear: number; hours: number; minutes: number } | null {
  const elapsedRealMs = nowRlMs - anchor.rlTimestampMs;
  if (!Number.isFinite(elapsedRealMs) || elapsedRealMs < 0) return null;
  const elapsedGameMinutes = Math.floor(
    elapsedRealMs / (REAL_SECONDS_PER_GAME_MINUTE * 1000)
  );
  const yearTotal = DAYS_PER_YEAR * GAME_MINUTES_PER_DAY;
  const anchorTotal =
    (anchor.dayOfYear - 1) * GAME_MINUTES_PER_DAY +
    anchor.hour * 60 +
    anchor.minute;
  const nowTotal =
    (((anchorTotal + elapsedGameMinutes) % yearTotal) + yearTotal) % yearTotal;
  const rem = nowTotal % GAME_MINUTES_PER_DAY;
  const t = clampIshtarTime(
    Math.floor(nowTotal / GAME_MINUTES_PER_DAY) + 1,
    Math.floor(rem / 60),
    rem % 60
  );
  return { dayOfYear: t.dayOfYear, hours: t.hours, minutes: t.minutes };
}

function tryFinishRequestFromAnchor(): boolean {
  if (!apiRef) return false;
  if (!pendingRequest) return false;
  const anchor = loadTimeAnchor();
  if (!anchor) return false;
  const now = extrapolateFromAnchor(anchor, Date.now());
  if (!now || !isValidIshtarTime(now.dayOfYear, now.hours, now.minutes)) {
    return false;
  }
  clearPending();
  apiRef.output.print(
    wrapOutput(
      "[ishtar_cal] Pokazuje Ishtar wyliczone z zapisanej daty (ostatni odczyt: " +
        formatRealDateTime(new Date(anchor.rlTimestampMs)) +
        ")."
    )
  );
  runIshtarReport({
    dayOfYear: now.dayOfYear,
    hours: now.hours,
    minutes: now.minutes,
  });
  return true;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
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

function sanitizeCzasLine(line: string): string {
  let s = stripAnsi(line);

  const bracketIdx = s.indexOf("[");
  if (bracketIdx >= 0) s = s.slice(0, bracketIdx);

  s = s.replace(/^\s*>\s*/, "");

  const arrowIdx = s.indexOf("→");
  if (arrowIdx >= 0) {
    const before = s.slice(0, arrowIdx).trim();
    if (before === "" || before === ">" || before.endsWith(">")) {
      s = s.slice(0, arrowIdx);
    }
  }

  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function isLikelyIshtarCzasLine(raw: string): boolean {
  const lc = raw.toLowerCase();
  if (!lc.startsWith("jest w przyblizeniu")) return false;
  return lc.includes("wedlug rachuby czasu starszego ludu");
}

function isLikelyImperiumCzasLine(raw: string): boolean {
  const lc = raw.toLowerCase();
  if (!lc.startsWith("jest w przyblizeniu")) return false;
  return lc.includes("kalendarza imperialnego");
}

// Parsowanie polskich liczebnikow porzadkowych (np. "dwudziesty drugi" -> 22)
function parsePolishOrdinalDay(words: string): number | null {
  const w = words.trim().toLowerCase();

  const units: Record<string, number> = {
    pierwszy: 1,
    pierwsza: 1,
    pierwsze: 1,
    drugi: 2,
    druga: 2,
    drugie: 2,
    trzeci: 3,
    trzecia: 3,
    trzecie: 3,
    czwarty: 4,
    czwarta: 4,
    czwarte: 4,
    piaty: 5,
    piata: 5,
    piate: 5,
    szosty: 6,
    szosta: 6,
    szoste: 6,
    siodmy: 7,
    siodma: 7,
    siodme: 7,
    osmy: 8,
    osma: 8,
    osme: 8,
    dziewiaty: 9,
    dziewiata: 9,
    dziewiate: 9,
    dziesiaty: 10,
    dziesiata: 10,
    dziesiate: 10,
    jedenasty: 11,
    jedenasta: 11,
    jedenaste: 11,
    dwunasty: 12,
    dwunasta: 12,
    dwunaste: 12,
    trzynasty: 13,
    trzynasta: 13,
    trzynaste: 13,
    czternasty: 14,
    czternasta: 14,
    czternaste: 14,
    pietnasty: 15,
    pietnasta: 15,
    pietnaste: 15,
    szesnasty: 16,
    szesnasta: 16,
    szesnaste: 16,
    siedemnasty: 17,
    siedemnasta: 17,
    siedemnaste: 17,
    osiemnasty: 18,
    osiemnasta: 18,
    osiemnaste: 18,
    dziewietnasty: 19,
    dziewietnasta: 19,
    dziewietnaste: 19,
  };

  const tens: Record<string, number> = {
    dwudziesty: 20,
    dwudziesta: 20,
    dwudzieste: 20,
    trzydziesty: 30,
    trzydziesta: 30,
    trzydzieste: 30,
    czterdziesty: 40,
    czterdziesta: 40,
    czterdzieste: 40,
  };

  // Sprawdz czy to pojedyncza liczba
  if (units[w]) return units[w];
  if (tens[w]) return tens[w];

  // Sprawdz czy to zlozenie (np. "dwudziesty drugi")
  const parts = w.split(/[\s-]+/);
  if (parts.length === 2) {
    const t = tens[parts[0]];
    const u = units[parts[1]];
    if (typeof t === "number" && typeof u === "number") {
      return t + u;
    }
  }

  return null;
}

// Normalizacja koncowki "-ej" (np. "trzeciej" -> "trzecia") - parytet z imperium_cal.
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

function parseIshtarTimeFromCzasLine(line: string): ParsedTimeFromText | null {
  const hours = parseHourFromCzasLine(line);
  if (hours === null) return null;

  const seasonAlternation = ISHTAR_SEASONS.join("|");
  const mSeason = line.match(
    new RegExp(
      String.raw`\b(\d{1,2})\s*dzien\s+pory\s+(${seasonAlternation})\b`,
      "i"
    )
  );

  // Standardowa linia z "dzien pory <Sezon>"
  if (mSeason) {
    const dayOfMonth = Number(mSeason[1]);
    const season = mSeason[2] as IshtarSeason;

    if (
      !Number.isFinite(dayOfMonth) ||
      dayOfMonth < 1 ||
      dayOfMonth > DAYS_PER_SEASON
    ) {
      return null;
    }

    const seasonIndex = seasonIndexOf(season);
    if (seasonIndex < 0) return null;

    const dayOfYear = seasonIndex * DAYS_PER_SEASON + dayOfMonth;

    return {
      hours,
      dayOfYear,
    };
  }

  // Wariant slowny: "dwudziesty drugi dzien pory Saovine"
  const mSeasonWord = line.match(
    new RegExp(
      String.raw`\b([a-z]+(?:[\s-]+[a-z]+){0,2})\s+dzien\s+pory\s+(${seasonAlternation})\b`,
      "i"
    )
  );

  if (mSeasonWord) {
    const dayWord = mSeasonWord[1];
    const season = mSeasonWord[2] as IshtarSeason;

    const dayOfMonth = parsePolishOrdinalDay(dayWord);
    if (!dayOfMonth) return null;

    if (dayOfMonth < 1 || dayOfMonth > DAYS_PER_SEASON) return null;

    const seasonIndex = seasonIndexOf(season);
    if (seasonIndex < 0) return null;

    const dayOfYear = seasonIndex * DAYS_PER_SEASON + dayOfMonth;

    return {
      hours,
      dayOfYear,
    };
  }

  // Specjalne dni (np. "noc Midaete", "Belleteyn - Dzien Rozkwitu",
  // "Lammas - Dzien Dojrzewania", "Saovine - Dzien Zamierania") nie zawieraja
  // "dzien pory <sezon>". Identyfikuje je nazwa wydarzenia z HOLIDAYS;
  // dzien jest empirycznie staly (startDayOfYear danego wydarzenia).
  const lc = line.toLowerCase();
  for (const holiday of HOLIDAYS) {
    const name = holiday.name.toLowerCase();
    if (new RegExp(String.raw`\b${name}\b`, "i").test(lc)) {
      return {
        hours,
        dayOfYear: holiday.startDayOfYear,
      };
    }
  }

  return null;
}

function registerCzasTrigger(api: PluginApi): void {
  api.triggers.register(
    /^.*Jest w przyblizeniu .*$/i,
    (lineBuf: AnsiAwareBuffer) => {
      try {
        if (!apiRef) return lineBuf;

        const raw = sanitizeCzasLine(safeLineToString(lineBuf));

        // O1: kazda poprawnie sparsowana wlasna linia 'czas' zapisuje kotwice,
        // takze bez oczekujacego zapytania (pasywny zapis, paritet z WWW).
        if (isLikelyIshtarCzasLine(raw)) {
          const parsedPassive = parseIshtarTimeFromCzasLine(raw);
          if (parsedPassive) {
            // Minuty nie sa podawane w linii 'czas' — kotwica na pelnej
            // godzinie (paritet z klientami WWW i Mudlet).
            saveTimeAnchor(parsedPassive.dayOfYear, parsedPassive.hours, 0);
          }
        }

        if (!pendingRequest) return lineBuf;

        // Jesli request juz wygasl, nie probujemy parsowac spoznionych linii.
        if (Date.now() - requestStartedAtMs > REQUEST_TIMEOUT_MS + 200) {
          return lineBuf;
        }

        if (!isLikelyIshtarCzasLine(raw)) {
          // Zla domena (A3, jak w kliencie WWW): komunikat + kasowanie
          // pending, linia gagowana - zamiast mylacego timeoutu.
          if (isLikelyImperiumCzasLine(raw)) {
            clearPending();
            apiRef.output.print(wrapOutput(MSG_CROSS_DOMAIN));
            if (!printCrossAnchorReport()) {
              apiRef.output.print(wrapOutput(MSG_CROSS_NO_ANCHOR));
            }
            return null;
          }
          return lineBuf;
        }

        const parsed = parseIshtarTimeFromCzasLine(raw);
        if (!parsed) return lineBuf;

        // Kotwica zostala juz zapisana w bloku O1 powyzej.
        clearPending();
        runIshtarReport({
          dayOfYear: parsed.dayOfYear,
          hours: parsed.hours,
          minutes: 0,
        });
        return null;
      } catch (err) {
        console.error("Ishtar trigger error:", err);
        return lineBuf;
      }
    },
    TAG,
    { caseInsensitive: true }
  );
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
  title.textContent = "Kalendarz Ishtar";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "8px";

  const body = document.createElement("div");

  const p1 = document.createElement("div");
  p1.textContent =
    "Plugin wylicza (przybliżony) czas do najbliższych świąt astronomicznych i magicznych w domenie Ishtar, bazując na odpowiedzi serwera na komendę 'czas'.";

  const p2 = document.createElement("div");
  p2.style.marginTop = "10px";
  p2.appendChild(
    document.createTextNode("Aby uruchomić, wpisz w linii poleceń: ")
  );

  p2.appendChild(cmdChip("/ishtar"));


  const p3 = document.createElement("div");
  p3.style.marginTop = "10px";
  p3.textContent =
    "Święta są liczone cyklicznie w kalendarzu Ishtar (360 dni arkowych). Godziny wschodu i zachodu słońca są ustalone empirycznie dla każdego savoedu. Belleteyn, pełnia oraz festyn w Eysenlaan są wyróżnione trzema gwiazdkami. Jeśli event aktualnie trwa, wyświetlany jest komunikat TRWA TERAZ z godziną zakończenia.";

  const p4 = document.createElement("div");
  p4.style.marginTop = "10px";
  p4.textContent =
    "Pełnia księżyca: liczona na podstawie stałej listy empirycznych zakresów (okno 2 dni).";

  const p5 = document.createElement("div");
  p5.style.marginTop = "10px";
  p5.textContent =
    "Festyn w Eysenlaan trwa każdego savoedu od 6. do 8. dnia (włącznie) i w wynikach jest pokazywany jako przedział czasu (od–do). Pokazywane są 2 najbliższe wystąpienia festynu.";

  const p6 = document.createElement("div");
  p6.style.marginTop = "10px";
  p6.textContent =
    "Jeżeli odczyt 'czas' się nie powiedzie, plugin użyje ostatniej zapamiętanej daty. Po komunikacie o złej domenie pokaże wyniki wyliczone z zapisanej daty (jeśli jest), a gdy jej nie ma — powie, jak ją zapisać.";

  const p7 = document.createElement("div");
  p7.style.marginTop = "10px";
  p7.appendChild(document.createTextNode("Komenda "));
  p7.appendChild(cmdChip("/ishtar reset"));
  p7.appendChild(
    document.createTextNode(
      " czyści zapamiętaną datę (kotwicę). Plugin odnawia ją też automatycznie z każdej poprawnej odpowiedzi serwera na 'czas', nawet bez wywołania /ishtar."
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

export async function init(api: PluginApi): Promise<PluginInfo> {
  apiRef = api;

  registerCzasTrigger(api);

  aliasId = api.aliases.register(/^\/ishtar$/i, () => {
    try {
      if (!apiRef) return true;

      // debounce / spam-protection
      if (pendingRequest) return true;

      pendingRequest = true;
      requestStartedAtMs = Date.now();

      void apiRef.command.send("czas", false);

      window.setTimeout(() => {
        if (!apiRef) return;
        if (!pendingRequest) return;

        if (tryFinishRequestFromAnchor()) return;

        clearPending();
        printTimeout();
      }, REQUEST_TIMEOUT_MS + 50);

      return true;
    } catch (err) {
      console.error("Ishtar alias error:", err);
      clearPending();
      return true;
    }
  });

  resetAliasId = api.aliases.register(/^\/ishtar\s+reset$/i, () => {
    try {
      if (!apiRef) return true;
      clearTimeAnchor();
      apiRef.output.print(wrapOutput(MSG_RESET_DONE));
      return true;
    } catch (err) {
      console.error("Ishtar reset alias error:", err);
      return true;
    }
  });

  const popup = await api.ui.registerPersistentPopup({
    id: "help",
    title: "Kalendarz Ishtar",
    createContent: async () => buildHelpContent(),
  });

  helpMenuHandle = api.ui.addPopupMenuEntry("Kalendarz Ishtar", () => {
    if (popup.isOpen) popup.close();
    else void popup.open();
  });

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    author: "Isithunzi000",
    description:
      "Kalendarz Ishtar wylicza czas RL dla wydarzeń domeny bazując na czasie IG uzyskanym z gry (alias /ishtar).",
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

  if (helpMenuHandle) {
    try {
      helpMenuHandle.remove();
    } catch {
      // ignore
    }
    helpMenuHandle = null;
  }

  apiRef = null;
  clearPending();
}
