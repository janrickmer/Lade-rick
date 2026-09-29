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
const dfTimeUtc = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const dfParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

const dfZone = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, timeZoneName: 'short' });
const dfDateLong = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'short' });

/** Ersetzt das ASCII-Minus am Zahlenanfang durch das typografische Minus (U+2212). */
export function typographicMinus(str) {
  return String(str).replace(/(^|\s|\()-(?=\d)/g, '$1\u2212');
}

/** EUR/MWh → ct/kWh (identische Zahl geteilt durch 10). */
export function eurPerMwhToCtPerKwh(v) {
  return v / 10;
}

/** „6,8 ct/kWh“ */
export function formatCt(eurPerMwh, { decimals = 1, unit = true } = {}) {
  const n = typographicMinus((decimals === 2 ? nfCt2 : nfCt).format(eurPerMwhToCtPerKwh(eurPerMwh)));
  return unit ? `${n} ct/kWh` : n;
}

/** „68 €/MWh“ */
export function formatMwh(eurPerMwh, { decimals = 0, unit = true } = {}) {
  const n = typographicMinus((decimals === 2 ? nfMwh2 : nfMwh).format(eurPerMwh));
  return unit ? `${n} €/MWh` : n;
}

/** „−28 %“ – relative Abweichung von `value` zu `reference` (beide EUR/MWh). null, wenn nicht sinnvoll. */
export function formatDeltaPercent(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || Math.abs(reference) < 1e-9) return null;
  const pct = ((value - reference) / Math.abs(reference)) * 100;
  return `${typographicMinus(nfPct.format(pct))}\u00a0%`;
}

/**
 * Vergleichssatz für das günstigste Fenster gegenüber dem Bereichsmittel (beide EUR/MWh).
 * Prozentangabe nur, wenn das Bereichsmittel ≥ 20 EUR/MWh (2 ct/kWh) ist – sonst absolute Differenz,
 * weil Prozentwerte bei Mitteln nahe null oder negativ irreführend sind.
 * @param {number} meanPrice Fenstermittel
 * @param {number} rangeMean Bereichsmittel
 * @param {{ rangeLabel?: string }} [opts]
 */
