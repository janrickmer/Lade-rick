import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchEnergyCharts, fetchSmard, fetchAwattar, fetchSnapshot, fetchPrices, getJson, SourceError, acceptSeries, pointsFromStarts,
} from '../../src/sources.js';
import { HOUR, MINUTE } from '../../src/analysis.js';
import { buildFixtureSet, REFERENCE_NOW, toEnergyCharts } from '../fixtures/generate.js';

const NOW = REFERENCE_NOW;
const set = buildFixtureSet({ now: NOW });

/** Einfacher fetch-Ersatz: routes = [{ match:(url)=>bool, status?, json?, body?, delayMs?, throws? }] */
function makeFetch(routes, log = []) {
  return async (url, init = {}) => {
    log.push(url);
    const route = routes.find((r) => r.match(url));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    if (route.throws) throw route.throws;
    if (init.signal?.aborted) throw new Error('aborted');
    if (route.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, route.delayMs);
        init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
      });
    }
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (route.body !== undefined) return JSON.parse(route.body);
        return route.json;
      },
    };
  };
}

const smardRoutes = (files = set.smardFiles, index = set.smardIndex, resolution = 'quarterhour') => [
  { match: (u) => u.endsWith(`/4169/DE/index_${resolution}.json`), json: index },
  ...Object.entries(files).map(([ts, file]) => ({ match: (u) => u.endsWith(`/4169_DE_${resolution}_${ts}.json`), json: file })),
];

// ---------- Energy-Charts ----------

test('Energy-Charts: Antwort wird korrekt in Punkte umgesetzt, URL nutzt Berliner Kalendertage', async () => {
  const log = [];
  const fetchImpl = makeFetch([{ match: (u) => u.includes('/price?'), json: set.energyCharts }], log);
  const series = await fetchEnergyCharts({ now: NOW, fetchImpl });
  assert.equal(series.points.length, set.points.length);
  assert.equal(series.resolutionMinutes, 15);
  assert.deepEqual(series.points[0], set.points[0]);
  assert.deepEqual(series.points.at(-1), set.points.at(-1));
  assert.equal(series.source.id, 'energy-charts');
  assert.match(series.source.licenceInfo, /CC BY 4\.0/);
  assert.equal(series.fetchedAt, NOW);
  assert.match(log[0], /^https:\/\/api\.energy-charts\.info\/price\?bzn=DE-LU&start=2026-09-24&end=2026-09-30$/);
});

test('Energy-Charts: Einheit „EUR / MWh“ wird akzeptiert, andere Einheiten nicht', async () => {
  const ok = { ...set.energyCharts, unit: 'EUR / MWh' };
  const series = await fetchEnergyCharts({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: ok }]) });
  assert.equal(series.points.length, set.points.length);
  const bad = { ...set.energyCharts, unit: 'ct/kWh' };
  await assert.rejects(fetchEnergyCharts({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: bad }]) }), (e) => e instanceof SourceError && e.kind === 'format');
});

test('Energy-Charts (T11): fehlende Viertelstunde wird nicht aufgefüllt, null-Preise werden übersprungen', async () => {
  const T0 = Date.parse('2026-09-27T00:00:00Z');
  const starts = Array.from({ length: 24 }, (_, i) => T0 + i * 15 * MINUTE).filter((s) => s !== T0 + 2 * HOUR);
  const json = { license_info: 'CC BY 4.0', unix_seconds: starts.map((s) => s / 1000), price: starts.map(() => 50), unit: 'EUR/MWh', deprecated: true };
  json.price[5] = null;
  const series = await fetchEnergyCharts({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json }]) });
  assert.equal(series.points.length, 22);
  const p0145 = series.points.find((p) => p.start === T0 + HOUR + 45 * MINUTE);
  assert.equal(p0145.end, T0 + 2 * HOUR);
  assert.equal(series.points.at(-1).end, T0 + 6 * HOUR);
  assert.equal(series.points.reduce((acc, p) => acc + (p.end - p.start), 0), 22 * 15 * MINUTE);
  assert.equal(series.resolutionMinutes, 15);
  assert.equal(series.deprecated, true);
});

