# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **E-Auto-Fahrende mit dynamischem Stromtarif**, meist am Smartphone: ein kurzer Blick vor dem Einstecken, um zu
  entscheiden, wann das Laden am günstigsten ist.
- **Energie-Interessierte**, oft am Desktop: verfolgen den Börsenstrompreis und lesen die Kurve genauer
  (Tagesverlauf, negative Preise, Vergleich der Tage).
- **Breites Publikum**: Menschen, die über die Suche nach „Börsenstrompreis“ auf die Seite stoßen und verstehen wollen,
  was der Preis bedeutet.

## Product Purpose

LadeRick zeigt den deutschen Börsenstrompreis (EPEX SPOT Day-Ahead, Gebotszone DE-LU) als Verlauf und beantwortet
die Frage „Wann lade ich am günstigsten?“: das günstigste kommende 4-Stunden-Fenster aus den bereits veröffentlichten
Preisen, dazu das günstigste Fenster der letzten 72 Stunden, die im Mittel beste Startzeit der letzten Tage sowie
aktueller Preis, Minimum und Maximum. Erfolg heißt: Die Antwort ist in Sekunden ablesbar und stimmt.

## Positioning

- Zeigt ausschließlich feste Auktionsergebnisse, keine Prognosen; das grün markierte Fenster hat garantiert noch nicht
  begonnen.
- Seriöse, offen genannte Quellen mit Fallback-Kette (SMARD.de der Bundesnetzagentur, Energy-Charts, aWATTar,
  serverseitiger Zwischenspeicher); fehlende Folgetagspreise werden aus aWATTar ergänzt und gekennzeichnet.
- Keine Anmeldung, keine Cookies, kein Tracking, kein Backend.

## Operating Context

- Die Day-Ahead-Preise für morgen erscheinen frühestens um 12:55 Uhr; die Seite lädt dann engmaschig nach.
- Typische Nutzung: kurzer Blick am Handy vor dem Laden; seltener längeres Lesen der Kurve am Desktop.
- Alle Zeiten in deutscher Zeit (MEZ/MESZ), Preise in ct/kWh (zusätzlich €/MWh), reiner Börsenpreis ohne
  Netzentgelte, Steuern und Umlagen.

## Capabilities and Constraints

- Statische Seite ohne Build-Schritt (HTML, CSS, ES-Module), gehostet auf GitHub Pages unter
  https://laderick.janrickmer.de; strikte Content-Security-Policy (nur eigene Dateien plus die drei Datenquellen).
- Funktionen, die erhalten bleiben: Diagramm mit Zeitraum 1/2/3 Kalendertage, Tooltip/Ablesezeile, Tastaturnavigation,
  Tabellenansicht; Karten „kommend“ und „vergangen“; Rückblick „Beste Ladezeit der letzten Tage“; Kennzahlen; Status-
  und Ergänzungshinweise; Erklärtexte; aufklappbare Datenquellen, Impressum, Datenschutz, Haftungsausschluss.
- Reihenfolge: bisher Preisverlauf ganz oben, dann das kommende Fenster, das vergangene, Kennzahlen, Erklärtexte,
  aufklappbare Abschnitte. Für die Neugestaltung freigegeben: Die Antwort „Wann laden?“ darf nach oben rücken bzw. mit
  dem Verlauf zu einem ersten Bildschirm verschmelzen.
- Sprache Deutsch, Anrede „Sie“. End-to-End-Tests greifen auf IDs und Texte der Seite zu.

## Brand Commitments

- Name „LadeRick“ mit Blitz-Symbol.
- Die Karte mit dem günstigsten kommenden 4-Stunden-Fenster ist orange.
- Helle und dunkle Darstellung mit Umschalter.
- Ton: sachlich, ehrlich, zum eigenen Prüfen ermutigend; keine Werbesprache.

## Evidence on Hand

- Echte Live-Preisdaten der genannten Quellen; Rechtstexte (Impressum: Jan-Rickmer Feindt, Schauenburg).
- Bilder: frei lizenzierte Bilder aus offenen Sammlungen sind erlaubt, mit Quellenangabe auf der Seite; eigene Fotos
  gibt es bisher nicht.
- Keine Nutzerstimmen, Kundenzahlen, Presse oder Auszeichnungen – nichts davon erfinden.

## Product Principles

1. Die Antwort zuerst: Wann ist das günstigste kommende Fenster, und was kostet es ungefähr?
2. Ehrlichkeit vor Effekt: feste Preise als fest, Rückblick als Rückblick, Ergänzungen und Näherungen sichtbar.
3. Quellen offenlegen und zum eigenen Prüfen ermutigen.
4. Ohne Anmeldung und ohne Datensammeln nutzbar.

## Accessibility & Inclusion

Mindestens WCAG 2.1 AA: ausreichende Kontraste in hell und dunkel, Tastaturbedienung des Diagramms, Screenreader-
Ausgabe, Tabellenalternative, `prefers-reduced-motion` respektieren, kein horizontales Scrollen ab 320 px Breite.
