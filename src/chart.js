// SVG-Preisverlauf ohne Abhängigkeiten: Stufenlinie mit Flächenfüllung, Band für das günstigste
// Fenster, gestrichelter Rahmen für den Ausblick, „Jetzt“-Linie, Bereich der kommenden Preise,
// Crosshair mit Tooltip (Desktop) bzw. Ablesezeile (Mobil) und Tastaturnavigation.

import { HOUR, MINUTE, currentPoint, floorToResolution } from './analysis.js';
import { formatCt, formatMwh, formatTime, formatDateShort, formatRange, berlinParts } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = { top: 26, right: 14, bottom: 42, left: 46 };
const TICK_STEPS_H = [3, 6, 12, 24];
const MIN_LABEL_PX = 48;
const MIN_LABEL_PX_SHORT = 34;

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
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.hidden = true;
    this.container.appendChild(this.tooltip);

    this.onKey = this.onKey.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    container.addEventListener('keydown', this.onKey);
    container.addEventListener('focus', this.onFocus);
    container.addEventListener('blur', this.onBlur);

    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(container);
    }
  }

  /**
   * @param {{ points:Array<{start:number,end:number,price:number}>, now:number, slot?:object|null, upcoming?:object|null,
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
  }

  // ---------- Rendering ----------

  render() {
    const c = this.container;
    const width = c.clientWidth;
    const height = c.clientHeight;
    const old = c.querySelector('svg, .chart-empty');
    if (old) old.remove();
    if (!this.state || !width || !height) return;

    const { points, now, slot, upcoming, range, resolutionMinutes } = this.state;
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
    const desc = svgEl('desc', { id: 'chart-desc' }, svg);
    desc.textContent = this.describe(visible, xMin, xMax);

    const gRegions = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gGrid = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gData = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gAnno = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gAxis = svgEl('g', { 'aria-hidden': 'true' }, svg);
    const gHover = svgEl('g', { 'aria-hidden': 'true', class: 'hover-layer' }, svg);
    gHover.setAttribute('visibility', 'hidden');
    this.hoverLayer = gHover;

    // Bereich der kommenden (bereits bekannten) Preise
    const futureStart = Math.max(xMin, nowFloor + res * MINUTE);
    if (lastEnd > futureStart) {
      svgEl('rect', { class: 'region-future', x: x(futureStart), y: MARGIN.top, width: x(Math.min(lastEnd, xMax)) - x(futureStart), height: plotH }, gRegions);
      if (x(Math.min(lastEnd, xMax)) - x(futureStart) > 70) text(gRegions, x(futureStart) + 6, MARGIN.top + 14, 'kommend', 'region-label');
    }

    // Band für das günstigste Fenster
    if (slot && slot.end > xMin && slot.start < xMax) {
      const bx = x(Math.max(slot.start, xMin));
      const bw = x(Math.min(slot.end, xMax)) - bx;
      svgEl('rect', { class: 'band-cheapest', x: bx, y: MARGIN.top, width: bw, height: plotH }, gRegions);
      const label = bw >= 130 ? 'günstigstes 4-h-Fenster' : bw >= 44 ? 'günstig' : null;
      if (label) text(gRegions, bx + 6, MARGIN.top + plotH - 8, label, 'band-label');
    }

    // Gitter + y-Achse
    const step = niceStep(yMax - yMin);
    const firstTick = Math.ceil(yMin / step) * step;
    for (let v = firstTick; v <= yMax + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      const isZero = Math.abs(v) < 1e-9;
      svgEl('line', { class: isZero ? 'zero-line' : 'grid-line', x1: MARGIN.left, x2: MARGIN.left + plotW, y1: yy, y2: yy }, gGrid);
      text(gAxis, MARGIN.left - 6, yy + 4, formatCt(isZero ? 0 : v * 10, { unit: false }), 'y-label', { 'text-anchor': 'end' });
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
    for (const s of segments) {
      const d = this.stepPath(s, x, y, xMin, xMax);
      svgEl('path', { class: 'area', d: `${d} V ${y0.toFixed(1)} H ${x(Math.max(s[0].start, xMin)).toFixed(1)} Z` }, gData);
      svgEl('path', { class: 'line', d }, gData);
    }
    if (slot) {
      const inSlot = visible.filter((p) => p.end > slot.start && p.start < slot.end);
      const segs = [];
      let cur = [];
      for (const p of inSlot) {
        if (cur.length && cur[cur.length - 1].end !== p.start) { segs.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push(cur);
      for (const s of segs) svgEl('path', { class: 'line-cheapest', d: this.stepPath(s, x, y, Math.max(xMin, slot.start), Math.min(xMax, slot.end)) }, gData);
    }

    // Ausblick-Rahmen
    if (upcoming && upcoming.end > xMin && upcoming.start < xMax) {
      const ux = x(Math.max(upcoming.start, xMin));
      const uw = x(Math.min(upcoming.end, xMax)) - ux;
      svgEl('rect', { class: 'outlook-box', x: ux + 0.75, y: MARGIN.top + 0.75, width: Math.max(0, uw - 1.5), height: plotH - 1.5, rx: 3 }, gAnno);
      if (uw >= 52) text(gAnno, ux + 6, MARGIN.top + plotH - 8, 'Ausblick', 'band-label');
    }

    // Jetzt-Linie
    if (now >= xMin && now <= xMax) {
      const nx = Math.round(x(now)) + 0.5;
      svgEl('line', { class: 'now-line', x1: nx, x2: nx, y1: MARGIN.top - 4, y2: MARGIN.top + plotH }, gAnno);
      const anchor = nx > MARGIN.left + plotW - 40 ? 'end' : 'start';
      text(gAnno, anchor === 'end' ? nx - 4 : nx + 4, MARGIN.top - 8, 'Jetzt', 'now-label', { 'text-anchor': anchor });
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
    hit.addEventListener('pointermove', (e) => this.onPointer(e));
    hit.addEventListener('pointerdown', (e) => {
      this.pointerFocus = true;
      this.lastPointerType = e.pointerType;
      this.onPointer(e, true);
      if (e.pointerType === 'touch') this.pinned = true;
    });
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.pinned) this.clearSelection(); });
    hit.addEventListener('click', () => {
      if (this.lastPointerType === 'touch') return; // Tippen wählt und fixiert bereits (pointerdown)
      this.pinned = !this.pinned;
      if (!this.pinned) this.clearSelection();
    });

    c.insertBefore(svg, this.tooltip);
    if (this.selected >= 0) this.select(this.selected);
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
    const { slot, resolutionMinutes } = this.state;
    let min = visible[0];
    let max = visible[0];
    for (const p of visible) { if (p.price < min.price) min = p; if (p.price > max.price) max = p; }
    const parts = [
      `Preisverlauf ${formatRange(xMin, xMax)} in ${resolutionMinutes === 60 ? 'Stundenwerten' : `${resolutionMinutes}-Minuten-Werten`}.`,
      `Minimum ${formatCt(min.price)} am ${formatDateShort(min.start)} um ${formatTime(min.start)} Uhr, Maximum ${formatCt(max.price)} am ${formatDateShort(max.start)} um ${formatTime(max.start)} Uhr.`,
    ];
    if (slot) parts.push(`Günstigstes 4-Stunden-Fenster ${formatRange(slot.start, slot.end)} mit durchschnittlich ${formatCt(slot.meanPrice)}.`);
    parts.push('Alle Werte stehen in der Tabelle unter dem Diagramm.');
    return parts.join(' ');
  }

  // ---------- Auswahl / Tooltip ----------

  /** Beschreibung eines Punkts für Tooltip, Ablesezeile und Screenreader. */
  describePoint(p) {
    const { now, slot, upcoming } = this.state;
    const tags = [];
    if (slot && p.start >= slot.start && p.start < slot.end) tags.push('günstigstes Fenster');
    if (p.start <= now && now < p.end) tags.push('jetzt');
    else if (p.start > now) tags.push('kommend');
    if (upcoming && p.start >= upcoming.start && p.start < upcoming.end) tags.push('Ausblick');
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
    marker.classList.toggle('marker-cheapest', info.tags.includes('günstigstes Fenster'));
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

    // Ablesezeile (Mobil) + Screenreader-Ausgabe
    if (this.readout) {
      this.readout.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = info.ct;
      this.readout.append(`${info.title} · `, strong, ` · ${info.mwh}${info.tags.length ? ` · ${info.tags.join(', ')}` : ''}`);
    }
    if (this.output) this.output.textContent = info.text;
  }

  clearSelection() {
    this.selected = -1;
    this.pinned = false;
    this.hoverLayer?.setAttribute('visibility', 'hidden');
    this.tooltip.hidden = true;
    if (this.readout) this.readout.textContent = ' ';
  }

  selectNearest(ts) {
    const i = nearestIndex(this.visible, ts);
    if (i >= 0) this.select(i);
  }

  onPointer(e, pin = false) {
    if (!this.layout) return;
    if (this.pinned && !pin) return;
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
    let next = null;
    switch (e.key) {
      case 'ArrowLeft': next = this.selected < 0 ? nearestIndex(this.visible, this.state.now) : Math.max(0, this.selected - 1); break;
      case 'ArrowRight': next = this.selected < 0 ? nearestIndex(this.visible, this.state.now) : Math.min(last, this.selected + 1); break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
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
