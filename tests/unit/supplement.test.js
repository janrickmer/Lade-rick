// Ergänzen fehlender Preise aus weiteren Quellen, Erwartung der Folgetagspreise ab 12:55 Uhr, Abruftakt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPrices, fetchSnapshot, getJson, coverageGaps, mergeSupplement, nextDayPublicationTime, expectedCoverageEnd,
  expectedRange, nextRefreshAt, SNAPSHOT_FORMAT,
} from '../../src/sources.js';
import { aggregateToResolution, HOUR, MINUTE } from '../../src/analysis.js';
import { config } from '../../src/config.js';
import { buildFixtureSet, toSmardFile, toAwattar } from '../fixtures/generate.js';

const berlin = (iso) => Date.parse(iso); // ISO mit Offset, z. B. '2026-09-28T13:30:00+02:00'
const TODAY_START = berlin('2026-09-28T00:00:00+02:00');
const TODAY_END = berlin('2026-09-29T00:00:00+02:00');
const TOMORROW_END = berlin('2026-09-30T00:00:00+02:00');

function makeFetch(routes, log = []) {
  return async (url, init = {}) => {
    log.push({ url, init });
    const route = routes.find((r) => r.match(url));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const status = route.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => route.json };
  };
}

/** Fixtures um `now`; SMARD und aWATTar (Stundenmittel) lassen sich getrennt beschneiden. */
function sources(now, { smardKeep = () => true, awattarKeep = () => true, awattarStatus } = {}) {
  const set = buildFixtureSet({ now });
  const smardPoints = set.points.filter(smardKeep);
  const routes = [
    { match: (u) => u.endsWith('/4169/DE/index_quarterhour.json'), json: set.smardIndex },
    ...Object.keys(set.smardFiles).map((ws) => ({ match: (u) => u.endsWith(`/4169_DE_quarterhour_${ws}.json`), json: toSmardFile(smardPoints, Number(ws)) })),
    { match: (u) => u.includes('api.awattar.de'), ...(awattarStatus ? { status: awattarStatus } : { json: toAwattar(aggregateToResolution(set.points, 60).filter(awattarKeep)) }) },
  ];
  return { set, routes };
}

// ---------- Zeitpunkte ----------

test('Folgetagspreise werden ab 12:55 Uhr Berliner Zeit erwartet – auch an Tagen mit Zeitumstellung', () => {
  assert.equal(config.nextDayExpectedAt.hour, 12);
  assert.equal(config.nextDayExpectedAt.minute, 55);
  assert.equal(nextDayPublicationTime(berlin('2026-09-28T08:00:00+02:00')), berlin('2026-09-28T12:55:00+02:00'));
  // 25.10.2026: Umstellung auf MEZ um 03:00 → 12:55 MEZ = 11:55 UTC
  assert.equal(nextDayPublicationTime(berlin('2026-10-25T00:30:00+02:00')), Date.parse('2026-10-25T11:55:00Z'));
  // 29.03.2026: Umstellung auf MESZ um 02:00 → 12:55 MESZ = 10:55 UTC
  assert.equal(nextDayPublicationTime(berlin('2026-03-29T00:30:00+01:00')), Date.parse('2026-03-29T10:55:00Z'));
});

test('expectedCoverageEnd: vor 12:55 Uhr bis heute 24:00, ab 12:55 Uhr bis morgen 24:00', () => {
  assert.equal(expectedCoverageEnd(berlin('2026-09-28T12:54:59+02:00')), TODAY_END);
  assert.equal(expectedCoverageEnd(berlin('2026-09-28T12:55:00+02:00')), TOMORROW_END);
  assert.equal(expectedCoverageEnd(berlin('2026-09-28T23:59:00+02:00')), TOMORROW_END);
  assert.equal(expectedCoverageEnd(berlin('2026-09-29T00:01:00+02:00')), berlin('2026-09-30T00:00:00+02:00'));
  const r = expectedRange(berlin('2026-09-28T13:30:00+02:00'));
  assert.equal(r.to, TOMORROW_END);
  assert.equal(r.from, berlin('2026-09-25T13:00:00+02:00'));
});

