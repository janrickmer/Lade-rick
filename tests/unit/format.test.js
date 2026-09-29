import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCt, formatMwh, formatDeltaPercent, formatComparison, formatWindow, formatRange, formatTimeRange,
  formatDayLabel, relativeDayWord, formatAgo, formatIn, berlinParts, formatZone, typographicMinus, formatDateTime,
  formatEndTime, berlinOffsetMinutes, isAmbiguousWallTime, berlinDayStart, berlinDayStartOffset, computeView,
} from '../../src/format.js';

const NOW = Date.parse('2026-09-28T12:00:00Z'); // Mo., 28.09.2026 14:00 MESZ

test('formatCt / formatMwh: de-DE, typografisches Minus, geschütztes Leerzeichen', () => {
  assert.equal(formatCt(68.44), '6,8 ct/kWh');
  assert.equal(formatCt(68.44, { decimals: 2 }), '6,84 ct/kWh');
  assert.equal(formatCt(-12.34), '−1,2 ct/kWh');
  assert.equal(formatCt(0), '0,0 ct/kWh');
  assert.equal(formatMwh(68.44), '68 €/MWh');
  assert.equal(formatMwh(-12.34), '−12 €/MWh');
  assert.equal(formatMwh(1234.5, { unit: false }), '1.235');
  assert.equal(typographicMinus('(-3,5)'), '(−3,5)');
});

test('formatDeltaPercent', () => {
  assert.equal(formatDeltaPercent(68, 94), '−28 %');
  assert.equal(formatDeltaPercent(94, 94), '0 %');
  assert.equal(formatDeltaPercent(-5, 0), null);
});

test('formatComparison: Prozent nur bei Bereichsmittel ≥ 2 ct/kWh, sonst absolut', () => {
  assert.equal(formatComparison(68, 94), '28 % günstiger als der Durchschnitt der letzten 36 h (9,4 ct/kWh)');
  assert.equal(formatComparison(120, 94), '28 % teurer als der Durchschnitt der letzten 36 h (9,4 ct/kWh)');
  assert.equal(formatComparison(-10, -3), '0,7 ct/kWh unter dem Durchschnitt der letzten 36 h (−0,3 ct/kWh)');
  assert.equal(formatComparison(-8, 3), '1,1 ct/kWh unter dem Durchschnitt der letzten 36 h (0,3 ct/kWh)');
  assert.equal(formatComparison(3, 3.2), 'entspricht dem Durchschnitt der letzten 36 h (0,3 ct/kWh)');
  assert.equal(formatComparison(-6.7, 66.1), '7,3\u00a0ct/kWh unter dem Durchschnitt der letzten 36 h (6,6\u00a0ct/kWh)');
  assert.equal(formatComparison(NaN, 3), null);
  assert.equal(formatComparison(5, 10, { rangeLabel: 'des Zeitraums' }), '0,5 ct/kWh unter dem Durchschnitt des Zeitraums (1,0 ct/kWh)');
});

test('formatWindow: Zeitumstellung Oktober (T12)', () => {
  const w = formatWindow(Date.UTC(2026, 9, 25, 0), Date.UTC(2026, 9, 25, 4));
  assert.equal(w.main, '02:00\u00a0MESZ\u2009–\u200905:00\u00a0MEZ');
  assert.equal(w.note, '4\u00a0h, Zeitumstellung');
  assert.equal(w.dst, true);
  // Fenster endet genau auf der Umstellung (01:00 UTC): Ende im alten Offset, Hinweis trotzdem
  const edge = formatWindow(Date.UTC(2026, 9, 24, 21), Date.UTC(2026, 9, 25, 1));
  assert.equal(edge.main, '23:00\u00a0MESZ\u2009–\u200903:00\u00a0MESZ');
  assert.equal(edge.dst, true);
  assert.equal(edge.note, '4\u00a0h, Zeitumstellung');
});

