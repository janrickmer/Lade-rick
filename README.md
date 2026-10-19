# LadeRick

**LadeRick** zeigt den deutschen Börsenstrompreis (EPEX SPOT Day-Ahead, Gebotszone DE-LU) als Chart,
berechnet aus den Preisen der vergangenen 72 Stunden das im Durchschnitt günstigste 4-Stunden-Fenster und
gibt dessen ungefähren Durchschnittspreis an. Keine Anmeldung, keine Cookies, kein Tracking, kein Backend.

## Funktionen

- **Günstigstes 4-Stunden-Fenster der letzten 72 Stunden** mit Uhrzeiten, Ø-Preis in ct/kWh (und €/MWh) und
  Vergleich zum 72-h-Durchschnitt.
- **Ausblick** (orange Karte ganz oben, die Antwort auf „Wann lade ich?“): günstigstes 4-h-Fenster in den bereits veröffentlichten
  Preisen, das noch nicht begonnen hat (frühester Start: nächste volle Viertelstunde; nur dieses Fenster ist im
  Diagramm orange markiert) (Day-Ahead-Preise für den Folgetag erscheinen täglich gegen 13 Uhr) – klar als „kommend“
  gekennzeichnet, keine Prognose. Darin aufklappbar der Rückblick „Beste Ladezeit der letzten Tage“: die Uhrzeit, zu der
  ein 4-Stunden-Ladevorgang im Durchschnitt der letzten 72 Stunden am günstigsten begonnen hätte (Mittel über alle Tage
  je Uhrzeit, mindestens zwei vollständige Fenster).
- **Preisverlauf** direkt darunter als SVG-Chart mit wählbarem Zeitraum in Kalendertagen (1 Tag = heute, 2 Tage = heute und
  morgen, 3 Tage = gestern bis morgen; solange die Preise für morgen noch nicht veröffentlicht sind, rückt der Zeitraum
  einen Tag zurück), Nulllinie für negative Preise, „Jetzt“-Linie, orange markiertem kommendem Fenster, Tooltip/Ablesezeile,
  Tastaturnavigation, plus Tabellenansicht.
- **Kennzahlen**: aktueller Börsenpreis, Minimum und Maximum der letzten 72 Stunden.
- **Reihenfolge der Seite**: günstigstes kommendes 4-h-Fenster (orange) → Preisverlauf → Kennzahlen (am Desktop neben
  der orangen Karte) → günstigstes 4-h-Fenster der letzten 72 Stunden → Erklärtexte. „Datenquellen“, „Impressum“,
  „Datenschutz“ und „Haftungsausschluss“ sind aufklappbar; Links wie `#impressum` öffnen den Abschnitt automatisch.
- **Seriöse Quellen mit Fallback-Kette**: Bundesnetzagentur | SMARD.de → Energy-Charts (Fraunhofer ISE) →
  aWATTar → serverseitiger Zwischenspeicher. Die genutzte Quelle steht mit Lizenz in der Statuszeile.
- **Ergänzen statt warten**: Fehlen der Hauptquelle Preise, die schon veröffentlicht sein müssten (ab 12:55 Uhr die
  Preise für morgen, außerdem Lücken ≥ 1 h im Analysezeitraum), füllt LadeRick genau diese Zeiträume aus aWATTar.
  Unter dem Diagramm steht dann ein dezenter Hinweis („bisher nur von der Drittanbieter-Quelle aWATTar … noch nicht von
  der Hauptquelle SMARD.de“), die Statuszeile nennt beide Quellen. Sobald SMARD nachzieht, werden dessen Werte übernommen.
- Deutschsprachig, Zeiten in Europe/Berlin (inkl. Zeitumstellung), helles/dunkles Design, barrierearm.

## Datenquellen

