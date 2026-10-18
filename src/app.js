// Einstiegspunkt: Laden der Preisdaten (mit Fallback-Kette und lokalem Zwischenspeicher),
// Analyse, Rendering, Auto-Aktualisierung und Theme-Umschaltung. Keine Nutzerdaten, keine Cookies.

import { config } from './config.js';
import { fetchPrices, nextRefreshAt } from './sources.js';
import { cheapestSlot, cheapestUpcomingSlot, cheapestStartTimeOfDay, currentPoint, HOUR, MINUTE } from './analysis.js';
import { computeView, berlinParts } from './format.js';

/** Uhrzeit-Schlüssel „HH:MM“ in Europe/Berlin für den Rückblick „Beste Ladezeit der letzten Tage“. */
const berlinWallClockKey = (ts) => { const p = berlinParts(ts); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
import { PriceChart } from './chart.js';
import * as ui from './ui.js';

const CACHE_KEY = 'laderick:cache:v1';
const THEME_KEY = 'laderick:theme';
const DAYS_KEY = 'laderick:days';

const params = new URLSearchParams(window.location.search);
const nowParam = params.get('now');
const nowOverride = nowParam ? Date.parse(nowParam) : NaN;
const KNOWN_SOURCES = ['smard', 'energy-charts', 'awattar', 'snapshot'];
const sourceParam = params.get('source');
const sourceOverride = sourceParam && KNOWN_SOURCES.includes(sourceParam) ? sourceParam : null;
const hasOverride = Number.isFinite(nowOverride) || Boolean(sourceOverride);

/** „Jetzt“ für die Berechnung; notBefore erlaubt dem Grenz-Timer, knapp vor der Grenze bereits für sie zu rechnen. */
const getNow = (notBefore = 0) => (Number.isFinite(nowOverride) ? nowOverride : Math.max(Date.now(), notBefore));

const state = {
  series: null,
  attempts: [],
  lastFetchAt: 0,
  /** letzter Abrufversuch (auch erfolglos) und nächster geplanter Abruf, Epoch-ms */
  lastAttemptAt: 0,
  nextLoadAt: Infinity,
  loadTimer: undefined,
  loading: false,
  chart: null,
  viewDays: readDaysChoice(),
};

/** Gewählter Diagramm-Zeitraum (Kalendertage) aus localStorage, sonst Standard. */
function readDaysChoice() {
  try {
    const v = Number(window.localStorage.getItem(DAYS_KEY));
    if (config.chartDaysOptions.includes(v)) return v;
  } catch { /* ignorieren */ }
  return config.chartDaysDefault;
}

function setDaysChoice(days) {
  if (!config.chartDaysOptions.includes(days)) return;
  state.viewDays = days;
  try { window.localStorage.setItem(DAYS_KEY, String(days)); } catch { /* ignorieren */ }
  syncRangePicker();
  if (state.series) render({ fromCache: true });
}

function syncRangePicker() {
  const input = document.querySelector(`#range-picker input[value="${state.viewDays}"]`);
  if (input) input.checked = true;
  const seg = document.querySelector('#range-picker .segmented');
  if (seg) seg.dataset.active = String(state.viewDays); // Position der gleitenden Markierung
}


// ---------- Zwischenspeicher (localStorage, nur Preisdaten, keine Nutzerdaten) ----------

const CACHE_MAX_AGE_MS = 24 * 60 * MINUTE;

function dropCache() {
  try { window.localStorage.removeItem(CACHE_KEY); } catch { /* ignorieren */ }
}

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = parsed?.series;
    const valid = parsed && Number.isFinite(parsed.savedAt) && s && Array.isArray(s.points) && s.points.length > 0
      && s.source && typeof s.source.id === 'string' && Number.isFinite(s.resolutionMinutes) && Number.isFinite(s.fetchedAt)
      && s.points.every((p) => p && Number.isFinite(p.start) && Number.isFinite(p.end) && Number.isFinite(p.price));
    if (!valid || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) { dropCache(); return null; }
    return parsed;
  } catch {
    dropCache();
    return null;
  }
}

function writeCache(series, attempts) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), series, attempts }));
  } catch {
    /* Speicher voll oder nicht verfügbar – unkritisch */
  }
}

// ---------- Rendering ----------

