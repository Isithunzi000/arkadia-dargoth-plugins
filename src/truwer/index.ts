import PluginApi, { PluginInfo } from "plugin-api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_VERSION = "1.0.10";
const PLUGIN_BUILD_DATE = "12-09-2026";

const POPUP_ID = "truwer";
const STYLE_ID = "truwer_style";
const ALIAS_REGEX = /^\/truwer$/i;

const LS_LIB_BASE = "truwer.library";
const LS_CURRENT_CHAR_KEY = "currentCharacter";
const LS_AUTOCURSOR_KEY = "truwer.autocursor";
const LS_COMMON_CHAR = "__wspolne";

const PAUSE_RE = /^\/pauza(?:\s+(\d+(?:\.\d+)?))?$/i;
const SAVE_DEBOUNCE_MS = 300;
const STATUS_TTL_MS = 4000;
const COUNTDOWN_TICK_MS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type View = "library" | "scene" | "help";
type Mode = "edit" | "play";

type Komenda = { typ: "cmd"; tekst: string };
type Pauza = { typ: "pauza"; sekundy?: number };
type Notatka = { typ: "nota"; tekst: string };
type Krok = Komenda | Pauza | Notatka;

type Scena = {
    id: string;
    tytul: string;
    opis: string;
    utworzono: number;
    zmodyfikowano: number;
    kroki: Krok[];
};

type PopupHandle = {
    readonly isOpen: boolean;
    open: () => Promise<void>;
    close: () => void;
};
type MenuHandle = { remove: () => void };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let apiRef: PluginApi | null = null;
let popup: PopupHandle | null = null;
let menuHandle: MenuHandle | null = null;
let aliasId: unknown = null;

let library: Scena[] = [];
let view: View = "library";
let mode: Mode = "edit";
let currentId: string | null = null;
let importOpen = false;
let selectedIds: Set<string> = new Set();

let cursor = 0;
let playBuffer = "";
let sending = false;
let autoCursor = false;
// B8/D27: typ paska "Dodaj krok" pamietany w SESJI (nie w LS);
// reset do "cmd" przy wejsciu do sceny (openScene).
let lastAddType = "cmd";
// Fala E ("Zapisz jako..."): pole nazwy zbiorczej (render biblioteki)
// i id sceny z otwartym inline-formem zapisu (sesja, nie w LS).
let bulkNameEl: HTMLInputElement | null = null;
let saveAsId: string | null = null;
let helpReturn: { view: View; mode: Mode } = { view: "library", mode: "edit" };

let rootEl: HTMLDivElement | null = null;
let contentEl: HTMLDivElement | null = null;
let statusEl: HTMLDivElement | null = null;
let currentStepEl: HTMLElement | null = null;
let countdownSpan: HTMLElement | null = null;
let importTitleEl: HTMLInputElement | null = null;
let importTextEl: HTMLTextAreaElement | null = null;

let saveTimer: number | null = null;
let statusTimer: number | null = null;
let pauseTimer: number | null = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function genId(): string {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function numOr(v: unknown, d: number): number {
    return typeof v === "number" && isFinite(v) ? v : d;
}

function fmtNum(n: number): string {
    return String(n);
}

function fmtDate(ms: number): string {
    const d = new Date(ms);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return (
        p2(d.getDate()) +
        "-" +
        p2(d.getMonth() + 1) +
        "-" +
        d.getFullYear() +
        " " +
        p2(d.getHours()) +
        ":" +
        p2(d.getMinutes())
    );
}

function safeName(s: string): string {
    const out = (s || "scena").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
    return out || "scena";
}

// Fala E: dokleja rozszerzenie tylko, gdy nazwa go nie ma
// (jak Mudlet exportSelectedAs: name .. ".json" gdy brak).
function withExt(name: string, ext: string): string {
    return name.toLowerCase().endsWith("." + ext) ? name : name + "." + ext;
}

function baseName(name: string): string {
    const stripped = (name || "").replace(/.*[\\/]/, "").replace(/\.[^.]+$/, "");
    return stripped || "Importowana scena";
}

function isJson(text: string, name: string): boolean {
    return /\.json$/i.test(name || "") || text.trim().startsWith("{");
}

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

function btn(label: string, on: () => void, cls = "tr-btn", title?: string): HTMLButtonElement {
    const b = el("button", cls, label);
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", on);
    return b;
}

function addOpt(sel: HTMLSelectElement, value: string, label: string): void {
    const o = el("option", undefined, label);
    o.value = value;
    sel.appendChild(o);
}

function splitVariants(t: string): string[] {
    return t
        .split("|")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
}

function pickVariant(t: string): string {
    const v = splitVariants(t);
    if (v.length === 0) return t.trim();
    return v[Math.floor(Math.random() * v.length)];
}

// ---------------------------------------------------------------------------
// Parsing / serialization
// ---------------------------------------------------------------------------

function krokiFromDsl(text: string): Krok[] {
    const out: Krok[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const pm = line.match(PAUSE_RE);
        if (pm) {
            out.push({ typ: "pauza", sekundy: pm[1] !== undefined ? parseFloat(pm[1]) : undefined });
            continue;
        }
        if (line.startsWith("#")) {
            out.push({ typ: "nota", tekst: line.slice(1).replace(/^\s/, "") });
            continue;
        }
        out.push({ typ: "cmd", tekst: line });
    }
    return out;
}

function dslFromKroki(kroki: Krok[]): string {
    return kroki
        .map((k) => {
            if (k.typ === "pauza") return k.sekundy !== undefined ? "/pauza " + fmtNum(k.sekundy) : "/pauza";
            if (k.typ === "nota") return "# " + k.tekst;
            return k.tekst;
        })
        .join("\n");
}

function normKrok(k: unknown): Krok | null {
    if (!k || typeof k !== "object") return null;
    const o = k as Record<string, unknown>;
    if (o.typ === "pauza") {
        const s = typeof o.sekundy === "number" && isFinite(o.sekundy) && o.sekundy >= 0 ? o.sekundy : undefined;
        return { typ: "pauza", sekundy: s };
    }
    if (o.typ === "nota") {
        return { typ: "nota", tekst: o.tekst == null ? "" : String(o.tekst) };
    }
    return { typ: "cmd", tekst: o.tekst == null ? "" : String(o.tekst) };
}

function normScene(o: unknown): Scena | null {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const now = Date.now();
    const kroki = Array.isArray(r.kroki)
        ? (r.kroki.map(normKrok).filter((x): x is Krok => x !== null) as Krok[])
        : [];
    return {
        id: typeof r.id === "string" && r.id ? r.id : genId(),
        tytul: typeof r.tytul === "string" ? r.tytul : "Scena",
        opis: typeof r.opis === "string" ? r.opis : "",
        utworzono: numOr(r.utworzono, now),
        zmodyfikowano: numOr(r.zmodyfikowano, now),
        kroki,
    };
}

function sceneFromDsl(text: string, title: string): Scena {
    const now = Date.now();
    return { id: genId(), tytul: title, opis: "", utworzono: now, zmodyfikowano: now, kroki: krokiFromDsl(text) };
}

function sceneFromJson(obj: unknown): Scena {
    if (!obj || typeof obj !== "object") throw new Error("bad json");
    const r = obj as Record<string, unknown>;
    const now = Date.now();
    const kroki = Array.isArray(r.kroki)
        ? (r.kroki.map(normKrok).filter((x): x is Krok => x !== null) as Krok[])
        : [];
    return {
        id: genId(),
        tytul: typeof r.tytul === "string" ? r.tytul : "Importowana scena",
        opis: typeof r.opis === "string" ? r.opis : "",
        utworzono: numOr(r.utworzono, now),
        zmodyfikowano: numOr(r.zmodyfikowano, now),
        kroki,
    };
}

function jsonFromScene(s: Scena): string {
    return JSON.stringify(
        {
            format: "truwer-scene",
            wersja: 1,
            tytul: s.tytul,
            opis: s.opis,
            utworzono: s.utworzono,
            zmodyfikowano: s.zmodyfikowano,
            kroki: s.kroki,
        },
        null,
        2
    );
}

// Didaskalia kroku (paritet z Mudlet F16-B): ciagly blok notatek stojacych
// BEZPOSREDNIO przed krokiem pod kursorem (kursor 0-based wskazuje NASTEPNY
// krok do odegrania). Kolejnosc chronologiczna (najstarsza pierwsza).
// Straz konca sceny (cursor >= total) jest w renderze, nie tu.
function didaskalia(s: Scena, cursor: number): string[] {
    const out: string[] = [];
    for (let i = cursor - 1; i >= 0; i--) {
        const k = s.kroki[i];
        if (!k || k.typ !== "nota") break;
        out.unshift(k.tekst || "");
    }
    return out;
}

// Uciecie dlugiego tekstu z wielokropkiem (paritet z Mudlet fitText):
// bezpieczne dla UTF-8 - tnie po znakach (code points), nie po bajtach.
function fitText(t: string, maxChars: number): string {
    const s = String(t ?? "");
    const chars = [...s];
    if (chars.length <= maxChars) return s;
    return chars.slice(0, maxChars - 3).join("") + "...";
}

// ---------------------------------------------------------------------------
// Storage (per character)
// ---------------------------------------------------------------------------

function charKey(): string {
    let c = "";
    try {
        c = localStorage.getItem(LS_CURRENT_CHAR_KEY) || "";
    } catch {
        c = "";
    }
    c = c.trim();
    return LS_LIB_BASE + "." + (c || LS_COMMON_CHAR);
}

function loadLibrary(): Scena[] {
    try {
        const raw = localStorage.getItem(charKey());
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.map(normScene).filter((x): x is Scena => x !== null);
    } catch {
        return [];
    }
}

function saveLibrary(): void {
    try {
        localStorage.setItem(charKey(), JSON.stringify(library));
    } catch {
        showStatus("Błąd zapisu biblioteki.", "error");
    }
}

function scheduleSave(): void {
    if (saveTimer !== null) {
        try {
            window.clearTimeout(saveTimer);
        } catch {
            /* ignore */
        }
    }
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        saveLibrary();
    }, SAVE_DEBOUNCE_MS);
}

