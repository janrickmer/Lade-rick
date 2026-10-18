// End-to-End-Tests mit Playwright (Chromium) gegen den Dev-Server; alle Quellen werden per page.route gemockt.
// Aufruf: npm run test:e2e   (Chromium: npx playwright install chromium, falls nicht vorhanden)

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, mockSources, waitForRender, nowParam, REFERENCE_NOW, buildFixtureSet, ROOT } from './helpers.js';
import { plantedPrice, syntheticPrice, toAwattar, toSmardFile } from '../fixtures/generate.js';
import { cheapestSlot, cheapestUpcomingSlot, cheapestStartTimeOfDay, normalizePoints, aggregateToResolution, HOUR, MINUTE } from '../../src/analysis.js';
import { formatWindow, formatCt, berlinParts } from '../../src/format.js';
import { config } from '../../src/config.js';

const SHOTS = resolve(ROOT, 'tests/e2e/__screenshots__');
await mkdir(SHOTS, { recursive: true });

const srv = await startServer();
const browser = await launchBrowser();
let failed = 0;
let passed = 0;

const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED|status of (4|5)\d\d/;

// Optional nur einzelne Szenarien: E2E_FILTER='Zwischenspeicher' npm run test:e2e
const FILTER = process.env.E2E_FILTER ? new RegExp(process.env.E2E_FILTER) : null;