test('formatWindow: Zeitumstellung März (T12)', () => {
  const w = formatWindow(Date.UTC(2026, 2, 29, 0), Date.UTC(2026, 2, 29, 4));
  assert.equal(w.main, '01:00\u00a0MEZ\u2009–\u200906:00\u00a0MESZ');
  assert.equal(w.note, '4\u00a0h, Zeitumstellung');
  assert.equal(w.dst, true);
  const edge = formatWindow(Date.UTC(2026, 2, 28, 21), Date.UTC(2026, 2, 29, 1));
  assert.equal(edge.main, '22:00\u00a0MEZ\u2009–\u200902:00\u00a0MEZ');
  assert.equal(edge.dst, true);
  const normal = formatWindow(Date.UTC(2026, 8, 28, 0), Date.UTC(2026, 8, 28, 4));
  assert.equal(normal.note, null);
  assert.equal(normal.dst, false);
});

test('formatRange / formatTimeRange / formatEndTime an der Zeitumstellung', () => {
  const U = (s) => Date.parse(s);
  assert.equal(formatRange(U('2026-10-25T00:45:00Z'), U('2026-10-25T01:00:00Z')), 'So., 25.10., 02:45\u2009–\u200903:00\u00a0Uhr (MESZ)');
  assert.equal(formatRange(U('2026-10-25T00:00:00Z'), U('2026-10-25T01:00:00Z')), 'So., 25.10., 02:00\u2009–\u200903:00\u00a0Uhr (MESZ)');
  assert.equal(formatRange(U('2026-10-25T01:00:00Z'), U('2026-10-25T01:15:00Z')), 'So., 25.10., 02:00\u2009–\u200902:15\u00a0Uhr (MEZ)');
  assert.equal(formatTimeRange(U('2026-10-25T00:45:00Z'), U('2026-10-25T01:00:00Z')), '02:45\u2009–\u200903:00\u00a0Uhr (MESZ)');
  assert.equal(formatRange(U('2026-03-29T00:45:00Z'), U('2026-03-29T01:00:00Z')), 'So., 29.03., 01:45\u2009–\u200902:00\u00a0Uhr');
  assert.equal(formatEndTime(U('2026-09-28T22:00:00Z')), '24:00');
  assert.equal(formatEndTime(U('2026-09-28T12:15:00Z')), '14:15');
  assert.equal(berlinOffsetMinutes(U('2026-10-25T00:59:00Z')), 120);
  assert.equal(berlinOffsetMinutes(U('2026-10-25T01:00:00Z')), 60);
  assert.equal(isAmbiguousWallTime(U('2026-10-25T00:30:00Z')), true);
  assert.equal(isAmbiguousWallTime(U('2026-10-25T02:30:00Z')), false);
});

test('formatWindow: Tageswechsel zeigt beide Tage, Mitternachtsende als 24:00', () => {
  const w = formatWindow(Date.UTC(2026, 8, 27, 20), Date.UTC(2026, 8, 28, 0), { now: NOW });
  assert.equal(w.main, '22:00 – 02:00 Uhr');
  assert.equal(w.overline, 'So., 27.09. → Mo., 28.09.');
  assert.equal(w.dst, false);
  const late = formatWindow(Date.UTC(2026, 8, 28, 18), Date.UTC(2026, 8, 28, 22), { now: NOW });
  assert.equal(late.main, '20:00 – 24:00 Uhr');
  assert.equal(late.overline, 'Montag, 28. Sept. · heute');
});

test('formatWindow: normales Fenster mit Tageswort', () => {
  const w = formatWindow(Date.UTC(2026, 8, 28, 0), Date.UTC(2026, 8, 28, 4), { now: NOW });
  assert.equal(w.main, '02:00 – 06:00 Uhr');
  assert.equal(w.overline, 'Montag, 28. Sept. · heute');
  const y = formatWindow(Date.UTC(2026, 8, 27, 0), Date.UTC(2026, 8, 27, 4), { now: NOW });
  assert.equal(y.overline, 'Sonntag, 27. Sept. · gestern');
  const t = formatWindow(Date.UTC(2026, 8, 29, 0), Date.UTC(2026, 8, 29, 4), { now: NOW });
  assert.equal(t.overline, 'Dienstag, 29. Sept. · morgen');
  const far = formatWindow(Date.UTC(2026, 9, 1, 0), Date.UTC(2026, 9, 1, 4), { now: NOW });
  assert.equal(far.overline, 'Donnerstag, 1. Okt.');
});

