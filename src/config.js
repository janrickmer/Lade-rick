// Zentrale Konfiguration von LadeRick. Keine Geheimnisse, keine Nutzerdaten.

export const config = Object.freeze({
  /** Länge des Analysezeitraums in Stunden („die vergangenen 36 Stunden“). */
  lookbackHours: 36,
  /** Länge des gesuchten günstigsten Zeitfensters in Stunden. */
  slotHours: 4,
  /** Reihenfolge der Datenquellen (erste erreichbare Quelle mit ausreichend Daten gewinnt). */
  sourceOrder: ['smard', 'energy-charts', 'awattar', 'snapshot'],
  /** Mindestens so viele Stunden Daten müssen im Analysezeitraum vorliegen, sonst nächste Quelle. */
  minAcceptedHours: 24,
  /** Timeout je HTTP-Anfrage in Millisekunden. */
  requestTimeoutMs: 6_000,
  /** Automatische Neuabfrage der Quellen (Minuten). Day-Ahead-Preise ändern sich nur einmal täglich. */
  refreshMinutes: 30,
  /** Nach Rückkehr in den Tab neu laden, wenn der letzte Abruf älter ist als (Minuten). */
  refetchAfterHiddenMinutes: 10,
  /** Zwischengespeicherte Preisdaten (localStorage) werden so lange ohne Netzabruf wiederverwendet (Minuten). */
  cacheTtlMinutes: 10,
  /** Ab diesem Alter gilt der serverseitige Snapshot als veraltet (Stunden). */
  snapshotStaleHours: 6,
  /** Angefragter Datenbereich relativ zu „jetzt“ (Tage zurück / voraus). */
  fetchDaysBack: 3,
  fetchDaysAhead: 2,
  /** Gebotszone. */
  biddingZone: 'DE-LU',
});