async function scenario(name, fn, { viewport = { width: 1200, height: 900 }, colorScheme = 'light', storage = null, hasTouch = false } = {}) {
  if (FILTER && !FILTER.test(name)) return;
  const ctx = await browser.newContext({ viewport, colorScheme, hasTouch, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (storage) await page.addInitScript((s) => { for (const [k, v] of Object.entries(s)) window.localStorage.setItem(k, v); }, storage);
  try {
    await fn(page, ctx);
    assert.deepEqual(pageErrors, [], 'keine unbehandelten Fehler');
    assert.deepEqual(consoleErrors, [], 'keine Konsolenfehler (z. B. CSP)');
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`not ok - ${name}\n    ${String(err?.stack ?? err).split('\n').join('\n    ')}`);
    await page.screenshot({ path: resolve(SHOTS, `FAILED-${name.replace(/[^\w]+/g, '_')}.png`), fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const text = async (page, sel) => (await page.locator(sel).textContent() ?? '').replace(/\s+/g, ' ').trim();
const url = (query = nowParam(REFERENCE_NOW)) => `${srv.baseUrl}/?${query}`;

const base = buildFixtureSet({ now: REFERENCE_NOW });
const expected = cheapestSlot(normalizePoints(base.points), { now: REFERENCE_NOW, lookbackHours: config.lookbackHours, slotHours: config.slotHours });
const expectedUpcoming = cheapestUpcomingSlot(normalizePoints(base.points), { now: REFERENCE_NOW, slotHours: config.slotHours });

// ---------------------------------------------------------------------------

await scenario('Standardfall: SMARD liefert, Hero/Ausblick/Kennzahlen/Chart/Tabelle stimmen mit der Analyse überein', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'smard');
  assert.equal(r.pointCount, base.points.length);
  assert.equal(await page.locator('#chart-supplement').isHidden(), true, 'kein Ergänzungshinweis, wenn SMARD vollständig ist');
  assert.equal(r.slot.start, expected.slot.start);
  assert.equal(r.slot.end, expected.slot.end);
  assert.ok(Math.abs(r.slot.meanPrice - expected.slot.meanPrice) < 1e-9);

  const w = formatWindow(expected.slot.start, expected.slot.end, { now: REFERENCE_NOW });
  assert.equal(await text(page, '#hero [data-field="time"]'), w.main.replace(/\s+/g, ' '));
  assert.equal(await text(page, '#hero [data-field="day"]'), w.overline);
  assert.equal(await text(page, '#hero [data-field="ct"]'), formatCt(expected.slot.meanPrice).replace(/\s+/g, ' '));
  assert.match(await text(page, '#hero [data-field="compare"]'), /günstiger als der Durchschnitt der letzten 72 h/);
  assert.match(await text(page, '#hero [data-field="range"]'), /Analysiert: .* \(72 h\)\./);
  // Reihenfolge (Desktop): Antwort (orange) mit den Kennzahlen daneben → Preisverlauf → Vergangen
  const box = async (sel) => page.locator(sel).boundingBox();
  const [bOutlook, bKpi, bChart, bHero] = await Promise.all(['#outlook', '#kpi-min', '#chart-card', '#hero'].map(box));
  assert.ok(bOutlook.y < bChart.y && bChart.y < bHero.y, `Reihenfolge: ${[bOutlook.y, bChart.y, bHero.y].join(' / ')}`);
  assert.ok(bKpi.y < bChart.y && bKpi.x > bOutlook.x + bOutlook.width - 1, 'Kennzahlen stehen neben der Antwort');
  assert.equal(await page.locator('#range-3').isChecked(), true);
  assert.equal(await text(page, '#chart-subtitle'), 'Gestern bis morgen · So., 27.09., 00:00 – Di., 29.09., 24:00 Uhr · 15-Minuten-Werte');
  assert.equal(await text(page, '#range-hint'), '', 'kein Hinweis, wenn die Preise für morgen bekannt sind');
  assert.equal(await page.locator('#hero [data-field="empty"]').isHidden(), true);
  assert.equal(await page.locator('#hero').getAttribute('data-state'), 'ready');

  const uw = formatWindow(expectedUpcoming.start, expectedUpcoming.end, { now: REFERENCE_NOW });
  assert.equal(await text(page, '#outlook [data-field="time"]'), uw.main.replace(/\s+/g, ' '));
  assert.equal(await page.locator('#outlook .answer-time .t-part').count(), 2);
  assert.equal(await text(page, '#outlook .answer-time .time-unit'), 'Uhr');
  // Band im Diagramm trägt die Uhrzeit des Fensters (verbindet Antwort und Kurve)
  assert.match(await text(page, '#chart svg .band-label'), /^\d{1,2}(:\d\d)?–\d{1,2}(:\d\d)? Uhr$/);
  assert.equal(await text(page, '#outlook [data-field="headline"]'), 'Am günstigsten laden Sie morgen, Di., 29.09.');
  assert.equal(await text(page, '#outlook [data-field="known"]'), 'Bekannte Preise bis Di., 29.09., 24:00 Uhr.');
  assert.match(await text(page, '#outlook [data-field="starts"]'), /^Beginnt in /);

  assert.match(await text(page, '#kpi-current [data-field="label"]'), /^Jetzt \(14:00 – 14:15 Uhr\)$/);
  assert.equal(await text(page, '#kpi-current [data-field="value"]'), formatCt(r.current.price).replace(/\s+/g, ' '));
  assert.equal(await text(page, '#kpi-min [data-field="value"]'), formatCt(expected.rangeMin.price).replace(/\s+/g, ' '));
  assert.equal(await text(page, '#kpi-max [data-field="value"]'), formatCt(expected.rangeMax.price).replace(/\s+/g, ' '));

  assert.match(await text(page, '#status-meta'), /^Daten: Bundesnetzagentur \| SMARD\.de \(CC BY 4\.0\) · abgerufen 14:00 Uhr · Preise bekannt bis Di\., 29\.09\., 24:00 Uhr\.$/);
  assert.equal(await text(page, '#status-msg'), '');
  assert.equal(await page.locator('#override-banner').isVisible(), true);
  assert.match(await text(page, '#override-text'), /Testansicht: Zeitpunkt fixiert auf 28\.09\.2026, 14:00 Uhr/);

  // Chart
  assert.equal(await page.locator('#chart svg[role="img"]').count(), 1);
  assert.ok((await page.locator('#chart svg path.line').count()) >= 1);
  // Orange markiert ist nur das günstigste kommende Fenster – rechts der „Jetzt“-Linie
  assert.equal(await page.locator('#chart svg .band-cheapest').count(), 1);
  assert.equal(await page.locator('#chart svg .outlook-box').count(), 0);
  assert.equal(await page.locator('#chart svg .now-line').count(), 1);
  const bandX = Number(await page.locator('#chart svg .band-cheapest').getAttribute('x'));
  const nowX = Number(await page.locator('#chart svg .now-line').getAttribute('x1'));
  assert.ok(bandX >= nowX, `oranges Band (x=${bandX}) liegt vor der Jetzt-Linie (x=${nowX})`);
  // Vergangenheit als Tonfläche links von „jetzt“, Kurve dort grau, danach in Textfarbe; Punkt auf der Kurve bei „jetzt“
  assert.equal(await page.locator('#chart svg .region-past').count(), 1);
  assert.ok((await page.locator('#chart svg path.line-past').count()) >= 1);
  assert.equal(await page.locator('#chart svg .now-dot').count(), 1);
  assert.equal(await page.locator('#chart svg .band-cheapest').evaluate((el) => getComputedStyle(el).fill), 'rgb(240, 138, 46)');
  assert.match(await text(page, '#chart svg desc'), /Günstigstes kommendes 4-Stunden-Fenster/);
  assert.equal(await text(page, '#chart-legend'), 'Vergangene Preise Kommende Preise (bereits bekannt) Günstigstes kommendes 4-h-Fenster');
  assert.match(await text(page, '#chart-subtitle'), /15-Minuten-Werte$/);

  // Tabelle: alle Punkte ab Analysebeginn
  const rowsExpected = base.points.filter((p) => p.end > r.viewStart && p.start < r.viewEnd).length;
  assert.equal(rowsExpected, 3 * 96);
  assert.equal(await page.locator('#price-table tbody tr').count(), rowsExpected);
  assert.match(await text(page, '#table-summary'), new RegExp(`\\(${rowsExpected} Zeilen\\)`));
  assert.equal(await page.locator('#price-table tbody tr.row-cheapest').count(), 16);
  const cheapRowStarts = await page.locator('#price-table tbody tr.row-cheapest time').evaluateAll((els) => els.map((e) => Date.parse(e.dateTime)));
  assert.equal(cheapRowStarts[0], expectedUpcoming.start, 'Tabelle markiert das kommende Fenster');
  assert.ok(cheapRowStarts.every((t) => t >= REFERENCE_NOW));
  assert.equal(await page.locator('#price-table tbody tr.row-now').count(), 1);
  await page.locator('#table-link').click();
  assert.equal(await page.locator('#table').evaluate((d) => d.open), true);

  await page.screenshot({ path: resolve(SHOTS, 'desktop-light.png'), fullPage: true });
});

await scenario('Gepflanztes Optimum: 02:00–06:00 Uhr heute mit 0,1 ct/kWh', async (page) => {
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW, price: plantedPrice });
  await mockSources(page, { fixtures });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(new Date(r.slot.start).toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(new Date(r.slot.end).toISOString(), '2026-09-28T04:00:00.000Z');
  assert.equal(await text(page, '#hero [data-field="time"]'), '02:00 – 06:00 Uhr');
  assert.equal(await text(page, '#hero [data-field="day"]'), 'Montag, 28. Sept. · heute');
  assert.equal(await text(page, '#hero [data-field="ct"]'), '0,1 ct/kWh');
  assert.equal(await text(page, '#hero [data-field="mwh"]'), '(≈ 1 €/MWh)');
  assert.equal(await text(page, '#hero [data-field="ended"]'), 'Endete vor 8 Stunden.');
});

await scenario('Fallback: SMARD durch CORS blockiert → Energy-Charts, Statusmeldung nennt beide', async (page) => {
  const { log } = await mockSources(page, { smard: 'cors' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'energy-charts');
  assert.deepEqual(r.attempts.map((a) => [a.id, a.ok, a.kind ?? null]), [['smard', false, 'network'], ['energy-charts', true, null]]);
  assert.equal(await text(page, '#status-msg'), 'SMARD.de war nicht erreichbar – die Daten stammen von Energy-Charts.');
  assert.match(await text(page, '#status-meta'), /^Daten: Bundesnetzagentur \| SMARD\.de via Energy-Charts \(Fraunhofer ISE\), CC BY 4\.0 · abgerufen/);
  assert.ok(log.some((u) => u.startsWith('https://api.energy-charts.info/price?bzn=DE-LU&start=2026-09-24&end=2026-09-30')), log.join('\n'));
});

await scenario('Fallback: SMARD 503 und Energy-Charts 429 → aWATTar', async (page) => {
  await mockSources(page, { smard: 'fail', energyCharts: 'ratelimit' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'awattar');
  assert.equal(r.attempts[1].kind, 'ratelimit');
  assert.equal(await text(page, '#status-msg'), 'SMARD.de und Energy-Charts waren nicht erreichbar – die Daten stammen von aWATTar.');
  assert.match(await text(page, '#status-meta'), /^Daten: aWATTar-API/);
});

await scenario('Alle Live-Quellen scheitern → Snapshot (frisch) mit Hinweis', async (page) => {
  await mockSources(page, { smard: 'fail', energyCharts: 'fail', awattar: 'fail' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'snapshot');
  assert.match(await text(page, '#status-msg'), /^Live-Abruf nicht möglich – zwischengespeicherte Daten vom 28\.09\.2026, 13:40 Uhr \(Quelle: Energy-Charts\)\.$/);
  assert.match(await text(page, '#status-meta'), /^Daten: Zwischenspeicher vom 28\.09\.2026, 13:40 Uhr \(Quelle: Bundesnetzagentur \| SMARD\.de via Energy-Charts \(Fraunhofer ISE\), CC BY 4\.0\)/);
  assert.equal(await page.locator('#error-card').isHidden(), true);
});

await scenario('Veralteter Snapshot (10 h alt) wird als möglicherweise nicht aktuell markiert', async (page) => {
  const stale = { ...base.snapshot, generatedAt: REFERENCE_NOW - 10 * HOUR };
  await mockSources(page, { smard: 'cors', energyCharts: 'cors', awattar: 'cors', snapshot: stale });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'snapshot');
  assert.match(await text(page, '#status-msg'), /möglicherweise nicht aktuell\.$/);
});

await scenario('Totalausfall → Fehlerkarte mit Fokus auf „Erneut versuchen“, danach erfolgreicher Retry', async (page) => {
  let phase = 'down';
  await page.route('https://www.smard.de/**', async (route) => {
    if (phase === 'down') return route.abort('failed');
    const u = route.request().url();
    if (u.includes('index_quarterhour')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(base.smardIndex) });
    const m = u.match(/quarterhour_(\d+)\.json/);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(base.smardFiles[m[1]]) });
  });
  await page.route('https://api.energy-charts.info/**', (route) => route.abort('failed'));
  await page.route('https://api.awattar.de/**', (route) => route.fulfill({ status: 502, body: 'bad gateway' }));
  await page.route('**/data/prices.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
  await page.goto(url());
  await waitForRender(page);
  assert.equal(await page.locator('#error-card').isVisible(), true);
  assert.equal(await page.locator('#error-card').getAttribute('role'), 'alert');
  assert.match(await text(page, '#error-text'), /^Keine der Quellen \(SMARD\.de, Energy-Charts, aWATTar\) war erreichbar\./);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'retry');
  assert.equal(await page.locator('#hero').getAttribute('data-state'), 'error');
  assert.equal(await text(page, '#status-msg'), 'Preisdaten konnten nicht geladen werden.');
  assert.equal(await text(page, '#hero [data-field="time"]'), '–');
  assert.equal(await text(page, '#startzeit [data-field="st-empty"]'), 'Keine Preisdaten verfügbar.');
  assert.equal(await page.locator('#startzeit [data-field="st-text"]').evaluate((el) => el.hidden), true);
  const cardBox = await page.locator('#error-card').boundingBox();
  const heroBox = await page.locator('#hero').boundingBox();
  assert.ok(cardBox.y < heroBox.y, 'Fehlerkarte steht über den Karten');
  assert.ok(await page.locator('#retry').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }), 'Retry-Button im sichtbaren Bereich');
  phase = 'up';
  await page.locator('#retry').click();
  await page.waitForFunction(() => window.__LADERICK__?.series?.source?.id === 'smard');
  assert.equal(await page.locator('#error-card').isHidden(), true);
  assert.equal(await page.locator('#hero').getAttribute('data-state'), 'ready');
});

