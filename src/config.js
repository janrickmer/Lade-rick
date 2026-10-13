// Zentrale Konfiguration von LadeRick. Keine Geheimnisse, keine Nutzerdaten.

export const config = Object.freeze({
  /** Länge des Analysezeitraums in Stunden („die vergangenen 36 Stunden“). */
  lookbackHours: 72,
  /** Länge des gesuchten günstigsten Zeitfensters in Stunden. */
  slotHours: 4,
  /** Reihenfolge der Datenquellen (erste erreichbare Quelle mit ausreichend Daten gewinnt). */
  sourceOrder: ['smard', 'energy-charts', 'awattar', 'snapshot'],
  /** Quellen, aus denen Preise ergänzt werden, die der gewählten Quelle fehlen, obwohl sie schon veröffentlicht sein müssten
   *  (SMARD.de trägt die Folgetagspreise oft Stunden nach der Börse nach, an manchen Tagen erst nachts). Im Browser nur
   *  aWATTar: Energy-Charts gibt seine Daten per CORS nur für die eigene Adresse frei (geprüft mit scripts/probe-sources.mjs);
   *  der serverseitige Snapshot ergänzt zuerst aus Energy-Charts (siehe scripts/fetch-snapshot.js). */
  supplementOrder: ['awattar'],
  /** Ab dieser Uhrzeit (Europe/Berlin) werden die Day-Ahead-Preise für morgen erwartet: Seit der Umstellung auf
   *  15-Minuten-Produkte (1.10.2025) veröffentlicht die gekoppelte Day-Ahead-Auktion (SDAC/EPEX SPOT) ihre vorläufigen
   *  Ergebnisse frühestens um 12:55 Uhr. */
  nextDayExpectedAt: Object.freeze({ hour: 12, minute: 55 }),
  /** Mindestens so viele Stunden Daten müssen im Analysezeitraum vorliegen, sonst nächste Quelle. */
  minAcceptedHours: 24,
  /** Timeout je HTTP-Anfrage in Millisekunden. */
  requestTimeoutMs: 6_000,
  /** Automatische Neuabfrage der Quellen (Minuten). Day-Ahead-Preise ändern sich nur einmal täglich. */
  refreshMinutes: 60,
  /** Kürzerer Takt, solange erwartete Preise fehlen (z. B. nach 12:55 Uhr noch keine Preise für morgen). */
  refreshMinutesAwaiting: 5,
  /** Takt, solange Preise nur aus einer ergänzenden Quelle stammen (bis die Hauptquelle nachzieht; schont das
   *  Fair-Use-Kontingent von aWATTar). */
  refreshMinutesSupplemented: 30,
  /** Nach Rückkehr in den Tab neu laden, wenn der letzte Abruf älter ist als (Minuten). */
  refetchAfterHiddenMinutes: 10,
  /** Zwischengespeicherte Preisdaten (localStorage) werden so lange ohne Netzabruf wiederverwendet (Minuten). */
  cacheTtlMinutes: 10,
  /** Ab diesem Alter gilt der serverseitige Snapshot als veraltet (Stunden). */
  snapshotStaleHours: 6,
  /** Angefragter Datenbereich relativ zu „jetzt“ (Tage zurück / voraus). */
  fetchDaysBack: 4,
  fetchDaysAhead: 2,
  /** Wählbare Zeiträume für das Diagramm in Kalendertagen (Europe/Berlin): 1 = heute, 2 = heute und morgen
   *  (vor Veröffentlichung der Morgenpreise: gestern und heute), 3 = gestern bis morgen (sonst vorgestern bis heute). */
  chartDaysOptions: [1, 2, 3],
  chartDaysDefault: 3,
  /** Gebotszone. */
  biddingZone: 'DE-LU',
});
