// Datenquellen-Adapter für den Day-Ahead-Börsenstrompreis (EPEX SPOT, Gebotszone DE-LU).
// Läuft im Browser und in Node (≥ 20). Keine DOM-Zugriffe. Jeder Adapter liefert eine
// normalisierte PriceSeries (siehe unten) oder wirft einen SourceError.

import { config } from './config.js';
import { HOUR, MINUTE, detectResolutionMinutes, floorToResolution, normalizePoints, weightedStats } from './analysis.js';

/** @typedef {import('./analysis.js').PricePoint} PricePoint */
/** @typedef {{
 *   points: PricePoint[],
 *   resolutionMinutes: number,
 *   source: { id:string, name:string, url:string, licence:string, attribution:string, operator:string },
 *   fetchedAt: number,
 *   stale?: boolean,
 *   snapshotOf?: { id:string, name:string, url:string, licence:string, attribution:string, operator:string } | null
 * }} PriceSeries */

export class SourceError extends Error {
  /** @param {string} sourceId @param {string} message @param {{ cause?:unknown, status?:number, kind?:string }} [opts] */
  constructor(sourceId, message, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'SourceError';
    this.sourceId = sourceId;
    this.status = opts.status;
    this.kind = opts.kind ?? 'unknown';
  }
}

export const SOURCE_META = Object.freeze({
  'energy-charts': Object.freeze({
    id: 'energy-charts',
    name: 'Energy-Charts (Fraunhofer ISE)',
    operator: 'Fraunhofer-Institut für Solare Energiesysteme ISE',
    url: 'https://www.energy-charts.info/',
    apiBase: 'https://api.energy-charts.info',
    licence: 'CC BY 4.0',
    attribution: 'Datenquelle: Energy-Charts (Fraunhofer ISE), Day-Ahead-Preise EPEX SPOT DE-LU, Lizenz CC BY 4.0',
  }),
  smard: Object.freeze({
    id: 'smard',
    name: 'SMARD.de (Bundesnetzagentur)',
    operator: 'Bundesnetzagentur',
    url: 'https://www.smard.de/',
    apiBase: 'https://www.smard.de/app/chart_data',
    licence: 'CC BY 4.0',
    attribution: 'Datenquelle: Bundesnetzagentur | SMARD.de, Großhandelspreise DE-LU, Lizenz CC BY 4.0',
  }),
  awattar: Object.freeze({
    id: 'awattar',
    name: 'aWATTar API',
    operator: 'aWATTar GmbH',
    url: 'https://www.awattar.de/',
    apiBase: 'https://api.awattar.de',
    licence: 'Nutzung gemäß aWATTar-API-Bedingungen',
    attribution: 'Datenquelle: aWATTar GmbH (EPEX SPOT Day-Ahead DE-LU)',
  }),
  snapshot: Object.freeze({
    id: 'snapshot',
    name: 'Serverseitiger Snapshot',
    operator: 'LadeRick (GitHub Action)',
    url: './data/prices.json',
    apiBase: '',
    licence: 'siehe Originalquelle',
    attribution: 'Snapshot der Originalquelle (siehe Statuszeile)',
  }),
});

// ---------- Hilfsfunktionen ----------