await scenario('Quellen erreichbar, aber ohne Daten im Analysezeitraum → spezifische Fehlermeldung', async (page) => {
  const future = buildFixtureSet({ now: REFERENCE_NOW + 5 * 24 * HOUR }); // Daten liegen komplett nach „jetzt“
  await mockSources(page, { fixtures: future, snapshot: 'missing' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, null);
  assert.ok(r.attempts.filter((a) => a.id !== 'snapshot').every((a) => a.kind === 'insufficient'));
  assert.match(await text(page, '#error-text'), /lieferten aber keine ausreichenden Preisdaten für die letzten 72 Stunden/);
});

await scenario('Datenlücke: fehlende Viertelstunde im günstigsten Bereich → lückenloses Fenster, kein Näherungs-Hinweis', async (page) => {
  const gapStart = expected.slot.start + 2 * HOUR;
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW });
  const pts = fixtures.points.filter((p) => p.start !== gapStart);
  const { toEnergyCharts } = await import('../fixtures/generate.js');
  await mockSources(page, { fixtures: { ...fixtures, energyCharts: toEnergyCharts(pts) }, smard: 'fail' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'energy-charts');
  assert.equal(r.pointCount, pts.length);
  assert.equal(r.slot.partial, false);
  assert.ok(r.slot.end <= gapStart || r.slot.start > gapStart, 'Fenster umgeht die Lücke');
  assert.equal(await page.locator('#hero .chip-warn').count(), 0);
});

await scenario('Datenlücken überall: jede vierte Viertelstunde fehlt → Näherung mit Hinweis-Chip', async (page) => {
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW });
  const pts = fixtures.points.filter((_, i) => i % 4 !== 3);
  const { toAwattar } = await import('../fixtures/generate.js');
  await mockSources(page, { fixtures: { ...fixtures, awattar: toAwattar(pts) }, smard: 'fail', energyCharts: 'fail' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'awattar');
  assert.equal(r.slot.partial, true);
  assert.ok(Math.abs(r.slot.coverage - 0.75) < 1e-9);
  assert.match(await text(page, '#hero .chip-warn'), /Datenlücke – Näherung \(75 % der Werte\)/);
});

await scenario('Negative Preise: Chip und Minus-Zeichen', async (page) => {
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW, price: (ts) => syntheticPrice(ts) - 120 });
  await mockSources(page, { fixtures });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.ok(r.slot.meanPrice < 0);
  assert.match(await text(page, '#hero [data-field="ct"]'), /^−\d+,\d ct\/kWh$/);
  assert.equal(await text(page, '#hero .chip'), 'negativer Preis');
  assert.match(await text(page, '#hero [data-field="compare"]'), /unter dem Durchschnitt der letzten 72 h/);
});

await scenario('Ladezustand: Skelett und Statusmeldung, solange die Quellen nicht geantwortet haben', async (page) => {
  await mockSources(page, { delayMs: 1500 });
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#status-msg')?.textContent === 'Preisdaten werden geladen …');
  assert.equal(await page.locator('#hero').getAttribute('data-state'), 'loading');
  assert.equal(await page.locator('#chart-card').getAttribute('data-state'), 'loading');
  await waitForRender(page, { timeout: 20000 });
  assert.equal(await page.locator('#hero').getAttribute('data-state'), 'ready');
});

await scenario('Zwischenspeicher: zweiter Aufruf innerhalb von 10 Minuten lädt nicht neu (Live-Ansicht ohne Banner)', async (page) => {
  const liveNow = Date.now();
  const fixtures = buildFixtureSet({ now: liveNow });
  const { log } = await mockSources(page, { fixtures });
  await page.goto(`${srv.baseUrl}/`);
  const r1 = await waitForRender(page);
  assert.equal(r1.sourceId, 'smard');
  assert.equal(r1.fromCache, false);
  assert.equal(await page.locator('#override-banner').isHidden(), true);
  const requests = log.length;
  await page.reload();
  const r2 = await waitForRender(page);
  assert.equal(r2.fromCache, true);
  await page.waitForTimeout(300);
  assert.equal(log.length, requests, 'kein weiterer Netzabruf aus dem Zwischenspeicher');
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('laderick:cache:v1') ?? 'null'));
  assert.ok(cache && Array.isArray(cache.series.points));
});

await scenario('Chart-Interaktion: Hover-Tooltip, Tastaturnavigation, Screenreader-Ausgabe', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  await page.locator('#chart').scrollIntoViewIfNeeded();
  await page.locator('#chart .hit-area').hover({ position: { x: 300, y: 100 } });
  await page.waitForFunction(() => !document.querySelector('.chart-tooltip').hidden);
  assert.match(await text(page, '.chart-tooltip .tt-value'), /ct\/kWh$/);
  assert.match(await text(page, '.chart-tooltip .tt-title'), /Uhr$/);
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => document.querySelector('.chart-tooltip').hidden);
  await page.locator('#chart').focus();
  await page.keyboard.press('ArrowLeft');
  const out = await text(page, '#chart-output');
  assert.match(out, /^Mo\., 28\.09\., 13:45 – 14:00 Uhr: .* ct\/kWh \(.* €\/MWh\)/);
  await page.keyboard.press('Home');
  assert.match(await text(page, '#chart-output'), /^So\., 27\.09\., 00:00 – 00:15 Uhr/);
  await page.keyboard.press('PageUp');
  assert.match(await text(page, '#chart-output'), /^So\., 27\.09\., 01:00 – 01:15 Uhr/, 'Bild auf: eine Stunde weiter');
  await page.keyboard.press('Shift+PageUp');
  assert.match(await text(page, '#chart-output'), /^Mo\., 28\.09\., 01:00 – 01:15 Uhr/, 'Umschalt+Bild auf: ein Tag weiter');
  await page.keyboard.press('g');
  assert.match(await text(page, '#chart-output'), /günstigstes kommendes Fenster$/, 'G springt zum günstigsten Fenster');
  await page.keyboard.press('End');
  assert.match(await text(page, '#chart-output'), /^Di\., 29\.09\., 23:45 – 24:00 Uhr.*kommend/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.chart-tooltip').isHidden(), true);
  assert.equal(await text(page, '#chart-output'), '', 'Ablesezeile wird geleert');
});

