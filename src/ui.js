// DOM-Rendering der Karten, Kennzahlen, Tabelle, Status- und Fehlerzustände.
// Alle dynamischen Inhalte werden per textContent gesetzt (keine innerHTML-Verkettung mit Fremddaten).

import {
  formatCt, formatMwh, formatComparison, formatWindow, formatRange, formatTimeRange, formatTime, formatDateShort,
  formatDateTime, formatAgo, formatIn, berlinParts, formatEndTime,
} from './format.js';
import { HOUR } from './analysis.js';
import { config } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);

const SOURCE_SHORT = {
  smard: 'SMARD.de',
  'energy-charts': 'Energy-Charts',
  awattar: 'aWATTar',
  snapshot: 'Zwischenspeicher',
};

/** Menschenlesbarer Quellname für die Statuszeile (mit Lizenz). */
export function sourceLabel(meta) {
  if (!meta) return 'unbekannt';
  switch (meta.id) {
    case 'smard': return 'Bundesnetzagentur | SMARD.de (CC BY 4.0)';
    case 'energy-charts': return 'Bundesnetzagentur | SMARD.de via Energy-Charts (Fraunhofer ISE), CC BY 4.0';
    case 'awattar': return 'aWATTar-API (EPEX-SPOT-Day-Ahead-Preise)';
    default: return meta.name ?? meta.id;
  }
}

export function shortName(id) {
  return SOURCE_SHORT[id] ?? id;
}

function setField(root, name, value) {
  const el = root.querySelector(`[data-field="${name}"]`);
  if (!el) return null;
  if (value === null || value === undefined || value === '') {
    el.textContent = '';
  } else {
    el.textContent = value;
  }
  return el;
}

function setChips(root, name, chips) {
  const el = root.querySelector(`[data-field="${name}"]`);
  if (!el) return;
  el.replaceChildren();
  for (const chip of chips) {
    const span = document.createElement('span');
    span.className = `chip${chip.warn ? ' chip-warn' : ''}`;
    span.textContent = chip.text;
    if (chip.title) span.title = chip.title;
    el.appendChild(span);
  }
}

const NEGATIVE_HINT = 'Überangebot (viel Wind und Sonne) – Erzeuger zahlen für die Abnahme.';

/** „bis Di., 24:00 Uhr“ für den letzten bekannten Zeitpunkt (Slot-Ende). */
export function formatKnownUntil(ts) {
  return `${formatDateShort(ts - 1)}, ${formatEndTime(ts)} Uhr`;
}

// ---------- Hero (vergangene 36 h) ----------

/**
 * @param {ReturnType<import('./analysis.js').cheapestSlot>} result
 * @param {{ now:number }} ctx
 */
export function renderHero(result, { now }) {
  const root = $('#hero');
  root.dataset.state = 'ready';
  const empty = $('[data-field="empty"]', root);
  const lookback = result?.lookbackHours ?? 36;
  const rangeLabel = `der letzten ${lookback} h`;

  if (!result || !result.slot) {
    setField(root, 'day', '');
    setField(root, 'time', '–');
    setField(root, 'ct', '–');
    setField(root, 'mwh', '');
    setField(root, 'compare', '');
    setField(root, 'note', '');
    setChips(root, 'flags', []);
    setField(root, 'ended', '');
    setField(root, 'range', result?.range ? rangeText(result) : '');
    empty.hidden = false;
    empty.textContent = `In den vorliegenden Daten gibt es kein ausreichend vollständiges 4-Stunden-Fenster innerhalb der letzten ${lookback} Stunden.`;
    return;
  }
  empty.hidden = true;
  const { slot } = result;
  const w = formatWindow(slot.start, slot.end, { now });
  setField(root, 'day', w.overline);
  setField(root, 'time', w.main).dataset.dst = w.dst ? 'true' : 'false';
  setField(root, 'note', w.note ? `Fenster über die Zeitumstellung: ${w.note}.` : '');
  setField(root, 'ct', formatCt(slot.meanPrice));
  setField(root, 'mwh', `(≈ ${formatMwh(slot.meanPrice)})`);
  setField(root, 'compare', formatComparison(slot.meanPrice, result.rangeMean, { rangeLabel }) ?? '');
  const chips = [];
  if (slot.meanPrice < 0) chips.push({ text: 'negativer Preis', title: NEGATIVE_HINT });
  if (slot.partial) chips.push({ text: `Datenlücke – Näherung (${Math.round(slot.coverage * 100)} % der Werte)`, warn: true });
  setChips(root, 'flags', chips);
  const endedAgo = now - slot.end;
  setField(root, 'ended', endedAgo >= 0 ? `Endete ${formatAgo(slot.end, now)}.` : '');
  setField(root, 'range', rangeText(result));
}