function flushSave(): void {
    if (saveTimer !== null) {
        try {
            window.clearTimeout(saveTimer);
        } catch {
            /* ignore */
        }
        saveTimer = null;
        saveLibrary();
    }
}

function loadPrefs(): void {
    try {
        const v = localStorage.getItem(LS_AUTOCURSOR_KEY);
        autoCursor = v === null ? true : v === "1";
    } catch {
        autoCursor = true;
    }
}

function saveAuto(): void {
    try {
        localStorage.setItem(LS_AUTOCURSOR_KEY, autoCursor ? "1" : "0");
    } catch {
        /* ignore */
    }
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

function currentScene(): Scena | null {
    return library.find((s) => s.id === currentId) || null;
}

function touch(s: Scena): void {
    s.zmodyfikowano = Date.now();
}

function firstPlayable(kroki: Krok[], from: number): number {
    for (let i = Math.max(0, from); i < kroki.length; i++) if (kroki[i].typ !== "nota") return i;
    return kroki.length;
}

function prevPlayable(kroki: Krok[], from: number): number {
    for (let i = Math.min(kroki.length - 1, from); i >= 0; i--) if (kroki[i].typ !== "nota") return i;
    return -1;
}

function primeBuffer(s: Scena): void {
    const k = s.kroki[cursor];
    playBuffer = k && k.typ === "cmd" ? pickVariant(k.tekst) : "";
}

// ---------------------------------------------------------------------------
// Clipboard / download / file pick
// ---------------------------------------------------------------------------

function download(filename: string, text: string, mime: string): void {
    try {
        const blob = new Blob([text], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = el("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showStatus("Pobrano: " + filename, "success");
        window.setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch {
                /* ignore */
            }
        }, 0);
    } catch {
        showStatus("Błąd eksportu pliku.", "error");
    }
}

function pickFile(onText: (text: string, name: string) => void): void {
    const inp = el("input");
    inp.type = "file";
    inp.accept = ".txt,.json,application/json,text/plain";
    inp.style.display = "none";
    inp.addEventListener("change", () => {
        const f = inp.files && inp.files[0];
        if (f) {
            const fr = new FileReader();
            fr.onload = () => onText(String(fr.result || ""), f.name);
            fr.onerror = () => showStatus("Błąd odczytu pliku.", "error");
            fr.readAsText(f);
        }
        inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function onNewScene(): void {
    const now = Date.now();
    const s: Scena = { id: genId(), tytul: "Nowa scena", opis: "", utworzono: now, zmodyfikowano: now, kroki: [] };
    library.push(s);
    saveLibrary();
    openScene(s.id, "edit");
}

function openScene(id: string, m: Mode): void {
    currentId = id;
    view = "scene";
    importOpen = false;
    lastAddType = "cmd"; // B8/D27: reset typu paska przy wejsciu do sceny
    if (m === "play") {
        mode = "play";
        const s = currentScene();
        if (s) {
            cursor = firstPlayable(s.kroki, 0);
            primeBuffer(s);
        }
    } else {
        mode = "edit";
    }
    render();
}

function goLibrary(): void {
    flushSave();
    stopPauseTimer();
    view = "library";
    render();
}

function duplicateScene(id: string): void {
    const s = library.find((x) => x.id === id);
    if (!s) return;
    const now = Date.now();
    const copy: Scena = {
        id: genId(),
        tytul: (s.tytul || "Scena") + " (kopia)",
        opis: s.opis,
        utworzono: now,
        zmodyfikowano: now,
        kroki: s.kroki.map((k) => ({ ...k })),
    };
    library.push(copy);
    saveLibrary();
    render();
    showStatus("Utworzono kopię.", "success");
}

function deleteScene(id: string): void {
    const s = library.find((x) => x.id === id);
    if (!s) return;
    const ok =
        typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm("Usunąć scenę: " + (s.tytul || "(bez tytułu)") + " ?")
            : true;
    if (!ok) return;
    library = library.filter((x) => x.id !== id);
    selectedIds.delete(id);
    if (currentId === id) {
        currentId = null;
        view = "library";
    }
    saveLibrary();
    render();
    showStatus("Usunięto scenę.", "success");
}

function exportScene(s: Scena, fmt: "json" | "txt"): void {
    if (fmt === "json") download(safeName(s.tytul) + ".json", jsonFromScene(s), "application/json");
    else download(safeName(s.tytul) + ".txt", dslFromKroki(s.kroki), "text/plain");
}

function importScenes(text: string, dslTitle: string, jsonName: string): Scena[] {
    if (!isJson(text, jsonName)) return [sceneFromDsl(text, dslTitle)];
    const parsed: unknown = JSON.parse(text);
    let arr: unknown[];
    if (Array.isArray(parsed)) {
        arr = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { sceny?: unknown }).sceny)) {
        arr = (parsed as { sceny: unknown[] }).sceny;
    } else {
        arr = [parsed];
    }
    return arr.map(sceneFromJson);
}

function onImportText(text: string, name: string): void {
    try {
        const scenes = importScenes(text, baseName(name), name);
        if (scenes.length === 0) {
            showStatus("Pusty import.", "error");
            return;
        }
        for (const s of scenes) library.push(s);
        saveLibrary();
        if (scenes.length === 1) {
            openScene(scenes[0].id, "edit");
        } else {
            selectedIds.clear();
            view = "library";
            render();
        }
        showStatus(
            scenes.length === 1 ? "Zaimportowano scenę." : "Zaimportowano sceny: " + scenes.length + ".",
            "success"
        );
    } catch {
        showStatus("Błąd importu pliku.", "error");
    }
}

function onImportFromPanel(): void {
    const text = importTextEl ? importTextEl.value : "";
    const title = importTitleEl ? importTitleEl.value.trim() : "";
    if (!text.trim()) {
        showStatus("Pusty import.", "error");
        return;
    }
    try {
        const scenes = importScenes(text, title || "Importowana scena", "");
        if (scenes.length === 0) {
            showStatus("Pusty import.", "error");
            return;
        }
        if (scenes.length === 1 && title) scenes[0].tytul = title;
        for (const s of scenes) library.push(s);
        saveLibrary();
        importOpen = false;
        if (scenes.length === 1) {
            openScene(scenes[0].id, "edit");
        } else {
            selectedIds.clear();
            view = "library";
            render();
        }
        showStatus(
            scenes.length === 1 ? "Zaimportowano scenę." : "Zaimportowano sceny: " + scenes.length + ".",
            "success"
        );
    } catch {
        showStatus("Błąd importu.", "error");
    }
}

// Editor step ops
function addStep(s: Scena, typ: string): void {
    let k: Krok;
    if (typ === "pauza") k = { typ: "pauza", sekundy: undefined };
    else if (typ === "nota") k = { typ: "nota", tekst: "" };
    else k = { typ: "cmd", tekst: "" };
    s.kroki.push(k);
    touch(s);
    saveLibrary();
    render();
}

function insertStep(s: Scena, pos: number): void {
    s.kroki.splice(pos, 0, { typ: "cmd", tekst: "" });
    touch(s);
    saveLibrary();
    render();
}

function dupStep(s: Scena, i: number): void {
    s.kroki.splice(i + 1, 0, { ...s.kroki[i] });
    touch(s);
    saveLibrary();
    render();
}

function removeStep(s: Scena, i: number): void {
    const ok =
        typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm("Usunąć ten krok?")
            : true;
    if (!ok) return;
    s.kroki.splice(i, 1);
    touch(s);
    saveLibrary();
    render();
}

function moveStep(s: Scena, i: number, dir: number): void {
    const j = i + dir;
    if (j < 0 || j >= s.kroki.length) return;
    const tmp = s.kroki[i];
    s.kroki[i] = s.kroki[j];
    s.kroki[j] = tmp;
    touch(s);
    saveLibrary();
    render();
}

function changeType(s: Scena, i: number, typ: string): void {
    const old = s.kroki[i];
    const oldText = old.typ === "cmd" || old.typ === "nota" ? old.tekst : "";
    let nk: Krok;
    if (typ === "pauza") nk = { typ: "pauza", sekundy: undefined };
    else if (typ === "nota") nk = { typ: "nota", tekst: oldText };
    else nk = { typ: "cmd", tekst: oldText };
    s.kroki[i] = nk;
    touch(s);
    saveLibrary();
    render();
}

// Player ops
async function doSend(btnEl: HTMLButtonElement): Promise<void> {
    const text = playBuffer.trim();
    if (!text) {
        showStatus("Pusta komenda.", "error");
        return;
    }
    if (sending) return;
    sending = true;
    btnEl.disabled = true;
    try {
        if (apiRef) await apiRef.command.send(text, false);
    } catch {
        showStatus("Błąd wysłania komendy.", "error");
    } finally {
        sending = false;
    }
    advance();
}

function advance(): void {
    const s = currentScene();
    if (!s) return;
    stopPauseTimer();
    cursor = firstPlayable(s.kroki, cursor + 1);
    primeBuffer(s);
    render();
}

function back(): void {
    const s = currentScene();
    if (!s) return;
    stopPauseTimer();
    const oldCursor = cursor;
    const target = cursor >= s.kroki.length ? s.kroki.length - 1 : cursor - 1;
    const p = prevPlayable(s.kroki, target);
    cursor = p < 0 ? firstPlayable(s.kroki, 0) : p;
    if (s.kroki.length > 0 && cursor === oldCursor) {
        showStatus("To już pierwszy krok.", "info");
    }
    primeBuffer(s);
    render();
}

function stop(): void {
    const s = currentScene();
    if (!s) return;
    stopPauseTimer();
    cursor = firstPlayable(s.kroki, 0);
    primeBuffer(s);
    render();
}

// ---------------------------------------------------------------------------
// Pause countdown
// ---------------------------------------------------------------------------

function stopPauseTimer(): void {
    if (pauseTimer !== null) {
        try {
            window.clearInterval(pauseTimer);
        } catch {
            /* ignore */
        }
        pauseTimer = null;
    }
    countdownSpan = null;
}

function startPauseTimer(seconds: number): void {
    if (pauseTimer !== null) {
        try {
            window.clearInterval(pauseTimer);
        } catch {
            /* ignore */
        }
        pauseTimer = null;
    }
    const totalMs = seconds * 1000;
    const start = Date.now();
    const tick = () => {
        const rem = Math.max(0, totalMs - (Date.now() - start));
        if (countdownSpan) countdownSpan.textContent = (rem / 1000).toFixed(1) + "s";
        if (rem <= 0) {
            if (pauseTimer !== null) {
                try {
                    window.clearInterval(pauseTimer);
                } catch {
                    /* ignore */
                }
                pauseTimer = null;
            }
            if (countdownSpan) countdownSpan.classList.add("tr-ready");
            if (autoCursor) advance();
        }
    };
    tick();
    pauseTimer = window.setInterval(tick, COUNTDOWN_TICK_MS);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function showStatus(msg: string, kind: "info" | "error" | "success" = "info"): void {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "tr-status" + (kind === "error" ? " tr-c-error" : kind === "success" ? " tr-c-ok" : "");
    if (statusTimer !== null) {
        try {
            window.clearTimeout(statusTimer);
        } catch {
            /* ignore */
        }
    }
    statusTimer = window.setTimeout(() => {
        statusTimer = null;
        if (statusEl) {
            statusEl.textContent = "";
            statusEl.className = "tr-status";
        }
    }, STATUS_TTL_MS);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function autoGrow(ta: HTMLTextAreaElement): void {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
}

function initGrow(ta: HTMLTextAreaElement): void {
    ta.rows = 1;
    window.requestAnimationFrame(() => autoGrow(ta));
}

function commitKeys(elm: HTMLInputElement | HTMLTextAreaElement, onEnter?: () => void): void {
    const handler = (ev: KeyboardEvent): void => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            if (onEnter) onEnter();
            else elm.blur();
        } else if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            elm.blur();
        }
    };
    elm.addEventListener("keydown", handler as EventListener);
}

function openHelp(): void {
    flushSave();
    stopPauseTimer();
    if (view !== "help") helpReturn = { view, mode };
    view = "help";
    render();
}

function closeHelp(): void {
    view = helpReturn.view;
    mode = helpReturn.mode;
    render();
}

function helpBtn(): HTMLButtonElement {
    return btn("Pomoc", openHelp, "tr-icon-btn", "Pomoc: jak korzystać z truwera.");
}

function viewModeBtnCls(target: Mode): string {
    return "tr-icon-btn" + (target === mode ? " tr-active" : "");
}

function buildSceneHeader(s: Scena): HTMLElement {
    const head = el("div", "tr-head");

    const top = el("div", "tr-row");
    top.appendChild(btn("Biblioteka", goLibrary, "tr-icon-btn", "Wróć do listy scen."));
    top.appendChild(el("div", "tr-spacer"));
    top.appendChild(helpBtn());
    head.appendChild(top);

    const modeRow = el("div", "tr-row");
    modeRow.appendChild(el("span", "tr-hint", "Tryb:"));
    modeRow.appendChild(
        btn(
            "Edycja",
            () => {
                if (mode !== "edit") {
                    mode = "edit";
                    stopPauseTimer();
                    render();
                }
            },
            viewModeBtnCls("edit"),
            "Tryb edycji: dodawaj i zmieniaj kroki sceny."
        )
    );
    modeRow.appendChild(
        btn(
            "Odtwarzanie",
            () => {
                if (mode !== "play") {
                    mode = "play";
                    cursor = firstPlayable(s.kroki, 0);
                    primeBuffer(s);
                    render();
                }
            },
            viewModeBtnCls("play"),
            "Tryb odgrywania: wysyłaj kroki sceny po kolei."
        )
    );
    head.appendChild(modeRow);
    return head;
}

function activateStep(i: number): void {
    const s = currentScene();
    if (!s) return;
    if (i < 0 || i >= s.kroki.length) return;
    if (s.kroki[i].typ === "nota") return;
    stopPauseTimer();
    cursor = i;
    primeBuffer(s);
    render();
}

function render(): void {
    stopPauseTimer();
    if (!contentEl) return;
    contentEl.innerHTML = "";
    if (view === "help") renderHelp();
    else if (view === "library") renderLibrary();
    else renderScene();
}

function renderScene(): void {
    const s = currentScene();
    if (!s) {
        view = "library";
        renderLibrary();
        return;
    }
    if (mode === "play") renderPlay(s);
    else renderEdit(s);
}

function selectedScenes(): Scena[] {
    return library.filter((s) => selectedIds.has(s.id));
}

function toggleSelected(id: string): void {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    render();
}

function selectAll(scenes: Scena[]): void {
    const allSel = scenes.length > 0 && scenes.every((s) => selectedIds.has(s.id));
    selectedIds.clear();
    if (!allSel) for (const s of scenes) selectedIds.add(s.id);
    render();
}

function bulkStamp(): string {
    const d = new Date();
    const p = (n: number) => (n < 10 ? "0" + n : String(n));
    return p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear();
}

function bulkJson(scenes: Scena[]): string {
    return JSON.stringify(
        {
            format: "truwer-scenes",
            wersja: 1,
            sceny: scenes.map((s) => ({
                format: "truwer-scene",
                wersja: 1,
                tytul: s.tytul,
                opis: s.opis,
                utworzono: s.utworzono,
                zmodyfikowano: s.zmodyfikowano,
                kroki: s.kroki,
            })),
        },
        null,
        2
    );
}

function bulkTxt(scenes: Scena[]): string {
    return scenes.map((s) => "=== " + (s.tytul || "(bez tytulu)") + " ===\n" + dslFromKroki(s.kroki)).join("\n\n");
}

function exportScenesBulk(fmt: "json" | "txt"): void {
    const scenes = selectedScenes();
    if (scenes.length === 0) {
        showStatus("Najpierw zaznacz sceny.", "info");
        return;
    }
    const stamp = bulkStamp();
    // Fala E: wlasna nazwa z pola obok przyciskow (puste = domyslna).
    const raw = bulkNameEl ? bulkNameEl.value.trim() : "";
    const base = raw ? safeName(raw) : "truwer-sceny-" + stamp;
    if (fmt === "json") download(withExt(base, "json"), bulkJson(scenes), "application/json");
    else download(withExt(base, "txt"), bulkTxt(scenes), "text/plain");
}

function deleteSelected(): void {
    const scenes = selectedScenes();
    if (scenes.length === 0) {
        showStatus("Najpierw zaznacz sceny.", "info");
        return;
    }
    const ok =
        typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm("Usunąć zaznaczone sceny: " + scenes.length + " ?")
            : true;
    if (!ok) return;
    const ids = new Set(selectedIds);
    library = library.filter((s) => !ids.has(s.id));
    if (currentId && ids.has(currentId)) {
        currentId = null;
        view = "library";
    }
    selectedIds.clear();
    saveLibrary();
    render();
    showStatus("Usunięto sceny: " + scenes.length + ".", "success");
}

function renderLibrary(): void {
    if (!contentEl) return;
    const wrap = el("div", "tr-view");

    const bar = el("div", "tr-row");
    bar.appendChild(btn("Nowa scena", onNewScene, "tr-btn", "Utwórz nową, pustą scenę i otwórz ją do edycji."));
    bar.appendChild(
        btn(
            "Importuj plik",
            () => pickFile(onImportText),
            "tr-icon-btn",
            "Wczytaj scenę z pliku: .txt (lista komend) lub .json (pełna scena lub pakiet scen)."
        )
    );
    bar.appendChild(
        btn(
            importOpen ? "Anuluj import" : "Importuj tekst",
            () => {
                importOpen = !importOpen;
                render();
            },
            "tr-icon-btn",
            importOpen ? "Zamknij panel importu." : "Wklej JSON lub tekst sceny, aby ją zaimportować."
        )
    );
    bar.appendChild(el("div", "tr-spacer"));
    bar.appendChild(helpBtn());
    wrap.appendChild(bar);

    if (importOpen) wrap.appendChild(buildImportPanel());

    if (library.length === 0) {
        const empty = el("div", "tr-scroll");
        empty.appendChild(el("div", "tr-empty", "Brak zapisanych scen. Utwórz nową lub zaimportuj."));
        wrap.appendChild(empty);
        contentEl.appendChild(wrap);
        return;
    }

    const items = library.slice().sort((a, b) => b.zmodyfikowano - a.zmodyfikowano);
    const selCount = items.reduce((n, s) => (selectedIds.has(s.id) ? n + 1 : n), 0);
    const allSel = selCount === items.length;

    const bulk = el("div", "tr-row tr-bulk");
    bulk.appendChild(
        btn(
            allSel ? "Odznacz wszystkie" : "Zaznacz wszystkie",
            () => selectAll(items),
            "tr-icon-btn",
            allSel ? "Odznacz wszystkie sceny." : "Zaznacz wszystkie sceny."
        )
    );
    bulk.appendChild(el("span", "tr-hint", "zaznaczone: " + selCount + "/" + items.length));
    bulk.appendChild(el("div", "tr-spacer"));
    // Fala E ("Zapisz jako..." light): wlasna nazwa pliku zbiorczego;
    // puste = domyslna truwer-sceny-<stamp>, rozszerzenie wg przycisku.
    const nameInp = el("input", "tr-input tr-bulkname");
    nameInp.placeholder = "truwer-sceny-" + bulkStamp();
    nameInp.title = "Własna nazwa pliku (opcjonalna). Puste = nazwa domyślna. Polskie znaki zamieniane na _.";
    bulkNameEl = nameInp;
    bulk.appendChild(nameInp);
    const dJson = btn(
        "Pobierz JSON",
        () => exportScenesBulk("json"),
        "tr-icon-btn",
        "Pobierz zaznaczone sceny jako jeden plik .json (re-importowalny)."
    );
    const dTxt = btn(
        "Pobierz TXT",
        () => exportScenesBulk("txt"),
        "tr-icon-btn",
        "Pobierz zaznaczone sceny jako jeden plik .txt (do odczytu)."
    );
    const dDel = btn(
        "Usuń zaznaczone",
        deleteSelected,
        "tr-icon-btn tr-btn-danger",
        "Usuń zaznaczone sceny (z potwierdzeniem)."
    );
    bulk.appendChild(dJson);
    bulk.appendChild(dTxt);
    bulk.appendChild(dDel);
    wrap.appendChild(bulk);

    const list = el("div", "tr-scroll");
    for (const s of items) list.appendChild(buildLibRow(s));
    wrap.appendChild(list);
    contentEl.appendChild(wrap);
}

function buildImportPanel(): HTMLElement {
    const p = el("div", "tr-panel");
    const ti = el("input", "tr-input");
    ti.placeholder = "Tytuł (opcjonalnie)";
    importTitleEl = ti;
    commitKeys(ti, () => onImportFromPanel());
    const ta = el("textarea", "tr-textarea");
    ta.placeholder = "Wklej JSON lub tekst (komendy, /pauza, /pauza N, # notatki)";
    ta.rows = 6;
    importTextEl = ta;
    const row = el("div", "tr-row");
    row.appendChild(btn("Importuj", onImportFromPanel, "tr-btn", "Zaimportuj wklejoną zawartość."));
    p.appendChild(ti);
    p.appendChild(ta);
    p.appendChild(row);
    return p;
}

function buildLibRow(s: Scena): HTMLElement {
    const row = el("div", "tr-item");
    if (selectedIds.has(s.id)) row.classList.add("tr-item-sel");

    const head = el("div", "tr-item-head");
    const cb = el("input", "tr-item-check");
    cb.type = "checkbox";
    cb.checked = selectedIds.has(s.id);
    cb.title = "Zaznacz scenę do operacji zbiorczych.";
    cb.addEventListener("change", () => toggleSelected(s.id));
    head.appendChild(cb);
    head.appendChild(el("div", "tr-item-title", s.tytul || "(bez tytułu)"));
    row.appendChild(head);

    const metaTxt =
        fmtDate(s.zmodyfikowano) + " | " + (s.opis ? s.opis + " | " : "") + "kroki: " + s.kroki.length;
    row.appendChild(el("div", "tr-item-meta", metaTxt));

    const acts = el("div", "tr-item-acts");
    acts.appendChild(btn("Edycja", () => openScene(s.id, "edit"), "tr-icon-btn", "Otwórz tę scenę do edycji."));
    acts.appendChild(
        btn("Odtwarzaj", () => openScene(s.id, "play"), "tr-icon-btn", "Otwórz tę scenę do odgrywania (prompter).")
    );
    acts.appendChild(btn("Powiel", () => duplicateScene(s.id), "tr-icon-btn", "Utwórz kopię tej sceny."));
    acts.appendChild(
        btn("JSON", () => exportScene(s, "json"), "tr-icon-btn", "Zapisz scenę do pliku .json (pełna, bezstratna kopia).")
    );
    acts.appendChild(btn("TXT", () => exportScene(s, "txt"), "tr-icon-btn", "Zapisz scenę do pliku .txt (prosty tekst)."));
    acts.appendChild(
        btn(
            "Zapisz jako…",
            () => {
                saveAsId = s.id;
                render();
            },
            "tr-icon-btn",
            "Zapisz scenę pod własną nazwą pliku (.json)."
        )
    );
    acts.appendChild(
        btn("Usuń", () => deleteScene(s.id), "tr-icon-btn tr-btn-danger", "Usuń tę scenę (z potwierdzeniem).")
    );
    row.appendChild(acts);
    // Fala E: inline-form "Zapisz jako..." (nazwa + Zapisz/Anuluj);
    // domyslna nazwa = safeName(tytul); zapis zwyklym Blob+download.
    if (saveAsId === s.id) {
        const form = el("div", "tr-saveas");
        const inp = el("input", "tr-input tr-saveas-name");
        inp.value = safeName(s.tytul);
        inp.placeholder = "Nazwa pliku";
        form.appendChild(inp);
        form.appendChild(
            btn(
                "Zapisz",
                () => {
                    const raw = inp.value.trim();
                    const base = raw ? safeName(raw) : safeName(s.tytul);
                    saveAsId = null;
                    download(withExt(base, "json"), jsonFromScene(s), "application/json");
                    render();
                },
                "tr-icon-btn",
                "Pobierz scenę pod podaną nazwą."
            )
        );
        form.appendChild(
            btn(
                "Anuluj",
                () => {
                    saveAsId = null;
                    showStatus("Zapis anulowany.", "info");
                    render();
                },
                "tr-icon-btn",
                "Zamknij bez zapisu."
            )
        );
        row.appendChild(form);
    }
    return row;
}

function renderEdit(s: Scena): void {
    if (!contentEl) return;
    const wrap = el("div", "tr-view");
    wrap.appendChild(buildSceneHeader(s));

    const tit = el("input", "tr-input");
    tit.value = s.tytul;
    tit.placeholder = "Tytuł";
    tit.addEventListener("input", () => {
        s.tytul = tit.value;
        touch(s);
        scheduleSave();
    });
    commitKeys(tit);
    wrap.appendChild(tit);

    wrap.appendChild(el("label", "tr-label", "Opis (opcjonalny):"));
    const opi = el("input", "tr-input");
    opi.value = s.opis;
    opi.placeholder = "Opis (opcjonalny)";
    opi.addEventListener("input", () => {
        s.opis = opi.value;
        touch(s);
        scheduleSave();
    });
    commitKeys(opi);
    wrap.appendChild(opi);

    wrap.appendChild(
        el("div", "tr-hint", "warianty komendy: a|b|c — prompter wylosuje jedną. Pauza: /pauza lub /pauza N.")
    );
    wrap.appendChild(el("div", "tr-hint", "Notatka: wiersz typu notatka (nie wysyłana)."));

    const list = el("div", "tr-scroll");
    if (s.kroki.length === 0) {
        list.appendChild(el("div", "tr-empty", "Brak kroków. Dodaj poniżej."));
    } else {
        for (let i = 0; i < s.kroki.length; i++) list.appendChild(buildEditRow(s, s.kroki[i], i));
    }
    wrap.appendChild(list);

    const addbar = el("div", "tr-row");
    const sel = el("select", "tr-select");
    addOpt(sel, "cmd", "komenda");
    addOpt(sel, "pauza", "pauza");
    addOpt(sel, "nota", "notatka");
    sel.title = "Wybierz typ kroku do dodania.";
    sel.value = lastAddType; // B8/D27: pamiec sesji
    sel.addEventListener("change", () => {
        lastAddType = sel.value;
    });
    addbar.appendChild(sel);
    addbar.appendChild(btn("Dodaj krok", () => {
        lastAddType = sel.value;
        addStep(s, sel.value);
    }, "tr-btn", "Dodaj nowy krok na końcu sceny."));
    wrap.appendChild(addbar);

    contentEl.appendChild(wrap);
}

function buildLineEditor(placeholder: string, value: string, onChange: (v: string) => void): HTMLTextAreaElement {
    const inp = el("textarea", "tr-textarea tr-grow tr-line");
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener("input", () => {
        const v = inp.value.replace(/[\r\n]+/g, " ");
        if (v !== inp.value) inp.value = v;
        onChange(v);
        autoGrow(inp);
    });
    commitKeys(inp);
    initGrow(inp);
    return inp;
}

// Walidacja sekund pauzy (paritet z Mudlet setStepSekundy, F16-C):
// pusty/biale znaki -> undefined (sukces, bez statusu); przecinek -> kropka;
// sztywny wzorzec cyfry[.cyfry] (odrzuca litery, notacje e/hex, wiodace
// plusy, wielokrotne kropki); sufit 3600 s (1 h). Odrzut NIE zmienia kroku,
// tylko status error; sukces zapisuje LICZBE bez statusu.
function setStepSekundy(k: Krok, txt: string): boolean {
    if (k.typ !== "pauza") return false;
    const raw = String(txt);
    if (/^\s*$/.test(raw)) {
        k.sekundy = undefined;
        return true;
    }
    const norm = raw.replace(/,/g, ".");
    if (!/^\s*\d+\.?\d*\s*$/.test(norm) && !/^\s*\.\d+\s*$/.test(norm)) {
        showStatus("Sekundy: tylko liczby (np. 5 albo 2.5).", "error");
        return false;
    }
    const v = parseFloat(norm.trim());
    if (v > 3600) {
        showStatus("Sekundy: maksimum 3600 (1 h).", "error");
        return false;
    }
    k.sekundy = v;
    return true;
}

function buildEditRow(s: Scena, k: Krok, i: number): HTMLElement {
    const row = el("div", "tr-erow");

    const sel = el("select", "tr-select");
    addOpt(sel, "cmd", "komenda");
    addOpt(sel, "pauza", "pauza");
    addOpt(sel, "nota", "notatka");
    sel.value = k.typ;
    sel.title = "Zmień typ kroku: komenda, pauza lub notatka.";
    sel.addEventListener("change", () => changeType(s, i, sel.value));
    row.appendChild(sel);

    if (k.typ === "cmd") {
        row.appendChild(
            buildLineEditor("komenda (warianty: a|b|c)", k.tekst, (v) => {
                k.tekst = v;
                touch(s);
                scheduleSave();
            })
        );
    } else if (k.typ === "pauza") {
        row.appendChild(el("span", "tr-hint", "PAUZA"));
        const inp = el("input", "tr-input tr-num");
        inp.type = "text";
        inp.inputMode = "decimal";
        inp.autocomplete = "off";
        inp.value = k.sekundy !== undefined ? String(k.sekundy) : "";
        inp.placeholder = "sek (opc.)";
        inp.addEventListener("input", () => {
            if (setStepSekundy(k, inp.value)) {
                touch(s);
                scheduleSave();
            }
        });
        commitKeys(inp);
        row.appendChild(inp);
    } else {
        row.appendChild(
            buildLineEditor("notatka (nie wysyłana)", k.tekst, (v) => {
                k.tekst = v;
                touch(s);
                scheduleSave();
            })
        );
    }

    const acts = el("div", "tr-erow-acts");
    acts.appendChild(btn("^", () => moveStep(s, i, -1), "tr-icon-btn", "Przenieś krok wyżej."));
    acts.appendChild(btn("v", () => moveStep(s, i, 1), "tr-icon-btn", "Przenieś krok niżej."));
    acts.appendChild(btn("Wstaw", () => insertStep(s, i + 1), "tr-icon-btn", "Wstaw nową komendę poniżej tego kroku."));
    acts.appendChild(btn("Powiel", () => dupStep(s, i), "tr-icon-btn", "Powiel ten krok."));
    acts.appendChild(btn("X", () => removeStep(s, i), "tr-icon-btn tr-btn-danger", "Usuń ten krok."));
    row.appendChild(acts);
    return row;
}

function stepLabel(k: Krok): string {
    if (k.typ === "cmd") return k.tekst || "(pusta komenda)";
    if (k.typ === "pauza") return "PAUZA" + (k.sekundy ? " " + fmtNum(k.sekundy) + "s" : "");
    return "# " + k.tekst;
}

function renderPlay(s: Scena): void {
    if (!contentEl) return;
    const total = s.kroki.length;
    const wrap = el("div", "tr-view");
    wrap.appendChild(buildSceneHeader(s));

    const ctl = el("div", "tr-row");
    const auto = el("label", "tr-check");
    auto.title = "Gdy odliczanie pauzy się skończy, prompter sam pokaże następny krok. Nie wysyła żadnej komendy.";
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = autoCursor;
    cb.addEventListener("change", () => {
        autoCursor = cb.checked;
        saveAuto();
    });
    auto.appendChild(cb);
    auto.appendChild(el("span", undefined, "Po pauzie przejdź dalej"));
    ctl.appendChild(auto);
    const prog = el("span", "tr-prog");
    const pos = cursor >= total ? total : cursor + 1;
    prog.textContent = total ? "krok " + pos + "/" + total : "brak kroków";
    ctl.appendChild(prog);
    wrap.appendChild(ctl);

    wrap.appendChild(el("div", "tr-hint", "Kliknij krok, aby go aktywować"));

    const list = el("div", "tr-scroll");
    currentStepEl = null;
    for (const [i, k] of s.kroki.entries()) {
        const cls =
            "tr-step" +
            (i === cursor ? " tr-step-current" : "") +
            (k.typ === "nota" ? " tr-step-note" : "") +
            (k.typ === "pauza" ? " tr-step-pause" : "") +
            (k.typ !== "nota" ? " tr-step-click" : "");
        const stp = el("div", cls, stepLabel(k));
        if (k.typ !== "nota") stp.addEventListener("click", () => activateStep(i));
        if (i === cursor) currentStepEl = stp;
        list.appendChild(stp);
    }
    if (total === 0) list.appendChild(el("div", "tr-empty", "Brak kroków."));
    wrap.appendChild(list);

    wrap.appendChild(buildPlayPanel(s));

    const nav = el("div", "tr-row");
    nav.appendChild(btn("Wstecz", back, "tr-icon-btn", "Przejdź do poprzedniego kroku (bez wysyłania)."));
    nav.appendChild(btn("Dalej", advance, "tr-icon-btn", "Przejdź do następnego kroku (bez wysyłania)."));
    nav.appendChild(btn("Na początek", stop, "tr-icon-btn", "Wróć do pierwszego kroku sceny."));
    wrap.appendChild(nav);

    contentEl.appendChild(wrap);

    if (currentStepEl) {
        const target = currentStepEl;
        window.requestAnimationFrame(() => {
            try {
                target.scrollIntoView({ block: "nearest" });
            } catch {
                /* ignore */
            }
        });
    }
}

function buildPlayPanel(s: Scena): HTMLElement {
    const panel = el("div", "tr-panel");
    const total = s.kroki.length;

    // Didaskalia (F16-B/F18-E): blok notatek tuz przed krokiem pod kursorem,
    // w strefie miedzy lista a panelem kroku. Straz konca sceny jest TU
    // (rdzen zwrocilby blok takze dla cursor == total). Brak notatek =
    // panel w ogole nie pokazywany. Max 2 linie, nieklikalne.
    if (cursor < total) {
        const d = didaskalia(s, cursor);
        if (d.length > 0) {
            const did = el("div", "tr-did");
            const lines = Math.min(2, d.length);
            for (let li = 0; li < lines; li++) {
                let dt = "» " + fitText(d[li], 60);
                if (li === 1 && d.length > 2) dt += " …";
                did.appendChild(el("div", "tr-did-line", dt));
            }
            panel.appendChild(did);
        }
    }

    if (cursor >= total) {
        panel.appendChild(el("div", "tr-big", total ? "Koniec sceny" : "Brak kroków"));
        return panel;
    }

    const k = s.kroki[cursor];
    if (k.typ === "cmd") {
        panel.appendChild(el("div", "tr-hint", "do wysłania (Enter = wyślij):"));

        const inp = el("textarea", "tr-textarea tr-grow tr-line");
        inp.value = playBuffer;
        inp.title = "Treść, która pójdzie do gry. Możesz ją zmienić przed wysłaniem. Enter wysyła.";
        inp.addEventListener("input", () => {
            const v = inp.value.replace(/[\r\n]+/g, " ");
            if (v !== inp.value) inp.value = v;
            playBuffer = v;
            autoGrow(inp);
        });
        initGrow(inp);
        panel.appendChild(inp);

        const row = el("div", "tr-row");
        if (splitVariants(k.tekst).length > 1) {
            row.appendChild(
                btn(
                    "Losuj ponownie",
                    () => {
                        playBuffer = pickVariant(k.tekst);
                        inp.value = playBuffer;
                        autoGrow(inp);
                        inp.focus();
                    },
                    "tr-icon-btn",
                    "Wylosuj inny wariant tej komendy."
                )
            );
        }
        const sendBtn = el("button", "tr-btn tr-primary");
        sendBtn.type = "button";
        sendBtn.textContent = "Wyślij";
        sendBtn.title = "Wyślij tę linię do gry i przejdź do następnego kroku.";
        const doSendNow = () => {
            playBuffer = inp.value.replace(/[\r\n]+/g, " ");
            void doSend(sendBtn);
        };
        sendBtn.addEventListener("click", doSendNow);
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                ev.stopPropagation();
                doSendNow();
            } else if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                inp.blur();
            }
        };
        inp.addEventListener("keydown", onKey as EventListener);
        row.appendChild(sendBtn);
        panel.appendChild(row);
    } else if (k.typ === "pauza") {
        const line = el("div", "tr-pauseline");
        line.appendChild(el("span", "tr-big", "PAUZA"));
        if (k.sekundy !== undefined && k.sekundy > 0) {
            const cd = el("span", "tr-countdown", fmtNum(k.sekundy) + "s");
            countdownSpan = cd;
            line.appendChild(cd);
            startPauseTimer(k.sekundy);
        } else {
            line.appendChild(el("span", "tr-hint", "kliknij Dalej"));
        }
        panel.appendChild(line);
    }
    return panel;
}