await scenario('Mobil (360 px): kein horizontales Scrollen, Achsenlabels ohne Überlappung, Ablesezeile statt Tooltip', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  await page.waitForTimeout(200);
  const [scrollW, innerW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.equal(scrollW, innerW, 'kein horizontaler Überlauf');
  const boxes = await page.locator('#chart svg .x-label, #chart svg .x-day').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent, cls: e.getAttribute('class'), l: b.left, r: b.right }; }));
  for (const cls of ['x-label', 'x-day']) {
    const row = boxes.filter((b) => b.cls === cls).sort((a, b) => a.l - b.l);
    for (let i = 1; i < row.length; i += 1) assert.ok(row[i].l >= row[i - 1].r - 0.5, `Label „${row[i - 1].t}“ und „${row[i].t}“ überlappen`);
    assert.ok(row.length >= 2, `zu wenige ${cls}`);
  }
  await page.locator('#chart').scrollIntoViewIfNeeded();
  // Ohne Auswahl zeigt die Ablesezeile den aktuellen Preis
  assert.match(await text(page, '#chart-readout'), /^.+ ct\/kWh · jetzt 14:00–14:15$/);
  const chartTop = await page.locator('#chart').evaluate((el) => el.getBoundingClientRect().top);
  await page.locator('#chart .hit-area').hover({ position: { x: 150, y: 100 } });
  await page.waitForFunction(() => !/· jetzt \d/.test(document.querySelector('#chart-readout').textContent));
  assert.equal(await page.locator('.chart-tooltip').isVisible(), false);
  // Preis zuerst, dann Tag und Uhrzeit
  assert.match(await text(page, '#chart-readout'), /^.+ ct\/kWh · \S+ \d\d:\d\d–\d\d:\d\d/);
  // feste Höhe: das Diagramm springt nicht
  assert.equal(await page.locator('#chart').evaluate((el) => el.getBoundingClientRect().top), chartTop, 'Diagramm springt');
  await page.screenshot({ path: resolve(SHOTS, 'mobile-light.png'), fullPage: true });
}, { viewport: { width: 360, height: 780 } });

await scenario('Dunkles Design: folgt der Systemeinstellung, Umschalter speichert nur bei Klick', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 16, 18)');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await text(page, '#theme-toggle'), 'Dunkles Design');
  assert.equal(await page.evaluate(() => localStorage.getItem('laderick:theme')), null);
  // Orange Karte bleibt im dunklen Design orange mit dunkler, gut lesbarer Schrift
  assert.equal(await page.locator('#outlook').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(240, 138, 46)');
  for (const sel of ['#outlook .answer-time', '#outlook .answer-title', '#outlook .answer-ct', '#startzeit > summary h3']) {
    assert.equal(await page.locator(sel).evaluate((el) => getComputedStyle(el).color), 'rgb(11, 11, 11)', sel);
  }
  await page.screenshot({ path: resolve(SHOTS, 'desktop-dark.png'), fullPage: true });
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(241, 242, 244)');
  assert.equal(await page.evaluate(() => localStorage.getItem('laderick:theme')), 'light');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'false');
}, { colorScheme: 'dark' });

await scenario('Gespeichertes dunkles Design wird vor dem ersten Rendern gesetzt', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 16, 18)');
  await waitForRender(page);
}, { colorScheme: 'light', storage: { 'laderick:theme': 'dark' } });

await scenario('Erzwungene Quelle per ?source=awattar mit Banner', async (page) => {
  const { log } = await mockSources(page, {});
  await page.goto(url(`${nowParam(REFERENCE_NOW)}&source=awattar`));
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'awattar');
  assert.ok(log.every((u) => u.includes('awattar')), log.join('\n'));
  assert.match(await text(page, '#override-text'), /Quelle erzwungen: aWATTar/);
});

await scenario('Zeitumstellung 25.10.2026: Fenster über die doppelte Stunde wird mit Zonenkürzeln angezeigt', async (page) => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const switchUtc = Date.parse('2026-10-25T01:00:00Z');
  const fixtures = buildFixtureSet({ now, price: (ts) => (ts >= switchUtc - 2 * HOUR && ts < switchUtc + 2 * HOUR ? 1 : Math.max(syntheticPrice(ts), 5)) });
  await mockSources(page, { fixtures });
  await page.goto(url(nowParam(now)));
  const r = await waitForRender(page);
  assert.equal(r.slot.start, switchUtc - 2 * HOUR);
  assert.equal(r.slot.end - r.slot.start, 4 * HOUR);
  assert.equal(await text(page, '#hero [data-field="time"]'), '01:00 MESZ – 04:00 MEZ');
  assert.equal(await page.locator('#hero [data-field="time"]').getAttribute('data-dst'), 'true');
  assert.equal(await text(page, '#hero [data-field="note"]'), 'Fenster über die Zeitumstellung: 4 h, Zeitumstellung.');
  // Tabelle: Zeitangaben in der doppelten Stunde eindeutig; orange markiert sind nur kommende Zeilen
  const rows = await page.locator('#price-table tbody tr td:first-child').allTextContents();
  assert.ok(rows.some((r) => /02:45\s*–\s*03:00\s*Uhr \(MESZ\)/.test(r)), 'Zeile 02:45–03:00 (MESZ) fehlt');
  const cheapRowStarts = await page.locator('#price-table tbody tr.row-cheapest time').evaluateAll((els) => els.map((e) => Date.parse(e.dateTime)));
  assert.equal(cheapRowStarts.length, 16);
  assert.ok(cheapRowStarts.every((t) => t >= now), 'keine vergangene Zeile orange markiert');
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.equal(sw, iw, 'kein horizontaler Überlauf mit Zeitumstellungs-Fenster');
}, { viewport: { width: 360, height: 780 } });

await scenario('Stundenauflösung (SMARD fällt auf hour zurück): Kennzahl „Jetzt“ zeigt Stundenfenster', async (page) => {
  const hourly = buildFixtureSet({ now: REFERENCE_NOW, resolutionMinutes: 60 });
  const emptyQuarter = Object.fromEntries(Object.entries(base.smardFiles).map(([ts, f]) => [ts, { ...f, series: f.series.map(([t]) => [t, null]) }]));
  await page.route('https://www.smard.de/**', async (route) => {
    const u = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.includes('index_quarterhour')) return json(base.smardIndex);
    if (u.includes('index_hour')) return json(hourly.smardIndex);
    let m = u.match(/quarterhour_(\d+)\.json/);
    if (m) return json(emptyQuarter[m[1]] ?? { series: [] });
    m = u.match(/hour_(\d+)\.json/);
    if (m && hourly.smardFiles[m[1]]) return json(hourly.smardFiles[m[1]]);
    return json({}, 404);
  });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'smard');
  assert.equal(r.resolutionMinutes, 60);
  assert.match(await text(page, '#kpi-current [data-field="label"]'), /^Jetzt \(14:00 – 15:00 Uhr\)$/);
  assert.match(await text(page, '#chart-subtitle'), /Stundenwerte$/);
  assert.equal(r.range.end, Date.parse('2026-09-28T12:00:00Z'));
});

await scenario('Touch: Tippen auf das Diagramm zeigt den getippten Slot in der Ablesezeile und behält ihn', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart .hit-area').boundingBox();
  await page.touchscreen.tap(box.x + 20, box.y + 60);
  await page.waitForFunction(() => /ct\/kWh · So\.? /.test(document.querySelector('#chart-readout').textContent));
  const first = await text(page, '#chart-readout');
  assert.match(first, /ct\/kWh · So\.? 0\d:/, first);
  await page.waitForTimeout(150);
  assert.equal(await text(page, '#chart-readout'), first, 'Auswahl bleibt nach dem Tippen erhalten');
  const box2 = await page.locator('#chart .hit-area').boundingBox();
  await page.touchscreen.tap(box2.x + box2.width - 20, box2.y + 60);
  await page.waitForFunction(() => /ct\/kWh · Di\.? (1[0-9]|2[0-3]):/.test(document.querySelector('#chart-readout').textContent));
  await page.waitForTimeout(150);
  assert.doesNotMatch(await text(page, '#chart-readout'), /kommend/, '„kommend“ zeigt die Kurve selbst');
  // Tippen außerhalb des Diagramms hebt die Auswahl auf: zurück zum aktuellen Preis
  await page.touchscreen.tap(20, 20);
  await page.waitForFunction(() => /· jetzt \d/.test(document.querySelector('#chart-readout').textContent));
  // Wischen über ein Neuzeichnen hinweg und Loslassen außerhalb: Das Diagramm reagiert danach weiter auf Tippen
  const cdp = await page.context().newCDPSession(page);
  const b = await page.locator('#chart .hit-area').boundingBox();
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', b.x + 40, b.y + 60);
  await touch('touchMove', b.x + 80, b.y + 62);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // löst ein Neuzeichnen aus (neue Trefferfläche)
  await touch('touchMove', b.x + 120, b.y - 200);
  await touch('touchEnd');
  await page.touchscreen.tap(b.x + b.width - 20, b.y + 60);
  await page.waitForFunction(() => /ct\/kWh · Di\.? /.test(document.querySelector('#chart-readout').textContent));
}, { viewport: { width: 360, height: 780 }, hasTouch: true });