function rangeText(result) {
  const { range, lookbackHours } = result;
  const covered = Math.round((range.coveredMs / HOUR) * 10) / 10;
  const base = `Analysiert: ${formatRange(range.start, range.end)}`;
  if (range.coverage >= 0.999) return `${base} (${lookbackHours} h).`;
  if (range.coveredMs <= 0) return `${base} – keine Daten in diesem Zeitraum.`;
  const span = range.dataStart && range.dataEnd ? ` (${formatRange(range.dataStart, range.dataEnd)})` : '';
  return `${base} – Daten liegen nur für ${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(covered)} von ${lookbackHours} h vor${span}.`;
}

// ---------- Ausblick ----------

/**
 * @param {ReturnType<import('./analysis.js').cheapestUpcomingSlot>} upcoming
 * @param {{ now:number, knownUntil:number|null }} ctx
 */
export function renderOutlook(upcoming, { now, knownUntil }) {
  const root = $('#outlook');
  root.dataset.state = 'ready';
  const empty = $('[data-field="empty"]', root);
  setField(root, 'pill', knownUntil ? `Kommend · bekannt bis ${formatKnownUntil(knownUntil)}` : 'Kommend');
  if (!upcoming) {
    setField(root, 'day', '');
    setField(root, 'time', '–');
    setField(root, 'ct', '–');
    setField(root, 'mwh', '');
    setChips(root, 'flags', []);
    setField(root, 'note', '');
    setField(root, 'starts', '');
    empty.hidden = false;
    empty.textContent = 'Für die nächsten Stunden liegen noch keine 4 Stunden lückenlose Preise vor. Die Preise für morgen erscheinen täglich gegen 13 Uhr.';
    return;
  }
  empty.hidden = true;
  const w = formatWindow(upcoming.start, upcoming.end, { now });
  setField(root, 'day', w.overline);
  setField(root, 'time', w.main).dataset.dst = w.dst ? 'true' : 'false';
  setField(root, 'note', w.note ? `Fenster über die Zeitumstellung: ${w.note}.` : '');
  setField(root, 'ct', formatCt(upcoming.meanPrice));
  setField(root, 'mwh', `(≈ ${formatMwh(upcoming.meanPrice)})`);
  setChips(root, 'flags', upcoming.meanPrice < 0 ? [{ text: 'negativer Preis', title: NEGATIVE_HINT }] : []);
  if (upcoming.start > now) setField(root, 'starts', `Beginnt ${formatIn(upcoming.start, now)}.`);
  else setField(root, 'starts', `Läuft – noch bis ${formatEndTime(upcoming.end)} Uhr.`);
}

// ---------- Kennzahlen ----------

export function renderKpis({ current, result, now }) {
  const cur = $('#kpi-current');
  cur.dataset.state = 'ready';
  if (current) {
    setField(cur, 'label', `Jetzt (${formatTimeRange(current.start, current.end)})`);
    setField(cur, 'value', formatCt(current.price));
    setField(cur, 'sub', `${formatMwh(current.price)}${current.price < 0 ? ' · negativer Preis' : ''}`);
  } else {
    setField(cur, 'label', 'Jetzt');
    setField(cur, 'value', '–');
    setField(cur, 'sub', 'Für den aktuellen Zeitabschnitt liegt kein Preis vor.');
  }
  const lookback = result?.lookbackHours ?? 36;
  for (const [id, point, label] of [['#kpi-min', result?.rangeMin, 'Minimum'], ['#kpi-max', result?.rangeMax, 'Maximum']]) {
    const el = $(id);
    el.dataset.state = 'ready';
    setField(el, 'label', `${label} (${lookback} h)`);
    if (point) {
      setField(el, 'value', formatCt(point.price));
      setField(el, 'sub', `${formatDateShort(point.start)}, ${formatTime(point.start)} Uhr${point.price < 0 ? ' · negativer Preis' : ''}`);
    } else {
      setField(el, 'value', '–');
      setField(el, 'sub', '');
    }
  }
  void now;
}