function render({ fromCache = false, notBefore = 0 } = {}) {
  const { series, attempts } = state;
  if (!series) return;
  const now = getNow(notBefore);
  const result = cheapestSlot(series.points, { now, lookbackHours: config.lookbackHours, slotHours: config.slotHours });
  const upcoming = cheapestUpcomingSlot(series.points, { now, slotHours: config.slotHours });
  const startTime = cheapestStartTimeOfDay(series.points, { now, lookbackHours: config.lookbackHours, slotHours: config.slotHours, wallClockKey: berlinWallClockKey, dayKey: (ts) => berlinParts(ts).ymd });
  const current = currentPoint(series.points, now);
  const knownUntil = series.points.length ? series.points[series.points.length - 1].end : null;
  const view = computeView(now, knownUntil, state.viewDays);

  ui.renderHero(result, { now });
  ui.renderStartTime(startTime);
  ui.renderOutlook(upcoming, { now, knownUntil });
  ui.renderKpis({ current, result, now });
  ui.renderChartMeta({ points: series.points, view, resolutionMinutes: series.resolutionMinutes, supplements: series.supplements, now });
  ui.renderSupplementNote(series, now);
  ui.renderTable({ points: series.points, view, cheapest: upcoming, now });
  ui.renderStatusMeta({ series, attempts, now, knownUntil });
  state.chart.update({
    points: series.points,
    now,
    cheapest: upcoming, // grün im Diagramm: nur das günstigste kommende Fenster
    range: result.range,
    viewStart: view.viewStart,
    viewEnd: view.viewEnd,
    resolutionMinutes: series.resolutionMinutes,
  });
  ui.hideError();
  if (!fromCache) ui.setStatusMessage(ui.statusAfterLoad({ series, attempts, now, knownUntil }));

  window.__LADERICK__ = { series, result, upcoming, startTime, current, attempts, now, fromCache, viewDays: state.viewDays, viewStart: view.viewStart, viewEnd: view.viewEnd, viewLabel: view.label, nextLoadAt: state.nextLoadAt };
  document.dispatchEvent(new CustomEvent('laderick:rendered', { detail: window.__LADERICK__ }));

  // Grüne Markierung (Diagramm/Tabelle) und Legende nur, wenn das kommende Fenster im gewählten Zeitraum liegt
  const legend = document.getElementById('legend-cheapest');
  if (legend) legend.hidden = !(upcoming && upcoming.end > view.viewStart && upcoming.start < view.viewEnd);

  state.renderWall = Date.now();
  state.renderPerf = performance.now();
  state.shownUpcomingStart = upcoming ? upcoming.start : null;
  scheduleBoundaryRender(now);
}

/**
 * Neu berechnen kurz vor der nächsten Viertelstundengrenze, und zwar bereits für den Grenzzeitpunkt: So ist ein
 * Fenster, das an dieser Grenze beginnen würde, schon ersetzt, bevor es beginnt.
 * @param {number} renderedNow das „jetzt“ der gerade abgeschlossenen Berechnung
 */
function scheduleBoundaryRender(renderedNow) {
  window.clearTimeout(state.boundaryTimer);
  if (Number.isFinite(nowOverride)) return;
  const step = 15 * MINUTE;
  const boundary = Math.floor(renderedNow / step) * step + step;
  const wait = Math.max(0, boundary - Date.now() - 30);
  state.boundaryTimer = window.setTimeout(() => { if (state.series) render({ fromCache: true, notBefore: boundary }); }, wait);
}

/**
 * Wächter (jede Sekunde, sehr billig): Hat das angezeigte kommende Fenster begonnen oder ist die Uhr gesprungen
 * (Ruhezustand ohne Tab-Wechsel, Zeitumstellung per NTP), wird sofort neu gerechnet.
 */
function watchdog() {
  if (!state.series || Number.isFinite(nowOverride) || state.renderWall === undefined) return;
  const wall = Date.now();
  const expectedWall = state.renderWall + (performance.now() - state.renderPerf);
  const started = state.shownUpcomingStart !== null && wall >= state.shownUpcomingStart;
  if (started || Math.abs(wall - expectedWall) > 2000) render({ fromCache: true });
  // Abruf überfällig (Timer im Hintergrund-Tab gedrosselt, Standby, Uhrsprung): jetzt nachholen
  if (!state.loading && wall >= state.nextLoadAt + 5000) load();
}

// ---------- Laden ----------

