#!/usr/bin/env node
// Erzeugt data/prices.json als serverseitigen Zwischenspeicher (z. B. stündlich per GitHub Action).
// Nutzt dieselben Adapter wie die Seite, aber ohne den Snapshot selbst als Quelle.
//
// Aufruf: node scripts/fetch-snapshot.js [--tolerant] [--out data/prices.json]
//   --tolerant  Exit-Code 0 auch bei Fehlschlag (Deploy soll nicht scheitern; die Seite hat dann keinen Snapshot)

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPrices, SNAPSHOT_FORMAT } from '../src/sources.js';
import { config } from '../src/config.js';
import { HOUR } from '../src/analysis.js';

const args = process.argv.slice(2);
const tolerant = args.includes('--tolerant');
const outIdx = args.indexOf('--out');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(root, outIdx >= 0 ? args[outIdx + 1] : 'data/prices.json');

const now = Date.now();
const order = config.sourceOrder.filter((id) => id !== 'snapshot');
const { series, attempts } = await fetchPrices({ now, order, timeoutMs: 20_000 });

for (const a of attempts) {
  console.log(`${a.ok ? 'OK  ' : 'FAIL'} ${a.id.padEnd(14)} ${a.ms} ms${a.error ? ` – ${a.error}` : ''}${a.coveredHours !== undefined ? ` – ${a.coveredHours.toFixed(1)} h im Analysezeitraum` : ''}`);
}

if (!series) {
  console.error('Snapshot konnte nicht erzeugt werden: keine Quelle lieferte Daten.');
  process.exit(tolerant ? 0 : 1);
}

// Auf einen sinnvollen Zeitraum begrenzen (4 Tage zurück bis Ende der bekannten Daten).
const from = now - 4 * 24 * HOUR;
const points = series.points.filter((p) => p.end > from);
const snapshot = {
  format: SNAPSHOT_FORMAT,
  generatedAt: now,
  bzn: config.biddingZone,
  resolutionMinutes: series.resolutionMinutes,
  unit: 'EUR/MWh',
  source: series.source,
  points,
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(snapshot)}\n`);
console.log(`Snapshot geschrieben: ${outFile} (${points.length} Punkte, Quelle ${series.source.id}, bis ${new Date(points.at(-1).end).toISOString()})`);
