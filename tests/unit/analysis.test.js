import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUR, MINUTE, normalizePoints, detectResolutionMinutes, floorToResolution, cheapestSlot,
  cheapestUpcomingSlot, currentPoint, aggregateToResolution, weightedStats, evaluateWindows, resolutionAt,
} from '../../src/analysis.js';

const T0 = Date.parse('2026-09-27T00:00:00Z');
const m = (h, min = 0) => T0 + h * HOUR + min * MINUTE;

/** Raster-Reihe ab `from` mit `count` Slots à `resMin` Minuten; price(i, start) liefert den Preis. */
function grid({ from = T0, count, resMin = 15, price = () => 100 }) {
  const step = resMin * MINUTE;
  return Array.from({ length: count }, (_, i) => ({ start: from + i * step, end: from + (i + 1) * step, price: price(i, from + i * step) }));
}

function approx(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
}

function candidate(r, start) {
  return r.candidates.find((c) => c.start === start);
}

// ---------- normalizePoints ----------

test('normalizePoints sortiert, entfernt ungültige Punkte, letztes Duplikat gewinnt', () => {
  const pts = normalizePoints([
    { start: 30, end: 45, price: 2 },
    { start: 0, end: 15, price: 1 },
    { start: 0, end: 15, price: 99 }, // Duplikat – letztes Vorkommen gewinnt (neuere Datei)
    { start: 15, end: 30, price: NaN },
    { start: 60, end: 60, price: 3 }, // end <= start
    null,
  ]);
  assert.deepEqual(pts, [{ start: 0, end: 15, price: 99 }, { start: 30, end: 45, price: 2 }]);
});

test('normalizePoints beschneidet Überlappungen auf den nächsten Start (T5b)', () => {
  const pts = normalizePoints([{ start: m(0), end: m(1), price: 40 }, { start: m(0, 30), end: m(0, 45), price: 0 }]);
  assert.deepEqual(pts, [{ start: m(0), end: m(0, 30), price: 40 }, { start: m(0, 30), end: m(0, 45), price: 0 }]);
  const st = weightedStats(pts, m(0), m(1));
  approx(st.coveredMs / HOUR, 0.75);
  for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i - 1].end <= pts[i].start && pts[i - 1].start < pts[i].start);
});