// ---------- Lücken und Zusammenführen ----------

const pt = (startH, endH, price = 50, base = TODAY_START) => ({ start: base + startH * HOUR, end: base + endH * HOUR, price });

test('coverageGaps: Lücken ab 1 h, auch nach dem letzten Punkt; kleinere Lücken zählen nicht', () => {
  const pts = [pt(0, 1), pt(1, 2), pt(3, 4), pt(4.25, 5)];
  assert.deepEqual(coverageGaps(pts, TODAY_START, TODAY_START + 7 * HOUR), [[TODAY_START + 2 * HOUR, TODAY_START + 3 * HOUR], [TODAY_START + 5 * HOUR, TODAY_START + 7 * HOUR]]);
  assert.deepEqual(coverageGaps(pts, TODAY_START, Infinity).at(-1), [TODAY_START + 5 * HOUR, Infinity]);
  assert.deepEqual(coverageGaps([], 0, 2 * HOUR), [[0, 2 * HOUR]]);
  assert.deepEqual(coverageGaps(pts, TODAY_START, TODAY_START + 2 * HOUR), []);
});

test('mergeSupplement: hängt fehlende Stunden an und füllt Lücken, ersetzt aber nie vorhandene Werte', () => {
  const quarter = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    if (m >= 13 * 60 + 15 && m < 15 * 60) continue; // Lücke 13:15–15:00
    quarter.push({ start: TODAY_START + m * MINUTE, end: TODAY_START + (m + 15) * MINUTE, price: 100 });
  }
  const primary = { points: quarter, resolutionMinutes: 15, source: { id: 'smard' }, fetchedAt: 1 };
  const hourly = [];
  for (let h = 0; h < 48; h += 1) hourly.push(pt(h, h + 1, 7));
  const extra = { points: hourly, resolutionMinutes: 60, source: { id: 'awattar' }, fetchedAt: 2 };
  const merged = mergeSupplement(primary, extra);
  // 13:00–14:00 überlappt vorhandene Werte (13:00–13:15) → nicht übernommen; 14:00–15:00 passt in die Lücke
  assert.ok(!merged.points.some((p) => p.start === TODAY_START + 13 * HOUR && p.price === 7));
  assert.ok(merged.points.some((p) => p.start === TODAY_START + 14 * HOUR && p.end === TODAY_START + 15 * HOUR && p.price === 7));
  assert.equal(merged.points.filter((p) => p.price === 100).length, quarter.length, 'alle eigenen Werte bleiben');
  assert.deepEqual(merged.supplements.map((s) => [s.from, s.until, s.resolutionMinutes, s.source.id, s.fetchedAt]), [
    [TODAY_START + 14 * HOUR, TODAY_START + 15 * HOUR, 60, 'awattar', 2],
    [TODAY_END, TODAY_END + 24 * HOUR, 60, 'awattar', 2],
  ]);
  for (let i = 1; i < merged.points.length; i += 1) assert.ok(merged.points[i].start >= merged.points[i - 1].end, 'sortiert, überlappungsfrei');
  assert.equal(merged.resolutionMinutes, 15);
  // Vor dem Beginn der Reihe wird standardmäßig nichts ergänzt; nichts Neues → null
  assert.equal(mergeSupplement(merged, extra), null);
});

// ---------- fetchPrices ----------

test('fetchPrices: SMARD ohne Preise für morgen (13:30 Uhr) → Lücke wird aus aWATTar ergänzt und gekennzeichnet', async () => {
  const now = berlin('2026-09-28T13:30:00+02:00');
  const { routes } = sources(now, { smardKeep: (p) => p.end <= TODAY_END });
  const { series, attempts } = await fetchPrices({ now, fetchImpl: makeFetch(routes) });
  assert.equal(series.source.id, 'smard');
  assert.equal(series.points.at(-1).end, TOMORROW_END);
  assert.equal(series.resolutionMinutes, 15);
  assert.equal(series.supplements.length, 1);
  assert.deepEqual([series.supplements[0].source.id, series.supplements[0].from, series.supplements[0].until, series.supplements[0].resolutionMinutes], ['awattar', TODAY_END, TOMORROW_END, 60]);
  assert.equal(series.supplements[0].source.apiBase, undefined);
  const last = attempts.at(-1);
  assert.deepEqual([last.id, last.role, last.ok, last.addedHours], ['awattar', 'supplement', true, 24]);
  assert.ok(series.points.filter((p) => p.start >= TODAY_END).every((p) => p.end - p.start === HOUR));
});

