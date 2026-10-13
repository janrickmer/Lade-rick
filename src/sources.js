// Datenquellen-Adapter für den Day-Ahead-Börsenstrompreis (EPEX SPOT, Gebotszone DE-LU).
// Läuft im Browser und in Node (≥ 20). Keine DOM-Zugriffe. Jeder Adapter liefert eine
// normalisierte PriceSeries (siehe unten) oder wirft einen SourceError.

import { config } from './config.js';
import { HOUR, MINUTE, detectResolutionMinutes, floorToResolution, normalizePoints, weightedStats } from './analysis.js';
import { berlinDayStart, berlinDayStartOffset, berlinOffsetMinutes } from './format.js';

/** @typedef {import('./analysis.js').PricePoint} PricePoint */
/** @typedef {{
 *   points: PricePoint[],
 *   resolutionMinutes: number,
 *   source: { id:string, name:string, url:string, licence:string, attribution:string, operator:string },
 *   fetchedAt: number,
 *   stale?: boolean,
 *   snapshotOf?: { id:string, name:string, url:string, licence:string, attribution:string, operator:string } | null,
 *   supplements?: Array<{ source:{ id:string, name:string, url:string, licence:string, attribution:string, operator:string },
 *                          from:number, until:number, resolutionMinutes:number, fetchedAt:number }>
 * }} PriceSeries
 * `supplements`: künftige Preise, die an die Daten der gewählten Quelle angehängt wurden, weil diese sie noch nicht hatte. */

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
      // cache: 'no-cache' – der Browser darf eine gespeicherte Antwort nur nach Rückfrage beim Server verwenden. SMARD.de sendet
      // keine Cache-Dauer, nur Last-Modified; ohne diese Option dürfte der Browser eine alte Datei heuristisch stundenlang
      // wiederverwenden und neu veröffentlichte Preise übersehen.
      response = await fetchImpl(url, { signal: controller.signal, cache: 'no-cache', headers: { Accept: 'application/json', ...(headers ?? {}) } });
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
  const supplements = Array.isArray(json.supplements) ? json.supplements.map(sanitizeSupplement).filter(Boolean) : [];
  if (supplements.length) series.supplements = supplements;
  return series;
}