test('Energy-Charts: kaputtes Format und leere Antwort', async () => {
  await assert.rejects(fetchEnergyCharts({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: { foo: 1 } }]) }), (e) => e.kind === 'format');
  await assert.rejects(fetchEnergyCharts({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: { unix_seconds: [], price: [], unit: 'EUR/MWh' } }]) }), (e) => e.kind === 'empty');
  await assert.rejects(fetchEnergyCharts({ now: NOW, fetchImpl: makeFetch([{ match: () => true, body: '<html>' }]) }), (e) => e.kind === 'format');
});

test('pointsFromStarts: Auflösung aus Differenzen, Lücken bleiben Lücken', () => {
  const T0 = 0;
  const pts = pointsFromStarts([T0, T0 + HOUR, T0 + 3 * HOUR], [1, 2, 3]);
  assert.deepEqual(pts, [
    { start: 0, end: HOUR, price: 1 },
    { start: HOUR, end: 2 * HOUR, price: 2 },
    { start: 3 * HOUR, end: 4 * HOUR, price: 3 },
  ]);
});

// ---------- SMARD ----------

test('SMARD: Index + Wochendateien, null-Werte werden verworfen', async () => {
  const log = [];
  const series = await fetchSmard({ now: NOW, fetchImpl: makeFetch(smardRoutes(), log) });
  assert.equal(series.source.id, 'smard');
  assert.equal(series.resolutionMinutes, 15);
  assert.equal(series.points.length, set.points.length);
  assert.deepEqual(series.points[0], set.points[0]);
  assert.deepEqual(series.points.at(-1), set.points.at(-1));
  assert.ok(log[0].endsWith('/app/chart_data/4169/DE/index_quarterhour.json'));
  assert.equal(log.length, 1 + set.smardIndex.timestamps.length);
});

test('SMARD: fällt auf Stundenauflösung zurück, wenn Viertelstunden im Zielbereich fehlen', async () => {
  const emptyQuarter = Object.fromEntries(Object.entries(set.smardFiles).map(([ts, f]) => [ts, { ...f, series: f.series.map(([t]) => [t, null]) }]));
  const hourlySet = buildFixtureSet({ now: NOW, resolutionMinutes: 60 });
  const routes = [...smardRoutes(emptyQuarter), ...smardRoutes(hourlySet.smardFiles, hourlySet.smardIndex, 'hour')];
  const log = [];
  const series = await fetchSmard({ now: NOW, fetchImpl: makeFetch(routes, log) });
  assert.equal(series.resolutionMinutes, 60);
  assert.equal(series.points.length, hourlySet.points.length);
  assert.ok(log.some((u) => u.endsWith('/index_hour.json')));
});

test('SMARD: HTTP-Fehler beim Index, Netzwerkfehler bricht ohne Stundenversuch ab', async () => {
  await assert.rejects(fetchSmard({ now: NOW, fetchImpl: makeFetch([{ match: () => true, status: 500 }]) }), (e) => e.kind === 'http');
  const log = [];
  await assert.rejects(fetchSmard({ now: NOW, fetchImpl: makeFetch([{ match: () => true, throws: new TypeError('Failed to fetch') }], log) }), (e) => e.kind === 'network');
  assert.equal(log.length, 1);
});

test('SMARD: nur die Wochendateien im Zielbereich werden geladen (max. 3)', async () => {
  const weekStarts = set.smardIndex.timestamps;
  const olderIndex = { timestamps: [weekStarts[0] - 3 * 7 * 24 * HOUR, weekStarts[0] - 2 * 7 * 24 * HOUR, weekStarts[0] - 7 * 24 * HOUR, ...weekStarts] };
  const log = [];
  const series = await fetchSmard({ now: NOW, fetchImpl: makeFetch(smardRoutes(set.smardFiles, olderIndex), log) });
  assert.equal(series.points.length, set.points.length);
  assert.ok(log.length <= 4);
});