test('relativeDayWord / formatDayLabel in Europe/Berlin', () => {
  assert.equal(relativeDayWord(Date.parse('2026-09-27T22:30:00Z'), NOW), 'heute'); // 00:30 MESZ am 28.09.
  assert.equal(relativeDayWord(Date.parse('2026-09-27T21:30:00Z'), NOW), 'gestern'); // 23:30 MESZ am 27.09.
  assert.equal(relativeDayWord(Date.parse('2026-09-29T21:59:00Z'), NOW), 'morgen');
  assert.equal(relativeDayWord(Date.parse('2026-09-29T22:00:00Z'), NOW), null);
  assert.equal(formatDayLabel(NOW, NOW), 'Montag, 28. Sept. · heute');
});

test('formatRange / formatTimeRange', () => {
  assert.equal(formatRange(Date.parse('2026-09-28T00:00:00Z'), Date.parse('2026-09-28T04:00:00Z')), 'Mo., 28.09., 02:00 – 06:00 Uhr');
  assert.equal(formatRange(Date.parse('2026-09-28T20:00:00Z'), Date.parse('2026-09-28T22:00:00Z')), 'Mo., 28.09., 22:00 – 24:00 Uhr');
  assert.equal(formatRange(Date.parse('2026-09-28T20:00:00Z'), Date.parse('2026-09-29T00:00:00Z')), 'Mo., 28.09., 22:00 – Di., 29.09., 02:00 Uhr');
  assert.equal(formatTimeRange(Date.parse('2026-09-28T12:15:00Z'), Date.parse('2026-09-28T12:30:00Z')), '14:15 – 14:30 Uhr');
});

test('berlinParts, formatZone, formatDateTime', () => {
  assert.deepEqual(berlinParts(Date.parse('2026-10-25T00:30:00Z')), { ymd: '2026-10-25', hour: 2, minute: 30 });
  assert.deepEqual(berlinParts(Date.parse('2026-10-25T01:30:00Z')), { ymd: '2026-10-25', hour: 2, minute: 30 }); // zweite 02:30
  assert.equal(formatZone(NOW), 'MESZ');
  assert.equal(formatZone(Date.parse('2026-12-01T12:00:00Z')), 'MEZ');
  assert.equal(formatDateTime(NOW), '28.09.2026, 14:00');
});

test('formatAgo / formatIn', () => {
  assert.equal(formatAgo(NOW - 20_000, NOW), 'gerade eben');
  assert.equal(formatAgo(NOW - 60_000, NOW), 'vor 1 Minute');
  assert.equal(formatAgo(NOW - 125_000, NOW), 'vor 2 Minuten');
  assert.equal(formatAgo(NOW - 3 * 3_600_000, NOW), 'vor 3 Stunden');
  assert.equal(formatAgo(NOW - 3 * 86_400_000, NOW), 'vor 3 Tagen');
  assert.equal(formatIn(NOW + 600_000, NOW), 'in 10 Minuten');
  assert.equal(formatIn(NOW + 10_000, NOW), 'in weniger als einer Minute');
  assert.equal(formatIn(NOW + 75 * 60_000, NOW), 'in 1\u00a0Stunde und 15\u00a0Minuten');
  assert.equal(formatIn(NOW + 3 * 3_600_000, NOW), 'in 3\u00a0Stunden');
  assert.equal(formatIn(NOW + 1260 * 60_000, NOW), 'in etwa 21\u00a0Stunden');
  assert.equal(formatIn(NOW + 3 * 86_400_000, NOW), 'in etwa 3\u00a0Tagen');
});