// ---------- Chart-Kopf & Tabelle ----------

export function renderChartMeta({ points, view, resolutionMinutes, now }) {
  $('#chart-card').dataset.state = 'ready';
  const lastEnd = points.length ? points[points.length - 1].end : now;
  const xMin = view?.viewStart ?? (points[0]?.start ?? now);
  const xMax = view?.viewEnd ?? Math.max(lastEnd, now);
  const resLabel = resolutionMinutes === 60 ? 'Stundenwerte' : `${resolutionMinutes}-Minuten-Werte`;
  const dayLabel = view?.label ? `${view.label} · ` : '';
  $('#chart-subtitle').textContent = `${dayLabel}${formatRange(xMin, xMax)} · ${resLabel}`;
  const hint = $('#range-hint');
  if (hint) {
    hint.textContent = view?.label
      ? `${view.label}: ${formatRange(xMin, xMax)}.${view.tomorrowKnown ? '' : ' Die Preise für morgen erscheinen täglich gegen 13 Uhr.'}`
      : '';
  }
}

export function renderTable({ points, view, slot, upcoming, now }) {
  const tbody = $('#price-table tbody');
  const xMin = view?.viewStart ?? (points[0]?.start ?? now);
  const xMax = view?.viewEnd ?? Infinity;
  const rows = points.filter((p) => p.end > xMin && p.start < xMax);
  tbody.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const p of rows) {
    const tr = document.createElement('tr');
    const marks = [];
    if (slot && p.start >= slot.start && p.start < slot.end) { marks.push('günstigstes Fenster'); tr.classList.add('row-cheapest'); }
    if (p.start <= now && now < p.end) { marks.push('jetzt'); tr.classList.add('row-now'); }
    else if (p.start > now) marks.push('kommend');
    if (upcoming && p.start >= upcoming.start && p.start < upcoming.end) marks.push('Ausblick');
    const tdTime = document.createElement('td');
    const time = document.createElement('time');
    time.dateTime = new Date(p.start).toISOString();
    time.textContent = formatRange(p.start, p.end);
    tdTime.appendChild(time);
    const tdCt = document.createElement('td');
    tdCt.className = `num${p.price < 0 ? ' neg' : ''}`;
    tdCt.textContent = formatCt(p.price, { decimals: 2, unit: false });
    const tdMwh = document.createElement('td');
    tdMwh.className = 'num';
    tdMwh.textContent = formatMwh(p.price, { decimals: 2, unit: false });
    const tdMark = document.createElement('td');
    tdMark.textContent = marks.join(', ');
    tr.append(tdTime, tdCt, tdMwh, tdMark);
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  const lastEnd = rows.length ? rows[rows.length - 1].end : now;
  $('#table-caption').textContent = rows.length ? `Alle Börsenpreise ${formatRange(rows[0].start, lastEnd)} (EPEX SPOT Day-Ahead, DE-LU)` : 'Keine Werte';
  $('#table-summary').textContent = `Alle Werte als Tabelle (${rows.length} Zeilen)`;
}

// ---------- Status ----------

export function setStatusMessage(text) {
  const el = $('#status-msg');
  if (el.textContent !== text) el.textContent = text ?? '';
}

/**
 * Statuszeile unter dem Diagramm (nicht aria-live).
 * @param {{ series:object, attempts:Array, now:number, knownUntil:number|null, fromCache?:boolean }} p
 */