export function formatComparison(meanPrice, rangeMean, { rangeLabel = 'der letzten 36 h' } = {}) {
  if (!Number.isFinite(meanPrice) || !Number.isFinite(rangeMean)) return null;
  const diff = meanPrice - rangeMean; // EUR/MWh
  const avg = formatCt(rangeMean);
  if (Math.abs(diff) < 0.5) return `entspricht dem Durchschnitt ${rangeLabel} (${avg})`;
  if (rangeMean >= 20 && meanPrice >= 0) {
    const pct = Math.round((Math.abs(diff) / rangeMean) * 100);
    return diff < 0
      ? `${pct}\u00a0% günstiger als der Durchschnitt ${rangeLabel} (${avg})`
      : `${pct}\u00a0% teurer als der Durchschnitt ${rangeLabel} (${avg})`;
  }
  const abs = formatCt(Math.abs(diff));
  return diff < 0
    ? `${abs} unter dem Durchschnitt ${rangeLabel} (${avg})`
    : `${abs} über dem Durchschnitt ${rangeLabel} (${avg})`;
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

/** Beginn des Berliner Kalendertags (00:00 Europe/Berlin), in dem ts liegt, als Epoch-ms. */
export function berlinDayStart(ts) {
  const { ymd } = berlinParts(ts);
  for (const offset of ['+02:00', '+01:00']) {
    const cand = Date.parse(`${ymd}T00:00:00${offset}`);
    const p = berlinParts(cand);
    if (p.ymd === ymd && p.hour === 0 && p.minute === 0) return cand;
  }
  throw new Error(`Tagesbeginn nicht bestimmbar für ${ymd}`);
}

/** Beginn des Berliner Kalendertags `days` Tage nach (oder vor) dem Tag von ts – robust über Zeitumstellungen. */
export function berlinDayStartOffset(ts, days) {
  return berlinDayStart(berlinDayStart(ts) + days * 24 * 3_600_000 + 12 * 3_600_000);
}

/** UTC-Offset von Europe/Berlin in Minuten zum Zeitpunkt ts (60 = MEZ, 120 = MESZ). */
export function berlinOffsetMinutes(ts) {
  const p = berlinParts(ts);
  const wall = Date.parse(`${p.ymd}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00Z`);
  const tsMinute = Math.floor(ts / 60_000) * 60_000;
  return Math.round((wall - tsMinute) / 60_000);
}

/** Uhrzeit „hh:mm“ von ts, dargestellt mit dem Offset, der zum Zeitpunkt refTs galt. */
export function formatTimeAs(ts, refTs) {
  return dfTimeUtc.format(new Date(ts + berlinOffsetMinutes(refTs) * 60_000));
}

/**
 * Endzeit eines Zeitabschnitts: im Offset, der kurz vor dem Ende galt (sonst liest sich das Ende an der
 * Zeitumstellung als „02:45 – 02:00“); Mitternacht wird als „24:00“ geschrieben.
 */
export function formatEndTime(end) {
  const label = formatTimeAs(end, end - 1);
  return label === '00:00' ? '24:00' : label;
}

/** true, wenn die Wanduhrzeit von ts an diesem Tag doppelt vorkommt (Ende der Sommerzeit). */
export function isAmbiguousWallTime(ts) {
  const wall = (t) => { const p = berlinParts(t); return `${p.ymd} ${p.hour}:${p.minute}`; };
  const w = wall(ts);
  return w === wall(ts - 3_600_000) || w === wall(ts + 3_600_000);
}

/** „Mo., 28.09., 02:00 – 06:00 Uhr“ bzw. mit Tageswechsel „Mo., 28.09., 22:00 – Di., 29.09., 02:00 Uhr“. */
export function formatRange(start, end) {
  const a = berlinParts(start);
  const lastDay = berlinParts(end - 1).ymd;
  const endLabel = formatEndTime(end);
  const zone = isAmbiguousWallTime(start) ? ` (${formatZone(start)})` : '';
  if (a.ymd === lastDay) {
    return `${formatDateShort(start)}, ${formatTime(start)} – ${endLabel} Uhr${zone}`;
  }
  return `${formatDateShort(start)}, ${formatTime(start)} – ${formatDateShort(end - 1)}, ${endLabel} Uhr${zone}`;
}

/** Nur die Uhrzeiten: „02:00 – 06:00 Uhr“ (Mitternacht als 24:00, doppelte Stunde mit Zonenkürzel). */
export function formatTimeRange(start, end) {
  const zone = isAmbiguousWallTime(start) ? ` (${formatZone(start)})` : '';
  return `${formatTime(start)} – ${formatEndTime(end)} Uhr${zone}`;
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
  if (diffMin < 60) return `in ${diffMin} ${diffMin === 1 ? 'Minute' : 'Minuten'}`;
  if (diffMin < 6 * 60) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    const hours = `${h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
    return m ? `in ${hours} und ${m} ${m === 1 ? 'Minute' : 'Minuten'}` : `in ${hours}`;
  }
  const h = Math.round(diffMin / 60);
  if (h < 48) return `in etwa ${h} Stunden`;
  return `in etwa ${Math.round(h / 24)} Tagen`;
}

/** Stunden als „36 h“ / „4 h“ */
export function formatHours(h) {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(h)} h`;
}

/** Zeitzonenkürzel („MESZ“/„MEZ“) eines Zeitpunkts. */
export function formatZone(ts) {
  return dfZone.formatToParts(new Date(ts)).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** „Dienstag, 29. Sept.“ */
export function formatDateLong(ts) {
  return dfDateLong.format(new Date(ts));
}

/** „heute“, „gestern“, „morgen“ oder null – bezogen auf Kalendertage in Europe/Berlin. */
export function relativeDayWord(ts, now) {
  const a = berlinParts(ts).ymd;
  const dayOf = (t) => berlinParts(t).ymd;
  if (a === dayOf(now)) return 'heute';
  if (a === dayOf(now - 24 * 3_600_000)) return 'gestern';
  if (a === dayOf(now + 24 * 3_600_000)) return 'morgen';
  return null;
}

/** „Dienstag, 29. Sept. · heute“ */
export function formatDayLabel(ts, now) {
  const word = Number.isFinite(now) ? relativeDayWord(ts, now) : null;
  return word ? `${formatDateLong(ts)} · ${word}` : formatDateLong(ts);
}

/**
 * Zeitfenster für die Anzeige: Uhrzeiten, bei Tageswechsel beide Tage, bei Zeitumstellung innerhalb des
 * Fensters (oder genau an dessen Ende) die Zonenkürzel und ein Hinweis.
 * @returns {{ main:string, overline:string, dst:boolean, note:string|null }}
 *  main: „03:00 – 07:00 Uhr“ | „22:00 – 02:00 Uhr“ | „02:00 MESZ – 05:00 MEZ“
 *  overline: „Dienstag, 29. Sept. · heute“ | „Mo., 28. Sept. → Di., 29. Sept.“
 *  note: „4 h, Zeitumstellung“ oder null
 */
export function formatWindow(start, end, { now } = {}) {
  const a = berlinParts(start);
  const lastDay = berlinParts(end - 1).ymd;
  const sameDay = a.ymd === lastDay;
  const zoneA = formatZone(start);
  const zoneB = formatZone(end - 1);
  const zoneC = formatZone(end);
  const dst = zoneA !== zoneB || zoneB !== zoneC;
  const endLabel = formatEndTime(end);
  const hours = Math.round(((end - start) / 3_600_000) * 100) / 100;
  const main = dst
    ? `${formatTime(start)} ${zoneA} – ${endLabel} ${zoneB}`
    : `${formatTime(start)} – ${endLabel} Uhr`;
  const note = dst ? `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(hours)} h, Zeitumstellung` : null;
  const overline = sameDay
    ? formatDayLabel(start, now)
    : `${formatDateShort(start)} → ${formatDateShort(end - 1)}`;
  return { main, overline, dst, note };
}

/**
 * Sichtbarer Zeitraum des Diagramms in Kalendertagen (Europe/Berlin).
 * 1 Tag: heute. 2/3 Tage: bis einschließlich morgen, sobald mindestens eine Stunde der Morgenpreise
 * vorliegt, sonst bis einschließlich heute.
 */
export function computeView(now, lastKnownEnd, days) {
  const today = berlinDayStart(now);
  const tomorrow = berlinDayStartOffset(now, 1);
  const tomorrowKnown = Number.isFinite(lastKnownEnd) && lastKnownEnd >= tomorrow + 3_600_000;
  if (days <= 1) return { viewStart: today, viewEnd: tomorrow, tomorrowKnown, label: 'Heute' };
  const endOffset = tomorrowKnown ? 2 : 1;
  const viewEnd = berlinDayStartOffset(now, endOffset);
  const viewStart = berlinDayStartOffset(now, endOffset - days);
  const labels = {
    '2:true': 'Heute und morgen',
    '2:false': 'Gestern und heute',
    '3:true': 'Gestern bis morgen',
    '3:false': 'Vorgestern bis heute',
  };
  return { viewStart, viewEnd, tomorrowKnown, label: labels[`${days}:${tomorrowKnown}`] ?? `${days} Tage` };
}