await scenario('Große Schrift (150 %, 360 px): Ablesezeile schneidet nichts ab, Diagrammkopf ohne Überdeckung', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
  await page.waitForTimeout(200);
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart .hit-area').boundingBox();
  for (const fx of [0.1, 0.5, 0.95]) {
    await page.touchscreen.tap(box.x + box.width * fx, box.y + 40);
    const m = await page.locator('#chart-readout').evaluate((el) => {
      const s = el.querySelector('strong').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { inside: s.right <= r.right + 0.5 && s.bottom <= r.bottom + 0.5, sw: el.scrollWidth, cw: el.clientWidth };
    });
    assert.ok(m.inside && m.sw <= m.cw + 1, `Ablesezeile abgeschnitten: ${JSON.stringify(m)}`);
  }
  const head = await page.evaluate(() => {
    const t = document.querySelector('#chart-title').getBoundingClientRect();
    const l = document.querySelector('#table-link').getBoundingClientRect();
    return t.right <= l.left + 0.5 || l.top >= t.bottom - 1;
  });
  assert.ok(head, '„Preisverlauf“ und „Als Tabelle“ überdecken sich');
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.equal(sw, iw, 'kein horizontaler Überlauf bei 150 % Schrift');
}, { viewport: { width: 360, height: 780 }, hasTouch: true });

await scenario('Fensterzeit über dem Band bleibt am Handy im Diagramm, auch wenn das Fenster direkt nach „jetzt“ beginnt', async (page) => {
  // vormittags ohne Preise für morgen: das günstigste Fenster beginnt oft unmittelbar nach „jetzt“
  for (const iso of ['2026-09-28T08:30:00Z', '2026-09-28T09:00:00Z', '2026-09-28T09:45:00Z', '2026-09-28T10:30:00Z']) {
    const now = Date.parse(iso);
    const fixtures = buildFixtureSet({ now });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockSources(page, { fixtures });
    await page.goto(url(nowParam(now)));
    await waitForRender(page);
    const m = await page.evaluate(() => {
      const svg = document.querySelector('#chart svg').getBoundingClientRect();
      const lab = document.querySelector('#chart svg .band-label');
      if (!lab) return null;
      const l = lab.getBoundingClientRect();
      const nowLab = document.querySelector('#chart svg .now-label')?.getBoundingClientRect();
      return { l: l.left, r: l.right, svgL: svg.left, svgR: svg.right, overlap: nowLab ? !(nowLab.right <= l.left || nowLab.left >= l.right) : false };
    });
    assert.ok(m, `${iso}: Fensterzeit fehlt`);
    assert.ok(m.l >= m.svgL - 0.5 && m.r <= m.svgR + 0.5, `${iso}: Fensterzeit ragt aus dem Diagramm (${JSON.stringify(m)})`);
    assert.equal(m.overlap, false, `${iso}: Fensterzeit überdeckt „jetzt“`);
  }
}, { viewport: { width: 360, height: 780 } });

await scenario('Kleines Display (320 px): Kennzahlen bleiben einzeilig, kein Überlauf', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  await page.waitForTimeout(150);
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.equal(sw, iw);
  const singleLine = await page.locator('.tile-value').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).fontSize) * 1.6));
  assert.ok(singleLine.every(Boolean), `Kennzahl umbricht: ${singleLine}`);
  const inside = await page.locator('.tile-value').evaluateAll((els) => els.every((el) => el.getBoundingClientRect().right <= el.closest('.tile').getBoundingClientRect().right));
  assert.ok(inside, 'Kennzahl bleibt in der Kachel');
}, { viewport: { width: 320, height: 700 } });

await scenario('Tablet (768 px): Ergebniskarten ohne Überlauf', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  await page.waitForTimeout(150);
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.equal(sw, iw);
  const ok = await page.locator('.hero-time').evaluateAll((els) => els.every((el) => {
    const r = el.getBoundingClientRect(); const c = el.closest('.card').getBoundingClientRect();
    return r.right <= c.right && r.left >= c.left;
  }));
  assert.ok(ok, 'Zeitangaben bleiben innerhalb ihrer Karte');
}, { viewport: { width: 768, height: 1024 } });

await scenario('Ungültiger ?source=-Parameter wird ignoriert (kein Banner, normale Reihenfolge)', async (page) => {
  await mockSources(page, {});
  await page.goto(url(`${nowParam(REFERENCE_NOW)}&source=%3Cb%3Ehallo%3C%2Fb%3E`));
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'smard');
  assert.doesNotMatch(await text(page, '#override-text'), /Quelle erzwungen/);
});

await scenario('Bereits begonnenes günstiges Fenster wird nicht gezeigt – frühester Start ist die nächste Viertelstunde', async (page) => {
  const now = Date.parse('2026-09-28T18:07:00Z'); // 20:07 MESZ – der sehr günstige Block 20:00–24:00 läuft schon
  const cheapStart = Date.parse('2026-09-28T18:00:00Z'); // 20:00 MESZ
  const fixtures = buildFixtureSet({ now, price: (ts) => (ts >= cheapStart && ts < cheapStart + 4 * HOUR ? 1 : Math.max(syntheticPrice(ts), 5)) });
  await mockSources(page, { fixtures });
  await page.goto(url(nowParam(now)));
  const r = await waitForRender(page);
  assert.equal(r.upcoming.start, cheapStart + 15 * MINUTE, 'nicht 20:00, sondern 20:15');
  assert.ok(r.upcoming.start >= now);
  assert.equal(await text(page, '#outlook [data-field="time"]'), '20:15 – 00:15 Uhr');
  assert.equal(await text(page, '#outlook [data-field="starts"]'), 'Beginnt in 8 Minuten.');
  const bandX = Number(await page.locator('#chart svg .band-cheapest').getAttribute('x'));
  const nowX = Number(await page.locator('#chart svg .now-line').getAttribute('x1'));
  assert.ok(bandX >= nowX, `oranges Band (x=${bandX}) beginnt vor der Jetzt-Linie (x=${nowX})`);
  const cheapRowStarts = await page.locator('#price-table tbody tr.row-cheapest time').evaluateAll((els) => els.map((e) => Date.parse(e.dateTime)));
  assert.ok(cheapRowStarts.length > 0 && cheapRowStarts.every((t) => t >= now), 'keine begonnene Zeile orange markiert');
});

await scenario('Viertelstundengrenze: ein beginnendes Fenster wird schon kurz vor seinem Start ersetzt', async (page) => {
  const boundary = Date.parse('2026-09-28T18:15:00Z'); // 20:15 MESZ – hier beginnt der sehr günstige Block
  const fixtures = buildFixtureSet({ now: boundary - 20_000, price: (ts) => (ts >= boundary && ts < boundary + 4 * HOUR ? 1 : Math.max(syntheticPrice(ts), 5)) });
  await page.clock.install({ time: boundary - 20_000 });
  await mockSources(page, { fixtures });
  await page.goto(`${srv.baseUrl}/`); // Live-Uhr (gesteuert), kein ?now=
  await page.waitForFunction(() => Boolean(window.__LADERICK__?.upcoming), null, { polling: 100 });
  const read = () => page.evaluate(() => ({ start: window.__LADERICK__.upcoming.start, wall: Date.now() }));
  await page.clock.pauseAt(boundary - 100);
  const before = await read();
  assert.equal(before.start, boundary, '100 ms vor Beginn ist das Fenster noch kommend');
  assert.ok(before.start > before.wall);
  await page.clock.runFor(80); // 20 ms vor der Grenze
  const after = await read();
  assert.ok(after.wall < boundary, 'Uhr steht noch vor der Grenze');
  assert.equal(after.start, boundary + 15 * MINUTE, 'bereits vor Beginn durch das nächste Fenster ersetzt');
  await page.clock.runFor(60 * MINUTE); // eine Stunde weiter: Minuten-, Grenz- und Watchdog-Timer laufen
  const later = await page.evaluate(() => ({ start: window.__LADERICK__.upcoming?.start ?? null, now: window.__LADERICK__.now, wall: Date.now() }));
  assert.ok(later.start === null || later.start > later.wall, `angezeigtes Fenster (${later.start}) hat schon begonnen (${later.wall})`);
});