export function renderStatusMeta({ series, now, knownUntil }) {
  const el = $('#status-meta');
  if (!series) { el.textContent = ''; return; }
  const parts = [];
  if (series.source.id === 'snapshot') {
    parts.push(`Daten: Zwischenspeicher vom ${formatDateTime(series.fetchedAt)} Uhr${series.snapshotOf ? ` (Quelle: ${sourceLabel(series.snapshotOf)})` : ''}`);
  } else {
    parts.push(`Daten: ${sourceLabel(series.source)}`);
    const sameDay = berlinParts(series.fetchedAt).ymd === berlinParts(now).ymd;
    parts.push(`abgerufen ${sameDay ? formatTime(series.fetchedAt) : formatDateTime(series.fetchedAt)} Uhr`);
  }
  if (knownUntil) parts.push(`Preise bekannt bis ${formatKnownUntil(knownUntil)}`);
  if (series.deprecated) parts.push('Hinweis: Die Schnittstelle dieser Quelle ist als veraltet markiert');
  el.textContent = `${parts.join(' · ')}.`;
}

/** Nachricht nach erfolgreichem Laden (Fallback, Zwischenspeicher, Hinweis auf 13 Uhr). */
export function statusAfterLoad({ series, attempts, now, knownUntil }) {
  const failed = attempts.filter((a) => !a.ok && a.id !== 'snapshot').map((a) => a.id);
  const msgs = [];
  if (series.source.id === 'snapshot') {
    const when = formatDateTime(series.fetchedAt);
    msgs.push(`Live-Abruf nicht möglich – zwischengespeicherte Daten vom ${when} Uhr${series.snapshotOf ? ` (Quelle: ${shortName(series.snapshotOf.id)})` : ''}${series.stale ? ' – möglicherweise nicht aktuell' : ''}.`);
  } else if (failed.length) {
    const names = failed.map(shortName);
    msgs.push(`${names.join(' und ')} ${names.length > 1 ? 'waren' : 'war'} nicht erreichbar – die Daten stammen von ${shortName(series.source.id)}.`);
  }
  if (knownUntil) {
    const berlinHour = berlinParts(now).hour;
    const tomorrowKnown = berlinParts(knownUntil - 1).ymd > berlinParts(now).ymd;
    if (!tomorrowKnown && berlinHour < 15) msgs.push('Die Preise für morgen erscheinen täglich gegen 13 Uhr.');
    else if (!tomorrowKnown) msgs.push('Die Preise für morgen liegen in dieser Quelle noch nicht vor.');
  }
  return msgs.join(' ');
}

export function showError(attempts) {
  const card = $('#error-card');
  const text = $('#error-text');
  const live = attempts.filter((a) => a.id !== 'snapshot');
  const names = live.map((a) => shortName(a.id));
  const allInsufficient = live.length > 0 && live.every((a) => a.kind === 'insufficient');
  const someInsufficient = live.some((a) => a.kind === 'insufficient');
  if (allInsufficient) {
    text.textContent = `Die Quellen (${names.join(', ')}) waren erreichbar, lieferten aber keine ausreichenden Preisdaten für die letzten ${config.lookbackHours} Stunden.`;
  } else if (someInsufficient) {
    text.textContent = `Die Quellen (${names.join(', ')}) waren nicht erreichbar oder lieferten keine ausreichenden Preisdaten. Bitte später erneut versuchen.`;
  } else {
    text.textContent = `Keine der Quellen (${names.join(', ')}) war erreichbar. Bitte später erneut versuchen.`;
  }
  card.hidden = false;
  for (const id of ['#hero', '#outlook', '#kpi-current', '#kpi-min', '#kpi-max', '#chart-card']) {
    const el = $(id);
    if (!el || el.dataset.state !== 'loading') continue;
    el.dataset.state = 'error';
    for (const name of ['time', 'ct', 'value']) setField(el, name, '–');
  }
  setStatusMessage('Preisdaten konnten nicht geladen werden.');
  $('#retry').focus();
}

export function hideError() {
  $('#error-card').hidden = true;
}

export function setRefreshing(on) {
  document.body.dataset.refreshing = on ? 'true' : 'false';
}

export function renderOverrideBanner({ nowOverride, sourceOverride }) {
  const banner = $('#override-banner');
  const parts = [];
  if (Number.isFinite(nowOverride)) parts.push(`Testansicht: Zeitpunkt fixiert auf ${formatDateTime(nowOverride)} Uhr`);
  if (sourceOverride) parts.push(`Quelle erzwungen: ${shortName(sourceOverride)}`);
  if (!parts.length) { banner.hidden = true; return; }
  $('#override-text').textContent = parts.join(' · ');
  banner.hidden = false;
}
