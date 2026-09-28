// Formatierung für die deutsche Oberfläche. Alle Zeiten werden in Europe/Berlin angezeigt,
// unabhängig von der Zeitzone des Browsers. Gerechnet wird ausschließlich in Epoch-Millisekunden.

export const TIME_ZONE = 'Europe/Berlin';
export const LOCALE = 'de-DE';

const nfCt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfCt2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfMwh = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const nfMwh2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfPct = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, signDisplay: 'exceptZero' });

const dfTime = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const dfWeekday = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'short' });
const dfWeekdayLong = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'long' });
const dfDate = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const dfDateShort = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit' });
const dfDateTime = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dfParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** EUR/MWh → ct/kWh (identische Zahl geteilt durch 10). */
export function eurPerMwhToCtPerKwh(v) {
  return v / 10;
}

/** „6,8 ct/kWh“ */
export function formatCt(eurPerMwh, { decimals = 1, unit = true } = {}) {
  const n = (decimals === 2 ? nfCt2 : nfCt).format(eurPerMwhToCtPerKwh(eurPerMwh));
  return unit ? `${n} ct/kWh` : n;
}

/** „68 €/MWh“ */
export function formatMwh(eurPerMwh, { decimals = 0, unit = true } = {}) {
  const n = (decimals === 2 ? nfMwh2 : nfMwh).format(eurPerMwh);
  return unit ? `${n} €/MWh` : n;
}

/** „−28 %“ – relative Abweichung von `value` zu `reference` (beide EUR/MWh). null, wenn nicht sinnvoll. */
export function formatDeltaPercent(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || Math.abs(reference) < 1e-9) return null;
  const pct = ((value - reference) / Math.abs(reference)) * 100;
  return `${nfPct.format(pct)} %`;
}

/** „14:00“ */
export function formatTime(ts) {
  return dfTime.format(new Date(ts));
}

/** „Mo.“ */
export function formatWeekday(ts) {
  return dfWeekday.format(new Date(ts));
}

/** „Montag“ */
export function formatWeekdayLong(ts) {
  return dfWeekdayLong.format(new Date(ts));
}

/** „28.09.2026“ */
export function formatDate(ts) {
  return dfDate.format(new Date(ts));
}

/** „Mo., 28.09.“ */
export function formatDateShort(ts) {
  return dfDateShort.format(new Date(ts));
}

/** „28.09.2026, 14:00“ */
export function formatDateTime(ts) {
  return dfDateTime.format(new Date(ts));
}

/** Kalenderdatum (YYYY-MM-DD) und Uhrzeit in Europe/Berlin als Objekt. */
export function berlinParts(ts) {
  const parts = Object.fromEntries(dfParts.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** „Mo., 28.09., 02:00 – 06:00 Uhr“ bzw. mit Tageswechsel „Mo., 28.09., 22:00 – Di., 29.09., 02:00 Uhr“. */
export function formatRange(start, end) {
  const a = berlinParts(start);
  const b = berlinParts(end);
  const sameDay = a.ymd === b.ymd;
  const endsAtMidnight = b.hour === 0 && b.minute === 0 && berlinParts(end - 1).ymd === a.ymd;
  if (sameDay || endsAtMidnight) {
    const endLabel = endsAtMidnight ? '24:00' : formatTime(end);
    return `${formatDateShort(start)}, ${formatTime(start)} – ${endLabel} Uhr`;
  }
  return `${formatDateShort(start)}, ${formatTime(start)} – ${formatDateShort(end)}, ${formatTime(end)} Uhr`;
}

/** Nur die Uhrzeiten: „02:00 – 06:00 Uhr“ (Tageswechsel wird über formatRange abgedeckt). */
export function formatTimeRange(start, end) {
  const b = berlinParts(end);
  const endsAtMidnight = b.hour === 0 && b.minute === 0;
  return `${formatTime(start)} – ${endsAtMidnight ? '24:00' : formatTime(end)} Uhr`;
}

/** „vor 3 Minuten“, „vor 2 Stunden“ – grob, für die Statuszeile. */
export function formatAgo(ts, now) {
  const diffMin = Math.max(0, Math.round((now - ts) / 60_000));
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} ${diffMin === 1 ? 'Minute' : 'Minuten'}`;
  const h = Math.round(diffMin / 60);
  if (h < 48) return `vor ${h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
  const d = Math.round(h / 24);
  return `vor ${d} Tagen`;
}

/** „in 12 Minuten“ */
export function formatIn(ts, now) {
  const diffMin = Math.max(0, Math.round((ts - now) / 60_000));
  if (diffMin < 1) return 'in weniger als einer Minute';
  return `in ${diffMin} ${diffMin === 1 ? 'Minute' : 'Minuten'}`;
}

/** Stunden als „36 h“ / „4 h“ */
export function formatHours(h) {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(h)} h`;
}