async function load({ force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const now = getNow();
  const hadData = Boolean(state.series);

  // 1) Zwischenspeicher: sofort anzeigen, Netzabruf nur wenn abgelaufen
  if (!force && !hadData && !hasOverride) {
    const cached = readCache();
    if (cached) {
      try {
        state.series = cached.series;
        state.attempts = Array.isArray(cached.attempts) ? cached.attempts : [];
        state.lastFetchAt = cached.savedAt;
        render({ fromCache: true });
        ui.setStatusMessage(ui.statusAfterLoad({ series: cached.series, attempts: state.attempts, now, knownUntil: cached.series.points.at(-1)?.end ?? null }));
        // Frisch nur, solange weder die Cache-Dauer abgelaufen noch ein früherer Abruf fällig ist – fehlen z. B. nach
        // 12:55 Uhr die Preise für morgen, wird nach wenigen Minuten neu abgefragt statt erst nach 10 Minuten.
        const freshUntil = Math.min(cached.savedAt + config.cacheTtlMinutes * MINUTE, nextRefreshAt(cached.series, cached.savedAt, now));
        if (Date.now() < freshUntil) {
          state.lastAttemptAt = cached.savedAt;
          scheduleNextLoad(freshUntil);
          state.loading = false;
          return;
        }
      } catch (err) {
        console.warn('Zwischenspeicher unbrauchbar, wird verworfen', err);
        dropCache();
        state.series = null;
        state.attempts = [];
      }
    }
  }

  // 2) Netzabruf über die Fallback-Kette
  state.lastAttemptAt = Date.now();
  try {
    await fetchAndRender(now);
  } catch (err) {
    console.error('Laden fehlgeschlagen', err);
    ui.setRefreshing(false);
    if (!state.series) ui.showError(state.attempts);
    else ui.setStatusMessage('Aktualisierung fehlgeschlagen – es werden die zuletzt geladenen Daten angezeigt.');
  } finally {
    state.loading = false;
    scheduleNextLoad();
  }
}

const RETRY_AFTER_FAILURE_MS = 15 * MINUTE;

/**
 * Nächsten Abruf planen: stündlich, aber alle 5 Minuten, solange erwartete Preise fehlen (z. B. nach 12:55 Uhr die
 * Preise für morgen), und alle 30 Minuten, solange Preise nur aus einer ergänzenden Quelle stammen (siehe nextRefreshAt).
 * Nach einem fehlgeschlagenen Abruf spätestens nach 15 Minuten erneut.
 * @param {number} [at] fester Zeitpunkt (Epoch-ms), sonst aus dem Datenstand berechnet
 */
function scheduleNextLoad(at) {
  window.clearTimeout(state.loadTimer);
  let next = at;
  if (next === undefined) {
    if (Number.isFinite(nowOverride)) {
      next = state.lastAttemptAt + config.refreshMinutes * MINUTE; // Testmodus: fester Takt
    } else {
      next = nextRefreshAt(state.series, state.lastAttemptAt, getNow());
      if (state.lastFetchAt < state.lastAttemptAt) next = Math.min(next, state.lastAttemptAt + RETRY_AFTER_FAILURE_MS);
    }
  }
  next = Math.max(next, Date.now() + 30_000); // nie in Schleife
  state.nextLoadAt = next;
  if (window.__LADERICK__) window.__LADERICK__.nextLoadAt = next;
  state.loadTimer = window.setTimeout(() => load(), next - Date.now());
}

async function fetchAndRender(now) {
  ui.setRefreshing(Boolean(state.series));
  if (!state.series) ui.setStatusMessage('Preisdaten werden geladen …');
  const order = sourceOverride ? [sourceOverride] : config.sourceOrder;
  const { series, attempts } = await fetchPrices({
    now,
    order,
    onAttempt: (a) => {
      if (a.ok || state.series || a.role === 'supplement') return;
      const idx = order.indexOf(a.id);
      const next = order[idx + 1];
      ui.setStatusMessage(next
        ? `${ui.shortName(a.id)} antwortet nicht – versuche ${ui.shortName(next)} …`
        : `${ui.shortName(a.id)} antwortet nicht.`);
    },
  });
  ui.setRefreshing(false);

  if (series) {
    state.series = series;
    state.attempts = attempts;
    state.lastFetchAt = Date.now();
    if (!hasOverride) writeCache(series, attempts);
    render();
  } else if (state.series) {
    const age = Date.now() - state.lastFetchAt;
    const ageText = age > 60 * MINUTE
      ? `zuletzt geladen vor ${Math.round(age / (60 * MINUTE))}\u00a0Stunden`
      : `zuletzt geladen vor ${Math.max(1, Math.round(age / MINUTE))}\u00a0Minuten`;
    ui.setStatusMessage(`Aktualisierung fehlgeschlagen – es werden die zuletzt geladenen Daten angezeigt (${ageText}).`);
    state.attempts = attempts;
  } else {
    state.attempts = attempts;
    ui.showError(attempts);
    window.__LADERICK__ = { series: null, result: null, upcoming: null, current: null, attempts, now };
    document.dispatchEvent(new CustomEvent('laderick:rendered', { detail: window.__LADERICK__ }));
  }
}

// ---------- Theme ----------

function isDark() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function syncThemeButton() {
  const btn = document.getElementById('theme-toggle');
  btn.setAttribute('aria-pressed', isDark() ? 'true' : 'false');
}

function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { window.localStorage.setItem(THEME_KEY, next); } catch { /* ignorieren */ }
  syncThemeButton();
  state.chart?.render();
}

// ---------- Aufklappbare Abschnitte ----------

