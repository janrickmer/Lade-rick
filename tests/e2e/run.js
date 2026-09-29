// End-to-End-Tests mit Playwright (Chromium) gegen den Dev-Server; alle Quellen werden per page.route gemockt.
// Aufruf: npm run test:e2e   (Chromium: npx playwright install chromium, falls nicht vorhanden)

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, mockSources, waitForRender, nowParam, REFERENCE_NOW, buildFixtureSet, ROOT } from './helpers.js';
import { plantedPrice, syntheticPrice } from '../fixtures/generate.js';
import { cheapestSlot, cheapestUpcomingSlot, cheapestStartTimeOfDay, normalizePoints, HOUR, MINUTE } from '../../src/analysis.js';
import { formatWindow, formatCt, berlinParts } from '../../src/format.js';
import { config } from '../../src/config.js';

const SHOTS = resolve(ROOT, 'tests/e2e/__screenshots__');
await mkdir(SHOTS, { recursive: true });

const srv = await startServer();
const browser = await launchBrowser();
let failed = 0;
let passed = 0;

const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED|status of (4|5)\d\d/;

async function scenario(name, fn, { viewport = { width: 1200, height: 900 }, colorScheme = 'light', storage = null, hasTouch = false } = {}) {
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
  assert.equal(r.slot.start, expected.slot.start);
  assert.equal(r.slot.end, expected.slot.end);
  assert.ok(Math.abs(r.slot.meanPrice - expected.slot.meanPrice) < 1e-9);

  const w = formatWindow(expected.slot.start, expected.slot.end, { now: REFERENCE_NOW });
  assert.equal(await text(page, '#hero [data-field="time"]'), w.main.replace(/\s+/g, ' '));
  assert.equal(await text(page, '#hero [data-field="day"]'), w.overline);
  assert.equal(await text(page, '#hero [data-field="ct"]'), formatCt(expected.slot.meanPrice).replace(/\s+/g, ' '));
  assert.match(await text(page, '#hero [data-field="compare"]'), /günstiger als der Durchschnitt der letzten 72 h/);
  assert.match(await text(page, '#hero [data-field="range"]'), /Analysiert: .* \(72 h\)\./);
  // Diagramm steht ganz oben, vor der Hero-Karte
  assert.ok((await page.locator('#chart-card').boundingBox()).y < (await page.locator('#hero').boundingBox()).y, 'Chart über der Hero-Karte');
  assert.equal(await page.locator('#range-3').isChecked(), true);
  assert.equal(await text(page, '#chart-subtitle'), 'Gestern bis morgen · So., 27.09., 00:00 – Di., 29.09., 24:00 Uhr · 15-Minuten-Werte');
  assert.equal(await text(page, '#range-hint'), 'Gestern bis morgen: So., 27.09., 00:00 – Di., 29.09., 24:00 Uhr.');
  assert.equal(await page.locator('#hero [data-field="empty"]').isHidden(), true);
  assert.equal(await page.locator('#hero').getAttribute('data-state'), 'ready');

  const uw = formatWindow(expectedUpcoming.start, expectedUpcoming.end, { now: REFERENCE_NOW });
  assert.equal(await text(page, '#outlook [data-field="time"]'), uw.main.replace(/\s+/g, ' '));
  assert.match(await text(page, '#outlook [data-field="pill"]'), /^Kommend · bekannt bis Di\., 29\.09\., 24:00 Uhr$/);
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
  assert.equal(await page.locator('#chart svg .band-cheapest').count(), 1);
  assert.equal(await page.locator('#chart svg .outlook-box').count(), 1);
  assert.equal(await page.locator('#chart svg .now-line').count(), 1);
  assert.equal(await page.locator('#chart svg .region-future').count(), 1);
  assert.match(await text(page, '#chart svg desc'), /Günstigstes 4-Stunden-Fenster/);
  assert.match(await text(page, '#chart-subtitle'), /15-Minuten-Werte$/);

  // Tabelle: alle Punkte ab Analysebeginn
  const rowsExpected = base.points.filter((p) => p.end > r.viewStart && p.start < r.viewEnd).length;
  assert.equal(rowsExpected, 3 * 96);
  assert.equal(await page.locator('#price-table tbody tr').count(), rowsExpected);
  assert.match(await text(page, '#table-summary'), new RegExp(`\\(${rowsExpected} Zeilen\\)`));
  assert.equal(await page.locator('#price-table tbody tr.row-cheapest').count(), 16);
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
  await page.keyboard.press('End');
  assert.match(await text(page, '#chart-output'), /^Di\., 29\.09\., 23:45 – 24:00 Uhr.*kommend/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.chart-tooltip').isHidden(), true);
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
  await page.locator('#chart .hit-area').hover({ position: { x: 150, y: 100 } });
  await page.waitForFunction(() => document.querySelector('#chart-readout').textContent.includes('ct/kWh'));
  assert.equal(await page.locator('.chart-tooltip').isVisible(), false);
  assert.match(await text(page, '#chart-readout'), /Uhr · .* ct\/kWh · .* €\/MWh/);
  await page.screenshot({ path: resolve(SHOTS, 'mobile-light.png'), fullPage: true });
}, { viewport: { width: 360, height: 780 } });