test('SMARD: fehlende neueste Wochendatei (404) wird übersprungen, ältere Datei wird genutzt', async () => {
  const [oldTs, newTs] = set.smardIndex.timestamps;
  const routes = [
    { match: (u) => u.endsWith('/index_quarterhour.json'), json: set.smardIndex },
    { match: (u) => u.endsWith(`/4169_DE_quarterhour_${oldTs}.json`), json: set.smardFiles[oldTs] },
    { match: (u) => u.endsWith(`/4169_DE_quarterhour_${newTs}.json`), status: 404 },
  ];
  const series = await fetchSmard({ now: NOW, fetchImpl: makeFetch(routes) });
  assert.equal(series.resolutionMinutes, 15);
  assert.ok(series.points.length > 0 && series.points.length < set.points.length);
  // alle Dateien 404 → Fehler (und Fallback auf hour wird versucht)
  const log = [];
  await assert.rejects(fetchSmard({ now: NOW, fetchImpl: makeFetch([{ match: (u) => u.includes('index_'), json: set.smardIndex }, { match: () => true, status: 404 }], log) }), (e) => e.kind === 'http');
  assert.ok(log.some((u) => u.includes('index_hour.json')));
});

// ---------- aWATTar ----------

test('aWATTar: Antwort wird umgesetzt, Zeitfenster als Millisekunden in der URL', async () => {
  const log = [];
  const series = await fetchAwattar({ now: NOW, fetchImpl: makeFetch([{ match: (u) => u.includes('/v1/marketdata'), json: set.awattar }], log) });
  assert.equal(series.source.id, 'awattar');
  assert.equal(series.points.length, set.points.length);
  assert.deepEqual(series.points[10], set.points[10]);
  const url = new URL(log[0]);
  assert.equal(url.origin, 'https://api.awattar.de');
  assert.equal(Number(url.searchParams.get('start')), NOW - 4 * 24 * HOUR);
  assert.equal(Number(url.searchParams.get('end')), NOW + 2 * 24 * HOUR);
});

test('aWATTar: falsche Einheit wird abgelehnt', async () => {
  const bad = { ...set.awattar, data: set.awattar.data.map((d) => ({ ...d, unit: 'ct/kWh' })) };
  await assert.rejects(fetchAwattar({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: bad }]) }), (e) => e.kind === 'format');
});

// ---------- Snapshot ----------

test('Snapshot: Format, Originalquelle und Veraltet-Markierung', async () => {
  const fresh = await fetchSnapshot({ now: NOW, fetchImpl: makeFetch([{ match: (u) => u === 'data/prices.json', json: set.snapshot }]) });
  assert.equal(fresh.source.id, 'snapshot');
  assert.equal(fresh.snapshotOf.id, 'energy-charts');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.fetchedAt, set.snapshot.generatedAt);
  const old = { ...set.snapshot, generatedAt: NOW - 10 * HOUR };
  const stale = await fetchSnapshot({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: old }]) });
  assert.equal(stale.stale, true);
  await assert.rejects(fetchSnapshot({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: { format: 'other' } }]) }), (e) => e.kind === 'format');
});

// ---------- getJson ----------

test('getJson: Timeout, 429, ungültiges JSON', async () => {
  await assert.rejects(getJson('https://x/slow', { fetchImpl: makeFetch([{ match: () => true, delayMs: 200, json: {} }]), timeoutMs: 20, sourceId: 's' }), (e) => e.kind === 'timeout');
  await assert.rejects(getJson('https://x/limit', { fetchImpl: makeFetch([{ match: () => true, status: 429 }]), sourceId: 's' }), (e) => e.kind === 'ratelimit' && e.status === 429);
  await assert.rejects(getJson('https://x/bad', { fetchImpl: makeFetch([{ match: () => true, body: '{' }]), sourceId: 's' }), (e) => e.kind === 'format');
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(getJson('https://x/abort', { fetchImpl: makeFetch([{ match: () => true, delayMs: 50, json: {} }]), signal: ctrl.signal, sourceId: 's' }), (e) => e.kind === 'aborted');
});