await scenario('Sprung der Systemuhr (z. B. nach Standby): Anzeige wird innerhalb von 2 Sekunden neu berechnet', async (page) => {
  const start = Date.parse('2026-09-28T16:00:00Z'); // 18:00 MESZ
  const cheapStart = Date.parse('2026-09-28T18:00:00Z'); // 20:00 MESZ
  const fixtures = buildFixtureSet({ now: start, price: (ts) => (ts >= cheapStart && ts < cheapStart + 4 * HOUR ? 1 : Math.max(syntheticPrice(ts), 5)) });
  await page.clock.install({ time: start });
  await mockSources(page, { fixtures });
  await page.goto(`${srv.baseUrl}/`);
  await page.waitForFunction(() => Boolean(window.__LADERICK__?.upcoming), null, { polling: 100 });
  assert.equal(await page.evaluate(() => window.__LADERICK__.upcoming.start), cheapStart);
  const jumped = cheapStart + 7 * MINUTE; // Gerät wacht um 20:07 auf, der Block läuft bereits
  await page.clock.setSystemTime(jumped);
  await page.clock.runFor(1500);
  const r = await page.evaluate(() => ({ start: window.__LADERICK__.upcoming?.start ?? null, now: window.__LADERICK__.now }));
  assert.ok(r.now >= jumped, 'nach dem Sprung neu berechnet');
  assert.equal(r.start, cheapStart + 15 * MINUTE, 'begonnenes Fenster wird nicht mehr gezeigt');
  const bandX = Number(await page.locator('#chart svg .band-cheapest').getAttribute('x'));
  const nowX = Number(await page.locator('#chart svg .now-line').getAttribute('x1'));
  assert.ok(bandX >= nowX, `oranges Band (x=${bandX}) beginnt vor der Jetzt-Linie (x=${nowX})`);
});

await scenario('Unbrauchbarer Zwischenspeicher wird verworfen und die Seite lädt normal', async (page) => {
  await mockSources(page, { fixtures: buildFixtureSet({ now: Date.now() }) }); // Live-Uhr: Testdaten um „jetzt“ erzeugen
  await page.goto(`${srv.baseUrl}/`);
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'smard');
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('laderick:cache:v1')));
  assert.equal(cache?.series?.source?.id, 'smard', 'kaputter Eintrag wurde durch einen gültigen ersetzt');
}, { storage: { 'laderick:cache:v1': JSON.stringify({ savedAt: Date.now(), series: { points: [{ start: 1, end: 2, price: 3 }] } }) } });

await scenario('Veralteter Zwischenspeicher (gestern) zeigt Datum in der Statuszeile', async (page) => {
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW });
  await mockSources(page, { fixtures, smard: 'cors', energyCharts: 'cors', awattar: 'cors', snapshot: 'missing' });
  await page.goto(`${srv.baseUrl}/`); // Live-Zeit, kein Override: der Zwischenspeicher wird genutzt
  const r = await waitForRender(page);
  assert.equal(r.fromCache, true);
  assert.match(await text(page, '#status-meta'), /abgerufen 28\.09\.2026, 14:00 Uhr/);
}, { storage: { 'laderick:cache:v1': JSON.stringify({ savedAt: Date.now() - 2 * 60 * MINUTE, attempts: [], series: { points: buildFixtureSet({ now: REFERENCE_NOW }).points, resolutionMinutes: 15, fetchedAt: REFERENCE_NOW, source: { id: 'smard', name: 'SMARD.de (Bundesnetzagentur)', url: 'https://www.smard.de/', licence: 'CC BY 4.0', attribution: '', operator: 'Bundesnetzagentur' } } }) } });

await scenario('Zeitraum-Umschalter in Kalendertagen: 1/2/3 Tage, Auswahl wird gemerkt', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  const r3 = await waitForRender(page);
  assert.equal(r3.viewDays, 3);
  assert.equal(r3.viewLabel, 'Gestern bis morgen');
  assert.equal(r3.viewStart, Date.parse('2026-09-26T22:00:00Z'));
  assert.equal(r3.viewEnd, Date.parse('2026-09-29T22:00:00Z'));
  assert.equal(await page.locator('#price-table tbody tr').count(), 3 * 96);

  await page.locator('label[for="range-1"]').click();
  await page.waitForFunction(() => window.__LADERICK__?.viewDays === 1);
  const r1 = await waitForRender(page);
  assert.equal(r1.viewStart, Date.parse('2026-09-27T22:00:00Z'));
  assert.equal(r1.viewEnd, Date.parse('2026-09-28T22:00:00Z'));
  assert.equal(await text(page, '#chart-subtitle'), 'Heute · Mo., 28.09., 00:00 – 24:00 Uhr · 15-Minuten-Werte');
  assert.equal(await page.locator('#price-table tbody tr').count(), 96);
  assert.equal(await page.locator('#chart svg .now-line').count(), 1);
  assert.equal(await page.locator('#chart svg .band-cheapest').count(), 0, 'kommendes Fenster liegt morgen, außerhalb der Tagesansicht');
  assert.equal(await page.locator('#legend-cheapest').isHidden(), true, 'Legende ohne oranges Band ausgeblendet');
  assert.match(await text(page, '#range-hint'), /^Das günstigste kommende Fenster \(morgen, .* Uhr\) liegt außerhalb dieses Zeitraums\. „2 Tage“ zeigt es\.$/);
  assert.equal(await page.evaluate(() => localStorage.getItem('laderick:days')), '1');

  await page.locator('label[for="range-2"]').click();
  await page.waitForFunction(() => window.__LADERICK__?.viewDays === 2);
  const r2 = await waitForRender(page);
  assert.equal(r2.viewLabel, 'Heute und morgen');
  assert.equal(r2.viewStart, Date.parse('2026-09-27T22:00:00Z'));
  assert.equal(r2.viewEnd, Date.parse('2026-09-29T22:00:00Z'));
  assert.equal(await page.locator('#price-table tbody tr').count(), 2 * 96);
  assert.equal(await page.locator('#chart svg .band-cheapest').count(), 1);
  assert.equal(await page.locator('#legend-cheapest').isVisible(), true);

  await page.reload();
  const again = await waitForRender(page);
  assert.equal(again.viewDays, 2);
  assert.equal(await page.locator('#range-2').isChecked(), true);
  // Hero analysiert unabhängig von der Ansicht immer 72 h
  assert.match(await text(page, '#hero [data-field="range"]'), /\(72 h\)\./);
  await page.locator('#range-2').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__LADERICK__?.viewDays === 3);
});

