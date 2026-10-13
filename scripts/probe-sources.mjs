#!/usr/bin/env node
// Quellen-Check: prüft je Datenquelle Erreichbarkeit, CORS- und Cache-Header sowie das Ende der bekannten Preise,
// und öffnet optional die Live-Seite in Chromium, um zu sehen, welche Quelle der Browser tatsächlich nutzt.
//
// Aufruf: node scripts/probe-sources.mjs [--site https://laderick.janrickmer.de] [--json]

const args = process.argv.slice(2);
const siteIdx = args.indexOf('--site');
const site = siteIdx >= 0 ? args[siteIdx + 1] : null;
const ORIGIN = 'https://laderick.janrickmer.de';
const HEADERS = ['access-control-allow-origin', 'cache-control', 'age', 'expires', 'etag', 'last-modified', 'date', 'x-cache', 'cf-cache-status'];

const berlin = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '–');
const ymd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Origin: ORIGIN, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const headers = Object.fromEntries(HEADERS.map((h) => [h, res.headers.get(h)]).filter(([, v]) => v !== null));
  const body = res.ok ? await res.json() : null;
  return { status: res.status, ms: Date.now() - t0, headers, body };
}

function report(name, url, r, lastEnd) {
  console.log(`\n## ${name}\n${url}\nHTTP ${r.status} in ${r.ms} ms`);
  for (const [k, v] of Object.entries(r.headers)) console.log(`  ${k}: ${v}`);
  if (!r.headers['access-control-allow-origin']) console.log('  (kein Access-Control-Allow-Origin → Browser blockiert den Abruf)');
  console.log(`  bekannte Preise bis: ${berlin(lastEnd)} (Europe/Berlin)`);
}

const now = Date.now();
console.log(`Quellen-Check ${new Date(now).toISOString()} (${berlin(now)} Europe/Berlin)`);

// SMARD: Index → letzte Wochendatei → letzter Wert ≠ null
for (const resolution of ['quarterhour', 'hour']) {
  const base = 'https://www.smard.de/app/chart_data/4169/DE';
  try {
    const idx = await get(`${base}/index_${resolution}.json`);
    report(`SMARD Index (${resolution})`, `${base}/index_${resolution}.json`, idx, NaN);
    const stamps = (idx.body?.timestamps ?? []).map(Number).sort((a, b) => a - b);
    console.log(`  letzte Wochendateien: ${stamps.slice(-2).map((t) => `${t} (${berlin(t)})`).join(', ')}`);
    let lastEnd = NaN;
    for (const ts of stamps.slice(-2)) {
      const url = `${base}/4169_DE_${resolution}_${ts}.json`;
      const f = await get(url);
      const vals = (f.body?.series ?? []).filter((e) => Array.isArray(e) && e[1] !== null);
      const last = vals.at(-1)?.[0];
      if (Number.isFinite(last)) lastEnd = last + (resolution === 'quarterhour' ? 15 : 60) * 60_000;
      report(`SMARD Datei (${resolution})`, url, f, Number.isFinite(last) ? lastEnd : NaN);
    }
  } catch (err) {
    console.log(`\n## SMARD (${resolution})\nFehler: ${err.message}`);
  }
}

// Energy-Charts
try {
  const url = `https://api.energy-charts.info/price?bzn=DE-LU&start=${ymd(now - 2 * 86_400_000)}&end=${ymd(now + 2 * 86_400_000)}`;
  const r = await get(url);
  const secs = r.body?.unix_seconds ?? [];
  const prices = r.body?.price ?? [];
  let lastEnd = NaN;
  for (let i = secs.length - 1; i >= 0; i -= 1) if (prices[i] !== null && prices[i] !== undefined) { lastEnd = secs[i] * 1000 + (secs[i] - (secs[i - 1] ?? secs[i] - 900)) * 1000; break; }
  report('Energy-Charts', url, r, lastEnd);
} catch (err) {
  console.log(`\n## Energy-Charts\nFehler: ${err.message}`);
}

// aWATTar
try {
  const url = `https://api.awattar.de/v1/marketdata?start=${now - 86_400_000}&end=${now + 2 * 86_400_000}`;
  const r = await get(url);
  const data = r.body?.data ?? [];
  report('aWATTar', url, r, Number(data.at(-1)?.end_timestamp));
  if (data.length > 1) console.log(`  Auflösung: ${(data[1].start_timestamp - data[0].start_timestamp) / 60_000} min`);
} catch (err) {
  console.log(`\n## aWATTar\nFehler: ${err.message}`);
}