/** Ergänzungs-Eintrag aus einem Snapshot prüfen; Quellenangaben nur aus SOURCE_META (keine Fremdtexte übernehmen). */
function sanitizeSupplement(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const meta = SOURCE_META[entry.source?.id];
  const from = Number(entry.from);
  const until = Number(entry.until);
  if (!meta || meta.id === 'snapshot' || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) return null;
  const { apiBase, ...source } = meta;
  const res = Number(entry.resolutionMinutes);
  const fetchedAt = Number(entry.fetchedAt);
  return { source, from, until, resolutionMinutes: Number.isFinite(res) && res > 0 ? res : 60, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : until };
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

// ---------- Ergänzen fehlender Preise aus weiteren Quellen ----------

/** Ende des letzten Punkts einer Reihe (−∞ ohne Punkte). */
export function seriesEnd(series) {
  const pts = series?.points;
  return pts?.length ? pts[pts.length - 1].end : -Infinity;
}

/**
 * Zeitpunkt, ab dem an diesem Berliner Kalendertag die Folgetagspreise erwartet werden (Standard 12:55 Uhr) –
 * korrekt auch an Tagen mit Zeitumstellung.
 */
export function nextDayPublicationTime(now, at = config.nextDayExpectedAt) {
  const dayStart = berlinDayStart(now);
  const naive = dayStart + (at.hour * 60 + at.minute) * MINUTE;
  return naive - (berlinOffsetMinutes(naive) - berlinOffsetMinutes(dayStart)) * MINUTE;
}

/**
 * Bis wann Preise zu diesem Zeitpunkt veröffentlicht sein sollten: ab der Veröffentlichungszeit bis Ende morgen,
 * davor bis Ende heute (jeweils 24:00 Uhr Europe/Berlin).
 */
export function expectedCoverageEnd(now, at = config.nextDayExpectedAt) {
  return berlinDayStartOffset(now, now >= nextDayPublicationTime(now, at) ? 2 : 1);
}

/**
 * Lücken von mindestens `minGapMs` in der Abdeckung [from, to) einer sortierten, überlappungsfreien Punktliste
 * (to darf Infinity sein: dann zählt alles nach dem letzten Punkt als Lücke).
 * @returns {Array<[number, number]>}
 */
export function coverageGaps(points, from, to, { minGapMs = HOUR } = {}) {
  const gaps = [];
  let cursor = from;
  for (const p of points) {
    if (cursor >= to || p.start >= to) break;
    if (p.end <= cursor) continue;
    if (p.start > cursor) gaps.push([cursor, p.start]);
    cursor = p.end;
  }
  if (cursor < to) gaps.push([cursor, to]);
  return gaps.filter(([a, b]) => b - a >= minGapMs);
}

/**
 * Zeitraum, für den zu diesem Zeitpunkt lückenlos Preise vorliegen sollten: vom Beginn des Analysezeitraums
 * (72 h zurück) bis zum Ende der erwartungsgemäß veröffentlichten Preise (siehe expectedCoverageEnd).
 */
export function expectedRange(now, cfg = config) {
  return { from: floorToResolution(now - cfg.lookbackHours * HOUR, 60), to: expectedCoverageEnd(now, cfg.nextDayExpectedAt) };
}

/**
 * Füllt Lücken der Reihe (≥ 1 h, auch nach ihrem Ende) mit Punkten einer zweiten Quelle, die vollständig in eine
 * Lücke passen. Vorhandene Werte werden nie ersetzt oder gemischt. Jeder zusammenhängende ergänzte Zeitraum wird in
 * `supplements` vermerkt. null, wenn nichts hinzukäme.
 * @param {PriceSeries} primary @param {PriceSeries} extra
 * @param {{ from?:number, minGapMs?:number }} [opts] from: früheste zu füllende Zeit (Standard: Beginn der Reihe)
 * @returns {PriceSeries|null}
 */
export function mergeSupplement(primary, extra, { from = primary.points[0]?.start ?? -Infinity, minGapMs = HOUR } = {}) {
  const gaps = coverageGaps(primary.points, from, Infinity, { minGapMs });
  const added = extra.points.filter((p) => gaps.some(([a, b]) => p.start >= a && p.end <= b));
  if (!added.length) return null;
  const ranges = [];
  for (const p of added) {
    const last = ranges[ranges.length - 1];
    if (last && p.start === last.until) { last.until = p.end; last.points.push(p); } else ranges.push({ from: p.start, until: p.end, points: [p] });
  }
  const entries = ranges.map((r) => ({
    source: extra.source, from: r.from, until: r.until, resolutionMinutes: detectResolutionMinutes(r.points), fetchedAt: extra.fetchedAt,
  }));
  const points = [...primary.points, ...added].sort((x, y) => x.start - y.start);
  return { ...primary, points, supplements: [...(primary.supplements ?? []), ...entries] };
}

/**
 * Nächster planmäßiger Abruf (Epoch-ms) nach einem Abruf zum Zeitpunkt `lastFetchAt`:
 * - fehlen Preise von heute oder (ab 12:55 Uhr) von morgen → nach `refreshMinutesAwaiting`,
 * - stammen Preise im Analysezeitraum nur aus einer ergänzenden Quelle → nach `refreshMinutesSupplemented`,
 * - sonst nach `refreshMinutes`, aber nicht später als zur erwarteten Veröffentlichung der Folgetagspreise.
 * @param {PriceSeries|null} series @param {number} lastFetchAt @param {number} now
 */
export function nextRefreshAt(series, lastFetchAt, now, cfg = config) {
  const points = series?.points ?? [];
  if (coverageGaps(points, berlinDayStart(now), expectedCoverageEnd(now, cfg.nextDayExpectedAt)).length) {
    return lastFetchAt + cfg.refreshMinutesAwaiting * MINUTE;
  }
  if (series?.supplements?.some((s) => s.until > now - cfg.lookbackHours * HOUR)) return lastFetchAt + cfg.refreshMinutesSupplemented * MINUTE;
  let next = lastFetchAt + cfg.refreshMinutes * MINUTE;
  const publication = nextDayPublicationTime(now, cfg.nextDayExpectedAt);
  if (seriesEnd(series) < berlinDayStartOffset(now, 2) && publication > lastFetchAt) next = Math.min(next, publication);
  return next;
}

/**
 * Fallback-Kette: probiert die Quellen in `order`, bis eine erreichbar ist und genug Daten liefert. Fehlen der gewählten
 * Quelle danach Preise, die schon veröffentlicht sein müssten (siehe expectedRange), werden die Lücken aus den Quellen in
 * `supplementOrder` gefüllt (Versuche mit role: 'supplement'). In diesem Lauf bereits gescheiterte Quellen werden dabei
 * nicht erneut abgefragt.
 * Wirft nie; bei Totalausfall ist `series` null und `attempts` beschreibt jeden Versuch.
 * @param {{ now:number, fetchImpl?:typeof fetch, order?:string[], supplementOrder?:string[], timeoutMs?:number, signal?:AbortSignal,
 *           adapters?:Record<string,Function>, onAttempt?:(a:object)=>void, minAcceptedHours?:number, snapshotUrl?:string }} opts
 * @returns {Promise<{ series: PriceSeries|null, attempts: Array<{ id:string, ok:boolean, ms:number, role?:'supplement', error?:string, kind?:string, coveredHours?:number, addedHours?:number }> }>}
 */
export async function fetchPrices({ now = Date.now(), fetchImpl, order = config.sourceOrder, supplementOrder = config.supplementOrder, timeoutMs, signal, adapters = ADAPTERS, onAttempt, minAcceptedHours, snapshotUrl } = {}) {
  const attempts = [];
  const fetched = new Map(); // in diesem Lauf geladene Reihen (auch abgelehnte), für das Ergänzen wiederverwendbar
  let series = null;
  for (const id of order) {
    const adapter = adapters[id];
    if (!adapter) { attempts.push({ id, ok: false, ms: 0, error: 'Unbekannte Quelle', kind: 'config' }); continue; }
    const t0 = Date.now();
    try {
      const candidate = await adapter({ now, fetchImpl, timeoutMs, signal, ...(id === 'snapshot' && snapshotUrl ? { url: snapshotUrl } : {}) });
      fetched.set(id, candidate);
      const { ok, coveredHours } = acceptSeries(candidate, { now, minAcceptedHours: id === 'snapshot' ? Math.min(minAcceptedHours ?? config.minAcceptedHours, 4) : minAcceptedHours });
      const attempt = { id, ok, ms: Date.now() - t0, coveredHours };
      if (!ok) { attempt.error = `Zu wenig Daten im Analysezeitraum (${coveredHours.toFixed(1)} h)`; attempt.kind = 'insufficient'; }
      attempts.push(attempt);
      onAttempt?.(attempt);
      if (ok) { series = candidate; break; }
    } catch (err) {
      const attempt = { id, ok: false, ms: Date.now() - t0, error: String(err?.message ?? err), kind: err?.kind ?? 'unknown' };
      attempts.push(attempt);
      onAttempt?.(attempt);
      if (attempt.kind === 'aborted') return { series: null, attempts };
    }
  }
  if (!series) return { series: null, attempts };

  // Fehlen Preise, die schon veröffentlicht sein müssten (Lücken ≥ 1 h im Analysezeitraum oder – ab 12:55 Uhr – die
  // Preise für morgen), aus weiteren Quellen ergänzen. Typisch: SMARD.de trägt die Folgetagspreise Stunden später nach.
  const range = expectedRange(now);
  const failed = new Set(attempts.filter((a) => !a.ok && a.kind !== 'insufficient').map((a) => a.id));
  for (const id of supplementOrder ?? []) {
    if (!coverageGaps(series.points, range.from, range.to).length) break;
    if (id === series.source.id || id === 'snapshot' || failed.has(id) || !adapters[id]) continue;
    const t0 = Date.now();
    let extra = fetched.get(id);
    try {
      if (!extra) extra = await adapters[id]({ now, fetchImpl, timeoutMs, signal });
    } catch (err) {
      const attempt = { id, role: 'supplement', ok: false, ms: Date.now() - t0, error: String(err?.message ?? err), kind: err?.kind ?? 'unknown' };
      attempts.push(attempt);
      onAttempt?.(attempt);
      if (attempt.kind === 'aborted') break;
      continue;
    }
    const merged = mergeSupplement(series, extra, { from: range.from });
    const attempt = { id, role: 'supplement', ok: Boolean(merged), ms: Date.now() - t0 };
    if (merged) {
      const before = series.supplements?.length ?? 0;
      attempt.addedHours = merged.supplements.slice(before).reduce((sum, e) => sum + (e.until - e.from), 0) / HOUR;
      series = merged;
    } else {
      attempt.kind = 'no-new-data';
      attempt.error = 'Keine zusätzlichen Preise';
    }
    attempts.push(attempt);
    onAttempt?.(attempt);
  }
  return { series, attempts };
}