function berlinDate(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

/**
 * JSON per fetch laden – mit Timeout, Statusprüfung und Übersetzung von Netzwerk-/CORS-Fehlern.
 */
export async function getJson(url, { fetchImpl = globalThis.fetch, timeoutMs = config.requestTimeoutMs, signal, sourceId = 'unknown', headers } = {}) {
  if (typeof fetchImpl !== 'function') throw new SourceError(sourceId, 'fetch ist nicht verfügbar', { kind: 'environment' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    if (controller.signal.aborted) throw new SourceError(sourceId, 'Anfrage abgebrochen', { kind: 'aborted' });
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', ...(headers ?? {}) } });
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason?.message === 'timeout') {
        throw new SourceError(sourceId, `Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s (${url})`, { cause: err, kind: 'timeout' });
      }
      if (controller.signal.aborted) throw new SourceError(sourceId, 'Anfrage abgebrochen', { cause: err, kind: 'aborted' });
      throw new SourceError(sourceId, `Netzwerkfehler oder CORS-Blockade (${url})`, { cause: err, kind: 'network' });
    }
    if (!response.ok) {
      const kind = response.status === 429 ? 'ratelimit' : 'http';
      const hint = response.status === 429 ? 'Anfragelimit erreicht' : `HTTP ${response.status}`;
      throw new SourceError(sourceId, `${hint} (${url})`, { status: response.status, kind });
    }
    try {
      return await response.json();
    } catch (err) {
      throw new SourceError(sourceId, `Antwort ist kein gültiges JSON (${url})`, { cause: err, kind: 'format' });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }
}

function requestRange(now) {
  return { from: now - config.fetchDaysBack * 24 * HOUR, to: now + config.fetchDaysAhead * 24 * HOUR };
}

function assertUnitEurPerMwh(unit, sourceId) {
  if (typeof unit !== 'string' || !/^eur\s*\/\s*mwh$/i.test(unit.trim())) {
    throw new SourceError(sourceId, `Unerwartete Einheit „${unit}“ (erwartet EUR/MWh)`, { kind: 'format' });
  }
}

/** Aus Startzeiten (ms) und Preisen Punkte bilden; Slot-Ende = nächster Start, sonst Start + Auflösung. */
export function pointsFromStarts(starts, prices, { resolutionMinutes } = {}) {
  const pairs = [];
  for (let i = 0; i < starts.length; i += 1) {
    const s = starts[i];
    const v = prices[i];
    if (!Number.isFinite(s) || v === null || v === undefined || !Number.isFinite(Number(v))) continue;
    pairs.push({ start: s, price: Number(v) });
  }
  pairs.sort((a, b) => a.start - b.start);
  const diffs = new Map();
  for (let i = 1; i < pairs.length; i += 1) {
    const d = Math.round((pairs[i].start - pairs[i - 1].start) / MINUTE);
    if (d > 0) diffs.set(d, (diffs.get(d) ?? 0) + 1);
  }
  let res = resolutionMinutes ?? 60;
  if (!resolutionMinutes && diffs.size) {
    let bestCount = -1;
    for (const [d, c] of diffs) if (c > bestCount || (c === bestCount && d < res)) { res = d; bestCount = c; }
  }
  const step = res * MINUTE;
  return pairs.map((p, i) => {
    const next = pairs[i + 1];
    const end = next && next.start - p.start <= step ? next.start : p.start + step;
    return { start: p.start, end, price: p.price };
  });
}

function buildSeries(sourceId, rawPoints, { now, fetchedAt = now, resolutionMinutes } = {}) {
  const points = normalizePoints(rawPoints);
  if (!points.length) throw new SourceError(sourceId, 'Keine Preisdaten in der Antwort', { kind: 'empty' });
  const { apiBase, ...source } = SOURCE_META[sourceId];
  return {
    points,
    resolutionMinutes: resolutionMinutes ?? detectResolutionMinutes(points),
    source,
    fetchedAt,
  };
}

// ---------- Energy-Charts (Fraunhofer ISE) ----------

/**
 * GET https://api.energy-charts.info/price?bzn=DE-LU&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Antwort: { license_info, unix_seconds:number[], price:(number|null)[], unit:'EUR/MWh', deprecated }
 */
export async function fetchEnergyCharts({ now, fetchImpl, timeoutMs, signal, apiBase = SOURCE_META['energy-charts'].apiBase } = {}) {
  const id = 'energy-charts';
  const { from, to } = requestRange(now);
  const url = `${apiBase}/price?bzn=${encodeURIComponent(config.biddingZone)}&start=${berlinDate(from)}&end=${berlinDate(to)}`;
  const json = await getJson(url, { fetchImpl, timeoutMs, signal, sourceId: id });
  if (!json || !Array.isArray(json.unix_seconds) || !Array.isArray(json.price)) {
    throw new SourceError(id, 'Unerwartetes Antwortformat (unix_seconds/price fehlen)', { kind: 'format' });
  }
  assertUnitEurPerMwh(json.unit ?? 'EUR/MWh', id);
  const starts = json.unix_seconds.map((s) => Number(s) * 1000);
  const series = buildSeries(id, pointsFromStarts(starts, json.price), { now });
  if (typeof json.license_info === 'string' && json.license_info.trim()) {
    series.source = { ...series.source, licenceInfo: json.license_info.trim() };
  }
  if (json.deprecated === true) series.deprecated = true;
  return series;
}

// ---------- SMARD (Bundesnetzagentur) ----------

const SMARD_FILTER = 4169; // Großhandelspreise Deutschland/Luxemburg
const SMARD_REGION = 'DE';

/**
 * Index: {apiBase}/4169/DE/index_{resolution}.json → { timestamps:number[] } (Beginn der Wochendateien, ms)
 * Daten: {apiBase}/4169/DE/4169_DE_{resolution}_{timestamp}.json → { meta_data, series:[[ms, value|null], …] }
 */
export async function fetchSmard({ now, fetchImpl, timeoutMs, signal, apiBase = SOURCE_META.smard.apiBase } = {}) {
  const id = 'smard';
  const { from, to } = requestRange(now);
  let lastError = null;
  for (const resolution of ['quarterhour', 'hour']) {
    try {
      const base = `${apiBase}/${SMARD_FILTER}/${SMARD_REGION}`;
      const index = await getJson(`${base}/index_${resolution}.json`, { fetchImpl, timeoutMs, signal, sourceId: id });
      if (!index || !Array.isArray(index.timestamps) || !index.timestamps.length) {
        throw new SourceError(id, `Index ${resolution} ist leer oder ungültig`, { kind: 'format' });
      }
      const stamps = index.timestamps.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      // Dateien, die den Zielbereich berühren können (Wochendateien) – höchstens die letzten drei.
      const relevant = stamps.filter((ts) => ts <= to && ts + 8 * 24 * HOUR >= from).slice(-3);
      const files = relevant.length ? relevant : stamps.slice(-2);
      const resMin = resolution === 'quarterhour' ? 15 : 60;
      const raw = [];
      let loadedFiles = 0;
      for (const ts of files) {
        let data;
        try {
          data = await getJson(`${base}/${SMARD_FILTER}_${SMARD_REGION}_${resolution}_${ts}.json`, { fetchImpl, timeoutMs, signal, sourceId: id });
        } catch (err) {
          // Eine noch nicht vorhandene Wochendatei (404) ist normal, z. B. direkt nach Wochenbeginn.
          if (err instanceof SourceError && err.kind === 'http' && err.status === 404) continue;
          throw err;
        }
        if (!data || !Array.isArray(data.series)) throw new SourceError(id, 'Unerwartetes Antwortformat (series fehlt)', { kind: 'format' });
        loadedFiles += 1;
        for (const entry of data.series) {
          if (!Array.isArray(entry) || entry.length < 2) continue;
          const [start, value] = entry;
          if (value === null || value === undefined || !Number.isFinite(Number(value)) || !Number.isFinite(Number(start))) continue;
          raw.push({ start: Number(start), end: Number(start) + resMin * MINUTE, price: Number(value) });
        }
      }
      if (!loadedFiles) throw new SourceError(id, `Keine Datendatei gefunden (${resolution})`, { status: 404, kind: 'http' });
      const inRange = raw.filter((p) => p.end > from && p.start < to);
      if (!inRange.length) throw new SourceError(id, `Keine Werte im Zielbereich (${resolution})`, { kind: 'empty' });
      return buildSeries(id, raw, { now, resolutionMinutes: resMin });
    } catch (err) {
      lastError = err instanceof SourceError ? err : new SourceError(id, String(err?.message ?? err), { cause: err });
      if (lastError.kind === 'aborted' || lastError.kind === 'timeout' || lastError.kind === 'network') break;
    }
  }
  throw lastError ?? new SourceError(id, 'Unbekannter Fehler');
}

// ---------- aWATTar ----------

/**
 * GET https://api.awattar.de/v1/marketdata?start={ms}&end={ms}
 * Antwort: { object:'list', data:[{ start_timestamp, end_timestamp, marketprice, unit:'Eur/MWh' }], url }
 */
export async function fetchAwattar({ now, fetchImpl, timeoutMs, signal, apiBase = SOURCE_META.awattar.apiBase } = {}) {
  const id = 'awattar';
  const { from, to } = requestRange(now);
  const url = `${apiBase}/v1/marketdata?start=${from}&end=${to}`;
  const json = await getJson(url, { fetchImpl, timeoutMs, signal, sourceId: id });
  if (!json || !Array.isArray(json.data)) throw new SourceError(id, 'Unerwartetes Antwortformat (data fehlt)', { kind: 'format' });
  const raw = [];
  for (const e of json.data) {
    if (!e || !Number.isFinite(Number(e.start_timestamp)) || !Number.isFinite(Number(e.end_timestamp))) continue;
    if (e.marketprice === null || e.marketprice === undefined || !Number.isFinite(Number(e.marketprice))) continue;
    if (e.unit !== undefined) assertUnitEurPerMwh(e.unit, id);
    raw.push({ start: Number(e.start_timestamp), end: Number(e.end_timestamp), price: Number(e.marketprice) });
  }
  return buildSeries(id, raw, { now });
}

// ---------- Snapshot (data/prices.json, von scripts/fetch-snapshot.js erzeugt) ----------

export const SNAPSHOT_FORMAT = 'laderick-snapshot/1';

export async function fetchSnapshot({ now, fetchImpl, timeoutMs, signal, url = 'data/prices.json' } = {}) {
  const id = 'snapshot';
  const json = await getJson(url, { fetchImpl, timeoutMs, signal, sourceId: id });
  if (!json || json.format !== SNAPSHOT_FORMAT || !Array.isArray(json.points)) {
    throw new SourceError(id, 'Snapshot hat ein unbekanntes Format', { kind: 'format' });
  }
  const generatedAt = Number(json.generatedAt);
  const series = buildSeries(id, json.points, { now, fetchedAt: Number.isFinite(generatedAt) ? generatedAt : now, resolutionMinutes: json.resolutionMinutes });
  series.stale = Number.isFinite(generatedAt) ? now - generatedAt > config.snapshotStaleHours * HOUR : true;
  const orig = json.source && typeof json.source === 'object' ? json.source : null;
  series.snapshotOf = orig && SOURCE_META[orig.id]
    ? (({ apiBase, ...meta }) => meta)(SOURCE_META[orig.id])
    : orig ? { id: String(orig.id ?? '?'), name: String(orig.name ?? '?'), url: String(orig.url ?? ''), licence: String(orig.licence ?? ''), attribution: String(orig.attribution ?? ''), operator: String(orig.operator ?? '') } : null;
  return series;
}

export const ADAPTERS = Object.freeze({
  'energy-charts': fetchEnergyCharts,
  smard: fetchSmard,
  awattar: fetchAwattar,
  snapshot: fetchSnapshot,
});

/**
 * Prüft, ob eine Reihe genug Daten im Analysezeitraum [now − lookback, floor(now)) enthält.
 * @returns {{ ok:boolean, coveredHours:number }}
 */
export function acceptSeries(series, { now, lookbackHours = config.lookbackHours, minAcceptedHours = config.minAcceptedHours } = {}) {
  const rangeEnd = floorToResolution(now, series.resolutionMinutes);
  const rangeStart = rangeEnd - lookbackHours * HOUR;
  const st = weightedStats(series.points, rangeStart, rangeEnd);
  const coveredHours = st.coveredMs / HOUR;
  return { ok: coveredHours + 1e-9 >= minAcceptedHours, coveredHours };
}

/**
 * Fallback-Kette: probiert die Quellen in `order`, bis eine erreichbar ist und genug Daten liefert.
 * Wirft nie; bei Totalausfall ist `series` null und `attempts` beschreibt jeden Versuch.
 * @param {{ now:number, fetchImpl?:typeof fetch, order?:string[], timeoutMs?:number, signal?:AbortSignal,
 *           adapters?:Record<string,Function>, onAttempt?:(a:object)=>void, minAcceptedHours?:number, snapshotUrl?:string }} opts
 * @returns {Promise<{ series: PriceSeries|null, attempts: Array<{ id:string, ok:boolean, ms:number, error?:string, kind?:string, coveredHours?:number }> }>}
 */
export async function fetchPrices({ now = Date.now(), fetchImpl, order = config.sourceOrder, timeoutMs, signal, adapters = ADAPTERS, onAttempt, minAcceptedHours, snapshotUrl } = {}) {
  const attempts = [];
  for (const id of order) {
    const adapter = adapters[id];
    if (!adapter) { attempts.push({ id, ok: false, ms: 0, error: 'Unbekannte Quelle', kind: 'config' }); continue; }
    const t0 = Date.now();
    try {
      const series = await adapter({ now, fetchImpl, timeoutMs, signal, ...(id === 'snapshot' && snapshotUrl ? { url: snapshotUrl } : {}) });
      const { ok, coveredHours } = acceptSeries(series, { now, minAcceptedHours: id === 'snapshot' ? Math.min(minAcceptedHours ?? config.minAcceptedHours, 4) : minAcceptedHours });
      const attempt = { id, ok, ms: Date.now() - t0, coveredHours };
      if (!ok) { attempt.error = `Zu wenig Daten im Analysezeitraum (${coveredHours.toFixed(1)} h)`; attempt.kind = 'insufficient'; }
      attempts.push(attempt);
      onAttempt?.(attempt);
      if (ok) return { series, attempts };
    } catch (err) {
      const attempt = { id, ok: false, ms: Date.now() - t0, error: String(err?.message ?? err), kind: err?.kind ?? 'unknown' };
      attempts.push(attempt);
      onAttempt?.(attempt);
      if (attempt.kind === 'aborted') break;
    }
  }
  return { series: null, attempts };
}