test('Duplikate aus überlappenden SMARD-Wochendateien: neuere Datei gewinnt (T5a)', () => {
  const older = grid({ count: 24, price: () => 100 });
  const newer = grid({ from: m(2), count: 16, price: () => 0 });
  const pts = normalizePoints([...older, ...newer]);
  assert.equal(pts.length, 24);
  assert.equal(pts[8].price, 0);
  const r = cheapestSlot(pts, { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(r.slot.start, m(2));
  approx(r.slot.meanPrice, 0);
});

// ---------- Auflösung / Rundung ----------

test('detectResolutionMinutes erkennt 15 und 60 Minuten', () => {
  assert.equal(detectResolutionMinutes(grid({ count: 10, resMin: 15 })), 15);
  assert.equal(detectResolutionMinutes(grid({ count: 10, resMin: 60 })), 60);
  assert.equal(detectResolutionMinutes([]), 60);
  const mixed = [...grid({ count: 3, resMin: 60 }), ...grid({ from: m(3), count: 8, resMin: 15 })];
  assert.equal(detectResolutionMinutes(mixed), 15);
});

test('resolutionAt nimmt die Dauer des laufenden Slots, sonst den Modus', () => {
  const mixed = [...grid({ count: 3, resMin: 60 }), ...grid({ from: m(3), count: 8, resMin: 15 })];
  assert.equal(resolutionAt(mixed, m(1, 30)), 60);
  assert.equal(resolutionAt(mixed, m(3, 20)), 15);
  assert.equal(resolutionAt(mixed, m(9)), 15);
});

test('floorToResolution rundet auf Rasterbeginn ab', () => {
  const t = Date.parse('2026-09-28T12:37:12Z');
  assert.equal(floorToResolution(t, 15), Date.parse('2026-09-28T12:30:00Z'));
  assert.equal(floorToResolution(t, 60), Date.parse('2026-09-28T12:00:00Z'));
  assert.equal(floorToResolution(Date.parse('2026-09-28T12:30:00Z'), 15), Date.parse('2026-09-28T12:30:00Z'));
});

// ---------- cheapestSlot ----------

test('cheapestSlot findet ein gepflanztes 4-h-Fenster im 15-min-Raster', () => {
  const cheapStart = m(10);
  const pts = grid({ count: 48 * 4, price: (i, s) => (s >= cheapStart && s < cheapStart + 4 * HOUR ? 10 : 100) });
  const now = m(40); // Analysebereich: T0+4h … T0+40h
  const r = cheapestSlot(pts, { now });
  assert.equal(r.slot.start, cheapStart);
  assert.equal(r.slot.end, cheapStart + 4 * HOUR);
  approx(r.slot.meanPrice, 10);
  assert.equal(r.slot.partial, false);
  approx(r.slot.coverage, 1);
  assert.equal(r.slot.points.length, 16);
  assert.deepEqual([r.range.start, r.range.end], [m(4), m(40)]);
  approx(r.range.coverage, 1);
  assert.equal(r.range.dataStart, m(4));
  assert.equal(r.range.dataEnd, m(40));
  approx(r.rangeMean, (4 * 10 + 32 * 100) / 36);
  assert.equal(r.rangeMin.price, 10);
  assert.equal(r.rangeMax.price, 100);
  approx(r.worstSlot.meanPrice, 100);
  assert.equal(r.candidates.length, 32 * 4 + 1);
});

test('T1: 15→60-Übergang – überlappender Stundenpunkt zählt nur anteilig', () => {
  const pts = [
    { start: m(0), end: m(0, 15), price: 100 },
    ...grid({ from: m(0, 15), count: 7, price: () => 0 }),
    { start: m(2), end: m(3), price: 0 },
    { start: m(3), end: m(4), price: 0 },
    { start: m(4), end: m(5), price: 40 },
    { start: m(5), end: m(6), price: 100 },
  ];
  const r = cheapestSlot(pts, { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(r.slot.start, m(0, 15));
  assert.equal(r.slot.end, m(4, 15));
  approx(r.slot.meanPrice, 2.5);
  approx(r.slot.coverage, 1);
  assert.equal(r.slot.partial, false);
  approx(candidate(r, m(0)).mean, 6.25);
  approx(candidate(r, m(1)).mean, 10);
});

test('T2: fehlende Viertelstunde – vollständiges Fenster schlägt günstigeres Teilfenster', () => {
  const full = grid({ count: 24, price: (i, s) => (s < m(2) ? 0 : 50) });
  const pts = full.filter((p) => p.start !== m(1));
  const r = cheapestSlot(pts, { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(r.slot.start, m(1, 15));
  approx(r.slot.meanPrice, 40.625);
  approx(r.slot.coverage, 1);
  assert.equal(r.slot.partial, false);
  approx(candidate(r, m(0)).mean, 400 / 15);
  approx(candidate(r, m(0)).coverage, 15 / 16);
  // Variante B: zusätzlich 05:00–05:45 entfernen → kein vollständiges Fenster
  const ptsB = pts.filter((p) => p.start < m(5));
  const rB = cheapestSlot(ptsB, { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(rB.slot.start, m(0));
  approx(rB.slot.coverage, 0.9375);
  assert.equal(rB.slot.partial, true);
  approx(rB.slot.meanPrice, 400 / 15);
});

test('T3: „jetzt“ genau auf der Slot-Grenze vs. 1 ms davor', () => {
  const pts = grid({ count: 24, price: (i) => (i === 23 ? 0 : 100) });
  const a = cheapestSlot(pts, { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(a.range.end, m(6));
  assert.equal(a.slot.start, m(2));
  approx(a.slot.meanPrice, 93.75);
  const b = cheapestSlot(pts, { now: m(6) - 1, lookbackHours: 6, slotHours: 4 });
  assert.equal(b.range.end, m(5, 45));
  assert.equal(b.range.start, m(0) - 15 * MINUTE);
  assert.equal(b.slot.start, m(0));
  approx(b.slot.meanPrice, 100);
  const hourly = grid({ count: 6, resMin: 60 });
  const c = cheapestSlot(hourly, { now: m(6) - 1, lookbackHours: 6, slotHours: 4 });
  assert.equal(c.range.end, m(5));
});

test('T4: 60→15-Übergang – Kandidaten folgen dem Datenraster', () => {
  const pts = [
    { start: m(0), end: m(1), price: 20 },
    { start: m(1), end: m(2), price: 20 },
    ...grid({ from: m(2), count: 8, price: () => 20 }),
    ...grid({ from: m(4), count: 8, price: () => 80 }),
  ];
  assert.equal(detectResolutionMinutes(pts), 15);
  const r = cheapestSlot(pts, { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(r.range.end, m(6));
  assert.equal(r.slot.start, m(0));
  approx(r.slot.meanPrice, 20);
  approx(r.slot.coverage, 1);
  approx(candidate(r, m(1)).mean, 35);
  assert.equal(candidate(r, m(0, 15)), undefined);
});

test('T6: Reihe nur in der Zukunft → kein Rückblick, aber Ausblick', () => {
  const pts = grid({ from: m(12), count: 32, price: (i, s) => (s >= m(14) && s < m(18) ? 5 : 30) });
  const r = cheapestSlot(pts, { now: m(6), lookbackHours: 36, slotHours: 4 });
  assert.equal(r.slot, null);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.rangeMean, null);
  assert.equal(r.range.dataStart, null);
  const u = cheapestUpcomingSlot(pts, { now: m(6), slotHours: 4 });
  assert.equal(u.start, m(14));
  assert.equal(u.end, m(18));
  approx(u.meanPrice, 5);
  assert.equal(currentPoint(pts, m(6)), null);
});

test('T7: Uhr vor den Daten – vollständiges Fenster schlägt Teilfenster am Datenrand', () => {
  const pts = grid({ count: 40, price: (i, s) => (s >= m(8) ? 10 : 100) });
  const r = cheapestSlot(pts, { now: m(12), lookbackHours: 12, slotHours: 4 });
  assert.equal(r.slot.start, m(6));
  approx(r.slot.meanPrice, 55);
  approx(r.slot.coverage, 1);
  assert.equal(r.slot.partial, false);
  approx(candidate(r, m(8)).coverage, 0.5);
  approx(candidate(r, m(7)).coverage, 0.75);
  approx(candidate(r, m(7)).mean, 40);
  assert.equal(currentPoint(pts, m(12)), null);
  approx(r.range.coverage, 10 / 12);
  assert.equal(r.range.dataEnd, m(10));
});

test('T8: negative Preise und Gleichstand im Stundenraster', () => {
  const pts = grid({ count: 12, resMin: 60, price: () => -5 });
  const r = cheapestSlot(pts, { now: m(12), lookbackHours: 12, slotHours: 4 });
  assert.equal(r.slot.start, m(0));
  approx(r.slot.meanPrice, -5);
  assert.deepEqual([r.rangeMin.price, r.rangeMin.start], [-5, m(0)]);
  assert.deepEqual([r.rangeMax.price, r.rangeMax.start], [-5, m(0)]);
  const pts2 = grid({ count: 12, resMin: 60, price: (i) => (i === 3 ? -20 : -5) });
  const r2 = cheapestSlot(pts2, { now: m(12), lookbackHours: 12, slotHours: 4 });
  assert.equal(r2.slot.start, m(0));
  approx(r2.slot.meanPrice, -8.75);
  assert.deepEqual([r2.rangeMin.price, r2.rangeMin.start], [-20, m(3)]);
});

test('T9: cheapestUpcomingSlot – genau 4 h, zu wenig, Lücke', () => {
  const a = grid({ from: m(12), count: 16, price: () => 7 });
  assert.deepEqual((({ start, end, meanPrice }) => ({ start, end, meanPrice }))(cheapestUpcomingSlot(a, { now: m(12), slotHours: 4 })), { start: m(12), end: m(16), meanPrice: 7 });
  assert.equal(cheapestUpcomingSlot(a.slice(0, 15), { now: m(12), slotHours: 4 }), null);
  assert.equal(cheapestUpcomingSlot(a.filter((p) => p.start !== m(13)), { now: m(12), slotHours: 4 }), null);
  assert.equal(cheapestUpcomingSlot([], { now: m(12) }), null);
});

test('T10: Kandidatengrenzen, genau 36 h Daten, 0,75-Schwelle', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const a = cheapestSlot(grid({ from: now - 36 * HOUR, count: 144, price: (i) => i }), { now });
  assert.equal(a.slot.start, now - 36 * HOUR);
  approx(a.slot.meanPrice, 7.5);
  assert.equal(a.candidates.length, 129);
  assert.deepEqual([a.range.start, a.range.end], [now - 36 * HOUR, now]);
  const b = cheapestSlot(grid({ from: now - 36 * HOUR, count: 144, price: (i) => 143 - i }), { now });
  assert.equal(b.slot.start, now - 4 * HOUR);
  assert.equal(b.slot.end, now);
  approx(b.slot.meanPrice, 7.5);
  const c = cheapestSlot(grid({ from: now - 36 * HOUR, count: 36, resMin: 60 }), { now });
  assert.equal(c.candidates.length, 33);
  const d = cheapestSlot(grid({ count: 11, price: () => 50 }), { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(d.slot, null);
  assert.ok(d.candidates.length > 0);
  const e = cheapestSlot(grid({ count: 12, price: () => 50 }), { now: m(6), lookbackHours: 6, slotHours: 4 });
  assert.equal(e.slot.start, m(0));
  approx(e.slot.coverage, 0.75);
  assert.equal(e.slot.partial, true);
  approx(e.slot.meanPrice, 50);
});

test('cheapestSlot: Fenster, das teilweise vor dem Analysebereich liegt, zählt nicht', () => {
  const now = m(40);
  const rangeStart = now - 36 * HOUR; // T0+4h
  const pts = grid({ count: 48 * 4, price: (i, s) => (s >= rangeStart - 2 * HOUR && s < rangeStart + 2 * HOUR ? 1 : 100) });
  const r = cheapestSlot(pts, { now });
  assert.equal(r.slot.start, rangeStart);
  approx(r.slot.meanPrice, (2 * 1 + 2 * 100) / 4);
});

test('cheapestSlot im Stundenraster mit Gleichstand wählt den früheren Start', () => {
  const pts = grid({ count: 48, resMin: 60, price: (i) => ((i >= 2 && i < 6) || (i >= 20 && i < 24) ? 20 : 80) });
  const r = cheapestSlot(pts, { now: m(36) });
  assert.equal(r.slot.start, m(2));
  approx(r.slot.meanPrice, 20);
  assert.equal(r.resolutionMinutes, 60);
});

test('cheapestSlot ignoriert Fenster mit Datenlücke, wenn vollständige Fenster existieren', () => {
  const pts = grid({ count: 48 * 4, price: (i) => 100 - i * 0.1 }).filter((p) => p.start !== m(37, 30));
  const r = cheapestSlot(pts, { now: m(40) });
  assert.equal(r.slot.partial, false);
  assert.equal(r.slot.end, m(37, 30));
});

test('Teilabdeckung: bei gleichem Mittel gewinnt die höhere Abdeckung', () => {
  // jede vierte Viertelstunde fehlt (Abdeckung 0,75) – außer im Block 20:00–24:00, wo nur eine fehlt
  const pts = grid({ count: 48 * 4, price: () => 50 }).filter((p, i) => {
    if (p.start >= m(20) && p.start < m(24)) return p.start !== m(21);
    return i % 4 !== 3;
  });
  const r = cheapestSlot(pts, { now: m(40) });
  assert.equal(r.slot.partial, true);
  assert.equal(r.slot.start, m(20));
  approx(r.slot.coverage, 15 / 16);
  const strict = cheapestSlot(pts, { now: m(40), minCoverage: 0.99 });
  assert.equal(strict.slot, null);
});

test('leere Reihe → kein Fenster', () => {
  const r = cheapestSlot([], { now: T0 });
  assert.equal(r.slot, null);
  assert.equal(r.resolutionMinutes, 60);
  assert.equal(r.rangeMean, null);
});

test('weniger als 36 h Daten: bestes Fenster innerhalb der vorhandenen Daten', () => {
  const pts = grid({ count: 30 * 4, price: (i, s) => (s >= m(1) && s < m(5) ? 5 : 90) });
  const r = cheapestSlot(pts, { now: m(30) });
  assert.equal(r.slot.start, m(1));
  assert.equal(r.slot.partial, false);
  approx(r.range.coverage, 30 / 36);
  assert.equal(r.range.dataStart, m(0));
});

test('Zeitumstellung 25.10.2026: 4-h-Fenster hat 16 Viertelstunden, Bereich ist 36 h in ms', () => {
  const from = Date.parse('2026-10-24T00:00:00Z');
  const switchUtc = Date.parse('2026-10-25T01:00:00Z');
  const pts = grid({ from, count: 48 * 4, price: (i, s) => (s >= switchUtc - 2 * HOUR && s < switchUtc + 2 * HOUR ? 2 : 50) });
  const r = cheapestSlot(pts, { now: Date.parse('2026-10-25T12:00:00Z') });
  assert.equal(r.range.end - r.range.start, 36 * HOUR);
  assert.equal(r.slot.start, switchUtc - 2 * HOUR);
  assert.equal(r.slot.end, switchUtc + 2 * HOUR);
  assert.equal(r.slot.points.length, 16);
  approx(r.slot.meanPrice, 2);
});

test('zeitgewichteter Mittelwert bei gemischter Auflösung', () => {
  const pts = [{ start: T0, end: m(1), price: 100 }, ...grid({ from: m(1), count: 12, price: () => 0 })];
  const st = weightedStats(pts, T0, m(4));
  approx(st.mean, 25);
  approx(st.coveredMs, 4 * HOUR);
});

test('cheapestUpcomingSlot nutzt den laufenden Slot und die bekannten künftigen Preise', () => {
  const now = m(14, 7);
  const pts = grid({ count: 48 * 4, price: (i, s) => (s >= m(20) && s < m(24) ? 8 : 90) });
  const u = cheapestUpcomingSlot(pts, { now });
  assert.deepEqual([u.range.start, u.range.end], [m(14), m(48)]);
  assert.equal(u.start, m(20));
  approx(u.meanPrice, 8);
  const pts2 = grid({ count: 48 * 4, price: (i, s) => (s >= m(14) && s < m(18) ? 3 : 90) });
  assert.equal(cheapestUpcomingSlot(pts2, { now }).start, m(14));
});

test('currentPoint findet den laufenden Slot', () => {
  const pts = grid({ count: 8 });
  assert.equal(currentPoint(pts, m(0, 20)).start, m(0, 15));
  assert.equal(currentPoint(pts, m(2)), null);
  assert.equal(currentPoint(pts, T0 - 1), null);
});

test('aggregateToResolution 15 → 60 bildet zeitgewichtete Stundenmittel', () => {
  const pts = grid({ count: 8, price: (i) => [1, 2, 3, 4, 10, 10, 20, 20][i] });
  const hourly = aggregateToResolution(pts, 60);
  assert.deepEqual(hourly, [{ start: T0, end: m(1), price: 2.5 }, { start: m(1), end: m(2), price: 15 }]);
  assert.deepEqual(aggregateToResolution(pts.slice(0, 2), 60), [{ start: T0, end: m(1), price: 1.5 }]);
});

test('aggregateToResolution am Tag der Zeitumstellung liefert 25 Stundenwerte', () => {
  const from = Date.parse('2026-10-24T22:00:00Z'); // 00:00 MESZ
  const to = Date.parse('2026-10-25T23:00:00Z'); // 00:00 MEZ des Folgetags
  const pts = grid({ from, count: (to - from) / (15 * MINUTE) });
  assert.equal(pts.length, 100);
  assert.equal(aggregateToResolution(pts, 60).length, 25);
});

test('evaluateWindows: Kandidaten liegen vollständig im Bereich', () => {
  const pts = grid({ count: 12 * 4 });
  const w = evaluateWindows(pts, { rangeStart: m(1), rangeEnd: m(9), slotMs: 4 * HOUR });
  assert.equal(w[0].start, m(1));
  assert.equal(w.at(-1).start, m(5));
  assert.equal(w.length, 4 * 4 + 1);
  for (const x of w) approx(x.coverage, 1);
});