test('berlinDayStart / berlinDayStartOffset: Berliner Mitternacht, auch über Zeitumstellungen', () => {
  const U = (x) => Date.parse(x);
  assert.equal(berlinDayStart(U('2026-09-28T12:00:00Z')), U('2026-09-27T22:00:00Z'));
  assert.equal(berlinDayStart(U('2026-09-27T22:00:00Z')), U('2026-09-27T22:00:00Z'));
  assert.equal(berlinDayStart(U('2026-09-27T21:59:59Z')), U('2026-09-26T22:00:00Z'));
  assert.equal(berlinDayStartOffset(U('2026-09-28T12:00:00Z'), 1), U('2026-09-28T22:00:00Z'));
  assert.equal(berlinDayStartOffset(U('2026-09-28T12:00:00Z'), -2), U('2026-09-25T22:00:00Z'));
  // Umstellung auf Winterzeit am 25.10.: der Tag hat 25 Stunden
  assert.equal(berlinDayStart(U('2026-10-25T12:00:00Z')), U('2026-10-24T22:00:00Z'));
  assert.equal(berlinDayStartOffset(U('2026-10-25T12:00:00Z'), 1), U('2026-10-25T23:00:00Z'));
  assert.equal(berlinDayStartOffset(U('2026-10-24T12:00:00Z'), 2), U('2026-10-25T23:00:00Z'));
  // Umstellung auf Sommerzeit am 29.03.: der Tag hat 23 Stunden
  assert.equal(berlinDayStart(U('2026-03-29T12:00:00Z')), U('2026-03-28T23:00:00Z'));
  assert.equal(berlinDayStartOffset(U('2026-03-29T12:00:00Z'), 1), U('2026-03-29T22:00:00Z'));
});

test('computeView: Kalendertage je nach Auswahl und Kenntnis der Morgenpreise', () => {
  const U = (x) => Date.parse(x);
  const now = U('2026-09-28T12:00:00Z'); // Mo., 14:00 MESZ
  const knownTomorrow = U('2026-09-29T22:00:00Z'); // bis Di., 24:00
  const knownToday = U('2026-09-28T22:00:00Z'); // bis Mo., 24:00
  assert.deepEqual(computeView(now, knownTomorrow, 1), { viewStart: U('2026-09-27T22:00:00Z'), viewEnd: U('2026-09-28T22:00:00Z'), tomorrowKnown: true, label: 'Heute' });
  assert.deepEqual(computeView(now, knownTomorrow, 2), { viewStart: U('2026-09-27T22:00:00Z'), viewEnd: U('2026-09-29T22:00:00Z'), tomorrowKnown: true, label: 'Heute und morgen' });
  assert.deepEqual(computeView(now, knownTomorrow, 3), { viewStart: U('2026-09-26T22:00:00Z'), viewEnd: U('2026-09-29T22:00:00Z'), tomorrowKnown: true, label: 'Gestern bis morgen' });
  assert.deepEqual(computeView(now, knownToday, 1), { viewStart: U('2026-09-27T22:00:00Z'), viewEnd: U('2026-09-28T22:00:00Z'), tomorrowKnown: false, label: 'Heute' });
  assert.deepEqual(computeView(now, knownToday, 2), { viewStart: U('2026-09-26T22:00:00Z'), viewEnd: U('2026-09-28T22:00:00Z'), tomorrowKnown: false, label: 'Gestern und heute' });
  assert.deepEqual(computeView(now, knownToday, 3), { viewStart: U('2026-09-25T22:00:00Z'), viewEnd: U('2026-09-28T22:00:00Z'), tomorrowKnown: false, label: 'Vorgestern bis heute' });
  // weniger als eine Stunde Morgenpreise zählt noch nicht als „bekannt“
  assert.equal(computeView(now, U('2026-09-28T22:30:00Z'), 2).tomorrowKnown, false);
  assert.equal(computeView(now, null, 3).label, 'Vorgestern bis heute');
});
