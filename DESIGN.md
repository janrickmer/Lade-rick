---
name: LadeRick
description: "Börsenstrompreis für Deutschland – eine saubere Energiepreis-App: die Antwort „Wann laden?“ zuerst, die Kurve direkt darunter."
colors:
  orange: "#f08a2e"
  orange-ink: "#0b0b0b"
  orange-ink-2: "rgba(11, 11, 11, 0.74)"
  band-edge: "#b4560f"
  orange-wash: "rgba(240, 138, 46, 0.16)"
  answer-veil: "rgba(255, 255, 255, 0.24)"
  page: "#f1f2f4"
  surface: "#ffffff"
  surface-2: "#eceef1"
  surface-3: "#e2e5ea"
  ink: "#111214"
  ink-2: "#474a52"
  muted: "#646872"
  grid: "#e7e9ed"
  axis: "#8a8e96"
  line-past: "#80848c"
  past-wash: "#f4f5f7"
  future-area: "rgba(17, 18, 20, 0.06)"
  shimmer: "rgba(17, 18, 20, 0.07)"
  critical: "#c42b2b"
  warning-wash: "#fdeec9"
  page-dark: "#0f1012"
  surface-dark: "#1b1c1f"
  surface-2-dark: "#26282c"
  surface-3-dark: "#303237"
  ink-dark: "#f4f5f7"
  ink-2-dark: "#c0c3ca"
  muted-dark: "#979ba4"
  grid-dark: "#2a2c30"
  axis-dark: "#6e727b"
  line-past-dark: "#6e727b"
  past-wash-dark: "#222327"
  future-area-dark: "rgba(244, 245, 247, 0.07)"
  shimmer-dark: "rgba(244, 245, 247, 0.08)"
  orange-wash-dark: "rgba(240, 138, 46, 0.22)"
  critical-dark: "#ff6b63"
  warning-wash-dark: "#3b3220"
typography:
  display:
    fontFamily: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "clamp(2.125rem, 15cqi, 6.5rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.035em"
    fontFeature: '"tnum" 1'
  headline:
    fontFamily: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontFeature: '"tnum" 1'
  title:
    fontFamily: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontFeature: '"tnum" 1'
  body:
    fontFamily: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontFeature: '"tnum" 1'
  label:
    fontFamily: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontFeature: '"tnum" 1'
rounded:
  sm: "12px"
  md: "18px"
  lg: "24px"
  full: "999px"
spacing:
  gap: "12px"
  pad: "20px"
  gutter: "16px"
  section: "72px"
components:
  answer-card:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.orange-ink}"
    rounded: "{rounded.lg}"
    padding: "24px 20px 20px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.pad}"
  kpi-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "0 20px"
    height: "44px"
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "44px"
  icon-button-hover:
    backgroundColor: "{colors.surface-3}"
  segmented:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.full}"
    padding: "4px"
  segmented-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    rounded: "{rounded.full}"
    padding: "0 14px"
    height: "44px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "28px"
  chip-warn:
    backgroundColor: "{colors.warning-wash}"
  disclosure:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "60px"
  disclosure-hover:
    backgroundColor: "{colors.surface-2}"
  answer-disclosure:
    backgroundColor: "{colors.answer-veil}"
    textColor: "{colors.orange-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "48px"
  banner:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  tooltip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  tooltip-dark:
    backgroundColor: "{colors.surface-3-dark}"
    textColor: "{colors.ink-dark}"
  chart-band:
    backgroundColor: "{colors.orange}"
  table-row-cheapest:
    backgroundColor: "{colors.orange-wash}"
  brand-tile:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.orange-ink}"
    rounded: "13px"
    size: "44px"
---

# Design System: LadeRick

## Overview

**Creative North Star: "Das orange Fenster"**

LadeRick ist eine saubere Energiepreis-App im Standard ihrer Kategorie: ruhige, neutral-kühle Flächen, auf denen genau eine Sache leuchtet – das günstigste kommende Ladefenster. Es erscheint zweimal in derselben Farbe: oben als orange Antwortfläche mit Tag, Uhrzeit und Preis, darunter als oranges Band in der Preiskurve, an dem sich die Antwort prüfen lässt. Alles andere – Kennzahlen, Rückblick, Tabelle, Erklärtexte – ordnet sich in Weiß, kühlem Grau und fast schwarzer Tinte darunter ein.