function helpContent(box: HTMLElement): void {
    const h = (t: string) => box.appendChild(el("div", "tr-help-h", t));
    const p = (t: string) => box.appendChild(el("div", "tr-help-p", t));
    const ul = (items: string[]) => {
        const u = el("ul", "tr-help-ul");
        for (const it of items) u.appendChild(el("li", "tr-help-li", it));
        box.appendChild(u);
    };

    box.appendChild(el("div", "tr-help-title", "Truwer - asystent odgrywania scen"));
    p(
        "Truwer pozwala przygotować scenę (listę kroków z komend gry) i odegrać ją we własnym tempie, krok po kroku. Każdą linię wysyłasz ręcznie - plugin nigdy nie wysyła nic sam. Tempo ustalasz Ty."
    );

    h("Otwieranie");
    const open = el("div", "tr-help-p");
    open.appendChild(document.createTextNode("Okno truwera otwierasz i zamykasz: wpisz w linii poleceń "));
    open.appendChild(el("span", "tr-cmd", "/truwer"));
    open.appendChild(document.createTextNode(", albo kliknij pozycję 'Truwer' w menu wtyczek klienta."));
    box.appendChild(open);

    h("Biblioteka i tryby");
    ul([
        "Biblioteka to lista Twoich scen, osobna dla każdej postaci. Tu tworzysz, importujesz, otwierasz, odgrywasz, eksportujesz i usuwasz sceny.",
        "Otwarta scena ma dwa tryby, przełączane w wierszu 'Tryb': Edycja (budujesz i zmieniasz kroki) oraz Odtwarzanie (odgrywasz scenę).",
        "'Powiel' przy scenie tworzy jej kopię z dopiskiem '(kopia)' - szybki wariant sceny bez budowania od zera.",
    ]);

    h("Rodzaje kroków");
    ul([
        "Komenda - zwykła komenda gry (np. usmiechnij sie, albo długi opis przez powiedz ...). Wysyłana dosłownie. Może być długa - kilka, kilkanaście zdań.",
        "Pauza - przerwa z odliczaniem, jako podpowiedź tempa. Sama nic nie wysyła. Może mieć liczbę sekund.",
        "Notatka - tekst tylko dla Ciebie. Nigdy nie jest wysyłana; prompter ją pomija.",
        "Mowę pisz przez powiedz <tekst>, nie przez '<tekst>' - apostrof sprawia, że klient pokazuje echo wypowiedzi; powiedz tego nie robi, a efekt w grze jest identyczny.",
    ]);

    h("Warianty komendy (znak |)");
    ul([
        "W jednej komendzie możesz podać kilka wersji oddzielonych znakiem |. Przy odgrywaniu prompter wylosuje jedną z nich.",
        "Przykład: usmiechnij sie|skin glowa - czasem wyśle 'usmiechnij sie', czasem 'skin glowa'.",
        "W prompterze 'Losuj ponownie' wybiera inną wersję.",
    ]);

    h("Odgrywanie (prompter)");
    ul([
        "Widzisz listę kroków, aktywny jest podświetlony. Kliknij dowolną linię, aby ustawić ją jako aktywną (tak też wracasz, by coś powtórzyć).",
        "Nad przyciskami jest pole 'do wysłania' - dokładnie to, co pójdzie do gry. Możesz je zmienić przed wysłaniem. Trwałe zmiany rób w trybie Edycja.",
        "'Wyślij' (lub Enter w polu) wysyła linię i przechodzi do następnego kroku. 'Wstecz' i 'Dalej' poruszają się bez wysyłania. 'Na początek' wraca do pierwszego kroku.",
        "Pauza: leci odliczanie. Przy włączonym 'Po pauzie przejdź dalej' prompter sam pokaże następny krok po skończonym odliczaniu (nadal nic nie wysyła).",
    ]);

    h("Didaskalia");
    ul([
        "Notatka tuż przed krokiem to jego didaskalia: prompter pokazuje ją nad polem kroku (bursztyn).",
        "Didaskalia to ciągły blok notatek - komenda lub pauza przerywa blok. Pokazywane są maksymalnie 2 linie; przy większej liczbie notatek druga kończy się wielokropkiem.",
    ]);

    h("Edycja sceny");
    ul([
        "Pasek 'Dodaj krok' na dole: wybierasz typ (komenda / pauza / notatka) i dodajesz krok na końcu sceny. Wybrany typ jest zapamiętywany w ramach sesji.",
        "Przy każdym kroku: 'Wstaw' wstawia nowy krok poniżej, 'Powiel' powiela krok, strzałki ^ i v przesuwają go w górę i w dół.",
        "'X' usuwa krok (z potwierdzeniem). Usunięcie całej sceny z biblioteki też wymaga potwierdzenia.",
    ]);

    h("Operacje zbiorcze");
    ul([
        "Checkboxy przy scenach zaznaczają je do operacji zbiorczych; 'Zaznacz wszystkie' / 'Odznacz wszystkie' działa na całej bibliotece.",
        "'Pobierz JSON' i 'Pobierz TXT' eksportują wszystkie zaznaczone sceny jednym plikiem.",
        "'Usuń zaznaczone' kasuje zaznaczone sceny po potwierdzeniu. Przy pustym zaznaczeniu status przypomina: Najpierw zaznacz sceny.",
    ]);

    h("Import i eksport");
    ul([
        "Importuj plik: wczytaj scenę z .txt (lista komend) lub .json (pełna scena z tytułem i opisem).",
        "Importuj tekst: wklej zawartość bezpośrednio.",
        "Format tekstu: każda linia to jedna komenda; /pauza lub /pauza N to pauza; linia zaczynająca się od # to notatka.",
        "Eksport: 'JSON' (pełna, bezstratna kopia) lub 'TXT' (prosty tekst).",
        "Import JSON przyjmuje też pakiet scen (jeden plik z wieloma scenami naraz) - wszystkie sceny z pakietu trafiają do biblioteki.",
        "Import jest dosłowny. Natywne pieśni truwerskie używają komend z wiodącym /, a klient rezerwuje / dla aliasów - takie komendy trzeba pozbawić / (w trybie Edycja), żeby trafiły do gry.",
    ]);

    h("Zapisz jako…");
    ul([
        "Zbiorczo: pole nazwy obok 'Pobierz JSON/TXT' - wpisz własną nazwę pliku albo zostaw puste (wtedy domyślna truwer-sceny-<data>). Rozszerzenie .json/.txt doklejane jest wg przycisku, jeśli go nie podasz.",
        "Per scena: 'Zapisz jako…' w wierszu sceny otwiera pole nazwy (domyślnie z tytułu sceny). 'Zapisz' pobiera plik .json, 'Anuluj' zamyka bez zapisu.",
        "Nazwy plików zapisywane są bez polskich znaków (ogonki i inne znaki specjalne zamieniane na _) - dotyczy to tylko nazw plików, nie treści scen.",
    ]);

    h("Ważne");
    ul([
        "Plugin nigdy nie wysyła komend samodzielnie. Każda wysyłka to Twój świadomy klik. To wymóg regulaminu Arkadii.",
    ]);
}

