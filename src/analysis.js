// Reine Analysefunktionen (keine DOM-, Netz- oder Zeitzonenabhängigkeit).
// Alle Zeitstempel sind Epoch-Millisekunden (UTC), alle Preise EUR/MWh.
// „now“ wird immer injiziert, damit die Berechnung deterministisch testbar ist.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;

/** @typedef {{ start:number, end:number, price:number }} PricePoint */

/**
 * Sortiert, entfernt Duplikate und ungültige Punkte und beschneidet Überlappungen.
 *  - bei gleichem Start gewinnt das LETZTE Vorkommen (Adapter hängen neuere Dateien hinten an)
 *  - `end` wird auf den nächsten Start begrenzt; Punkte ohne Restdauer entfallen
 * Invariante des Ergebnisses: streng steigende Starts, p.end ≤ next.start.
 * @param {PricePoint[]} points
 * @returns {PricePoint[]}
 */
export function normalizePoints(points) {
  const byStart = new Map();
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || !Number.isFinite(p.start) || !Number.isFinite(p.end) || !Number.isFinite(p.price)) continue;
    if (p.end <= p.start) continue;
    byStart.set(p.start, { start: p.start, end: p.end, price: p.price });
  }
  const sorted = [...byStart.values()].sort((a, b) => a.start - b.start);
  const result = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i];
    const next = sorted[i + 1];
    const end = next ? Math.min(p.end, next.start) : p.end;
    if (end <= p.start) continue;
    result.push({ start: p.start, end, price: p.price });
  }
  return result;
}

/**
 * Dominante Auflösung in Minuten (Modus der Slot-Dauern). Standard 60, wenn keine Punkte.
 * @param {PricePoint[]} points
 */
