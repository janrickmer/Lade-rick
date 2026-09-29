import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCt, formatMwh, formatDeltaPercent, formatComparison, formatWindow, formatRange, formatTimeRange,
  formatDayLabel, relativeDayWord, formatAgo, formatIn, berlinParts, formatZone, typographicMinus, formatDateTime,
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
  assert.equal(formatComparison(NaN, 3), null);
  assert.equal(formatComparison(5, 10, { rangeLabel: 'des Zeitraums' }), '0,5 ct/kWh unter dem Durchschnitt des Zeitraums (1,0 ct/kWh)');
});

test('formatWindow: Zeitumstellung Oktober (T12)', () => {
  const w = formatWindow(Date.UTC(2026, 9, 25, 0), Date.UTC(2026, 9, 25, 4));
  assert.ok(w.main.includes('02:00') && w.main.includes('05:00'), w.main);
  assert.ok(w.main.includes('MESZ') && w.main.includes('MEZ'), w.main);
  assert.ok(w.main.includes('Zeitumstellung'), w.main);
  assert.equal(w.dst, true);
});

test('formatWindow: Zeitumstellung März (T12)', () => {
  const w = formatWindow(Date.UTC(2026, 2, 29, 0), Date.UTC(2026, 2, 29, 4));
  assert.ok(w.main.includes('01:00') && w.main.includes('06:00'), w.main);
  assert.ok(w.main.includes('Zeitumstellung'), w.main);
  assert.equal(w.dst, true);
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
});