await scenario('Vor 13 Uhr (Morgenpreise unbekannt): 2 Tage = gestern und heute, Hinweis auf 13 Uhr', async (page) => {
  const now = Date.parse('2026-09-28T08:00:00Z'); // Mo., 10:00 MESZ – Fixture kennt Preise nur bis heute 24:00
  const fixtures = buildFixtureSet({ now });
  await mockSources(page, { fixtures });
  await page.goto(url(nowParam(now)));
  const r = await waitForRender(page);
  assert.equal(r.viewLabel, 'Vorgestern bis heute');
  assert.equal(r.viewEnd, Date.parse('2026-09-28T22:00:00Z'));
  assert.match(await text(page, '#range-hint'), /Die Preise für morgen erscheinen täglich gegen 13 Uhr\.$/);
  await page.locator('label[for="range-2"]').click();
  await page.waitForFunction(() => window.__LADERICK__?.viewDays === 2);
  const r2 = await waitForRender(page);
  assert.equal(r2.viewLabel, 'Gestern und heute');
  assert.equal(r2.viewStart, Date.parse('2026-09-26T22:00:00Z'));
  assert.equal(await text(page, '#chart-subtitle'), 'Gestern und heute · So., 27.09., 00:00 – Mo., 28.09., 24:00 Uhr · 15-Minuten-Werte');
  assert.match(await text(page, '#status-msg'), /Die Preise für morgen erscheinen täglich gegen 13 Uhr\./);
});

const expectedStartText = (best) =>
  `Im Durchschnitt der letzten 72 Stunden wäre ein Ladestart um ${best.key} Uhr am günstigsten gewesen (4 Stunden, ca. ${formatCt(best.meanPrice).replace(/\s+/g, ' ')} im Mittel aus ${best.count} ${best.count === 1 ? 'Tag' : 'Tagen'}). Rückblick, keine Prognose.`;

await scenario('Orange Karte „Kommend“ mit aufklappbarem Rückblick „Beste Ladezeit der letzten Tage“', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  const r = await waitForRender(page);
  const key = (ts) => { const p = berlinParts(ts); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
  const exp = cheapestStartTimeOfDay(normalizePoints(base.points), { now: REFERENCE_NOW, lookbackHours: 72, slotHours: 4, wallClockKey: key, dayKey: (ts) => berlinParts(ts).ymd });
  assert.ok(exp.best && exp.best.count >= 2, 'Erwartung berechenbar');
  assert.equal(r.startTime.key, exp.best.key);
  // Die frühere separate Empfehlungskarte gibt es nicht mehr
  assert.equal(await page.locator('#start-time').count(), 0);
  // Karte „Kommend“ ist orange mit dunkler Schrift
  assert.equal(await page.locator('#outlook').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(240, 138, 46)');
  assert.equal(await page.locator('#outlook .answer-time').evaluate((el) => getComputedStyle(el).color), 'rgb(11, 11, 11)');
  // Rückblick ist eingeklappt, Überschrift sichtbar
  assert.equal(await page.locator('#outlook #startzeit').evaluate((d) => d.tagName === 'DETAILS' && !d.open), true);
  assert.equal(await text(page, '#startzeit > summary'), 'Beste Ladezeit der letzten Tage');
  assert.equal(await page.locator('#startzeit [data-field="st-text"]').isVisible(), false);
  await page.locator('#startzeit > summary').click();
  assert.equal(await page.locator('#startzeit [data-field="st-text"]').isVisible(), true);
  assert.equal(await text(page, '#startzeit [data-field="st-text"]'), expectedStartText(exp.best));
  assert.equal(await text(page, '#startzeit strong'), `${exp.best.key} Uhr`);
  // Reihenfolge: Kommend (orange) → Diagramm → Vergangen
  const ys = await Promise.all(['#outlook', '#chart-card', '#hero'].map(async (sel) => (await page.locator(sel).boundingBox()).y));
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2], `Reihenfolge: ${ys.join(' / ')}`);
});

await scenario('Rückblick ohne ausreichende Daten zeigt einen Hinweis', async (page) => {
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW });
  // nur die letzten 26 h behalten: jede Uhrzeit hat höchstens ein vollständiges Fenster
  const pts = fixtures.points.filter((p) => p.start >= REFERENCE_NOW - 26 * HOUR);
  const { toEnergyCharts, toAwattar } = await import('../fixtures/generate.js');
  // auch die Ergänzungsquelle (aWATTar) hat nur diese 26 h – sonst würden die Lücken korrekt aufgefüllt
  await mockSources(page, { fixtures: { ...fixtures, energyCharts: toEnergyCharts(pts), awattar: toAwattar(pts) }, smard: 'fail' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'energy-charts');
  assert.equal(r.startTime, null);
  await page.locator('#startzeit > summary').click();
  assert.equal(await page.locator('#startzeit [data-field="st-empty"]').isVisible(), true);
  assert.equal(await text(page, '#startzeit [data-field="st-empty"]'), 'Für die letzten Tage liegen nicht genügend vollständige Preisdaten vor.');
  assert.equal(await page.locator('#startzeit [data-field="st-text"]').isVisible(), false);
});

await scenario('Aufklappbare Abschnitte: Datenquellen und Rechtliches eingeklappt, Links öffnen sie', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  // „Negative Preise“ ist der letzte offen sichtbare Abschnitt im Info-Teil
  const openHeadings = await page.locator('#info > h3').allTextContents();
  assert.equal(openHeadings.at(-1), 'Negative Preise');
  for (const id of ['quellen', 'impressum', 'datenschutz', 'haftung']) {
    assert.equal(await page.locator(`#${id}`).evaluate((d) => d.tagName === 'DETAILS' && !d.open), true, `${id} eingeklappt`);
    assert.equal(await page.locator(`#${id} > summary`).isVisible(), true, `${id}: Überschrift sichtbar`);
  }
  assert.equal(await page.locator('#impressum address').isVisible(), false);
  // Footer-Link öffnet das Impressum
  await page.locator('.site-footer a[href="#impressum"]').click();
  await page.waitForFunction(() => document.getElementById('impressum').open);
  assert.equal(await page.locator('#impressum address').isVisible(), true);
  assert.match(await text(page, '#impressum address'), /Jan-Rickmer Feindt.*An der Bauna 30.*34270 Schauenburg.*feindt\+ladeRick@janrickmer\.de/);
  const inView = await page.locator('#impressum').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= -2 && r.top < window.innerHeight; });
  assert.ok(inView, 'Impressum im sichtbaren Bereich');
  // Hinweis unter den Kennzahlen öffnet die Datenquellen
  await page.locator('.disclaimer-note a[href="#quellen"]').click();
  await page.waitForFunction(() => document.getElementById('quellen').open);
  // Klick auf die Überschrift klappt wieder zu
  await page.locator('#quellen > summary').click();
  assert.equal(await page.locator('#quellen').evaluate((d) => d.open), false);
});

await scenario('Direktaufruf mit #datenschutz öffnet den Abschnitt beim Laden', async (page) => {
  await mockSources(page, {});
  await page.goto(`${url()}#datenschutz`);
  await waitForRender(page);
  await page.waitForFunction(() => document.getElementById('datenschutz').open);
  assert.equal(await page.locator('#datenschutz').evaluate((d) => d.open), true);
  assert.equal(await page.locator('#impressum').evaluate((d) => d.open), false);
  await page.waitForTimeout(100);
  const top = await page.locator('#datenschutz').evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(top >= -2 && top < 200, `Abschnitt oben im Bild (top=${top})`);
});


// ---------- Ergänzen fehlender Preise (SMARD.de hinkt hinterher) ----------

/** Fixtures, bei denen SMARD nur Punkte bis `smardUntil` hat; aWATTar liefert Stundenmittel aller Punkte. */
function laggingSmard(set, smardUntil) {
  const smardPoints = set.points.filter((p) => p.end <= smardUntil);
  const smardFiles = Object.fromEntries(Object.keys(set.smardFiles).map((ws) => [ws, toSmardFile(smardPoints, Number(ws))]));
  return { ...set, smardFiles, awattar: toAwattar(aggregateToResolution(set.points, 60)) };
}