function renderHelp(): void {
    if (!contentEl) return;
    const wrap = el("div", "tr-view");

    const top = el("div", "tr-row");
    top.appendChild(btn("Powrót", closeHelp, "tr-icon-btn", "Wróć do poprzedniego widoku."));
    wrap.appendChild(top);

    const box = el("div", "tr-scroll tr-help");
    helpContent(box);
    wrap.appendChild(box);

    contentEl.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

const STYLE_CSS =
    ".tr-root{display:flex;flex-direction:column;gap:0.4rem;flex:1 1 auto;min-height:0;min-width:0;box-sizing:border-box;padding:0.6rem;}" +
    ".dockable-popup-body:has(.tr-root){flex:1 1 auto;min-height:0;}" +
    ".dockable-popup-body:has(.tr-root) div:has(.tr-root){display:flex;flex-direction:column;flex:1 1 auto;min-height:0;}" +
    ".tr-content{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:0.4rem;}" +
    ".tr-view{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:0.4rem;}" +
    ".tr-row{display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;}" +
    ".tr-grow{flex:1;min-width:0;}" +
    ".tr-scroll{flex:1 1 auto;min-height:4rem;overflow-y:auto;border:1px solid var(--popup-border-subtle);border-radius:0.25rem;padding:0.4rem;display:flex;flex-direction:column;gap:0.35rem;}" +
    ".tr-input,.tr-select,.tr-textarea{padding:0.3rem 0.5rem;border:1px solid var(--popup-border-control);border-radius:0.25rem;background-color:var(--popup-input-bg);color:var(--popup-input-text);font-size:13px;box-sizing:border-box;}" +
    ".tr-input::placeholder,.tr-textarea::placeholder{color:var(--popup-text-faint);}" +
    ".tr-input:focus,.tr-select:focus,.tr-textarea:focus{border-color:var(--popup-input-focus-border);outline:none;}" +
    ".tr-select option{background-color:var(--popup-input-bg);color:var(--popup-input-text);}" +
    ".tr-textarea{resize:vertical;min-height:5rem;width:100%;font-family:inherit;}" +
    ".tr-num{width:7rem;flex:0 0 auto;}" +
    ".tr-btn{padding:0.3rem 0.75rem;border:none;border-radius:0.25rem;background-color:var(--popup-accent-bg);color:var(--popup-accent);cursor:pointer;font-size:13px;}" +
    ".tr-btn:hover:not(:disabled){background-color:var(--popup-accent-hover-bg);}" +
    ".tr-btn:disabled{opacity:0.5;cursor:default;}" +
    ".tr-primary{font-weight:600;}" +
    ".tr-icon-btn{padding:0.2rem 0.5rem;border:1px solid var(--popup-border-control);border-radius:0.25rem;background-color:var(--popup-control-bg);color:var(--popup-text);cursor:pointer;font-size:12px;line-height:1.2;}" +
    ".tr-icon-btn:hover:not(:disabled){background-color:var(--popup-control-hover-bg);}" +
    ".tr-icon-btn:disabled{opacity:0.5;cursor:default;}" +
    ".tr-btn-danger{background-color:var(--popup-danger-bg);color:var(--popup-danger);border-color:var(--popup-danger);}" +
    ".tr-btn-danger:hover:not(:disabled){background-color:var(--popup-danger-hover-bg);}" +
    ".tr-active{border-color:var(--popup-input-focus-border);color:var(--popup-accent);}" +
    ".tr-item{display:flex;flex-direction:column;gap:0.2rem;border:1px solid var(--popup-border-subtle);border-radius:0.25rem;padding:0.4rem;}" +
    ".tr-item-title{font-size:13px;font-weight:600;color:var(--popup-text);overflow-wrap:anywhere;}" +
    ".tr-item-meta{font-size:11px;color:var(--popup-text-subtle);}" +
    ".tr-item-acts{display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.2rem;}" +
    ".tr-erow{display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;}" +
    ".tr-erow-acts{display:flex;gap:0.25rem;margin-left:auto;}" +
    ".tr-panel{display:flex;flex-direction:column;gap:0.4rem;border:1px solid var(--popup-border-subtle);border-radius:0.25rem;padding:0.4rem;}" +
    ".tr-step{font-size:12px;padding:0.2rem 0.35rem;border-radius:0.2rem;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--popup-text);}" +
    ".tr-step-current{background-color:var(--popup-accent-bg);color:var(--popup-accent);border:1px solid var(--popup-input-focus-border);}" +
    ".tr-step-note{color:#e0b85c;font-style:italic;}" +
    ".tr-did{background:#2b2517;border-left:3px solid #e0b85c;padding:0.3rem 0.6rem;margin-bottom:0.4rem;}" +
    ".tr-did-line{color:#e0b85c;font-style:italic;font-size:12px;line-height:1.4;}" +
    ".tr-bulkname{max-width:180px;}" +
    ".tr-saveas{display:flex;gap:0.3rem;align-items:center;margin-top:0.3rem;}" +
    ".tr-saveas-name{max-width:220px;}" +
    ".tr-step-pause{color:var(--popup-text-subtle);}" +
    ".tr-big{font-size:14px;font-weight:600;color:var(--popup-text);}" +
    ".tr-pauseline{display:flex;align-items:center;gap:0.5rem;}" +
    ".tr-countdown{font-size:14px;font-weight:600;color:var(--popup-warning);}" +
    ".tr-ready{color:var(--popup-accent);}" +
    ".tr-prog{font-size:12px;color:var(--popup-text-subtle);margin-left:auto;}" +
    ".tr-hint{font-size:11px;color:var(--popup-text-faint);}" +
    ".tr-label{display:block;font-size:11px;color:var(--popup-text-subtle);margin:0.2rem 0 0.1rem;}" +
    ".tr-empty{font-size:12px;color:var(--popup-text-faint);text-align:center;padding:0.6rem;}" +
    ".tr-check{display:inline-flex;align-items:center;gap:0.3rem;font-size:12px;color:var(--popup-text-subtle);cursor:pointer;}" +
    ".tr-status{font-size:12px;min-height:1rem;color:var(--popup-text-subtle);}" +
    ".tr-c-error{color:var(--popup-danger);}" +
    ".tr-c-ok{color:var(--popup-accent);}" +
    ".tr-spacer{flex:1 1 auto;}" +
    ".tr-head{display:flex;flex-direction:column;gap:0.4rem;}" +
    ".tr-step-click{cursor:pointer;}" +
    ".tr-step-click:hover{background-color:var(--popup-control-hover-bg);}" +
    ".tr-help{gap:0.3rem;}" +
    ".tr-help-title{font-size:15px;font-weight:600;color:var(--popup-text);margin-bottom:0.3rem;}" +
    ".tr-help-h{font-size:13px;font-weight:600;color:var(--popup-accent);margin-top:0.5rem;}" +
    ".tr-help-p{font-size:12px;color:var(--popup-text);line-height:1.4;}" +
    ".tr-help-ul{margin:0.2rem 0 0.2rem 1rem;padding:0;}" +
    ".tr-help-li{font-size:12px;color:var(--popup-text-subtle);line-height:1.4;margin-bottom:0.2rem;}" +
    ".tr-line{min-height:1.9rem;resize:none;overflow:hidden;width:auto;white-space:pre-wrap;overflow-wrap:anywhere;}" +
    ".tr-cmd{font-family:monospace;padding:1px 6px;border:1px solid var(--popup-border-subtle);border-radius:4px;}" +
    ".tr-bulk{border-bottom:1px solid var(--popup-border-subtle);padding-bottom:0.4rem;}" +
    ".tr-item-head{display:flex;align-items:center;gap:0.4rem;}" +
    ".tr-item-head .tr-item-title{flex:1 1 auto;min-width:0;}" +
    ".tr-item-check{flex:0 0 auto;}" +
    ".tr-item-sel{border-color:var(--popup-input-focus-border);}" +
    ".tr-btn:disabled,.tr-icon-btn:disabled{opacity:0.45;cursor:default;}" +
    ".tr-footer{text-align:right;margin-top:0.4rem;color:var(--popup-text-dim);font-size:11px;opacity:0.7;}";

function injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const st = el("style");
    st.id = STYLE_ID;
    st.textContent = STYLE_CSS;
    (document.head || document.getElementsByTagName("head")[0]).appendChild(st);
}