// ---------- Fallback-Kette ----------

test('acceptSeries: mindestens 24 h Daten im Analysezeitraum', () => {
  const full = { points: set.points, resolutionMinutes: 15 };
  assert.equal(acceptSeries(full, { now: NOW }).ok, true);
  const short = { points: set.points.filter((p) => p.start >= NOW - 10 * HOUR), resolutionMinutes: 15 };
  const r = acceptSeries(short, { now: NOW });
  assert.equal(r.ok, false);
  assert.ok(Math.abs(r.coveredHours - 10) < 1e-9);
});

test('fetchPrices: Primärquelle scheitert (CORS) → zweite Quelle liefert, Versuche werden protokolliert', async () => {
  const routes = [
    { match: (u) => u.includes('smard.de'), throws: new TypeError('Failed to fetch') },
    { match: (u) => u.includes('energy-charts'), json: set.energyCharts },
  ];
  const seen = [];
  const { series, attempts } = await fetchPrices({ now: NOW, fetchImpl: makeFetch(routes), onAttempt: (a) => seen.push(a.id) });
  assert.equal(series.source.id, 'energy-charts');
  assert.deepEqual(attempts.map((a) => [a.id, a.ok]), [['smard', false], ['energy-charts', true]]);
  assert.equal(attempts[0].kind, 'network');
  assert.match(attempts[0].error, /CORS/);
  assert.deepEqual(seen, ['smard', 'energy-charts']);
});

test('fetchPrices: zu wenig Daten → nächste Quelle', async () => {
  const shortEc = toEnergyCharts(set.points.filter((p) => p.start >= NOW - 10 * HOUR));
  const routes = [
    { match: (u) => u.includes('energy-charts'), json: shortEc },
    { match: (u) => u.includes('awattar'), json: set.awattar },
  ];
  const { series, attempts } = await fetchPrices({ now: NOW, fetchImpl: makeFetch(routes), order: ['energy-charts', 'awattar'] });
  assert.equal(series.source.id, 'awattar');
  assert.equal(attempts[0].kind, 'insufficient');
  assert.match(attempts[0].error, /Zu wenig Daten/);
});

test('fetchPrices: alle Quellen scheitern → Snapshot; ohne Snapshot series = null', async () => {
  const failing = [{ match: (u) => !u.startsWith('data/'), status: 503 }, { match: (u) => u.startsWith('data/'), json: set.snapshot }];
  const { series, attempts } = await fetchPrices({ now: NOW, fetchImpl: makeFetch(failing) });
  assert.equal(series.source.id, 'snapshot');
  assert.equal(attempts.length, 4);
  assert.equal(attempts.filter((a) => a.ok).length, 1);
  const none = await fetchPrices({ now: NOW, fetchImpl: makeFetch([{ match: () => true, status: 503 }]) });
  assert.equal(none.series, null);
  assert.equal(none.attempts.length, 4);
  assert.ok(none.attempts.every((a) => !a.ok && a.error));
});

test('fetchPrices: Snapshot wird schon mit 4 h Daten akzeptiert, 429 wird als Anfragelimit protokolliert', async () => {
  const tiny = { ...set.snapshot, points: set.points.filter((p) => p.start >= NOW - 5 * HOUR && p.start < NOW) };
  const routes = [{ match: (u) => u.includes('energy-charts'), status: 429 }, { match: (u) => u.startsWith('data/'), json: tiny }];
  const { series, attempts } = await fetchPrices({ now: NOW, fetchImpl: makeFetch(routes), order: ['energy-charts', 'snapshot'] });
  assert.equal(series.source.id, 'snapshot');
  assert.equal(attempts[0].kind, 'ratelimit');
});

test('fetchPrices: erzwungene Reihenfolge und unbekannte Quelle', async () => {
  const { series, attempts } = await fetchPrices({ now: NOW, fetchImpl: makeFetch([{ match: () => true, json: set.awattar }]), order: ['nope', 'awattar'] });
  assert.equal(series.source.id, 'awattar');
  assert.equal(attempts[0].kind, 'config');
});