await scenario('SMARD ohne Preise für morgen: aWATTar ergänzt, dezenter Hinweis unter dem Diagramm, Statuszeile nennt beide', async (page) => {
  const todayEnd = Date.parse('2026-09-29T00:00:00+02:00');
  const fixtures = laggingSmard(buildFixtureSet({ now: REFERENCE_NOW }), todayEnd);
  const { log } = await mockSources(page, { fixtures });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'smard');
  assert.equal(r.viewLabel, 'Gestern bis morgen', 'morgen ist dank Ergänzung sichtbar');
  assert.ok(log.some((u) => u.includes('api.awattar.de')));
  const sup = await page.evaluate(() => window.__LADERICK__.series.supplements);
  assert.deepEqual(sup.map((s) => [s.source.id, s.from, s.until, s.resolutionMinutes]), [['awattar', todayEnd, Date.parse('2026-09-30T00:00:00+02:00'), 60]]);
  const note = page.locator('#chart-supplement');
  assert.equal(await note.isVisible(), true);
  assert.equal(await text(page, '#chart-supplement'),
    'Hinweis: Die Preise für Di., 29.09., 00:00 – 24:00 Uhr liegen bisher nur von der Drittanbieter-Quelle aWATTar vor (als Stundenwerte), '
    + 'noch nicht von der Hauptquelle SMARD.de. Sobald SMARD.de sie veröffentlicht, werden sie automatisch übernommen.');
  // leicht ausgegraut und kleiner als der Fließtext, direkt unter Diagramm und Legende
  assert.equal(await note.evaluate((el) => getComputedStyle(el).color), 'rgb(100, 104, 114)');
  assert.equal(await note.evaluate((el) => getComputedStyle(el).fontSize), '13px');
  const [legendBox, noteBox] = await Promise.all([page.locator('#chart-legend').boundingBox(), note.boundingBox()]);
  assert.ok(noteBox.y > legendBox.y, 'Hinweis steht unter der Legende');
  assert.match(await text(page, '#status-meta'),
    /^Daten: Bundesnetzagentur \| SMARD\.de \(CC BY 4\.0\) · abgerufen 14:00 Uhr · ergänzt für Di\., 29\.09\., 00:00 – 24:00 Uhr: aWATTar-API \(EPEX-SPOT-Day-Ahead-Preise\), abgerufen 14:00 Uhr · Preise bekannt bis Di\., 29\.09\., 24:00 Uhr\.$/);
  assert.equal(await text(page, '#status-msg'), '', 'keine Fehlermeldung wegen der Ergänzung');
  assert.match(await text(page, '#chart-subtitle'), /15-Minuten-Werte, teils Stundenwerte$/);
  // kommende Stunden aus aWATTar stehen in der Tabelle als Stundenzeilen
  await page.locator('#table-summary').click();
  assert.ok(await page.locator('#price-table tbody tr').filter({ hasText: 'Di., 29.09., 03:00 – 04:00 Uhr' }).count() === 1);
});

await scenario('Ohne Neuladen: ab 12:55 Uhr alle 5 Minuten nachfragen, Ergänzung übernehmen, später durch SMARD ersetzen', async (page) => {
  const start = Date.parse('2026-09-28T12:50:00+02:00');
  const todayEnd = Date.parse('2026-09-29T00:00:00+02:00');
  const before = buildFixtureSet({ now: start }); // alle Quellen nur bis heute 24:00
  const after = buildFixtureSet({ now: Date.parse('2026-09-28T13:30:00+02:00') }); // inkl. morgen
  await page.clock.install({ time: start });
  await mockSources(page, { fixtures: { ...before, awattar: toAwattar(aggregateToResolution(before.points, 60)) } });
  await page.goto(`${srv.baseUrl}/`); // Live-Uhr (gesteuert)
  await page.waitForFunction(() => Boolean(window.__LADERICK__?.series), null, { polling: 100 });
  const state = () => page.evaluate(() => ({
    end: window.__LADERICK__.series.points.at(-1).end,
    sup: (window.__LADERICK__.series.supplements ?? []).map((s) => s.source.id),
    next: window.__LADERICK__.nextLoadAt,
    now: Date.now(),
  }));
  let st = await state();
  assert.equal(st.end, todayEnd);
  assert.equal(st.next, Date.parse('2026-09-28T12:55:00+02:00'), 'nächster Abruf zur Veröffentlichung, nicht erst in einer Stunde');
  assert.match(await text(page, '#status-msg'), /Die Preise für morgen erscheinen täglich gegen 13 Uhr\./);

  // 12:55: noch keine Quelle hat morgen → Hinweis, nächster Versuch in 5 Minuten
  await page.clock.runFor(5 * MINUTE + 1000);
  await page.waitForFunction((t) => window.__LADERICK__.nextLoadAt > t, Date.parse('2026-09-28T12:56:00+02:00'), { polling: 100 });
  st = await state();
  assert.equal(st.end, todayEnd);
  assert.ok(Math.abs(st.next - (Date.parse('2026-09-28T12:55:00+02:00') + 5 * MINUTE)) < 2000, `nächster Abruf ≈ 13:00 (${new Date(st.next).toISOString()})`);
  assert.match(await text(page, '#status-msg'), /Die Preise für morgen sind noch nicht verfügbar – LadeRick prüft alle 5 Minuten erneut\./);

  // aWATTar veröffentlicht, SMARD noch nicht → beim nächsten Abruf ergänzt
  await mockSources(page, { fixtures: laggingSmard(after, todayEnd) });
  await page.clock.runFor(5 * MINUTE);
  await page.waitForFunction(() => (window.__LADERICK__.series.supplements ?? []).length === 1, null, { polling: 100 });
  st = await state();
  assert.equal(st.end, Date.parse('2026-09-30T00:00:00+02:00'));
  assert.deepEqual(st.sup, ['awattar']);
  assert.equal(await page.locator('#chart-supplement').isVisible(), true);
  assert.ok(Math.abs(st.next - (st.now + 30 * MINUTE)) < 5000, 'solange ergänzt: alle 30 Minuten');

  // SMARD zieht nach → Ergänzung und Hinweis verschwinden
  await mockSources(page, { fixtures: { ...after, awattar: toAwattar(aggregateToResolution(after.points, 60)) } });
  await page.clock.runFor(30 * MINUTE + 1000);
  await page.waitForFunction(() => !(window.__LADERICK__.series.supplements ?? []).length, null, { polling: 100 });
  assert.equal(await page.locator('#chart-supplement').isHidden(), true);
  st = await state();
  assert.equal(st.end, Date.parse('2026-09-30T00:00:00+02:00'));
  assert.ok(st.next - st.now > 55 * MINUTE, 'vollständig aus der Hauptquelle: wieder stündlich');
});

await scenario('Zwischenspeicher ohne Preise für morgen gilt nach 12:55 Uhr nicht als frisch', async (page) => {
  const now = Date.parse('2026-09-28T13:10:00+02:00');
  const todayEnd = Date.parse('2026-09-29T00:00:00+02:00');
  const set = buildFixtureSet({ now: Date.parse('2026-09-28T12:00:00+02:00') }); // bis heute 24:00
  await page.clock.install({ time: now });
  await page.addInitScript(([series, savedAt]) => {
    window.localStorage.setItem('laderick:cache:v1', JSON.stringify({ savedAt, attempts: [], series }));
  }, [{ points: set.points, resolutionMinutes: 15, fetchedAt: now - 3 * MINUTE, source: { id: 'smard', name: 'SMARD.de (Bundesnetzagentur)', url: 'https://www.smard.de/', licence: 'CC BY 4.0', attribution: '', operator: 'Bundesnetzagentur' } }, now - 6 * MINUTE]);
  const { log } = await mockSources(page, { fixtures: laggingSmard(buildFixtureSet({ now }), todayEnd) });
  await page.goto(`${srv.baseUrl}/`);
  await page.waitForFunction(() => (window.__LADERICK__?.series?.supplements ?? []).length === 1, null, { polling: 100 });
  assert.ok(log.some((u) => u.includes('smard.de')), 'trotz 6 Minuten alter Kopie neu abgefragt');
});

// ---------------------------------------------------------------------------

await browser.close();
await srv.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