| Quelle | Betreiber | Endpunkt | Lizenz |
|---|---|---|---|
| [SMARD.de](https://www.smard.de/) | Bundesnetzagentur | `https://www.smard.de/app/chart_data/4169/DE/…` (Filter 4169 = Großhandelspreise DE-LU, Viertelstunden, Fallback Stunden) | CC BY 4.0 |
| [Energy-Charts](https://www.energy-charts.info/) | Fraunhofer ISE | `https://api.energy-charts.info/price?bzn=DE-LU&start=…&end=…` (DE-LU-Preise unverändert von SMARD.de übernommen) | CC BY 4.0, Quellenangabe |
| [aWATTar](https://www.awattar.de/) | aWATTar GmbH | `https://api.awattar.de/v1/marketdata?start=…&end=…` (reiner EPEX-SPOT-Preis) | API-Bedingungen aWATTar |
| Zwischenspeicher | GitHub Action dieses Repos | `data/prices.json` (planmäßig stündlich erzeugt, nur Fallback) | wie Originalquelle |

Alle Preise werden in EUR/MWh verarbeitet und als ct/kWh angezeigt (÷ 10). Es handelt sich um reine
Börsenpreise ohne Netzentgelte, Steuern, Umlagen und MwSt.

**Gemessen mit dem Quellen-Check (13.10.2026, siehe unten):**

| Quelle | CORS für fremde Seiten | Cache-Header | Auflösung | Folgetagspreise |
|---|---|---|---|---|
| SMARD.de | `Access-Control-Allow-Origin: *` | nur `ETag`/`Last-Modified` (kein `Cache-Control`) | 15 min | laut Pages-Protokollen meist ca. 14–16 Uhr, an einzelnen Tagen erst nachts (09.10., 13.10.); am 10.10. fehlte sogar der laufende Tag |
| Energy-Charts | nein (fest `https://www.api.energy-charts.info`) | – | 15 min, identisch mit SMARD | am 13.10. um 20:34 Uhr vorhanden, SMARD nicht |
| aWATTar | ja (spiegelt den Origin) | `max-age=120` | 60 min = Mittel der vier Viertelstunden (max. 0,005 €/MWh Abweichung) | am 13.10. um 20:34 Uhr vorhanden |

Folgerungen: Im Browser wird nur aus aWATTar ergänzt; Energy-Charts nutzt der serverseitige Snapshot (Node, ohne
CORS). Alle Abrufe laufen mit `cache: 'no-cache'`, weil Browser SMARD-Dateien ohne `Cache-Control` sonst heuristisch
stundenlang aus dem eigenen Cache bedienen dürfen. Energy-Charts begrenzt Anfragen pro IP (ca. 2/min, HTTP 429 mit
`Retry-After`); aWATTar nennt eine Fair-Use-Grenze (ältere Angabe: 100 Abfragen pro Tag).

**Veröffentlichung:** Seit der Umstellung auf 15-Minuten-Produkte (1.10.2025) veröffentlicht die gekoppelte
Day-Ahead-Auktion (SDAC, für DE-LU über EPEX SPOT) ihre vorläufigen Ergebnisse frühestens um 12:55 Uhr (vorher 12:45 Uhr;
Quellen: Nord-Pool-FAQ zur 15-Minuten-MTU, Montel, SDAC Fallback Manual). Bei Verzögerungen kann es deutlich später
werden (Decoupling-Frist 14:20 Uhr).

## Berechnung

1. Analysezeitraum: die vergangenen 72 Stunden bis zum Ende der letzten vollständig abgeschlossenen
   Viertelstunde (bzw. Stunde bei Stundendaten).
2. Gleitendes 4-Stunden-Fenster mit Schrittweite = Datenauflösung; Mittelwert zeitgewichtet, Punkte an den
   Fenstergrenzen zählen anteilig.
3. Nur lückenlose Fenster zählen; gibt es keines, wird das beste Fenster mit ≥ 75 % Abdeckung als Näherung
   gekennzeichnet. Gleichstand → früheres Fenster.
4. Der Ausblick verwendet dieselbe Rechnung für Fenster, die noch nicht begonnen haben (Start frühestens zur nächsten
   vollen Viertelstunde, immer echt nach „jetzt“), ohne Näherungs-Fallback. Ergänzte Stundenwerte (aWATTar) gehen
   zeitgewichtet in die Mittelwerte ein; vorhandene Werte der Hauptquelle werden nie ersetzt oder gemischt. Nur dieses kommende Fenster wird im
   Diagramm orange markiert. Die Seite rechnet kurz vor jeder Viertelstundengrenze für diese Grenze neu, sodass ein
   beginnendes Fenster schon vor seinem Start ersetzt wird; ein Sekunden-Wächter rechnet zusätzlich sofort neu, wenn die
   Systemuhr springt (Standby, Zeitkorrektur) oder das angezeigte Fenster begonnen hat. Grundlage ist die Uhr des Geräts.

Die Logik liegt in `src/analysis.js` und ist vollständig durch Unit-Tests abgedeckt (u. a. Zeitumstellung,
Datenlücken, gemischte Auflösung 15/60 min, negative Preise, Duplikate aus SMARD-Wochendateien).

## Projektstruktur

```
index.html              Seite (statisch, ohne Build)
assets/styles.css       Design (Farbtoken hell/dunkel)
src/app.js              Laden → Analyse → Rendering, Auto-Aktualisierung, Theme
src/sources.js          Quellen-Adapter + Fallback-Kette (Browser und Node)
src/analysis.js         reine Berechnungsfunktionen
src/chart.js            SVG-Chart ohne Abhängigkeiten
src/ui.js               DOM-Rendering (Karten, Tabelle, Status)
src/format.js           de-DE-Formatierung, Europe/Berlin
src/config.js           Konfiguration (Lookback, Slot, Quellenreihenfolge, Intervalle)
assets/img/             Fotos für den Erklärteil (WebP, aus Wikimedia Commons, Nachweise unten)
assets/fonts/           Hanken Grotesk (SIL Open Font License), selbst gehostet
DESIGN.md               Designsystem (Farben, Schrift, Komponenten, Regeln); .impeccable/design.json maschinenlesbar
scripts/serve.js        Dev-Server ohne Abhängigkeiten
scripts/fetch-snapshot.js  erzeugt data/prices.json (GitHub Action)
tests/unit              node:test
tests/e2e               Playwright (Chromium) gegen gemockte APIs
tests/fixtures          deterministischer Generator für alle API-Formate
```

## Entwicklung

Voraussetzung: Node.js ≥ 20.

```bash
npm install                 # nur Playwright (Dev-Dependency)
npm start                   # http://localhost:8080
npm test                    # Unit-Tests
npx playwright install chromium
npm run test:e2e            # End-to-End-Tests, Screenshots in tests/e2e/__screenshots__/
npm run snapshot            # data/prices.json aus den Live-Quellen erzeugen
```

Die Seite braucht keinen Build-Schritt; ES-Module benötigen aber einen HTTP-Server (kein `file://`).

### Test-Parameter (nur zum Prüfen)

- `?now=2026-09-28T12:00:00Z` fixiert „jetzt“ (Analyse und Anzeige). Ein gelbes Banner weist darauf hin.
- `?source=smard|energy-charts|awattar|snapshot` erzwingt eine Quelle.

## Betrieb

**GitHub Pages mit eigener Domain (https://laderick.janrickmer.de):**

1. DNS beim Anbieter von `janrickmer.de`: `CNAME laderick → janrickmer.github.io` (bereits eingerichtet).
2. Repository → *Settings → Pages*: unter „Build and deployment“ als Source **GitHub Actions** wählen.
3. Auf derselben Seite unter „Custom domain“ `laderick.janrickmer.de` eintragen und speichern. GitHub prüft den
   DNS-Eintrag und stellt innerhalb von etwa einer Stunde ein TLS-Zertifikat aus; danach „Enforce HTTPS“ aktivieren.
4. Unter *Actions → GitHub Pages* den Workflow einmal starten („Run workflow“) oder den nächsten Push abwarten.

Der Workflow `.github/workflows/pages.yml` veröffentlicht die Seite bei jedem Push auf den Standard-Branch und zusätzlich
planmäßig stündlich (nachmittags halbstündlich); dabei erzeugt er serverseitig `data/prices.json` als Fallback (fehlende
Folgetagspreise ergänzt aus Energy-Charts, sonst aWATTar), falls der Browser die Quellen nicht
direkt erreichen kann (z. B. fehlende CORS-Freigabe oder Ausfall). Ohne diesen Snapshot funktioniert die Seite
ebenfalls, solange mindestens eine Quelle direkt erreichbar ist. Bei einer Veröffentlichung per GitHub Actions wird die
Domain ausschließlich über die Pages-Einstellungen gesetzt; eine `CNAME`-Datei im Repository ist dafür nicht nötig.

**Anderer statischer Host:** Die Dateien `index.html`, `assets/`, `src/` (und optional `data/prices.json`)
genügen. Die Content-Security-Policy in `index.html` erlaubt Verbindungen nur zu den drei Quellen.

**Abruftakt im Browser:** stündlich; solange Preise fehlen, die schon veröffentlicht sein müssten (ab 12:55 Uhr die
Preise für morgen), alle 5 Minuten; solange Preise nur ergänzt sind, alle 30 Minuten. Der erste Abruf nach 12:55 Uhr
erfolgt pünktlich zur Veröffentlichung. Hintergrund-Tabs holen überfällige Abrufe beim Zurückkehren nach.

**Quellen-Check:** *Actions → Quellen-Check → Run workflow* (`.github/workflows/probe.yml`, Skript
`scripts/probe-sources.mjs`) prüft je Quelle CORS- und Cache-Header, bis wann Preise vorliegen, gleicht die Werte
untereinander ab und öffnet die Live-Seite in Chromium, um die tatsächlich genutzte Quelle zu sehen.

**Hinweis zu geplanten Workflows:** GitHub führt `schedule`-Läufe nur nach Kapazität aus; in diesem Repository liefen
die stündlich geplanten Läufe real nur etwa alle 3–9 Stunden. Für den Browser ist das unkritisch (er fragt die Quellen
direkt ab), nur der Snapshot-Fallback ist dann älter. GitHub deaktiviert `schedule`-Trigger in öffentlichen Repositories nach
60 Tagen ohne Commits. Dann bleibt der Snapshot stehen (die Seite meldet ihn nach 6 Stunden als „möglicherweise
nicht aktuell“ und lehnt ihn ab, sobald weniger als 4 Stunden Daten im Analysezeitraum liegen). Unter *Actions → GitHub Pages → Enable workflow* lässt er sich
wieder aktivieren. Schlägt der stündliche Abruf fehl, bleibt der zuvor veröffentlichte Snapshot erhalten.

**Rechtliches:** Impressum (§ 5 DDG), Haftungsausschluss und Datenschutzhinweis stehen im Info-Abschnitt von
`index.html`. Änderungen an Anschrift oder Kontakt dort pflegen. Nach dem Livegang einmal im Browser prüfen, welche
Quelle tatsächlich live antwortet (Statuszeile unter den Kennzahlen).

## Gestaltung

Saubere Energiepreis-App: Die Antwort „Wann laden?“ steht oben in der orangen Fläche, die Preiskurve direkt darunter
zeigt dasselbe Fenster als oranges Band. Hell und dunkel, eine Schrift (Hanken Grotesk), Bewegung knapp und mit
Rücksicht auf „Bewegung reduzieren“. Alle Regeln, Farbwerte und Komponenten stehen in [`DESIGN.md`](DESIGN.md).

## Lizenz

MIT (siehe `LICENSE`). Die Preisdaten unterliegen den Lizenzen der jeweiligen Quellen.

**Fotos** (Wikimedia Commons, zugeschnitten und als WebP verkleinert; Nachweis auch unter jedem Bild auf der Seite):

- Windpark Pilsum am Deich in der Krummhörn (2010) – kaʁstn,
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.de),
  [Quelle](https://commons.wikimedia.org/wiki/File:Krummh%C3%B6rn,_Deich,_2010-06_CN-05.jpg)
- Hochspannungsleitung bei Häusern im Schwarzwald (2016) – Kreuzschnabel,
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.de),
  [Quelle](https://commons.wikimedia.org/wiki/File:2016_110-kV-Leitung_H%C3%A4usern_Schwarzabruck.jpg)
- Wallbox an einem Holzpfosten (2017) – Jakob Härter,
  [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/deed.de),
  [Quelle](https://commons.wikimedia.org/wiki/File:Bettermann_Ladebox_B3200_(35737706894).jpg)
- Solarpark Wörrstadt (2023) – Matthias Eckert,
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de),
  [Quelle](https://commons.wikimedia.org/wiki/File:Solarpark-W%C3%B6rrstadt.jpg)

Die zugeschnittenen Bilddateien in `assets/img/` stehen unter derselben Lizenz wie ihr jeweiliges Original.