await scenario('Dunkles Design: folgt der Systemeinstellung, Umschalter speichert nur bei Klick', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  await waitForRender(page);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 13, 13)');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await text(page, '#theme-toggle'), 'Dunkles Design');
  assert.equal(await page.evaluate(() => localStorage.getItem('laderick:theme')), null);
  await page.screenshot({ path: resolve(SHOTS, 'desktop-dark.png'), fullPage: true });
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(249, 249, 247)');
  assert.equal(await page.evaluate(() => localStorage.getItem('laderick:theme')), 'light');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'false');
}, { colorScheme: 'dark' });

await scenario('Gespeichertes dunkles Design wird vor dem ersten Rendern gesetzt', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 13, 13)');
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
  assert.equal(await page.locator('#price-table tbody tr.row-cheapest').count(), 16);
  const rows = await page.locator('#price-table tbody tr.row-cheapest td:first-child').allTextContents();
  assert.ok(rows.some((r) => /02:45\s*–\s*03:00\s*Uhr \(MESZ\)/.test(r)), rows.join(' | '));
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
  await page.waitForFunction(() => document.querySelector('#chart-readout').textContent.includes('ct/kWh'));
  const first = await text(page, '#chart-readout');
  assert.match(first, /^So\., 27\.09\., 0\d:/, first);
  await page.waitForTimeout(150);
  assert.equal(await text(page, '#chart-readout'), first, 'Auswahl bleibt nach dem Tippen erhalten');
  const box2 = await page.locator('#chart .hit-area').boundingBox();
  await page.touchscreen.tap(box2.x + box2.width - 20, box2.y + 60);
  await page.waitForFunction(() => /Di\., 29\.09\., (1[0-9]|2[0-3]):/.test(document.querySelector('#chart-readout').textContent));
  await page.waitForTimeout(150);
  assert.match(await text(page, '#chart-readout'), /Di\., 29\.09\., (1[0-9]|2[0-3]):.*kommend/);
}, { viewport: { width: 360, height: 780 }, hasTouch: true });

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