test('fetchPrices: vor 12:55 Uhr und bei vollständigen Daten keine Anfrage an aWATTar', async () => {
  const early = berlin('2026-09-28T12:54:00+02:00');
  const a = sources(early);
  const logA = [];
  const ra = await fetchPrices({ now: early, fetchImpl: makeFetch(a.routes, logA) });
  assert.equal(ra.series.source.id, 'smard');
  assert.equal(ra.series.supplements, undefined);
  assert.ok(!logA.some((r) => r.url.includes('awattar')));

  const late = berlin('2026-09-28T15:00:00+02:00');
  const b = sources(late); // SMARD hat morgen bereits
  const logB = [];
  const rb = await fetchPrices({ now: late, fetchImpl: makeFetch(b.routes, logB) });
  assert.equal(rb.series.points.at(-1).end, TOMORROW_END);
  assert.ok(!logB.some((r) => r.url.includes('awattar')));
});

test('fetchPrices: ab 12:55 Uhr wird nachgefragt; hat noch keine Quelle die Preise, bleibt es bei SMARD (ohne Ergänzung)', async () => {
  const { routes } = sources(berlin('2026-09-28T12:54:00+02:00')); // Daten aller Quellen nur bis heute 24:00
  const now = berlin('2026-09-28T12:56:00+02:00');
  const log = [];
  const { series, attempts } = await fetchPrices({ now, fetchImpl: makeFetch(routes, log) });
  assert.ok(log.some((r) => r.url.includes('awattar')));
  assert.equal(series.supplements, undefined);
  assert.equal(series.points.at(-1).end, TODAY_END);
  assert.deepEqual([attempts.at(-1).role, attempts.at(-1).ok, attempts.at(-1).kind], ['supplement', false, 'no-new-data']);
});

test('fetchPrices: SMARD fehlen die Preise des laufenden Tags (Lücke) → aus aWATTar gefüllt', async () => {
  const now = berlin('2026-09-28T10:00:00+02:00');
  const { routes } = sources(now, { smardKeep: (p) => p.end <= TODAY_START });
  const { series } = await fetchPrices({ now, fetchImpl: makeFetch(routes) });
  assert.equal(series.source.id, 'smard');
  assert.deepEqual(series.supplements.map((s) => [s.from, s.until]), [[TODAY_START, TODAY_END]]);
  assert.deepEqual(coverageGaps(series.points, expectedRange(now).from, TODAY_END), []);
});

test('fetchPrices: aWATTar nicht erreichbar → SMARD-Daten bleiben, Versuch als Ergänzung protokolliert', async () => {
  const now = berlin('2026-09-28T13:30:00+02:00');
  const { routes } = sources(now, { smardKeep: (p) => p.end <= TODAY_END, awattarStatus: 503 });
  const seen = [];
  const { series, attempts } = await fetchPrices({ now, fetchImpl: makeFetch(routes), onAttempt: (a) => seen.push(a) });
  assert.equal(series.source.id, 'smard');
  assert.equal(series.supplements, undefined);
  assert.deepEqual([attempts.at(-1).id, attempts.at(-1).role, attempts.at(-1).ok, attempts.at(-1).kind], ['awattar', 'supplement', false, 'http']);
  assert.equal(seen.at(-1).role, 'supplement');
});

