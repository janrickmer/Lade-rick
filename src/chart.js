// SVG-Preisverlauf ohne Abhängigkeiten: Stufenlinie mit Flächenfüllung, oranges Band für das günstigste
// kommende 4-h-Fenster (nie ein vergangenes) mit seiner Uhrzeit darüber, „Jetzt“-Linie, Vergangenheit als Tonfläche,
// Crosshair mit Tooltip (Desktop) bzw. Ablesezeile (Mobil, folgt dem Finger) und Tastaturnavigation.

import { HOUR, MINUTE, currentPoint, floorToResolution } from './analysis.js';
import {
  formatCt, formatMwh, formatTime, formatEndTime, formatDateShort, formatRange, berlinParts, typographicMinus,
  isAmbiguousWallTime, formatZone,
} from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHEAPEST_TAG = 'günstigstes kommendes Fenster';
const MARGIN = { top: 26, right: 14, bottom: 42, left: 46 };
const TICK_STEPS_H = [3, 6, 12, 24];
const MIN_LABEL_PX = 48;
const MIN_LABEL_PX_SHORT = 34;
/** Dauer, in der die Eingangsbewegung nach dem ersten Zeichnen mit Daten weiterläuft (ms) */
const ENTER_MS = 900;

function svgEl(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, str, cls, attrs = {}) {
  const t = svgEl('text', { x, y, class: cls, ...attrs }, parent);
  t.textContent = str;
  return t;
}

/** Zeitstempel für eine Berliner Ortszeit (ymd, Stunde). Bei doppelter Stunde (Zeitumstellung) die erste. */
export function berlinLocalToTs(ymd, hour) {
  const hh = String(hour).padStart(2, '0');
  for (const offset of ['+02:00', '+01:00']) {
    const ts = Date.parse(`${ymd}T${hh}:00:00${offset}`);
    const parts = berlinParts(ts);
    if (parts.ymd === ymd && parts.hour === hour && parts.minute === 0) return ts;
  }
  return null;
}

/** Alle Berliner Mitternachten im Bereich [from, to]. */
export function berlinMidnights(from, to) {
  const out = [];
  const seen = new Set();
  for (let t = from - 26 * HOUR; t <= to + 26 * HOUR; t += 12 * HOUR) {
    const { ymd } = berlinParts(t);
    if (seen.has(ymd)) continue;
    seen.add(ymd);
    const ts = berlinLocalToTs(ymd, 0);
    if (ts !== null && ts >= from && ts <= to) out.push(ts);
  }
  return out.sort((a, b) => a - b);
}

/** Achsen-Ticks (Berliner Ortszeit, Vielfache von stepHours) im Bereich [from, to]. */
export function timeTicks(from, to, stepHours) {
  const ticks = [];
  const seen = new Set();
  for (let t = from - 26 * HOUR; t <= to + 26 * HOUR; t += 12 * HOUR) {
    const { ymd } = berlinParts(t);
    if (seen.has(ymd)) continue;
    seen.add(ymd);
    for (let h = 0; h < 24; h += stepHours) {
      const ts = berlinLocalToTs(ymd, h);
      if (ts !== null && ts >= from && ts <= to) ticks.push(ts);
    }
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

/** „So. 27.9.“ – kompakte Tagesbeschriftung für schmale Diagramme. */
function shortDayLabel(ts) {
  const { ymd } = berlinParts(ts);
  const [, mm, dd] = ymd.split('-');
  const weekday = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(new Date(ts));
  return `${weekday} ${Number(dd)}.${Number(mm)}.`;
}

/** „11–15“ bzw. „11:15–15:15“ – kurze Fensterzeit für die Beschriftung über dem Band (ohne „Uhr“). */
function bandTimeLabel(start, end) {
  const a = formatTime(start);
  const b = formatEndTime(end);
  const whole = a.endsWith(':00') && b.endsWith(':00');
  return whole ? `${Number(a.slice(0, 2))}–${Number(b.slice(0, 2))}` : `${a}–${b}`;
}

const dfWeekdayShort = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short' });

/** „Di. 11:45–12:00“ – Zeitabschnitt kompakt für die einzeilige Ablesezeile (Zonenkürzel nur in der doppelten Stunde). */
function compactSlot(p) {
  const zone = isAmbiguousWallTime(p.start) ? ` ${formatZone(p.start)}` : '';
  return `${dfWeekdayShort.format(new Date(p.start))} ${formatTime(p.start)}–${formatEndTime(p.end)}${zone}`;
}

/** Breite eines SVG-Texts; vor dem ersten Layout (oder ohne Layout-Engine) geschätzt. */
function textWidth(node) {
  const w = typeof node.getComputedTextLength === 'function' ? node.getComputedTextLength() : 0;
  return w > 0 ? w : node.textContent.length * 7.2;
}

/** „Schöne“ Schrittweite für die y-Achse (ct/kWh). */
function niceStep(span, maxTicks = 6) {
  const raw = span / Math.max(1, maxTicks);
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  return candidates.find((c) => c >= raw) ?? 100;
}

function nearestIndex(points, ts) {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].end <= ts) lo = mid + 1; else hi = mid;
  }
  if (points[lo].start > ts && lo > 0 && ts - points[lo - 1].end < points[lo].start - ts) return lo - 1;
  return lo;
}

