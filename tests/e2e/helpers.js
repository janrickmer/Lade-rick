// Hilfsfunktionen für die End-to-End-Tests: Dev-Server starten, API-Hosts mit Fixtures mocken.
import { chromium } from 'playwright';
import { createStaticServer } from '../../scripts/serve.js';
import { buildFixtureSet, REFERENCE_NOW } from '../fixtures/generate.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export { REFERENCE_NOW, buildFixtureSet };

export async function startServer() {
  const server = createStaticServer(ROOT);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function launchBrowser() {
  return chromium.launch();
}

/**
 * Richtet page.route für alle Quellen ein.
 * @param {import('playwright').Page} page
 * @param {{ fixtures?:ReturnType<typeof buildFixtureSet>, smard?:'ok'|'fail'|'cors'|'slow'|'empty', energyCharts?:'ok'|'fail'|'cors'|'ratelimit',
 *           awattar?:'ok'|'fail'|'cors', snapshot?:'ok'|'missing'|object, delayMs?:number, log?:string[] }} opts
 */
export async function mockSources(page, opts = {}) {
  const fixtures = opts.fixtures ?? buildFixtureSet({ now: REFERENCE_NOW });
  const log = opts.log ?? [];
  const mode = (name, def = 'ok') => opts[name] ?? def;

  const respond = async (route, json, status = 200) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) });
  };

  await page.route('https://www.smard.de/**', async (route) => {
    const url = route.request().url();
    log.push(url);
    const m = mode('smard');
    if (m === 'fail') return respond(route, { error: 'x' }, 503);
    if (m === 'cors') return route.abort('failed');
    if (m === 'slow') return new Promise(() => {});
    if (m === 'empty') return respond(route, { timestamps: [] });
    if (url.includes('index_quarterhour.json')) return respond(route, fixtures.smardIndex);
    if (url.includes('index_hour.json')) return respond(route, { timestamps: [] }, 404);
    const match = url.match(/quarterhour_(\d+)\.json/);
    if (match && fixtures.smardFiles[match[1]]) return respond(route, fixtures.smardFiles[match[1]]);
    return respond(route, { error: 'not found' }, 404);
  });

  await page.route('https://api.energy-charts.info/**', async (route) => {
    log.push(route.request().url());
    const m = mode('energyCharts');
    if (m === 'fail') return respond(route, { detail: 'x' }, 500);
    if (m === 'cors') return route.abort('failed');
    if (m === 'ratelimit') return respond(route, { detail: 'rate limit' }, 429);
    return respond(route, fixtures.energyCharts);
  });

  await page.route('https://api.awattar.de/**', async (route) => {
    log.push(route.request().url());
    const m = mode('awattar');
    if (m === 'fail') return respond(route, { error: 'x' }, 502);
    if (m === 'cors') return route.abort('failed');
    return respond(route, fixtures.awattar);
  });

  await page.route('**/data/prices.json', async (route) => {
    log.push(route.request().url());
    const m = mode('snapshot');
    if (m === 'missing') return respond(route, { error: 'not found' }, 404);
    if (typeof m === 'object') return respond(route, m);
    return respond(route, fixtures.snapshot);
  });

  return { fixtures, log };
}

/** Wartet, bis die Seite gerendert hat, und liefert window.__LADERICK__ (serialisierbar). */
export async function waitForRender(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(() => Boolean(window.__LADERICK__), null, { timeout });
  return page.evaluate(() => {
    const s = window.__LADERICK__;
    return JSON.parse(JSON.stringify({
      now: s.now,
      fromCache: s.fromCache ?? false,
      attempts: s.attempts,
      sourceId: s.series?.source?.id ?? null,
      pointCount: s.series?.points?.length ?? 0,
      resolutionMinutes: s.series?.resolutionMinutes ?? null,
      slot: s.result?.slot ? { start: s.result.slot.start, end: s.result.slot.end, meanPrice: s.result.slot.meanPrice, partial: s.result.slot.partial, coverage: s.result.slot.coverage } : null,
      range: s.result?.range ?? null,
      upcoming: s.upcoming ? { start: s.upcoming.start, end: s.upcoming.end, meanPrice: s.upcoming.meanPrice } : null,
      current: s.current ?? null,
      viewHours: s.viewHours ?? null,
      viewStart: s.viewStart ?? null,
    }));
  });
}

export function nowParam(ts) {
  return `now=${encodeURIComponent(new Date(ts).toISOString())}`;
}