// Werte-Abgleich für heute (Europe/Berlin): Viertelstunden SMARD ↔ Energy-Charts, Stunden aWATTar ↔ Mittel der SMARD-Viertelstunden
try {
  const smardIdx = await get('https://www.smard.de/app/chart_data/4169/DE/index_quarterhour.json');
  const stamps = (smardIdx.body?.timestamps ?? []).map(Number).sort((a, b) => a - b).slice(-2);
  const smard = new Map();
  for (const ts of stamps) {
    const f = await get(`https://www.smard.de/app/chart_data/4169/DE/4169_DE_quarterhour_${ts}.json`);
    for (const [t, v] of f.body?.series ?? []) if (v !== null) smard.set(t, v);
  }
  const ec = await get(`https://api.energy-charts.info/price?bzn=DE-LU&start=${ymd(now - 86_400_000)}&end=${ymd(now + 86_400_000)}`);
  console.log(`\n## Werte-Abgleich\n  Energy-Charts license_info: ${ec.body?.license_info ?? '–'}`);
  let n = 0; let maxDiff = 0;
  (ec.body?.unix_seconds ?? []).forEach((s, i) => {
    const v = ec.body.price[i];
    if (v === null || !smard.has(s * 1000)) return;
    n += 1; maxDiff = Math.max(maxDiff, Math.abs(v - smard.get(s * 1000)));
  });
  console.log(`  Energy-Charts vs. SMARD (Viertelstunden): ${n} gemeinsame Werte, max. Abweichung ${maxDiff.toFixed(3)} €/MWh`);
  const aw = await get(`https://api.awattar.de/v1/marketdata?start=${now - 2 * 86_400_000}&end=${now + 2 * 86_400_000}`);
  let m = 0; let maxAw = 0; let maxAwRounded = 0; const samples = [];
  for (const e of aw.body?.data ?? []) {
    const q = [0, 1, 2, 3].map((k) => smard.get(e.start_timestamp + k * 900_000));
    if (q.some((v) => v === undefined)) continue;
    const mean = q.reduce((a, b) => a + b, 0) / 4;
    m += 1; maxAw = Math.max(maxAw, Math.abs(e.marketprice - mean));
    maxAwRounded = Math.max(maxAwRounded, Math.abs(e.marketprice - Math.round(mean * 100) / 100));
    if (samples.length < 3) samples.push(`${berlin(e.start_timestamp)}: aWATTar ${e.marketprice} / Mittel SMARD ${mean.toFixed(3)} (${q.join(', ')})`);
  }
  console.log(`  aWATTar vs. Mittel der SMARD-Viertelstunden: ${m} Stunden, max. Abweichung ${maxAw.toFixed(3)} €/MWh (gegen gerundetes Mittel ${maxAwRounded.toFixed(3)})`);
  for (const s of samples) console.log(`    ${s}`);
} catch (err) {
  console.log(`\n## Werte-Abgleich\nFehler: ${err.message}`);
}

// Live-Seite im echten Browser (CORS wird nur hier wirksam)
if (site) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  for (const source of [null, 'smard', 'energy-charts', 'awattar', 'snapshot']) {
    const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const page = await ctx.newPage();
    const url = source ? `${site}/?source=${source}` : `${site}/`;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(() => window.__LADERICK__ && 'series' in window.__LADERICK__, null, { timeout: 45_000 });
      const r = await page.evaluate(() => {
        const L = window.__LADERICK__;
        return {
          source: L.series?.source?.id ?? null,
          snapshotOf: L.series?.snapshotOf?.id ?? null,
          lastEnd: L.series?.points?.at(-1)?.end ?? null,
          attempts: (L.attempts ?? []).map((a) => `${a.id}:${a.ok ? 'ok' : a.kind}`).join(', '),
          status: document.getElementById('status-meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        };
      });
      console.log(`\n## Browser ${url}\n  Quelle: ${r.source}${r.snapshotOf ? ` (Snapshot von ${r.snapshotOf})` : ''}\n  Versuche: ${r.attempts}\n  bekannte Preise bis: ${berlin(r.lastEnd)}\n  Statuszeile: ${r.status}`);
    } catch (err) {
      console.log(`\n## Browser ${url}\nFehler: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
}