export class PriceChart {
  /**
   * @param {HTMLElement} container Element mit tabindex=0 (Tastaturnavigation)
   * @param {{ readout?:HTMLElement, output?:HTMLElement }} opts
   */
  constructor(container, { readout = null, output = null } = {}) {
    this.container = container;
    this.readout = readout;
    this.output = output;
    this.state = null;
    this.visible = [];
    this.selected = -1;
    this.pinned = false;
    this.layout = null;
    this.enterStart = 0; // Beginn der Eingangsbewegung (erstes Zeichnen mit Daten), performance.now()
    this.touch = null; // laufende Fingergeste: { id, prevTs, prevPinned }
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.hidden = true;
    this.container.appendChild(this.tooltip);

    this.onKey = this.onKey.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onOutsidePointer = this.onOutsidePointer.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    container.addEventListener('keydown', this.onKey);
    container.addEventListener('focus', this.onFocus);
    container.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerdown', this.onOutsidePointer);
    // Ende einer Fingergeste am Fenster abfangen: Die Trefferfläche wird bei jedem Zeichnen ersetzt (jede Minute),
    // und der Finger kann außerhalb des Diagramms losgelassen werden.
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);

    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(container);
    }
  }

  /**
   * @param {{ points:Array<{start:number,end:number,price:number}>, now:number, cheapest?:object|null,
   *           range?:{start:number,end:number}, viewStart?:number, viewEnd?:number, resolutionMinutes:number }} state
   */
  update(state) {
    const keepTs = this.selected >= 0 && this.visible[this.selected] ? this.visible[this.selected].start : null;
    const keepPinned = this.pinned;
    this.state = state;
    this.selected = -1;
    this.pinned = false;
    this.render();
    if (keepTs !== null) {
      const i = this.visible.findIndex((p) => p.start === keepTs);
      if (i >= 0) { this.select(i); this.pinned = keepPinned; } else this.clearSelection();
    } else {
      this.clearSelection();
    }
  }

  destroy() {
    this.ro?.disconnect();
    this.container.removeEventListener('keydown', this.onKey);
    this.container.removeEventListener('focus', this.onFocus);
    this.container.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerdown', this.onOutsidePointer);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
  }

  // ---------- Rendering ----------

  render() {
    const c = this.container;
    const width = c.clientWidth;
    const height = c.clientHeight;
    const old = c.querySelector('svg, .chart-empty');
    if (old) old.remove();
    if (!this.state || !width || !height) return;

    const { points, now, range, resolutionMinutes } = this.state;
    const cheapest = this.state.cheapest ?? null; // günstigstes kommendes Fenster (beginnt nie vor „jetzt“)
    const res = resolutionMinutes || 15;
    const nowFloor = floorToResolution(now, res);
    const lastEnd = points.length ? points[points.length - 1].end : now;
    const xMin = this.state.viewStart ?? range?.start ?? (points[0]?.start ?? now - 36 * HOUR);
    const xMax = this.state.viewEnd ?? Math.max(lastEnd, nowFloor + res * MINUTE, xMin + HOUR);
    const visible = points.filter((p) => p.end > xMin && p.start < xMax);
    this.visible = visible;

    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'chart-empty';
      empty.textContent = 'Für diesen Zeitraum liegen keine Preisdaten vor.';
      c.appendChild(empty);
      this.layout = null;
      return;
    }

    const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
    const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom);
    const prices = visible.map((p) => p.price / 10);
    let yMin = Math.min(0, ...prices);
    let yMax = Math.max(0, ...prices);
    const span = Math.max(yMax - yMin, 1);
    const pad = span * 0.06;
    yMax += pad;
    if (yMin < 0) yMin -= pad;
    const x = (t) => MARGIN.left + ((t - xMin) / (xMax - xMin)) * plotW;
    const y = (v) => MARGIN.top + ((yMax - v) / (yMax - yMin)) * plotH;
    this.layout = { x, y, xMin, xMax, plotW, plotH, width, height };

    const svg = svgEl('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-labelledby': 'chart-title', 'aria-describedby': 'chart-desc',
    });
    // Eingangsbewegung nur beim ersten Zeichnen mit Daten (spätere Neuberechnungen jede Minute bleiben ruhig). Wird in
    // dieser Zeit neu gezeichnet (erst Zwischenspeicher, dann Netzabruf), läuft sie weiter, statt neu zu beginnen:
    // --enter-elapsed verschiebt die Startzeit der Animationen um die schon vergangene Zeit.
    const tNow = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!this.enterStart) this.enterStart = tNow;
    const elapsed = tNow - this.enterStart;
    if (elapsed < ENTER_MS) {
      svg.classList.add('is-entering');
      svg.style.setProperty('--enter-elapsed', `${Math.round(elapsed)}ms`);
    }
    c.insertBefore(svg, this.tooltip); // schon jetzt im Dokument, damit Beschriftungen gemessen werden können
    const desc = svgEl('desc', { id: 'chart-desc' }, svg);
    desc.textContent = this.describe(visible, xMin, xMax);

    // Ebenen von unten nach oben: Tonfläche, Fläche unter der Kurve, Fensterband (deckend, damit es einfarbig bleibt),
    // Gitter und Nulllinie (auch im Fenster ablesbar), Linien, Markierungen, Achsen, Auswahl
    const gRegions = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gArea = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gBand = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gGrid = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gData = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gAnno = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gAxis = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gHover = svgEl('g', { 'aria-hidden': 'true', class: 'hover-layer' }, svg);
    gHover.setAttribute('visibility', 'hidden');
    this.hoverLayer = gHover;

    // Vergangenheit als leichte Tonfläche (keine Linie): links von „jetzt“
    const pastEnd = Math.min(Math.max(now, xMin), xMax);
    if (pastEnd > xMin) {
      svgEl('rect', { class: 'region-past', x: x(xMin), y: MARGIN.top, width: x(pastEnd) - x(xMin), height: plotH }, gRegions);
    }
    // Oranges Band für das günstigste kommende Fenster (dieselbe Farbe wie die Antwortfläche)
    let band = null;
    if (cheapest && cheapest.end > xMin && cheapest.start < xMax) {
      // Linke Kante nie vor der (auf Pixel gerundeten) Jetzt-Linie – das Fenster beginnt nach „jetzt“
      const nowLineX = now >= xMin && now <= xMax ? Math.round(x(now)) + 0.5 : -Infinity;
      const bx = Math.max(x(Math.max(cheapest.start, xMin)), nowLineX);
      const bw = Math.max(0, x(Math.min(cheapest.end, xMax)) - bx);
      svgEl('rect', { class: 'band-cheapest', x: bx, y: MARGIN.top, width: bw, height: plotH }, gBand);
      const short = bandTimeLabel(cheapest.start, cheapest.end);
      band = { cx: bx + bw / 2, label: `${short}\u00a0Uhr`, short };
    }

    // Gitter + y-Achse (ganze Zahlen, solange die Schrittweite ganzzahlig ist)
    const step = niceStep(yMax - yMin);
    const digits = step >= 1 ? 0 : 1;
    const nfTick = new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const firstTick = Math.ceil(yMin / step) * step;
    for (let v = firstTick; v <= yMax + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      const isZero = Math.abs(v) < 1e-9;
      svgEl('line', { class: isZero ? 'zero-line' : 'grid-line', x1: MARGIN.left, x2: MARGIN.left + plotW, y1: yy, y2: yy }, gGrid);
      text(gAxis, MARGIN.left - 6, yy + 4, typographicMinus(nfTick.format(isZero ? 0 : v)), 'y-label', { 'text-anchor': 'end' });
    }
    if (yMin >= 0) svgEl('line', { class: 'zero-line', x1: MARGIN.left, x2: MARGIN.left + plotW, y1: Math.round(y(0)) + 0.5, y2: Math.round(y(0)) + 0.5 }, gGrid);
    text(gAxis, MARGIN.left - 6, MARGIN.top - 10, 'ct/kWh', 'y-label', { 'text-anchor': 'end' });

    // Stufenlinie + Fläche je lückenlosem Abschnitt
    const segments = [];
    let seg = [];
    for (const p of visible) {
      if (seg.length && seg[seg.length - 1].end !== p.start) { segments.push(seg); seg = []; }
      seg.push(p);
    }
    if (seg.length) segments.push(seg);
    const y0 = y(0);
    // Vergangenheit grau, Zukunft in voller Textfarbe mit leichter Fläche; Wechsel genau bei „jetzt“
    const split = Math.min(Math.max(now, xMin), xMax);
    for (const s of segments) {
      const past = s.filter((p) => p.start < split);
      const future = s.filter((p) => p.end > split);
      if (past.length) svgEl('path', { class: 'line-past', d: this.stepPath(past, x, y, xMin, split) }, gData);
      if (future.length) {
        const fStart = Math.max(future[0].start, split);
        const d = this.stepPath(future, x, y, split, xMax);
        svgEl('path', { class: 'area', d: `${d} V ${y0.toFixed(1)} H ${x(fStart).toFixed(1)} Z` }, gArea);
        svgEl('path', { class: 'line', d }, gData);
      }
    }
    if (cheapest) {
      const inSlot = visible.filter((p) => p.end > cheapest.start && p.start < cheapest.end);
      const segs = [];
      let cur = [];
      for (const p of inSlot) {
        if (cur.length && cur[cur.length - 1].end !== p.start) { segs.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push(cur);
      for (const s of segs) svgEl('path', { class: 'line-cheapest', d: this.stepPath(s, x, y, Math.max(xMin, cheapest.start), Math.min(xMax, cheapest.end)) }, gData);
    }

    // Jetzt: feine Linie, Punkt auf der Kurve, Beschriftung; darüber die Uhrzeit des Fensters (verbindet Antwort und Band)
    const plotL = MARGIN.left;
    const plotR = MARGIN.left + plotW;
    const labelY = MARGIN.top - 8;
    let nowBox = null;
    if (now >= xMin && now <= xMax) {
      const nx = Math.round(x(now)) + 0.5;
      svgEl('line', { class: 'now-line', x1: nx, x2: nx, y1: MARGIN.top - 4, y2: MARGIN.top + plotH }, gAnno);
      const nowLabel = text(gAnno, nx + 6, labelY, 'jetzt', 'now-label');
      const w = textWidth(nowLabel);
      nowBox = { l: nx + 6, r: nx + 6 + w, nx, w, node: nowLabel };
      if (nowBox.r > plotR) this.placeLeft(nowBox, plotL);
      const cur = visible.find((p) => p.start <= now && now < p.end);
      if (cur) svgEl('circle', { class: 'now-dot', r: 5, cx: nx, cy: y(cur.price / 10).toFixed(1) }, gAnno);
    }
    if (band) {
      // Fensterzeit mittig über dem Band. Stößt sie an „jetzt“, rückt „jetzt“ links neben die Linie und die Fensterzeit
      // rechts daneben – nie über den rechten Rand des Diagramms hinaus. Reicht der Platz nicht, entfällt erst „Uhr“,
      // dann das Wort „jetzt“ (Linie, Punkt und Ablesezeile zeigen „jetzt“ weiterhin).
      const node = text(gAnno, 0, labelY, band.label, 'band-label');
      const gap = 8;
      const maxR = width - 2;
      const hits = (l, w) => Boolean(nowBox) && l < nowBox.r + gap && l + w > nowBox.l - gap;
      const place = (w) => {
        let l = Math.min(Math.max(band.cx - w / 2, plotL), plotR - w);
        if (hits(l, w)) {
          this.placeLeft(nowBox, plotL);
          if (hits(l, w)) l = Math.min(nowBox.r + gap, maxR - w);
        }
        return l;
      };
      let w = textWidth(node);
      let l = place(w);
      if (hits(l, w)) {
        node.textContent = band.short;
        w = textWidth(node);
        l = place(w);
      }
      if (hits(l, w)) {
        nowBox.node.remove();
        nowBox = null;
        l = Math.min(Math.max(band.cx - w / 2, plotL), maxR - w);
      }
      node.setAttribute('x', Math.max(0, l).toFixed(1));
    }

    // x-Achse: Uhrzeiten + Tage
    svgEl('line', { class: 'axis-line', x1: MARGIN.left, x2: MARGIN.left + plotW, y1: MARGIN.top + plotH + 0.5, y2: MARGIN.top + plotH + 0.5 }, gGrid);
    const spanHours = (xMax - xMin) / HOUR;
    const short = plotW < 520;
    const stepH = TICK_STEPS_H.find((h) => plotW / (spanHours / h) >= (short ? MIN_LABEL_PX_SHORT : MIN_LABEL_PX)) ?? 24;
    for (const t of timeTicks(xMin, xMax, stepH)) {
      const tx = x(t);
      svgEl('line', { class: 'grid-line', x1: Math.round(tx) + 0.5, x2: Math.round(tx) + 0.5, y1: MARGIN.top + plotH, y2: MARGIN.top + plotH + 4 }, gGrid);
      const label = short ? formatTime(t).slice(0, 2) : formatTime(t);
      text(gAxis, tx, MARGIN.top + plotH + 16, label, 'x-label', { 'text-anchor': 'middle' });
    }
    const midnights = berlinMidnights(xMin, xMax);
    const labelFor = (t) => (short ? shortDayLabel(t) : formatDateShort(t));
    const estWidth = (label) => label.length * 6.8;
    const dayLabelAt = [...midnights];
    // Randbeschriftung nur, wenn sie nicht mit der ersten Mitternacht kollidiert (Mitternacht hat Vorrang)
    if (!midnights.length || x(midnights[0]) - x(xMin) > estWidth(labelFor(xMin)) + 8) dayLabelAt.unshift(xMin);
    let lastRight = -Infinity;
    for (const t of dayLabelAt) {
      const tx = x(t);
      const label = labelFor(t);
      const w = estWidth(label);
      if (x(xMax) - tx < w || tx + 3 < lastRight + 8) continue;
      text(gAxis, tx + 3, MARGIN.top + plotH + 32, label, 'x-day');
      lastRight = tx + 3 + w;
    }

    // Hover-Ebene
    svgEl('line', { class: 'crosshair', x1: 0, x2: 0, y1: MARGIN.top, y2: MARGIN.top + plotH }, gHover);
    svgEl('circle', { class: 'marker', r: 4.5, cx: 0, cy: 0 }, gHover);
    const hit = svgEl('rect', { class: 'hit-area', x: MARGIN.left, y: MARGIN.top - 6, width: plotW, height: plotH + 6 + MARGIN.bottom }, svg);
    hit.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    hit.addEventListener('pointermove', (e) => this.onPointerMove(e));
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.pinned) this.clearSelection(); });
    hit.addEventListener('click', () => {
      if (this.lastPointerType === 'touch') return; // Finger: Auswahl bleibt nach dem Loslassen ohnehin stehen
      this.pinned = !this.pinned;
      if (!this.pinned) this.clearSelection();
    });

    if (this.selected >= 0) this.select(this.selected);
    else this.showDefaultReadout();
  }

  /** „jetzt“ links neben die Jetzt-Linie setzen – nur, wenn es dort noch im Diagramm Platz hat. */
  placeLeft(box, minL) {
    if (box.nx - 6 - box.w < minL) return;
    box.node.setAttribute('x', (box.nx - 6).toFixed(1));
    box.node.setAttribute('text-anchor', 'end');
    box.l = box.nx - 6 - box.w;
    box.r = box.nx - 6;
  }

  stepPath(points, x, y, clipStart, clipEnd) {
    let d = '';
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const xs = x(Math.max(p.start, clipStart));
      const xe = x(Math.min(p.end, clipEnd));
      const yy = y(p.price / 10);
      if (i === 0) d += `M ${xs.toFixed(1)} ${yy.toFixed(1)} `;
      else d += `V ${yy.toFixed(1)} `;
      d += `H ${xe.toFixed(1)} `;
    }
    return d.trim();
  }

  describe(visible, xMin, xMax) {
    const { cheapest, resolutionMinutes } = this.state;
    let min = visible[0];
    let max = visible[0];
    for (const p of visible) { if (p.price < min.price) min = p; if (p.price > max.price) max = p; }
    const parts = [
      `Preisverlauf ${formatRange(xMin, xMax)} in ${resolutionMinutes === 60 ? 'Stundenwerten' : `${resolutionMinutes}-Minuten-Werten`}.`,
      `Minimum ${formatCt(min.price)} am ${formatDateShort(min.start)} um ${formatTime(min.start)} Uhr, Maximum ${formatCt(max.price)} am ${formatDateShort(max.start)} um ${formatTime(max.start)} Uhr.`,
    ];
    if (cheapest) parts.push(`Günstigstes kommendes 4-Stunden-Fenster ${formatRange(cheapest.start, cheapest.end)} mit durchschnittlich ${formatCt(cheapest.meanPrice)}.`);
    parts.push('Alle Werte stehen in der Tabelle unter dem Diagramm.');
    return parts.join(' ');
  }

  // ---------- Auswahl / Tooltip ----------

  /** Beschreibung eines Punkts für Tooltip, Ablesezeile und Screenreader. */
  describePoint(p) {
    const { now, cheapest } = this.state;
    const tags = [];
    if (cheapest && p.start >= cheapest.start && p.start < cheapest.end) tags.push(CHEAPEST_TAG);
    if (p.start <= now && now < p.end) tags.push('jetzt');
    else if (p.start > now && !tags.includes(CHEAPEST_TAG)) tags.push('kommend');
    return {
      title: formatRange(p.start, p.end),
      ct: formatCt(p.price),
      mwh: formatMwh(p.price),
      tags,
      text: `${formatRange(p.start, p.end)}: ${formatCt(p.price)} (${formatMwh(p.price)})${tags.length ? ` – ${tags.join(', ')}` : ''}`,
    };
  }

  select(index) {
    const p = this.visible[index];
    if (!p || !this.layout || !this.hoverLayer) return;
    this.selected = index;
    const { x, y, width } = this.layout;
    const cx = (x(Math.max(p.start, this.layout.xMin)) + x(Math.min(p.end, this.layout.xMax))) / 2;
    const cy = y(p.price / 10);
    const cross = this.hoverLayer.querySelector('.crosshair');
    const marker = this.hoverLayer.querySelector('.marker');
    cross.setAttribute('x1', cx.toFixed(1));
    cross.setAttribute('x2', cx.toFixed(1));
    marker.setAttribute('cx', cx.toFixed(1));
    marker.setAttribute('cy', cy.toFixed(1));
    const info = this.describePoint(p);
    marker.classList.toggle('marker-cheapest', info.tags.includes(CHEAPEST_TAG));
    this.hoverLayer.setAttribute('visibility', 'visible');

    // Tooltip (Desktop)
    this.tooltip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'tt-title';
    title.textContent = info.title;
    const value = document.createElement('div');
    value.className = 'tt-value';
    value.textContent = info.ct;
    const sub = document.createElement('div');
    sub.className = 'tt-tag';
    sub.textContent = info.tags.length ? `${info.mwh} · ${info.tags.join(' · ')}` : info.mwh;
    this.tooltip.append(title, value, sub);
    this.tooltip.hidden = false;
    const ttW = this.tooltip.offsetWidth || 160;
    const left = cx + 12 + ttW > width ? cx - 12 - ttW : cx + 12;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${Math.max(0, Math.min(cy - 20, this.layout.height - 80))}px`;

    // Ablesezeile (Mobil, eine Zeile: Tag, Uhrzeit, Preis, Kennzeichen; Langform in Tooltip und Screenreader-Ausgabe)
    if (this.readout) {
      const strong = document.createElement('strong');
      strong.textContent = info.ct;
      const tags = info.tags.map((t) => (t === CHEAPEST_TAG ? 'günstig' : t));
      this.readout.replaceChildren(`${compactSlot(p)} · `, strong, tags.length ? ` · ${tags.join(', ')}` : '');
    }
    if (this.output) this.output.textContent = info.text;
  }

  /** Ablesezeile ohne Auswahl: der aktuelle Preis (wie in Börsen-Apps), sonst leer. */
  showDefaultReadout() {
    if (!this.readout) return;
    const now = this.state?.now;
    const cur = Number.isFinite(now) ? this.visible.find((p) => p.start <= now && now < p.end) : null;
    if (!cur) { this.readout.textContent = '\u00a0'; return; }
    const strong = document.createElement('strong');
    strong.textContent = formatCt(cur.price);
    this.readout.replaceChildren(`Jetzt ${formatTime(cur.start)}–${formatEndTime(cur.end)} · `, strong);
  }

  clearSelection() {
    this.selected = -1;
    this.pinned = false;
    this.hoverLayer?.setAttribute('visibility', 'hidden');
    this.tooltip.hidden = true;
    this.showDefaultReadout();
    if (this.output) this.output.textContent = '';
  }

  selectNearest(ts) {
    const i = nearestIndex(this.visible, ts);
    if (i >= 0) this.select(i);
  }

  /**
   * Maus: Bewegen zeigt den Punkt, Klicken fixiert ihn. Finger: Antippen wählt den Punkt, Wischen folgt dem Finger,
   * nach dem Loslassen bleibt die Auswahl stehen. Wird die Geste zum Scrollen (pointercancel), gilt die vorige Auswahl.
   */
  onPointerDown(e) {
    this.pointerFocus = true;
    this.lastPointerType = e.pointerType;
    if (e.pointerType === 'touch') {
      // Weiterer Finger: ignorieren, sonst springt die Auswahl. Ein primärer Finger heißt dagegen, dass keiner mehr
      // aufliegt – ein übrig gebliebener Gestenzustand ist dann veraltet.
      if (this.touch && !e.isPrimary) return;
      const prev = this.selected >= 0 ? this.visible[this.selected] : null;
      this.touch = { id: e.pointerId, prevTs: prev ? prev.start : null, prevPinned: this.pinned };
    }
    this.pointAt(e);
  }

  onPointerMove(e) {
    if (e.pointerType === 'touch') {
      if (this.touch?.id === e.pointerId) this.pointAt(e);
      return;
    }
    if (!this.pinned) this.pointAt(e);
  }

  onPointerUp(e) {
    if (this.touch?.id !== e.pointerId) return;
    this.touch = null;
    this.pinned = true;
  }

  onPointerCancel(e) {
    if (this.touch?.id !== e.pointerId) return;
    const { prevTs, prevPinned } = this.touch;
    this.touch = null;
    const i = prevTs === null ? -1 : this.visible.findIndex((p) => p.start === prevTs);
    if (i >= 0) { this.select(i); this.pinned = prevPinned; } else this.clearSelection();
  }

  /** Tippen oder Klicken außerhalb des Diagramms hebt eine Auswahl auf. */
  onOutsidePointer(e) {
    if (this.selected >= 0 && e.target instanceof Node && !this.container.contains(e.target)) this.clearSelection();
  }

  pointAt(e) {
    if (!this.layout) return;
    const rect = this.container.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const { xMin, xMax, plotW } = this.layout;
    const ts = xMin + ((px - MARGIN.left) / plotW) * (xMax - xMin);
    const i = nearestIndex(this.visible, Math.max(xMin, Math.min(xMax - 1, ts)));
    if (i >= 0) this.select(i);
  }

  onFocus() {
    if (this.pointerFocus) { this.pointerFocus = false; return; } // Fokus durch Zeiger/Tippen: Auswahl bleibt
    if (this.selected < 0 && this.state) this.selectNearest(this.state.now);
  }

  onBlur() {
    if (!this.pinned) this.clearSelection();
  }

  onKey(e) {
    if (!this.visible.length || e.altKey || e.ctrlKey || e.metaKey) return;
    const last = this.visible.length - 1;
    const from = () => (this.selected < 0 ? nearestIndex(this.visible, this.state.now) : this.selected);
    // Bild auf/ab: eine Stunde weiter bzw. zurück (mit Umschalt einen Tag), unabhängig von der Auflösung
    const jump = (hours) => nearestIndex(this.visible, this.visible[from()].start + hours * HOUR);
    const { cheapest } = this.state;
    let next = null;
    switch (e.key) {
      case 'ArrowLeft': next = this.selected < 0 ? from() : Math.max(0, this.selected - 1); break;
      case 'ArrowRight': next = this.selected < 0 ? from() : Math.min(last, this.selected + 1); break;
      case 'PageUp': next = jump(e.shiftKey ? 24 : 1); break;
      case 'PageDown': next = jump(e.shiftKey ? -24 : -1); break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      case 'g': case 'G':
        if (!cheapest || !this.layout || cheapest.end <= this.layout.xMin || cheapest.start >= this.layout.xMax) return;
        next = nearestIndex(this.visible, Math.max(cheapest.start, this.layout.xMin));
        break;
      case 'Escape': this.clearSelection(); e.preventDefault(); return;
      case 'Enter': case ' ': this.pinned = !this.pinned; e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    this.pinned = true;
    this.select(next);
  }
}

export { currentPoint };