await scenario('Tablet (768 px): zweispaltige Hero-Karten ohne Überlauf', async (page) => {
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

await scenario('Laufendes Ausblick-Fenster bis Mitternacht wird als „noch bis 24:00 Uhr“ beschrieben', async (page) => {
  const now = Date.parse('2026-09-28T18:07:00Z'); // 20:07 MESZ – Fenster 20:00–24:00 läuft
  const cheapStart = Date.parse('2026-09-28T18:00:00Z'); // 20:00 MESZ
  const fixtures = buildFixtureSet({ now, price: (ts) => (ts >= cheapStart && ts < cheapStart + 4 * HOUR ? 1 : Math.max(syntheticPrice(ts), 5)) });
  await mockSources(page, { fixtures });
  await page.goto(url(nowParam(now)));
  const r = await waitForRender(page);
  assert.equal(r.upcoming.start, cheapStart);
  assert.equal(await text(page, '#outlook [data-field="time"]'), '20:00 – 24:00 Uhr');
  assert.equal(await text(page, '#outlook [data-field="starts"]'), 'Läuft – noch bis 24:00 Uhr.');
});

await scenario('Unbrauchbarer Zwischenspeicher wird verworfen und die Seite lädt normal', async (page) => {
  await mockSources(page, {});
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
  assert.equal(await page.locator('#chart svg .band-cheapest').count(), 0, 'Fenster von gestern liegt außerhalb der Tagesansicht');
  assert.equal(await page.locator('#chart svg .outlook-box').count(), 0, 'Ausblick liegt morgen, außerhalb der Tagesansicht');
  assert.equal(await page.evaluate(() => localStorage.getItem('laderick:days')), '1');

  await page.locator('label[for="range-2"]').click();
  await page.waitForFunction(() => window.__LADERICK__?.viewDays === 2);
  const r2 = await waitForRender(page);
  assert.equal(r2.viewLabel, 'Heute und morgen');
  assert.equal(r2.viewStart, Date.parse('2026-09-27T22:00:00Z'));
  assert.equal(r2.viewEnd, Date.parse('2026-09-29T22:00:00Z'));
  assert.equal(await page.locator('#price-table tbody tr').count(), 2 * 96);
  assert.equal(await page.locator('#chart svg .outlook-box').count(), 1);

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

await scenario('Orange Empfehlungskarte: beste Startzeit über 72 h, zweite Karte nach dem Diagramm', async (page) => {
  await mockSources(page, {});
  await page.goto(url());
  const r = await waitForRender(page);
  const key = (ts) => { const p = berlinParts(ts); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
  const exp = cheapestStartTimeOfDay(normalizePoints(base.points), { now: REFERENCE_NOW, lookbackHours: 72, slotHours: 4, wallClockKey: key });
  assert.ok(exp.best, 'Erwartung berechenbar');
  assert.equal(r.startTime.key, exp.best.key);
  assert.equal(r.startTime.count, exp.best.count);
  assert.ok(exp.best.count >= 2);
  assert.equal(await text(page, '#start-time [data-field="time"]'), `${exp.best.key} Uhr`);
  assert.equal(await text(page, '#start-time [data-field="ct"]'), formatCt(exp.best.meanPrice).replace(/\s+/g, ' '));
  assert.match(await text(page, '#start-time .start-lead'), /^Gemessen an den Strompreisen der vergangenen 72 Stunden haben Sie durchschnittlich das günstigste 4-stündige Lade-Zeitfenster, wenn Sie um diese Uhrzeit Ihre Ladung gestartet hätten:$/);
  assert.match(await text(page, '#start-time [data-field="days"]'), /^Durchschnitt aus [23] Tagen \(ct\/kWh\): (Fr\., 25\.09\. [\d,−]+ · )?Sa\., 26\.09\. [\d,−]+ · So\., 27\.09\. [\d,−]+\.$/);
  assert.match(await text(page, '#start-time [data-field="runner"]'), /^Zweitbeste Startzeit: \d\d:\d\d Uhr \(Ø ca\. .* ct\/kWh\)\.$/);
  // Position: direkt nach dem Diagramm, vor der Hero-Karte; komplett orange
  const chartBox = await page.locator('#chart-card').boundingBox();
  const cardBox = await page.locator('#start-time').boundingBox();
  const heroBox = await page.locator('#hero').boundingBox();
  assert.ok(chartBox.y < cardBox.y && cardBox.y < heroBox.y, 'Reihenfolge Diagramm → Empfehlung → Hero');
  assert.equal(await page.locator('#start-time').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(240, 138, 46)');
  assert.equal(await page.locator('#start-time').getAttribute('data-state'), 'ready');
});

await scenario('Empfehlungskarte ohne ausreichende Daten zeigt einen Hinweis', async (page) => {
  const fixtures = buildFixtureSet({ now: REFERENCE_NOW });
  // nur die letzten 26 h behalten: jede Uhrzeit hat höchstens ein vollständiges Fenster
  const pts = fixtures.points.filter((p) => p.start >= REFERENCE_NOW - 26 * HOUR);
  const { toEnergyCharts } = await import('../fixtures/generate.js');
  await mockSources(page, { fixtures: { ...fixtures, energyCharts: toEnergyCharts(pts) }, smard: 'fail' });
  await page.goto(url());
  const r = await waitForRender(page);
  assert.equal(r.sourceId, 'energy-charts');
  assert.equal(r.startTime, null);
  assert.equal(await page.locator('#start-time [data-field="empty"]').isVisible(), true);
  assert.equal(await text(page, '#start-time [data-field="time"]'), '–');
});

// ---------------------------------------------------------------------------

await browser.close();
await srv.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