test('fetchPrices: eine im selben Lauf gescheiterte Quelle wird nicht erneut zum Ergänzen abgefragt', async () => {
  const now = berlin('2026-09-28T13:30:00+02:00');
  const { routes } = sources(now, { smardKeep: (p) => p.end <= TODAY_END, awattarStatus: 503 });
  const log = [];
  const { attempts } = await fetchPrices({ now, fetchImpl: makeFetch(routes, log), order: ['awattar', 'smard'] });
  assert.equal(log.filter((r) => r.url.includes('awattar')).length, 1);
  assert.equal(attempts.filter((a) => a.role === 'supplement').length, 0);
});

// ---------- Abruftakt ----------

test('nextRefreshAt: 5 min bei fehlenden Preisen, 30 min bei ergänzten Preisen, sonst stündlich bzw. zur Veröffentlichung', () => {
  const full = { points: [{ start: TODAY_START - 3 * 24 * HOUR, end: TOMORROW_END, price: 1 }] };
  const todayOnly = { points: [{ start: TODAY_START - 3 * 24 * HOUR, end: TODAY_END, price: 1 }] };
  const at1330 = berlin('2026-09-28T13:30:00+02:00');
  const at1200 = berlin('2026-09-28T12:00:00+02:00');
  assert.equal(nextRefreshAt(full, at1330, at1330), at1330 + 60 * MINUTE);
  assert.equal(nextRefreshAt(todayOnly, at1330, at1330), at1330 + 5 * MINUTE);
  assert.equal(nextRefreshAt(todayOnly, at1200, at1200), berlin('2026-09-28T12:55:00+02:00'), 'nicht erst um 13:00 Uhr');
  assert.equal(nextRefreshAt(null, at1200, at1200), at1200 + 5 * MINUTE);
  const supplemented = { ...full, supplements: [{ source: { id: 'awattar' }, from: TODAY_END, until: TOMORROW_END, resolutionMinutes: 60, fetchedAt: at1330 }] };
  assert.equal(nextRefreshAt(supplemented, at1330, at1330), at1330 + 30 * MINUTE);
  // Lücke heute (z. B. SMARD ohne Vormittag) → 5 min
  const hole = { points: [{ start: TODAY_START - 3 * 24 * HOUR, end: TODAY_START + 2 * HOUR, price: 1 }, { start: TODAY_START + 6 * HOUR, end: TOMORROW_END, price: 1 }] };
  assert.equal(nextRefreshAt(hole, at1330, at1330), at1330 + 5 * MINUTE);
});

// ---------- Snapshot und HTTP ----------

test('Snapshot: Ergänzungen werden übernommen, Quellenangaben nur aus den bekannten Quellen', async () => {
  const now = berlin('2026-09-28T13:30:00+02:00');
  const set = buildFixtureSet({ now });
  const json = {
    format: SNAPSHOT_FORMAT, generatedAt: now - 10 * MINUTE, resolutionMinutes: 15, unit: 'EUR/MWh',
    source: { id: 'smard', name: 'x' },
    supplements: [
      { source: { id: 'energy-charts', name: '<b>gefälscht</b>' }, from: TODAY_END, until: TOMORROW_END, resolutionMinutes: 15, fetchedAt: now - 11 * MINUTE },
      { source: { id: 'unbekannt' }, from: 1, until: 2 },
      { source: { id: 'awattar' }, from: 5, until: 5 },
      null,
    ],
    points: set.points,
  };
  const s = await fetchSnapshot({ now, fetchImpl: makeFetch([{ match: () => true, json }]) });
  assert.equal(s.supplements.length, 1);
  assert.equal(s.supplements[0].source.name, 'Energy-Charts (Fraunhofer ISE)');
  assert.equal(s.supplements[0].source.apiBase, undefined);
  assert.deepEqual([s.supplements[0].from, s.supplements[0].until, s.supplements[0].resolutionMinutes], [TODAY_END, TOMORROW_END, 15]);
});

test('getJson: Antworten aus dem Browser-Cache nur nach Rückfrage beim Server (cache: no-cache)', async () => {
  const log = [];
  await getJson('https://example.invalid/x.json', { fetchImpl: makeFetch([{ match: () => true, json: {} }], log) });
  assert.equal(log[0].init.cache, 'no-cache');
});
