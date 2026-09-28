// Deterministischer Fixture-Generator für die drei Quell-APIs und den Snapshot.
// Erzeugt eine synthetische, aber realistische Day-Ahead-Preiskurve (EUR/MWh) im
// 15-Minuten-Raster und formatiert sie exakt so, wie die jeweiligen APIs antworten.
//
// Aufruf als Skript:  node tests/fixtures/generate.js   → schreibt tests/fixtures/*.json
// Import in Tests:    import { buildFixtureSet, REFERENCE_NOW } from './generate.js'

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Referenz-"Jetzt" für alle Fixtures: Montag, 28.09.2026 14:00 Uhr MESZ (12:00 UTC).
 *  Um 14:00 Uhr sind die Day-Ahead-Preise für den Folgetag bereits veröffentlicht. */
export const REFERENCE_NOW = Date.parse('2026-09-28T12:00:00Z');

/** Stunde (mit Bruchteil) in Europe/Berlin für einen Epoch-ms-Zeitstempel. */
export function berlinHour(ts) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h + m / 60;
}

/** Tagesindex (Anzahl Tage seit REFERENCE_NOW-Mitternacht UTC, gerundet) – nur für die Variation. */
function dayIndex(ts) {
  return Math.floor((ts - REFERENCE_NOW) / (24 * HOUR));
}

/**
 * Synthetische Preiskurve in EUR/MWh: Nacht günstig, Morgenrampe, Mittagsdelle (Solar, teils negativ),
 * Abendspitze. Rein deterministisch (keine Zufallszahlen), damit Tests reproduzierbar sind.
 */
export function syntheticPrice(ts) {
  const h = berlinHour(ts);
  const d = dayIndex(ts);
  const night = 70;
  const morning = 55 * Math.exp(-((h - 8) ** 2) / 2.5);
  const solar = -75 * Math.exp(-((h - 13) ** 2) / 4.5);
  const evening = 110 * Math.exp(-((h - 19) ** 2) / 3);
  const dayShift = 8 * Math.sin(d * 1.7);
  const ripple = 3 * Math.sin(h * 2.3 + d);
  return Math.round((night + morning + solar + evening + dayShift + ripple) * 100) / 100;
}

/**
 * Preisreihe im gewünschten Raster.
 * @param {{ from:number, to:number, resolutionMinutes?:number, price?:(ts:number)=>number }} opts
 * @returns {Array<{start:number,end:number,price:number}>}
 */
export function generatePoints({ from, to, resolutionMinutes = 15, price = syntheticPrice }) {
  const step = resolutionMinutes * MINUTE;
  const start0 = Math.ceil(from / step) * step;
  const points = [];
  for (let s = start0; s + step <= to; s += step) {
    points.push({ start: s, end: s + step, price: price(s) });
  }
  return points;
}

/** Beginn eines Berlin-Kalendertags (00:00 Europe/Berlin) als Epoch-ms für den Tag, der ts enthält. */
export function berlinMidnight(ts) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
  const ymd = fmt.format(new Date(ts)); // YYYY-MM-DD
  // Mitternacht Berlin finden: UTC-Mitternacht des Datums, dann Offset korrigieren.
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  for (const offsetH of [1, 2, 0]) {
    const cand = utcMidnight - offsetH * HOUR;
    if (fmt.format(new Date(cand)) === ymd && berlinHour(cand) === 0) return cand;
  }
  throw new Error('Mitternacht nicht bestimmbar für ' + ymd);
}

/** Bis wann Day-Ahead-Preise „bekannt“ sind: nach 13:00 Berlin bis Ende des Folgetags, sonst bis Tagesende. */
export function knownUntil(now) {
  const todayMidnight = berlinMidnight(now);
  const tomorrowMidnight = berlinMidnight(todayMidnight + 26 * HOUR);
  if (berlinHour(now) >= 13) return berlinMidnight(tomorrowMidnight + 26 * HOUR);
  return tomorrowMidnight;
}

// ---------- API-Formate ----------

/** Energy-Charts: GET /price?bzn=DE-LU&start=…&end=… */
export function toEnergyCharts(points) {
  return {
    license_info: 'CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de',
    unix_seconds: points.map((p) => Math.floor(p.start / 1000)),
    price: points.map((p) => p.price),
    unit: 'EUR/MWh',
    deprecated: false,
  };
}

/** aWATTar: GET /v1/marketdata?start=…&end=… */
export function toAwattar(points) {
  return {
    object: 'list',
    data: points.map((p) => ({
      start_timestamp: p.start,
      end_timestamp: p.end,
      marketprice: p.price,
      unit: 'Eur/MWh',
    })),
    url: '/de/v1/marketdata',
  };
}