/** Öffnet eingeklappte Abschnitte (<details>), auf die ein Anker zeigt (#impressum, #datenschutz, #quellen …). */
function revealTarget(hash, { scroll = false } = {}) {
  if (!hash || hash.length < 2) return;
  let el = null;
  try { el = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return; }
  if (!el) return;
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  // Ziel eines Sprungs erscheint sofort und ohne Bewegung, damit es an der richtigen Stelle landet
  for (let r = el.closest('.reveal-scroll'); r; r = r.parentElement?.closest('.reveal-scroll') ?? null) r.classList.add('is-visible', 'is-instant');
  if (scroll) el.scrollIntoView({ block: 'start' });
}

// ---------- Bewegung ----------

/**
 * Die Teile des Erklär- und Rechtsteils (Überschriften, Absätze, aufklappbare Abschnitte) erscheinen einmal beim
 * Hineinscrollen, gestaffelt in Lesereihenfolge; ohne Observer sofort.
 */
function setupReveal() {
  const items = [...document.querySelectorAll('.article > *, .legal > *')];
  for (const el of items) el.classList.add('reveal-scroll');
  if (typeof IntersectionObserver !== 'function') { for (const el of items) el.classList.add('is-visible'); return; }
  const io = new IntersectionObserver((entries) => {
    let i = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.transitionDelay = `${Math.min(i, 4) * 70}ms`;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
      i += 1;
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
  for (const el of items) io.observe(el);
  window.addEventListener('beforeprint', () => { for (const el of items) el.classList.add('is-visible'); });
}

/** Der Zeitraum-Umschalter gleitet bei Zeiger-Bedienung; per Tastatur wechselt er ohne Bewegung. */
function setupSegmented() {
  const seg = document.querySelector('#range-picker .segmented');
  if (!seg) return;
  seg.addEventListener('keydown', () => { seg.dataset.keyboard = 'true'; });
  seg.addEventListener('pointerdown', () => { seg.dataset.keyboard = 'false'; });
}

function setupSectionLinks() {
  // Vor der Standard-Navigation öffnen, damit der Browser zum sichtbaren Abschnitt springt
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (a) revealTarget(a.getAttribute('href'));
  });
  window.addEventListener('hashchange', () => revealTarget(window.location.hash, { scroll: true }));
  if (window.location.hash) {
    revealTarget(window.location.hash, { scroll: true });
    // Nach dem ersten Rendern verschiebt sich die Seitenhöhe – dann erneut zum Abschnitt springen
    document.addEventListener('laderick:rendered', () => revealTarget(window.location.hash, { scroll: true }), { once: true });
  }
  window.addEventListener('beforeprint', () => {
    for (const d of document.querySelectorAll('details.info-details')) d.open = true;
  });
}

// ---------- Start ----------

function init() {
  setupSectionLinks();
  setupReveal();
  setupSegmented();
  ui.renderOverrideBanner({ nowOverride, sourceOverride });
  const link = document.getElementById('override-link');
  if (link) link.href = window.location.pathname;

  state.chart = new PriceChart(document.getElementById('chart'), {
    readout: document.getElementById('chart-readout'),
    output: document.getElementById('chart-output'),
  });

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { syncThemeButton(); state.chart?.render(); });
  syncThemeButton();

  document.getElementById('retry').addEventListener('click', () => load({ force: true }));
  syncRangePicker();
  document.getElementById('range-picker').addEventListener('change', (e) => {
    if (e.target?.name === 'range') setDaysChoice(Number(e.target.value));
  });
  document.getElementById('table-link').addEventListener('click', () => {
    const details = document.getElementById('table');
    details.open = true;
    details.querySelector('caption')?.setAttribute('tabindex', '-1');
    details.querySelector('caption')?.focus?.();
  });

  load();

  // Neuabfrage der Quellen: geplant nach jedem Abruf (scheduleNextLoad) – stündlich, enger getaktet, solange erwartete
  // Preise fehlen; lokale Neuberechnung (Jetzt-Linie, aktueller Preis, Ausblick) jede Minute ohne Netzabruf …
  window.setInterval(() => { if (state.series && !Number.isFinite(nowOverride)) render({ fromCache: true }); }, MINUTE);
  window.setInterval(watchdog, 1000);
  window.addEventListener('focus', () => { if (state.series) render({ fromCache: true }); });
  // … und beim Zurückkehren in den Tab: sofort neu rechnen (damit kein inzwischen begonnenes Fenster stehen bleibt),
  // danach neu abrufen, wenn der letzte Abruf schon länger her ist.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.series) render({ fromCache: true });
    if (Date.now() >= state.nextLoadAt || Date.now() - state.lastAttemptAt > config.refetchAfterHiddenMinutes * MINUTE) load();
  });
  // Rückkehr per Zurück-Taste aus dem Browser-Cache (bfcache): ebenfalls sofort neu rechnen
  window.addEventListener('pageshow', (e) => { if (e.persisted && state.series) render({ fromCache: true }); });
}

init();