export function detectResolutionMinutes(points) {
  const counts = new Map();
  for (const p of points) {
    const d = Math.round((p.end - p.start) / MINUTE);
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = 60;
  let bestCount = -1;
  for (const [d, c] of counts) {
    if (c > bestCount || (c === bestCount && d < best)) { best = d; bestCount = c; }
  }
  return best;
}

/** Rundet einen Zeitstempel auf den Beginn des Rasterschritts ab (Raster ist UTC-ausgerichtet). */
export function floorToResolution(ts, resolutionMinutes) {
  const step = resolutionMinutes * MINUTE;
  return Math.floor(ts / step) * step;
}

/** Rundet einen Zeitstempel auf das nächste Rasterende auf. */
export function ceilToResolution(ts, resolutionMinutes) {
  const step = resolutionMinutes * MINUTE;
  return Math.ceil(ts / step) * step;
}

/**
 * Punkte, die den Bereich [from, to) berühren.
 * @param {PricePoint[]} points sortiert
 */
export function sliceRange(points, from, to) {
  return points.filter((p) => p.end > from && p.start < to);
}

/**
 * Zeitgewichteter Mittelwert der Punkte, beschnitten auf [from, to).
 * @returns {{ mean:number|null, coveredMs:number, min:PricePoint|null, max:PricePoint|null }}
 */
export function weightedStats(points, from, to) {
  let weightSum = 0;
  let priceSum = 0;
  let min = null;
  let max = null;
  for (const p of points) {
    const a = Math.max(p.start, from);
    const b = Math.min(p.end, to);
    const w = b - a;
    if (w <= 0) continue;
    weightSum += w;
    priceSum += p.price * w;
    if (!min || p.price < min.price) min = p;
    if (!max || p.price > max.price) max = p;
  }
  return { mean: weightSum > 0 ? priceSum / weightSum : null, coveredMs: weightSum, min, max };
}

/**
 * Bewertet alle Kandidatenfenster der Länge slotMs innerhalb [rangeStart, rangeEnd].
 * Kandidatenstarts sind die Punkt-Starts im Bereich (das Datenraster bestimmt die „Uhrzeiten“).
 * @returns {Array<{ start:number, end:number, mean:number, coverage:number, points:PricePoint[] }>}
 */
export function evaluateWindows(points, { rangeStart, rangeEnd, slotMs }) {
  const inRange = sliceRange(points, rangeStart, rangeEnd);
  const windows = [];
  for (const cand of inRange) {
    const s = cand.start;
    if (s < rangeStart || s + slotMs > rangeEnd) continue;
    const e = s + slotMs;
    const inWin = inRange.filter((p) => p.end > s && p.start < e);
    const st = weightedStats(inWin, s, e);
    if (st.mean === null) continue;
    windows.push({ start: s, end: e, mean: st.mean, coverage: st.coveredMs / slotMs, points: inWin });
  }
  return windows;
}

const EPS = 1e-9;

/**
 * Bestes Fenster: Mittel aufsteigend, dann Abdeckung absteigend, dann früherer Start.
 * Kandidaten werden in Startreihenfolge durchlaufen; ersetzt wird nur bei echter Verbesserung (ε = 1e-9).
 */
function pickCheapest(windows) {
  let best = null;
  for (const w of windows) {
    if (!best) { best = w; continue; }
    if (w.mean < best.mean - EPS) { best = w; continue; }
    if (Math.abs(w.mean - best.mean) <= EPS && w.coverage > best.coverage + EPS) best = w;
  }
  return best;
}

/**
 * Günstigstes Zeitfenster der Länge `slotHours` innerhalb der vergangenen `lookbackHours`.
 *
 * Definition:
 *  - Analysebereich: [rangeEnd − lookback, rangeEnd) mit rangeEnd = auf das Datenraster
 *    abgerundetes „jetzt“ (nur vollständig vergangene Slots).
 *  - Kandidaten: jeder Slot-Start im Bereich, dessen Fenster vollständig im Bereich liegt.
 *  - Punkte, die eine Fenstergrenze überlappen, zählen nur mit ihrem Anteil im Fenster (Clipping).
 *  - Reihenfolge: (1) Fenster mit vollständiger Abdeckung, Mittel aufsteigend, dann früherer Start;
 *    (2) nur wenn (1) leer: Fenster mit Abdeckung ≥ minCoverage, Mittel aufsteigend, dann Abdeckung
 *    absteigend, dann früherer Start → `partial: true`; (3) sonst slot = null.
 *  - Mittelwert zeitgewichtet (Dauer der Slots als Gewicht). Vergleiche mit ε = 1e-9 EUR/MWh.
 *
 * @param {PricePoint[]} points normalisiert (siehe normalizePoints)
 * @param {{ now:number, lookbackHours?:number, slotHours?:number, minCoverage?:number, resolutionMinutes?:number }} opts
 */
export function cheapestSlot(points, { now, lookbackHours = 36, slotHours = 4, minCoverage = 0.75, resolutionMinutes } = {}) {
  if (!Number.isFinite(now)) throw new TypeError('cheapestSlot: now fehlt');
  const res = resolutionMinutes ?? resolutionAt(points, now);
  const rangeEnd = floorToResolution(now, res);
  const rangeStart = rangeEnd - lookbackHours * HOUR;
  const slotMs = slotHours * HOUR;

  const windows = evaluateWindows(points, { rangeStart, rangeEnd, slotMs });
  const complete = windows.filter((w) => Math.abs(w.coverage - 1) <= 1e-6);
  let best = pickCheapest(complete);
  let partial = false;
  if (!best) {
    best = pickCheapest(windows.filter((w) => w.coverage + 1e-9 >= minCoverage));
    partial = Boolean(best);
  }
  const rangePoints = sliceRange(points, rangeStart, rangeEnd);
  const rangeStats = weightedStats(rangePoints, rangeStart, rangeEnd);
  const lookbackMs = lookbackHours * HOUR;
  const base = {
    range: {
      start: rangeStart,
      end: rangeEnd,
      coveredMs: rangeStats.coveredMs,
      coverage: lookbackMs > 0 ? rangeStats.coveredMs / lookbackMs : 0,
      dataStart: rangePoints.length ? Math.max(rangeStart, rangePoints[0].start) : null,
      dataEnd: rangePoints.length ? Math.min(rangeEnd, rangePoints[rangePoints.length - 1].end) : null,
    },
    resolutionMinutes: res,
    slotHours,
    lookbackHours,
    rangeMean: rangeStats.mean,
    rangeMin: rangeStats.min,
    rangeMax: rangeStats.max,
    candidates: windows.map(({ start, end, mean, coverage }) => ({ start, end, mean, coverage })),
  };
  if (!best) return { ...base, slot: null, worstSlot: null };
  const worst = complete.length ? complete.reduce((a, b) => (b.mean > a.mean + EPS ? b : a)) : null;
  return {
    ...base,
    slot: {
      start: best.start,
      end: best.end,
      meanPrice: best.mean,
      coverage: best.coverage,
      partial,
      points: best.points,
    },
    worstSlot: worst ? { start: worst.start, end: worst.end, meanPrice: worst.mean } : null,
  };
}

/**
 * Auflösung, die für „jetzt“ gilt: Dauer des Punkts, der now enthält; sonst der Modus der Reihe.
 */
export function resolutionAt(points, now) {
  const cur = currentPoint(points, now);
  if (cur) {
    const d = Math.round((cur.end - cur.start) / MINUTE);
    if (d > 0) return d;
  }
  return detectResolutionMinutes(points);
}

/**
 * Günstigstes Fenster in den bereits veröffentlichten (künftigen) Preisen ab dem laufenden Slot.
 * null, wenn weniger als `slotHours` lückenlose Daten ab jetzt vorliegen.
 */
export function cheapestUpcomingSlot(points, { now, slotHours = 4, resolutionMinutes } = {}) {
  if (!Number.isFinite(now)) throw new TypeError('cheapestUpcomingSlot: now fehlt');
  if (!points.length) return null;
  const res = resolutionMinutes ?? resolutionAt(points, now);
  const rangeStart = floorToResolution(now, res);
  const rangeEnd = points[points.length - 1].end;
  const slotMs = slotHours * HOUR;
  if (rangeEnd - rangeStart < slotMs) return null;
  const windows = evaluateWindows(points, { rangeStart, rangeEnd, slotMs }).filter((w) => Math.abs(w.coverage - 1) <= 1e-6);
  const best = pickCheapest(windows);
  if (!best) return null;
  return {
    start: best.start,
    end: best.end,
    meanPrice: best.mean,
    coverage: best.coverage,
    points: best.points,
    range: { start: rangeStart, end: rangeEnd },
  };
}

/** Punkt, der „jetzt“ enthält (start ≤ now < end), sonst null. */
export function currentPoint(points, now) {
  return points.find((p) => p.start <= now && now < p.end) ?? null;
}

/**
 * Aggregiert auf ein gröberes Raster (z. B. 15 → 60 min), zeitgewichtet, UTC-ausgerichtet.
 * Unvollständige Buckets bekommen den Mittelwert der vorhandenen Anteile.
 * @returns {PricePoint[]}
 */
export function aggregateToResolution(points, targetMinutes) {
  const step = targetMinutes * MINUTE;
  const buckets = new Map();
  for (const p of points) {
    let cursor = p.start;
    while (cursor < p.end) {
      const bStart = Math.floor(cursor / step) * step;
      const bEnd = bStart + step;
      const w = Math.min(p.end, bEnd) - cursor;
      const acc = buckets.get(bStart) ?? { start: bStart, end: bEnd, weight: 0, sum: 0 };
      acc.weight += w;
      acc.sum += p.price * w;
      buckets.set(bStart, acc);
      cursor += w;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.start - b.start)
    .map((b) => ({ start: b.start, end: b.end, price: b.sum / b.weight }));
}

/** Gesamtstatistik über alle Punkte (zeitgewichtet). */
export function stats(points) {
  if (!points.length) return { mean: null, min: null, max: null, coveredMs: 0 };
  return weightedStats(points, points[0].start, points[points.length - 1].end);
}