/** SMARD: Wochendateien. timestamps = Montag 00:00 Europe/Berlin (ms) jeder Woche. */
export function smardWeekStarts(from, to) {
  // Montag der Woche von `from` finden
  let d = berlinMidnight(from);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(new Date(d));
  const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  d = berlinMidnight(d - idx * 24 * HOUR + 2 * HOUR);
  const starts = [];
  while (d < to) {
    starts.push(d);
    d = berlinMidnight(d + 7 * 24 * HOUR + 2 * HOUR);
  }
  return starts;
}

export function toSmardIndex(weekStarts) {
  return { timestamps: weekStarts };
}

/**
 * SMARD-Datendatei für eine Woche: alle Raster-Slots der Woche; Slots ohne bekannten Preis = null.
 * @param {Array<{start:number,end:number,price:number}>} points bekannte Punkte (beliebiger Bereich)
 */
export function toSmardFile(points, weekStart, resolutionMinutes = 15, filter = 4169, region = 'DE') {
  const step = resolutionMinutes * MINUTE;
  const weekEnd = berlinMidnight(weekStart + 7 * 24 * HOUR + 2 * HOUR);
  const byStart = new Map(points.map((p) => [p.start, p.price]));
  const series = [];
  for (let s = weekStart; s < weekEnd; s += step) {
    series.push([s, byStart.has(s) ? byStart.get(s) : null]);
  }
  return {
    meta_data: {
      version: 1,
      created: weekStart,
      filter,
      region,
      resolution: resolutionMinutes === 15 ? 'quarterhour' : 'hour',
    },
    series,
  };
}

/** Snapshot-Format (data/prices.json), siehe src/sources.js. */
export function toSnapshot(points, { generatedAt, sourceId = 'energy-charts', resolutionMinutes = 15 } = {}) {
  return {
    format: 'laderick-snapshot/1',
    generatedAt,
    bzn: 'DE-LU',
    resolutionMinutes,
    unit: 'EUR/MWh',
    source: {
      id: sourceId,
      name: 'Energy-Charts (Fraunhofer ISE)',
      url: 'https://www.energy-charts.info/',
      licence: 'CC BY 4.0',
    },
    points,
  };
}

/**
 * Kompletter Fixture-Satz um ein Referenz-"Jetzt" herum.
 * @param {{ now?:number, resolutionMinutes?:number, price?:(ts:number)=>number, daysBack?:number }} opts
 */
export function buildFixtureSet({ now = REFERENCE_NOW, resolutionMinutes = 15, price = syntheticPrice, daysBack = 3 } = {}) {
  const from = berlinMidnight(now - daysBack * 24 * HOUR);
  const to = knownUntil(now);
  const points = generatePoints({ from, to, resolutionMinutes, price });
  const weekStarts = smardWeekStarts(from, to);
  const smardFiles = Object.fromEntries(weekStarts.map((ws) => [ws, toSmardFile(points, ws, resolutionMinutes)]));
  return {
    now,
    resolutionMinutes,
    points,
    energyCharts: toEnergyCharts(points),
    awattar: toAwattar(points),
    smardIndex: toSmardIndex(weekStarts),
    smardFiles,
    snapshot: toSnapshot(points, { generatedAt: now - 20 * MINUTE, resolutionMinutes }),
  };
}

/** Variante mit einem klar „gepflanzten“ Optimum: am Referenztag (28.09.2026) kostet 02:00–06:00 Uhr Berlin nur 1 EUR/MWh. */
export function plantedPrice(ts) {
  const h = berlinHour(ts);
  const d = dayIndex(ts);
  if (d === -1 && h >= 2 && h < 6) return 1;
  return Math.max(syntheticPrice(ts), 5);
}

// ---------- Skript-Modus ----------
const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const set = buildFixtureSet();
  const files = {
    'energy-charts.json': set.energyCharts,
    'awattar.json': set.awattar,
    'smard-index-quarterhour.json': set.smardIndex,
    'snapshot.json': set.snapshot,
  };
  for (const [ws, file] of Object.entries(set.smardFiles)) files[`smard-4169-DE-quarterhour-${ws}.json`] = file;
  await Promise.all(Object.entries(files).map(([name, data]) => writeFile(join(here, name), JSON.stringify(data) + '\n')));
  console.log(`Fixtures geschrieben (${Object.keys(files).length} Dateien, ${set.points.length} Punkte, now=${new Date(set.now).toISOString()})`);
}