Die Dichte ist die eines Werkzeugs für den kurzen Blick am Handy, das am Desktop zum genauen Lesen der Kurve einlädt. Große Radien, Tonstufen statt Linien und Schatten, runde Bedienelemente und eine einzige Schrift, Hanken Grotesk, mit tabellarischen Ziffern. Bewegung ist knapp und funktional: Die Bühne setzt sich einmal, das Fensterband steigt einmal auf, der Zeitraum-Umschalter gleitet; danach ist die Seite still. Hell und dunkel tragen dieselben Rollen – dunkel ist tiefes Anthrazit –, und die Antwortfläche bleibt in beiden Designs orange mit dunkler Schrift.

Bestätigte Absagen: nicht technisch-kalt wie ein Börsenterminal, nicht werblich wie eine Verkaufsseite. Die Seite trägt derzeit keine Fotos oder Illustrationen; das Bild ist die Kurve. Das ist der Stand der Umsetzung, keine Regel – frei lizenzierte Bilder mit Quellenangabe sind erlaubt, waren beim Bau aber nicht erreichbar, und nichts wurde erfunden.

**Key Characteristics:**
- Eine Akzentfarbe, Ladeorange, ausschließlich für das günstigste kommende Fenster und das Markenzeichen.
- Neutral-kühler heller Grund, weiße Flächen mit 24/18/12 px Radius, Trennung durch Tonstufen statt Rahmen.
- Flach in Ruhe; der Diagramm-Tooltip ist das einzige schwebende Element mit Schatten.
- Hanken Grotesk in fünf Größen, tabellarische Ziffern auf der ganzen Seite.
- Runde Bedienelemente (Pillen, mindestens 44 px hoch); Interaktion in Tinte, nie in Orange.
- Bewegung einmalig beim ersten Zeichnen, nur über transform und clip-path, mit Ausweichpfad bei reduzierter Bewegung.

## Colors

Ein ruhiges, leicht bläulich-kühles System aus Grau, Weiß und Tinte mit einer einzigen warmen Stimme, dem Ladeorange.