function removeStyle(): void {
    const st = document.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
}

// ---------------------------------------------------------------------------
// Popup wiring
// ---------------------------------------------------------------------------

function buildContent(): Node {
    injectStyle();
    library = loadLibrary();
    if (currentId && !library.find((s) => s.id === currentId)) {
        currentId = null;
        view = "library";
    }
    rootEl = el("div", "tr-root");
    rootEl.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter") ev.stopPropagation();
    });
    contentEl = el("div", "tr-content");
    statusEl = el("div", "tr-status");
    const footer = el("div", "tr-footer", "v" + PLUGIN_VERSION + " | " + PLUGIN_BUILD_DATE);
    rootEl.appendChild(contentEl);
    rootEl.appendChild(statusEl);
    rootEl.appendChild(footer);
    render();
    return rootEl;
}

function togglePopup(): void {
    if (!popup) return;
    if (popup.isOpen) {
        flushSave();
        popup.close();
        return;
    }
    library = loadLibrary();
    if (currentId && !library.find((s) => s.id === currentId)) {
        currentId = null;
        view = "library";
    }
    void popup.open();
    if (rootEl && contentEl) render();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function init(api: PluginApi): Promise<PluginInfo> {
    apiRef = api;
    loadPrefs();
    library = loadLibrary();
    view = "library";
    mode = "edit";
    currentId = null;
    importOpen = false;

    injectStyle();

    popup = (await api.ui.registerPersistentPopup({
        id: POPUP_ID,
        title: "Truwer - asystent odgrywania scen",
        createContent: () => buildContent(),
    })) as unknown as PopupHandle;

    menuHandle = api.ui.addPopupMenuEntry("Truwer", () => togglePopup()) as unknown as MenuHandle;

    aliasId = api.aliases.register(ALIAS_REGEX, () => {
        togglePopup();
        return true;
    });

    return {
        name: "truwer",
        version: PLUGIN_VERSION,
        author: "Isithunzi000",
        description:
            "Truwer to asystent odgrywania sekwencyjnego, śpiewanie piosenek, deklamowanie wierszy, odgrywanie scen lub rytuałów (alias /truwer). Plugin w pełni zgodny z regulaminem gry — wszystkie komendy wysyłane świadomie przez gracza, bez automatyki.",
    };
}

export async function destroy(): Promise<void> {
    flushSave();
    stopPauseTimer();

    if (statusTimer !== null) {
        try {
            window.clearTimeout(statusTimer);
        } catch {
            /* ignore */
        }
        statusTimer = null;
    }
    if (saveTimer !== null) {
        try {
            window.clearTimeout(saveTimer);
        } catch {
            /* ignore */
        }
        saveTimer = null;
    }

    if (aliasId && apiRef) {
        try {
            apiRef.aliases.remove(aliasId as never);
        } catch {
            /* ignore */
        }
    }
    aliasId = null;

    if (menuHandle) {
        try {
            menuHandle.remove();
        } catch {
            /* ignore */
        }
        menuHandle = null;
    }

    if (popup) {
        try {
            if (popup.isOpen) popup.close();
        } catch {
            /* ignore */
        }
        popup = null;
    }

    removeStyle();

    rootEl = null;
    contentEl = null;
    statusEl = null;
    currentStepEl = null;
    countdownSpan = null;
    importTitleEl = null;
    importTextEl = null;
    library = [];
    currentId = null;
    apiRef = null;
}
