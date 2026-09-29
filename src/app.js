// Einstiegspunkt: Laden der Preisdaten (mit Fallback-Kette und lokalem Zwischenspeicher),
// Analyse, Rendering, Auto-Aktualisierung und Theme-Umschaltung. Keine Nutzerdaten, keine Cookies.

import { config } from './config.js';
import { fetchPrices } from './sources.js';
import { cheapestSlot, cheapestUpcomingSlot, currentPoint, MINUTE } from './analysis.js';
import { PriceChart } from './chart.js';
import * as ui from './ui.js';

const CACHE_KEY = 'laderick:cache:v1';
const THEME_KEY = 'laderick:theme';

const params = new URLSearchParams(window.location.search);
const nowParam = params.get('now');
const nowOverride = nowParam ? Date.parse(nowParam) : NaN;
const sourceOverride = params.get('source');
const hasOverride = Number.isFinite(nowOverride) || Boolean(sourceOverride);

const getNow = () => (Number.isFinite(nowOverride) ? nowOverride : Date.now());

const state = {
  series: null,
  attempts: [],
  lastFetchAt: 0,
  loading: false,
  chart: null,
};

// ---------- Zwischenspeicher (localStorage, nur Preisdaten, keine Nutzerdaten) ----------

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.series?.points) || !Number.isFinite(parsed.savedAt)) return null;
    return parsed;
  } catch {
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

function render({ fromCache = false } = {}) {
  const { series, attempts } = state;
  if (!series) return;
  const now = getNow();
  const result = cheapestSlot(series.points, { now, lookbackHours: config.lookbackHours, slotHours: config.slotHours });
  const upcoming = cheapestUpcomingSlot(series.points, { now, slotHours: config.slotHours });
  const current = currentPoint(series.points, now);
  const knownUntil = series.points.length ? series.points[series.points.length - 1].end : null;

  ui.renderHero(result, { now });
  ui.renderOutlook(upcoming, { now, knownUntil });
  ui.renderKpis({ current, result, now });
  ui.renderChartMeta({ points: series.points, range: result.range, resolutionMinutes: series.resolutionMinutes, now });
  ui.renderTable({ points: series.points, range: result.range, slot: result.slot, upcoming, now });
  ui.renderStatusMeta({ series, attempts, now, knownUntil });
  state.chart.update({
    points: series.points,
    now,
    slot: result.slot,
    upcoming,
    range: result.range,
    resolutionMinutes: series.resolutionMinutes,
  });
  ui.hideError();
  if (!fromCache) ui.setStatusMessage(ui.statusAfterLoad({ series, attempts, now, knownUntil }));

  window.__LADERICK__ = { series, result, upcoming, current, attempts, now, fromCache };
  document.dispatchEvent(new CustomEvent('laderick:rendered', { detail: window.__LADERICK__ }));
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
      state.series = cached.series;
      state.attempts = cached.attempts ?? [];
      state.lastFetchAt = cached.savedAt;
      render({ fromCache: true });
      ui.setStatusMessage(ui.statusAfterLoad({ series: cached.series, attempts: state.attempts, now, knownUntil: cached.series.points.at(-1)?.end ?? null }));
      if (Date.now() - cached.savedAt < config.cacheTtlMinutes * MINUTE) {
        state.loading = false;
        return;
      }
    }
  }

  // 2) Netzabruf über die Fallback-Kette
  ui.setRefreshing(Boolean(state.series));
  if (!state.series) ui.setStatusMessage('Preisdaten werden geladen …');
  const order = sourceOverride ? [sourceOverride] : config.sourceOrder;
  const { series, attempts } = await fetchPrices({
    now,
    order,
    onAttempt: (a) => {
      if (a.ok || state.series) return;
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
    ui.setStatusMessage('Aktualisierung fehlgeschlagen – es werden die zuletzt geladenen Daten angezeigt.');
    state.attempts = attempts;
  } else {
    ui.setStatusMessage('');
    ui.showError(attempts);
    window.__LADERICK__ = { series: null, result: null, upcoming: null, current: null, attempts, now };
    document.dispatchEvent(new CustomEvent('laderick:rendered', { detail: window.__LADERICK__ }));
  }
  state.loading = false;
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
  const dark = isDark();
  btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  btn.textContent = dark ? 'Helles Design' : 'Dunkles Design';
}

function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { window.localStorage.setItem(THEME_KEY, next); } catch { /* ignorieren */ }
  syncThemeButton();
  state.chart?.render();
}

// ---------- Start ----------

function init() {
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
  document.getElementById('table-link').addEventListener('click', () => {
    const details = document.getElementById('table');
    details.open = true;
    details.querySelector('caption')?.setAttribute('tabindex', '-1');
    details.querySelector('caption')?.focus?.();
  });

  load();

  // Neuabfrage der Quellen in festem Takt …
  window.setInterval(() => load(), config.refreshMinutes * MINUTE);
  // … lokale Neuberechnung (Jetzt-Linie, aktueller Preis, Ausblick) jede Minute ohne Netzabruf …
  window.setInterval(() => { if (state.series && !Number.isFinite(nowOverride)) render({ fromCache: true }); }, MINUTE);
  // … und beim Zurückkehren in den Tab, wenn der letzte Abruf schon länger her ist.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - state.lastFetchAt > config.refetchAfterHiddenMinutes * MINUTE) load();
    else if (state.series) render({ fromCache: true });
  });
}

init();