### Primary
- **Ladeorange** (`orange`, #f08a2e): Antwortfläche, Fensterband im Diagramm, Legendenfeld des Fensters, Markenkachel und Favicon, Ablesemarker innerhalb des Fensters, Kennzeichen „günstig“ in der schmalen Tabelle. Gleich in hell und dunkel.
- **Orange-Tinte** (`orange-ink`, #0b0b0b): Text, Blitz und Symbole auf Orange (7,85:1) sowie die Kurve innerhalb des Fensterbands. Auf der Antwortfläche werden Tinte und Fokus lokal auf diese Farbe umgestellt, damit alles darin dunkel auf Orange steht.
- **Gedämpfte Orange-Tinte** (`orange-ink-2`, rgba(11, 11, 11, 0.74)): Nebentext auf Orange – Preiszeile, Fußnote (5,12:1).
- **Gebrannte Kante** (`band-edge`, #b4560f): 1-px-Kante des Fensterbands und des Legendenfelds im hellen Design, 4,91:1 gegen Weiß. Im dunklen Design ist die Kante das Ladeorange selbst, das gegen die Anthrazitfläche bereits 6,8:1 erreicht.
- **Orange-Hauch** (`orange-wash`, rgba(240, 138, 46, 0.16); dunkel `orange-wash-dark`): Grund der Tabellenzeilen im günstigsten Fenster; eine dichtere Tönung (0.32) dient als Textauswahl.
- **Weißer Schleier** (`answer-veil`, rgba(255, 255, 255, 0.24)): einziges Material auf der Antwortfläche – die aufklappbare Rückblickzeile und ihr Hover. Chips auf Orange nutzen denselben Schleier etwas dichter (0.35).

### Neutral
- **Kühles Hellgrau** (`page`, #f1f2f4): Seitengrund und Browserfarbe; zugleich Schrift auf Tinte-Flächen (Primärknopf, gewähltes Segment).
- **Weiß** (`surface`, #ffffff): Karten, Kennzahl-Kacheln, Aufklappzeilen, Tooltip, Fußzeilenband, runder Designknopf.
- **Helle Tonstufe** (`surface-2`, #eceef1): Spur des Zeitraum-Umschalters, Tabellengrund, Chips, Hover der Aufklappzeilen.
- **Tiefere Tonstufe** (`surface-3`, #e2e5ea): Tabellenkopf, Hover des Designknopfs, Kennzeichen in der schmalen Tabelle.
- **Fast-Schwarz** (`ink`, #111214): Text, Kurve der kommenden Preise, Primärknopf, gewähltes Segment, Fokusring, Jetzt-Punkt (16,7:1 auf dem Seitengrund).
- **Schiefer** (`ink-2`, #474a52): Untertitel, Kachelbeschriftungen, Tagesbeschriftung der Zeitachse, Fadenkreuz (≥7,9:1).
- **Gedämpftes Grau** (`muted`, #646872): Achsenbeschriftung, Fußnoten, Unterzeilen (≥4,8:1 auf allen hellen Flächen).
- **Gitterton** (`grid`, #e7e9ed): Gitterlinien, Zeitachse und Trennlinien der Tabellenzeilen – die einzigen Linien des Systems.
- **Achsgrau** (`axis`, #8a8e96): Nulllinie im Diagramm, Scrollbalken der Tabelle.
- **Vergangenheitsgrau** (`line-past`, #80848c): Kurve und Legendenstrich der vergangenen Preise.
- **Vergangenheitston** (`past-wash`, #f4f5f7): Tonfläche links von „jetzt“ im Diagramm.
- **Zukunftsfläche** (`future-area`, rgba(17, 18, 20, 0.06)): leichte Fläche unter der kommenden Kurve.
- **Ladeschimmer** (`shimmer`, rgba(17, 18, 20, 0.07)): Platzhalterflächen für Werte im Ladezustand.

### Status
- **Signalrot** (`critical`, #c42b2b; dunkel `critical-dark`, #ff6b63): nur der Titel der Fehlerkarte.
- **Hinweisgelb** (`warning-wash`, #fdeec9; dunkel `warning-wash-dark`, #3b3220): Banner der Test- und Zwischenspeicheransicht, Warn-Chip „Datenlücke – Näherung“.

### Dunkel
Tiefes Anthrazit mit denselben Rollen: Seitengrund `page-dark`, Flächen `surface-dark` → `surface-2-dark` → `surface-3-dark`, die Tinte kehrt sich um (`ink-dark`, `ink-2-dark`, `muted-dark`), dazu `grid-dark`, `axis-dark`, `line-past-dark`, `past-wash-dark`, `future-area-dark`, `shimmer-dark`. Der Tooltip liegt im Dunkeln auf der tiefsten Tonstufe statt auf der Kartenfläche, damit er sich vom Diagramm abhebt. Ladeorange, Orange-Tinte und die Antwortfläche ändern sich nicht. Gedruckt wird immer mit der hellen Palette und reinem Schwarz.

Die Dunkelwerte stehen im Stylesheet zweimal – einmal für die Systemeinstellung, einmal für den Umschalter. Das ist eine bekannte Dopplung der Umsetzung, keine Gestaltungsregel.

### Named Rules
**Die Ein-Orange-Regel.** Orange bedeutet „das günstigste kommende Fenster“ und, als Markenkachel, LadeRick selbst. Es färbt nie einen Knopf, Link, Hover, Fokus, das gewählte Segment oder eine Statusmeldung; Interaktion ist Tinte.

**Die Volles-Band-Regel.** Das Fensterband im Diagramm ist deckendes Ladeorange – eine bewusste Abweichung von der Dataviz-Regel, große Flächen nur als Tönung von etwa 10 % zu zeigen. Grund: Band und Antwortfläche sind dieselbe Aussage in derselben Farbe; wer oben die Uhrzeit gelesen hat, findet das Fenster in der Kurve ohne Suchen. Die Abweichung gilt nur zusammen mit ihren Ausgleichen: Gitter- und Nulllinie liegen über dem Band, die Kurve läuft im Band in Orange-Tinte weiter, die Bandkante ist dunkler (Gebrannte Kante, 4,91:1 gegen Weiß), die Fensterzeit steht als Beschriftung über der Plotfläche, das Legendenfeld trägt dieselbe Kante, und die Tabellenzeilen des Fensters sind orange markiert. Wer das Band übernimmt, übernimmt alle Ausgleiche.

**Die Tonstufen-Regel.** Flächen trennen sich durch Helligkeit – Seitengrund, Weiß, helle und tiefere Tonstufe –, nie durch Rahmen. Linien gibt es nur als Datenlinien im Gitterton: Diagrammgitter, Zeitachse, Tabellenzeilen. Im Hochkontrastmodus erhalten Flächen Umrisse in Systemfarbe; das ist Zugänglichkeit, kein Stil.

## Typography

**Display Font:** Hanken Grotesk (variabel 100–900, selbst gehostet, SIL Open Font License; Fallback system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Body Font:** Hanken Grotesk (derselbe Schnitt)
**Label/Mono Font:** keine eigene; Zahlen laufen über tabellarische Ziffern der Grundschrift.

**Character:** Eine freundliche, klare Grotesk, sachlich ohne Kälte. Die Hierarchie entsteht aus Größe und Gewicht (400, 600, 650, 700) und aus drei Tintenstufen, nie aus einer zweiten Familie; große Zahlen laufen enger (bis −0.035em), Fließtext normal.

### Hierarchy
- **Display** (700, fluid nach Breite der Antwortfläche, Zeilenhöhe 1.02, −0.035em): ausschließlich die Uhrzeit des kommenden Fensters. Das nachgestellte „Uhr“ fällt auf Title-Größe in 600 zurück. In der Nacht der Zeitumstellung, wenn die Zeitangabe ein Zonenkürzel trägt, schmaler: clamp(1.75rem, 8.5cqi, 3.5rem), −0.02em.
- **Headline** (650, 28 px, ab 720 px Viewport 32 px, Zeilenhöhe 1.15, −0.02em): Wert der Kachel „Jetzt“, Uhrzeit im Rückblick (700), Abschnittstitel des Erklärteils (−0.025em).
- **Title** (650, 20 px, Zeilenhöhe 1.2, −0.01em): Kartentitel, Satzüberschrift und Preiszeile der Antwort, Werte der Nebenkacheln, Zwischenüberschriften im Erklärteil; Markenname und Tooltip-Wert in 700.
- **Body** (400, 16 px, ab 720 px Viewport 17 px, Zeilenhöhe 1.5): Fließtext, Kachelbeschriftungen, Ablesezeile; Knöpfe, Segmente und Textlinks in 600. Langer Lesetext mit Zeilenhöhe 1.65 in einer Spalte von höchstens 72ch.
- **Label** (400, 13 px, Zeilenhöhe 1.5): Achsen, Legende, Fußnoten, Tagline, Unterzeilen, Tooltip-Text (1.35); Chips in 600; Fensterzeit und „jetzt“ über dem Diagramm in 700.

### Named Rules
**Die Fünf-Größen-Regel.** Fünf Stufen, keine sechste: 13 px, 16/17 px, 20 px, 28/32 px und die fluide Antwortzeit. Neue Hierarchie entsteht über Gewicht oder Tintenstufe (Fast-Schwarz, Schiefer, Gedämpftes Grau), nicht über eine neue Größe.

**Die Tabellenziffern-Regel.** Tabellarische Ziffern gelten seitenweit: Preise, Uhrzeiten und Achsen stehen bündig und springen beim Aktualisieren nicht. Negative Werte tragen das typografische Minus (−), keinen Bindestrich.

**Die Zusammenhalt-Regel.** Beginn und Ende einer Zeitspanne sowie Zahl und Einheit bleiben je beisammen; bei wenig Platz oder großer Schrift bricht die Zeile nur zwischen diesen Teilen. Lange deutsche Komposita dürfen umbrechen, statt seitlich hinauszulaufen.

## Layout

Ein zentrierter Inhaltsbereich von höchstens 1160 px mit 16 px Seitenrand (ab 720 px 32 px). Darin liegt die obere Bühne als Raster mit 12 px Abstand (ab 720 px 16 px); Karten haben 20 px Innenabstand (ab 720 px 28 px), die Antwortfläche oben 4 px mehr.

- **Handy (unter 960 px):** eine Spalte in Lesereihenfolge – Antwortfläche, Diagrammkarte, Kennzahlen, Rückblick.
- **Desktop (ab 960 px):** Antwortfläche (7 Teile) neben den gestapelten Kennzahlen (5 Teile), beide gleich hoch; die Rückblickzeile der Antwortfläche sitzt dann am Boden der Karte statt über einer Leerfläche. Darunter Diagramm und Rückblick in voller Breite; der Rückblick teilt sich innen 5 : 7 mit 40 px Spaltenabstand.
- **Kennzahlen:** eine Spalte, ab 18.5em Bühnenbreite zwei („Jetzt“ über die volle Breite), ab 40em drei (1.3 : 1 : 1).
- **Diagramm:** 244 px hoch, ab 720 px 340 px, ab 1200 px 380 px. Unter 720 px eine Ablesezeile über dem Diagramm mit festem Platz für eine Zeile, in schmalen Karten (unter 19.5em) für zwei; ab 720 px stattdessen der Tooltip.
- **Tabelle:** höchstens 420 px hoch, scrollt in sich; unter 420 px Viewport nur Zeit und ct/kWh, die Markierung als Kennzeichen in der Zeitzelle, das Datum nur in der ersten Zeile eines Tages.
- **Lesen:** Erklärteil 72 px unter der Bühne (ab 960 px 112 px), höchstens 72ch breit; Rechtliches 64 px darunter; Fußzeile 72 px Abstand, 32 px oben und 48 px unten.
- **Trefferflächen:** jedes Bedienelement mindestens 44 px hoch, Aufklappzeilen 48 px (in der Antwort) und 60 px. Kein horizontales Scrollen ab 320 px Breite.

### Named Rules
**Die Große-Schrift-Regel.** Kachelraster und Ablesezeile richten sich nach der verfügbaren Breite in em (Container-Abfragen), nicht nach Viewport-Pixeln: Bei vergrößerter Schrift stapeln sich Kennzahlen von selbst, Einheiten rutschen unter ihre Zahl, nichts läuft seitlich hinaus.

## Elevation & Depth

Das System ist flach. Tiefe entsteht über Tonstufen: Der Seitengrund liegt am tiefsten, weiße Flächen heben sich davon ab, Tonstufen markieren Spuren, Köpfe und Hover darin. Auch das Diagramm erzählt Zeit über Ton – die Vergangenheit liegt auf einer leichten Tonfläche, nicht hinter einer Linie. Beim Nachladen dimmen die Karten auf 0.75 Deckkraft, aber erst nach 300 ms, damit schnelle Abrufe nicht flackern.

### Shadow Vocabulary
- **Schwebeschatten** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.14)`): ausschließlich der Diagramm-Tooltip, das einzige Element, das über anderem Inhalt schwebt.

### Named Rules
**Die Flach-in-Ruhe-Regel.** Keine Schatten, Verläufe oder Rahmen an ruhenden Flächen. Ein Schatten nur für das, was wirklich schwebt – derzeit allein der Tooltip.

## Shapes

Große, weiche Radien von außen nach innen gestaffelt: großzügig gerundete Karten und Antwortfläche (24 px), Kacheln, Aufklappzeilen und Banner (18 px), innere Flächen wie Tooltip, Tabellenfläche, Diagrammfläche und die Rückblickzeile auf Orange (12 px). Alle Bedienelemente sind Pillen: Knopf, Designknopf, Segmente, Chips, Kennzeichen, Sprunglink.

- **Markenzeichen:** ein Blitz in Orange-Tinte auf einem orangen, weich gerundeten Quadrat (44 px mit 13 px Radius, klein 28 px mit 8 px; das Favicon hält nahezu dieselbe Proportion). Der Blitz füllt 62 % der Kachel.
- **Diagrammformen:** Preise als Stufenlinie mit runden Ecken und Enden (vergangen 2 px, kommend 2.25 px, im Fenster 2.5 px); das Fensterband als Rechteck mit scharfer 1-px-Kante ohne Radius; Jetzt-Punkt 10 px mit 3 px Ring in Flächenfarbe, Ablesemarker 9 px mit 2.5 px Ring.
- **Legende:** Striche 18 × 3 px (2 px Radius), Bandfeld 18 × 12 px (3 px Radius) mit Kante.
- **Chevron:** eine 8-px-Ecke aus zwei 2-px-Strichen in Schriftfarbe, 45° gedreht; geöffnet zeigt sie nach oben.
- **Fokus:** 2 px Ring in Tinte, 3 px Abstand, 6 px Radius; beim Zeitraum-Umschalter umläuft er die ganze Spur.

### Named Rules
**Die Stufenlinien-Regel.** Preise gelten je Viertelstunde oder Stunde fest und werden als Stufen gezeichnet, nie geglättet. Das Fensterband beginnt nie links der Jetzt-Linie.

## Components

### Buttons
- **Form:** Pille (999 px), mindestens 44 px hoch, 20 px seitlich.
- **Primär:** Fast-Schwarz mit hellgrauer Schrift, 600 in Body-Größe. Einziger Einsatz derzeit: „Erneut versuchen“ in der Fehlerkarte.
- **Hover / Fokus:** nur bei feinem Zeiger Deckkraft 0.88 (180 ms); Druck verkleinert auf 0.97 (140 ms, ease-out); Fokus als Tintenring.
- **Designknopf (Hell/Dunkel):** 44-px-Kreis in Flächenfarbe, Hover tiefere Tonstufe, Druck 0.95. Mond (gefüllt) und Sonne (Kontur 1.8) liegen übereinander und blenden mit Skalierung 0.6, Drehung ±45° und 2 px Unschärfe in 240 ms ineinander. Das Design selbst springt ohne Übergänge in einem Zug um; nur die Symbole blenden.
- **Textlink:** 1-px-Unterstreichung in 45 % der Schriftfarbe mit 3 px Abstand, beim Hover voll; als Bedienelement („Als Tabelle“) in 600 und 44 px hoch.

### Chips
- **Stil:** Pille, 28 px hoch, 12 px seitlich, Label 600, helle Tonstufe mit Tinte; auf der Antwortfläche weißer Schleier; Warnung in Hinweisgelb.
- **Zustand:** rein informativ (negativer Preis, Näherung), nicht klickbar. In der schmalen Tabelle trägt ein Kennzeichen gleicher Form die Markierung: tiefere Tonstufe, im Fenster Ladeorange mit Orange-Tinte.

### Cards / Containers
- **Eckenstil:** 24 px für Karten und Antwortfläche, 18 px für Kacheln, Aufklappzeilen und Banner.
- **Hintergrund:** Weiß bzw. Anthrazitfläche; die Antwortfläche in beiden Designs Ladeorange.
- **Schatten:** keiner (siehe Elevation & Depth).
- **Rahmen:** keiner.
- **Innenabstand:** Karten 20 px (ab 720 px 28 px); Kacheln 16 × 18 px (ab 960 px 18 × 22 px, Inhalt vertikal zentriert).
- **Kennzahl-Kachel:** Beschriftung in Schiefer, Wert in Headline („Jetzt“) bzw. Title (Tief, Hoch), Unterzeile in Label und Gedämpftem Grau.
- **Aufklappzeile:** Zeile 60 px, 20 px seitlich, Titel Body 650, Chevron rechts; Hover helle Tonstufe, Druck 0.99; geöffnet bleibt der Inhalt 20 px eingerückt. Auf der Antwortfläche dieselbe Zeile im weißen Schleier, 12 px Radius, 48 px hoch.
- **Fehlerkarte:** Karte mit Titel in Signalrot und Primärknopf. **Banner:** Hinweisgelb, 18 px Radius.
- **Ladezustand:** Werte als Schimmerflächen (10 px Radius) in reservierter Größe, sodass beim Eintreffen der Daten nichts springt.
- **Eingang:** Antwortfläche, Diagrammkarte und Rückblick setzen sich beim ersten Laden einmal um 10 px (420 ms, ease-out, je 70 ms versetzt); die Kennzahl-Kacheln folgen gestaffelt (70/120/170 ms). Nur Bewegung, keine Einblendung: Inhalte sind ab dem ersten Bild lesbar. Ohne Skript und bei reduzierter Bewegung keine Bewegung.

### Inputs / Fields
- **Zeitraum-Umschalter:** drei gleich breite Segmente (1/2/3 Tage, je 44 px) auf einer Pillenspur in heller Tonstufe mit 4 px Innenabstand; Beschriftung Schiefer 600, bei Hover Tinte. Das gewählte Segment ist eine Tinte-Pille mit hellgrauer Schrift: Eine Kopie der Beschriftungen in Aktivfarben liegt über der Spur und wird per clip-path auf das gewählte Feld zugeschnitten, sodass Fläche und Schrift in 240 ms gemeinsam gleiten, ohne Zwischenzustände. Per Tastatur ohne Übergang; Druck auf das gewählte Feld lässt die Aktivfläche um 2 px nachgeben, andere Felder 0.97. Im Hochkontrastmodus Systemauswahlfarben.
- **Fokus:** 2 px Ring in der jeweils gültigen Tinte (auf Orange Orange-Tinte, im Dunkeln helle Tinte), 3 px Abstand.
- **Textfelder:** keine.

### Navigation
- **Kopfzeile:** Markenkachel, „LadeRick“ in Title 700 (−0.02em) mit Tagline in Label und Gedämpftem Grau; rechts der runde Designknopf. Kein Menü.
- **Sprunglink:** Tinte-Pille, außerhalb des Bildes, erscheint beim Fokus.
- **Fußzeile:** weißes Band über die volle Breite, Label-Größe in Schiefer, kleine Markenkachel; Links im Linkstil. Anker zu Datenquellen, Impressum, Datenschutz und Haftung öffnen die zugehörigen Aufklappzeilen.

### Antwortfläche (Signatur)
Satzüberschrift (Title), darunter die Uhrzeit des Fensters in Display mit kleinem „Uhr“, die Preiszeile (Title; Preis in 700 Orange-Tinte, Rest gedämpft, „· Beginnt in …“ in 600), Chips, Fußnote (Label) und die aufklappbare Rückblickzeile. Die Fläche stellt Tinte, Nebentext, Fokus, Schimmer und Textauswahl lokal auf Werte für Orange um und bleibt auch im dunklen Design hell.

### Preisdiagramm mit Fensterband (Signatur)
- **Ebenen von unten nach oben:** Vergangenheitston, Fläche unter der kommenden Kurve, deckendes Fensterband, Gitter mit Null- und Zeitachse, Kurven (vergangen Vergangenheitsgrau, kommend Fast-Schwarz, im Fenster Orange-Tinte), Anmerkungen (Jetzt-Linie in Tinte mit 35 % Deckkraft, „jetzt“, Jetzt-Punkt, Fensterzeit), Achsenbeschriftungen, Auswahl (Fadenkreuz in Schiefer, Marker; im Fenster orange mit Orange-Tinte-Ring).
- **Achsen:** y in ct/kWh mit der Einheit über der Achse, ganze Zahlen, solange der Schritt ganzzahlig ist; x mit Uhrzeiten im 3-, 6-, 12- oder 24-Stunden-Raster je nach Platz (in schmalen Diagrammen nur die Stunde) und Tagesnamen an Mitternacht in Schiefer 600.
- **Fensterzeit:** mittig über dem Band, kurz („11–15 Uhr“, volle Stunden ohne „:00“). Stößt sie an „jetzt“, rückt „jetzt“ links neben die Linie und die Fensterzeit rechts daneben, nie über den rechten Rand; reicht der Platz nicht, entfällt erst „Uhr“, dann das Wort „jetzt“ – Linie, Punkt und Ablesezeile zeigen „jetzt“ weiterhin.
- **Ablesen:** am Desktop ein Tooltip (Zeitraum in Schiefer, Preis in Title 700, €/MWh und Kennzeichen in Label; 160–240 px breit, wechselt am rechten Rand die Seite). Am Handy die Ablesezeile: Preis fett zuerst, dann Wochentag und Zeit, Kennzeichen nur „günstig“ oder „jetzt“; ohne Auswahl der aktuelle Preis. Maus zeigt beim Bewegen und fixiert per Klick, der Finger wählt und wischt, die Auswahl bleibt stehen; Tastatur mit Pfeilen, Bild auf/ab (Stunde, mit Umschalt Tag), Pos1/Ende, G zum Fenster, Esc.
- **Eingang:** Das Band steigt beim ersten Zeichnen mit Daten einmal vom Boden auf (440 ms, ease-out, ab 140 ms); Fensterzeit und Fensterkurve blenden danach in 240 ms ein, der Jetzt-Punkt ab 200 ms. Wird in dieser Zeit neu gezeichnet (erst Zwischenspeicher, dann Netzabruf), läuft die Bewegung über `--enter-elapsed` an der erreichten Stelle weiter. Bei reduzierter Bewegung blendet das Band nur 200 ms ein.
- **Legende:** Label in Schiefer; Striche für vergangen und kommend, Bandfeld mit Kante für das Fenster. Im Hochkontrastmodus behalten Diagramm und Legende ihre Farben.

### Preistabelle
Aufklappbar unter dem Diagramm; Fläche in heller Tonstufe mit 12 px Radius, fester Kopf in tieferer Tonstufe (600), Zeilen 8 × 14 px mit Trennlinie im Gitterton, Zahlen rechtsbündig. Zeilen des Fensters im Orange-Hauch, die aktuelle Zeile in 700.

### Named Rules
**Die Einmal-Regel.** Bewegung läuft einmal, beim ersten Zeichnen mit Daten: Die Bühne setzt sich, die Kennzahlen folgen, das Fensterband steigt auf. Minütliche Neuberechnungen und das Umschalten des Designs bleiben still, und jede Bewegung hat einen Pfad für reduzierte Bewegung (keine Verschiebung, kein Druckeffekt, keine Übergänge an Umschalter und Chevrons, Designsymbole nur per Deckkraft).

## Do's and Don'ts

### Do:
- **Do** Ladeorange (#f08a2e) nur für das günstigste kommende Fenster und das Markenzeichen einsetzen; Text darauf ist immer Orange-Tinte (#0b0b0b), in hell wie dunkel.
- **Do** das Fensterband deckend zeichnen und dabei alle Ausgleiche der Volles-Band-Regel mitnehmen: Gitter darüber, Gebrannte Kante (#b4560f), Fensterzeit über der Plotfläche, Legendenfeld mit Kante, Orange-Hauch in der Tabelle.
- **Do** Flächen über Tonstufen trennen (Seitengrund #f1f2f4, Weiß #ffffff, Tonstufen #eceef1 und #e2e5ea) und Radien von außen nach innen staffeln (24 → 18 → 12 px).
- **Do** Bedienelemente als Pillen mit mindestens 44 px Höhe bauen und Druck mit 0.97 zeigen (breite Zeilen 0.99, der kleine runde Knopf 0.95), 140 ms.
- **Do** Text in hell und dunkel auf mindestens 4,5:1 prüfen, bedeutungstragende Grafik (Kurven, Bandkante, Legendenfelder) auf mindestens 3:1 gegen ihre Fläche.
- **Do** für jede neue Bewegung einen Pfad bei reduzierter Bewegung vorsehen und nur transform, opacity oder clip-path animieren.
- **Do** Preise als Stufenlinie mit tabellarischen Ziffern und typografischem Minus zeigen.

### Don't:
- **Don't** Orange für Knöpfe, Links, Hover, Fokus, das gewählte Segment oder Statusmeldungen verwenden – Interaktion ist Tinte.
- **Don't** Karten, Kacheln oder Aufklappzeilen mit Rahmen, Schatten oder Verläufen versehen; der Schwebeschatten gehört allein dem Tooltip.
- **Don't** eine sechste Schriftgröße oder eine zweite Schriftfamilie einführen.
- **Don't** die Kurve glätten oder das Fensterband links der Jetzt-Linie beginnen lassen.
- **Don't** Werte beim Eingang ein- oder ausblenden oder bei Neuberechnungen erneut animieren; Inhalte sind ab dem ersten Bild lesbar.
- **Don't** technisch-kalt wie ein Börsenterminal oder werblich wie eine Verkaufsseite werden.
