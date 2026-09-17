# Theater-Bild-Gelöte

**Videos auf LED-Wände legen, in der 3D-Bühne ansehen und passend exportieren.**
Für ganze Wände und bewegliche Einzelpanels. Deine Medien bleiben auf deinem Rechner.

**[Im Browser starten](https://jareb560-byte.github.io/theater-bild-geloete/)** ·
[Installationshilfe](docs/INSTALLATION.md) · [HAP exportieren](#hap-exportieren) ·
[English](README.en.md)

| Desktop-App 0.3.0 herunterladen | Passend für |
|---|---|
| **[Windows-Setup (.exe)](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest/download/Theater-Bild-Geloete-0.3.0-Windows-x64-Setup.exe)** | Windows 10/11, 64 Bit |
| **[Mac mit Apple Silicon (.dmg)](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest/download/Theater-Bild-Geloete-0.3.0-macOS-arm64.dmg)** | M1 und neuer, macOS 13+ |
| **[Mac mit Intel (.dmg)](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest/download/Theater-Bild-Geloete-0.3.0-macOS-x64.dmg)** | Intel, macOS 13+ |

Windows: Setup öffnen und installieren. Mac: DMG öffnen und die App in **Programme** ziehen.
Node, Homebrew und Terminal werden für die installierte App nicht benötigt.
Hinweise zum ersten Öffnen stehen in der [Installationshilfe](docs/INSTALLATION.md).

## In drei Schritten zum Bühnenvideo

1. **Medien hinzufügen.** In **Bibliothek** Videos oder Bilder laden. Online stehen
   **Dateien hinzufügen** und **Ordner hinzufügen** bereit; lokal **Ordner einlesen**.
2. **Wand gestalten.** Zielwand und **Ganze Wand** oder ein Panel wählen, **Platzieren**
   anklicken. Mit **Im Editor bearbeiten** Ausschnitt und Position einstellen.
3. **Ansehen und exportieren.** In **3D-Bühne** geschlossen und geöffnet prüfen.
   Unter **Export** eine belegte Wand wählen und zunächst einen kurzen Ausschnitt erstellen.

**Im Browser:** H.264-MP4 ohne Ton erstellen und herunterladen, in Chrome oder Edge.
**In der Desktop-App:** HAP, ProRes, MPEG-2, separate Paneldateien und technische Qualitätskontrolle.
Die Schaltfläche **Anleitung** in der App erklärt den Ablauf. Der Quellcode ist öffentlich
unter der [MIT-Lizenz](LICENSE).

## HAP exportieren

1. Die Desktop-App installieren und beim ersten Start **ffmpeg jetzt holen** wählen.
   Danach **Erneut prüfen**: Die HAP-Ampel muss grün sein. Dieser einmalige Download braucht Internet.
2. Material auf eine Wand legen oder über **··· → Projektdatei öffnen** ein vorhandenes Projekt laden.
3. **Export** öffnen, Wand, Zielordner und das mit dem Haus abgestimmte HAP-Preset wählen.
   Bei Bedarf **zusätzlich Einzelpanels** aktivieren, einen kurzen Bereich testen und **Rendern** starten.
4. Die fertige Ausgabe unter **QC** prüfen, bevor der vollständige Loop an das Haus geht.

[Einrichtung von HAP und ProRes](docs/INSTALLATION.md#rendern-mit-hap-und-prores) ·
[Ausführlicher Produktionsablauf](docs/WORKFLOW.md) ·
[Browserprojekt am Desktop weiterbearbeiten](docs/BROWSER-FASSUNG.md#projekt-sichern-und-lokal-weiterarbeiten)

## Was es nicht ist

Theater-Bild-Gelöte ist **kein Schnittprogramm**. Es schneidet keine Szenen, mischt keinen Ton und hat keine
Effekte. Es ist **kein Mediaserver** — es spielt nichts auf der Show ab, es triggert nichts und es
spricht mit keinem Pult. Es ersetzt **weder DaVinci Resolve noch Premiere noch After Effects**.
Es sitzt dazwischen: hinter dem Programm, in dem der Inhalt entsteht, und vor dem Server, der ihn
auf die Wand bringt. Alles, was mit der Geometrie der Wand, mit Panelaufteilung, Nähten, Fahrwegen,
Looplängen und Lieferformaten zu tun hat, macht Theater-Bild-Gelöte. Alles andere macht es ausdrücklich nicht.

---

## Zwei Betriebsarten

Es gibt Theater-Bild-Gelöte zweimal, aus einem Quelltext gebaut.

| | **Desktop** | **Browser** |
|---|---|---|
| Start | Windows-/Mac-App installieren | eine Adresse aufrufen |
| Voraussetzung | Videowerkzeuge über Einrichtungsassistent laden | Chrome oder Edge |
| Planen, 3D-Bühne, Panel-Editor, Venues | ja | ja |
| MP4-Video einer ganzen Wand, ohne Ton | ja | **ja**, bei unterstützter Auflösung |
| HAP, ProRes, MPEG-2 und separate Paneldateien | **ja** | nein |
| ffmpeg-Befehl erzeugen, Conform, technische QC | **ja** | nein |

Die **Desktop-Fassung** unterstützt die Hausformate und technische Qualitätskontrolle.
Windows- und Mac-Installationen stehen über die Releases bereit. Zusätzlich erzeugt
`node tools/build-portable.js` portable Archive für Windows, macOS und Linux.

Die **Browser-Fassung** kann planen, die Bühne zeigen und eine Wand als H.264-MP4 in voller
Pixelauflösung exportieren. Die Verarbeitung bleibt auf dem eigenen Rechner. Sie benötigt
einen aktuellen Chrome oder Edge mit Unterstützung für die gewählte Auflösung. Die Unterschiede stehen in
[docs/BROWSER-FASSUNG.md](docs/BROWSER-FASSUNG.md). Gebaut wird sie mit
`node tools/build-web.js`, veröffentlicht über GitHub Pages.

Die Brücke zwischen beiden ist die Projektdatei `.tbg.json`: im Browser planen, herunterladen,
am Desktop die Lieferformate des Hauses erzeugen. Die Medien gehören separat dazu.

### MP4 direkt online erstellen

1. In **Bibliothek** den Medienordner einlesen, die Dateien auf Wand und Slots legen.
2. **Export** öffnen und die gewünschte Wand wählen.
3. Zunächst unter **Ausschnitt** zum Beispiel 0 bis 5 Sekunden testen oder **Ganzer Loop** wählen.
4. **MP4 erstellen** anklicken, den Tab geöffnet lassen und anschließend **MP4 herunterladen** wählen.

Die Datei enthält die flache Wand mit den aktiven Layern, ohne Ton. Die 3D-Raumausstattung,
Fahrbewegungen und Hilfslinien werden nicht mitgefilmt. Der Export nutzt den Projektstand beim
Start. Medien werden nicht hochgeladen; es gibt keinen kostenpflichtigen Renderdienst.
MP4 ist kein automatischer Ersatz für ein vom Haus vorgeschriebenes Lieferformat.
Die Browser-Ausgabe ist auf 256 MB pro Video begrenzt. Bildfilter und weiche Übergänge
werden vor dem Export mit einem Hinweis abgewiesen; dafür die lokale Fassung nutzen.

---

## Installation

**[Desktop herunterladen](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest)**
führt zu den verfügbaren Installationsdateien für Windows und Mac. Die lokale Fassung
unterstützt die Lieferformate HAP, ProRes und MPEG-2.

In der installierten Anwendung führt der Einrichtungsassistent durch Arbeitsordner und
Hausvorlage. **ffmpeg jetzt holen** richtet die Videowerkzeuge ein. Danach **Erneut prüfen**
wählen und für HAP auf die grüne HAP-Ampel achten. Node, Homebrew und ein Terminal werden
für diesen Weg nicht benötigt.

Ein heruntergeladenes Browserprojekt lässt sich über **··· → Projektdatei öffnen** laden.
Die `.tbg.json` im ursprünglichen Medienordner ablegen, damit ihre relativen Verweise stimmen.
Sie enthält keine Mediendateien. Weitere Schritte stehen in [Browser-Fassung](docs/BROWSER-FASSUNG.md).

Für die Entwicklung aus dem Quellcode:

```sh
git clone https://github.com/jareb560-byte/theater-bild-geloete.git
cd theater-bild-geloete
```

Gebraucht wird **Node ab Version 18**. Alles Weitere holt das Werkzeug selbst.

```
node --version        # muss v18.x oder höher zeigen
```

Öffne ein Terminal im entpackten Quellcode-Ordner (dort, wo `package.json` liegt).
Diese Arbeitsfassung ist noch nicht als npm-Paket veröffentlicht; ein `npx`-Aufruf
ist deshalb kein Installationsweg. Für die lokale Fassung:

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

`npm run setup:ffmpeg` besorgt ein ffmpeg, das die gebrauchten Encoder kann, und legt es im
Arbeitsverzeichnis unter `bin/` ab. Es wird nichts am System installiert und nichts in den PATH
geschrieben. Danach beantwortet `npm run doctor` die Frage, ob dieser Rechner heute rendern kann.

Entscheidend ist nicht, *dass* ffmpeg da ist, sondern *welches*. Der Encoder `hap` fehlt in vielen
fertigen Paketen. Ohne ihn läuft alles andere weiter, nur die Auslieferung im gebräuchlichsten
LED-Format ist unmöglich — und das fällt sonst erst am Rendertag auf. Die Gegenprobe ist immer
dieselbe:

```
ffmpeg -hide_banner -encoders | findstr hap      # Windows
ffmpeg -hide_banner -encoders | grep hap         # macOS, Linux
```

### Windows

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

`setup:ffmpeg` lädt den BtbN-GPL-Build und entpackt `ffmpeg.exe` und `ffprobe.exe` nach `bin\`.
Wird der Download von der Firmen-Firewall geblockt, geht auch:

```
winget install BtbN.FFmpeg.GPL
```

Danach ein **neues** Terminal öffnen, damit der PATH stimmt, und `npm run doctor` laufen lassen.
Die schlanken "essentials"-Builds und die Pakete aus dem Microsoft Store können in der Regel kein
HAP.

### macOS

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

Der automatische Bezug wählt die passende Version für Apple Silicon oder Intel, prüft den
Download und kontrolliert die Encoder. In der installierten Mac-App genügt dafür der Knopf
**ffmpeg jetzt holen**; Homebrew und Terminal sind nicht nötig. Schlägt der Download fehl,
zeigt die Jobleiste den Grund. Nach erfolgreicher Einrichtung **Erneut prüfen** wählen.

### Linux

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

Das ffmpeg aus der Paketverwaltung (`apt install ffmpeg`, `dnf install ffmpeg`) ist bequem, kann
aber je nach Distribution kein HAP — das ist der häufigste Stolperstein auf Linux. Prüfen:

```
ffmpeg -hide_banner -encoders | grep hap
```

Fehlt der Encoder, einen statischen GPL-Build herunterladen, entpacken und die beiden Programme
`ffmpeg` und `ffprobe` nach `bin/` im Arbeitsverzeichnis legen. Ausführbar machen nicht vergessen
(`chmod +x`). Theater-Bild-Gelöte sucht immer zuerst in `bin/` und erst danach im PATH.

---

## Erster Start

Beim allerersten Start öffnet sich ein Assistent und fragt drei Dinge ab. Danach ist das Werkzeug
eingerichtet, und der Assistent kommt nur wieder, wenn etwas davon fehlt.

**1. Arbeitsverzeichnis.** Der Ordner, in dem Theater-Bild-Gelöte arbeitet: Projektdatei, Proxies,
Posterframes, Analyse-Cache, Renderausgaben, das lokale ffmpeg. Sinnvoll ist ein Ordner auf der
schnellsten Platte mit reichlich Platz — Renderausgaben sind schnell zweistellig gigabyteschwer.
Der Ordner darf jederzeit gewechselt werden; die alten Dateien bleiben liegen, wo sie sind.

| Unterordner | Inhalt |
|---|---|
| `project.tbg.json` | das aktuelle Projekt, wird bei jeder Änderung gesichert |
| `out/` | Standardziel für Renderausgaben |
| `proxies/` | H.264-Proxies für die Browservorschau |
| `thumbs/` | Posterframes für die Bibliothek |
| `.cache/` | ffprobe-Ergebnisse, damit ein erneuter Scan schnell ist |
| `bin/` | lokales ffmpeg und ffprobe |
| `config/venues/` | die Häuser, die dieses Werkzeug kennt |

**2. ffmpeg.** Der Assistent zeigt, ob ffmpeg gefunden wurde, aus welcher Quelle es stammt und
welche Encoder es kann — als Ampel, eine Zeile pro Encoder. Fehlt etwas, holt ein Knopf den
passenden Build; der Fortschritt läuft als Job unten mit. Solange `hap` fehlt, steht das rot da,
und zwar dauerhaft, weil dieser Mangel sonst erst beim Ausliefern auffällt.

**3. Venue.** Ein Venue ist die Beschreibung eines Hauses. Mitgeliefert ist ein vollständiges
Beispiel (`mein-schiff-theater`, das Theater, aus dem dieses Werkzeug entstanden ist). Man kann
damit sofort arbeiten, um sich das Werkzeug anzusehen, oder gleich ein eigenes anlegen — siehe
[Eigenes Haus einrichten](#eigenes-haus-einrichten).

Danach läuft der Server auf `http://127.0.0.1:7333` und die Oberfläche öffnet sich im Browser.
Der Server bindet ausschließlich auf `127.0.0.1`; von außen kommt niemand darauf.

Die Oberfläche gibt es auf **Deutsch und Englisch**; umgeschaltet wird in der Kopfzeile, die Wahl
bleibt gespeichert. Zahlen, Größen und Metermaße werden in der jeweiligen Sprache formatiert.

Beim Entwickeln stattdessen `npm run dev` benutzen — Node startet bei jeder Serveränderung neu.
Der Client wird nicht gebaut, ein F5 im Browser reicht.

---

## Das Grundprinzip in fünf Sätzen

1. Ein **Venue** beschreibt das Haus: welche Wände es gibt, aus welchen Panels sie bestehen, wie
   groß sie in Pixeln und in Metern sind, wie weit die Teile fahren, mit welcher Bildrate gearbeitet
   wird und in welchen Formaten geliefert werden muss.
2. Ein **Projekt** beschreibt eine Show in diesem Haus: Looplänge, Hintergrund, das benutzte
   Material und alles, was damit gemacht wurde.
3. Jede Wand hat **Slots** — einen für die ganze Fläche (`master`) und je einen pro Panel.
4. In jedem Slot liegen **Layer**: ein Layer ist eine Quelldatei mit Zuschnitt, Position,
   Bildkorrektur und Zeit, und genau daraus entsteht das Bild.
5. Gerendert wird immer die **ganze Wand in einem ffmpeg-Durchlauf**; die Einzeldateien der Panels
   werden aus derselben fertigen Fläche geschnitten und sind deshalb deckungsgleich mit ihr.

Der Gewinn dieser Form: Vier Clips nebeneinander auf vier Panels (räumliches Zusammenfügen) und
drei Clips nacheinander auf `master` (zeitliches Zusammenfügen) sind dasselbe Modell — Slot, Layer,
Startzeit. Beides gleichzeitig ist der Normalfall.

---

## Die sechs Ansichten

**Bibliothek.** Hier kommt Material herein. Ordner scannen, und jede Datei wird mit ffprobe
analysiert: Auflösung, Bildrate, Codec, Pixelformat, Dauer, Framezahl, Alpha, Farbbereich. Jede
Abweichung vom Ziel steht als Hinweis an der Datei. Von hier aus werden auch die Proxies erzeugt —
ohne sie bleiben Editor und 3D-Ansicht schwarz, weil kein Browser HAP, ProRes oder MPEG-2 abspielen
kann. Ebenfalls von hier startet das Angleichen (Conform) auf Zielbildrate und Ziellänge.

**Editor.** Die flache Arbeitsansicht auf eine Wand oder ein einzelnes Panel. Links die Slots,
darin die Layer. Hier wird zugeschnitten, verschoben, skaliert, die Helligkeit an den Nachbarclip
angeglichen und mit einer weichen Kante (Feather) der Übergang zum Nachbarpanel entschärft. Der
Zuschnitt ist immer in Quellpixeln, die Position in Slotpixeln; beides steht als Zahl da, nicht nur
als Anfasser.

**Bühne 3D.** Die Wände stehen als Flächen im Raum, dazu Boden und eine Figur als Maßstab. Hier
wird geprüft, was am Ende zählt: Das Bild muss geschlossen als durchgehende Fläche funktionieren
und aufgefahren, wenn die Teile auseinanderstehen und den Blick auf die dahinterliegende Wand
freigeben. Ein Klick auf ein Panel macht dessen Slot aktiv. LED-Look, Rahmenbreite, Schwarzanhebung
und Helligkeit sind reine Anzeigeeinstellungen und ändern nichts am Render.

**Render.** Auswahl von Wand, Delivery-Preset und Zielordner. Vor dem Start zeigt die Ansicht die
vollständige ffmpeg-Kommandozeile inklusive Filtergraph, die gleich laufen wird. Mit "Trockenlauf"
gibt es nur diese Zeile und sonst nichts. Laufende Jobs zeigen Fortschritt und Logzeilen und lassen
sich abbrechen. Auf Wunsch fallen die Panel-Einzeldateien im selben Durchlauf mit heraus.

**QC.** Prüft eine fertige Datei gegen die Vorgaben des Venues: Framezahl, Loopnaht (Frame 0 und
letzter Frame dürfen nicht identisch sein), Motiv über den Panelnähten, Belegung der Sperrzonen,
Schwarzwert und Spitzenhelligkeit, Banding, Moiré, Flackerfrequenz und Übereinstimmung mit der
Spezifikation. Jeder Check liefert pass, warn, fail oder skip mit einem Satz Begründung und, wo
sinnvoll, einem Bild als Beleg.

**Venue.** Das Haus selbst: Wände anlegen, Panels aufteilen, Pixel- und Metermaße eintragen,
Bildrate und Pixelpitch setzen, Fahrwege und Sperrzonen festlegen, Delivery-Presets pflegen.
Widersprüche werden sofort gemeldet — etwa wenn die Summe der Panelbreiten nicht der Wandbreite
entspricht. Gespeichert wird als JSON in `config/venues/`; die Datei kann man genauso gut von Hand
schreiben und weitergeben.

---

## Ein Durchgang mit echten Zahlen

Ausgangslage: eine Wand, **2736 × 1224 Pixel**, aufgebaut aus vier Panels — **648 · 720 · 720 ·
648** Pixel breit, alle 1224 hoch. Die Mittelnaht liegt bei **x = 1368**, dort fahren die Teile
auseinander. Das Beispiel arbeitet mit **30 fps** und dem Preset **HAP Q**. Der TUI-Guide nennt
MPEG-2 oder HAP; die konkrete HAP-Variante muss mit dem Haus abgestimmt werden. Der Loop soll **20 Sekunden**
lang sein, das sind **600 Frames**. Vier Einzelclips, jeweils 1920 × 1080 bei 25 fps, sollen
nebeneinander auf die vier Teile.

**1. Einlesen.** Ansicht Bibliothek, Ordner mit den vier Clips scannen. An jedem Clip steht danach
der Hinweis `25 fps statt 30 fps`. Alle vier markieren, *Proxies erzeugen*, warten, bis die
Vorschaubilder stehen.

**2. Angleichen.** Die vier markiert lassen, *Conform*. Zielrate 30 fps, Modus `resample` — Frames
werden gedoppelt, das Bild selbst bleibt unangetastet. Dauer 20 Sekunden, Modus `loop`, damit alle
vier gleich lang sind. Ergebnis: vier neue Dateien mit exakt 600 Frames.

**3. Auflegen.** Ansicht Editor, die Wand wählen. Slot `D1` aktivieren, den ersten angeglichenen
Clip als Layer hineinlegen, dasselbe für `D2`, `D3`, `D4`. Alle vier Layer stehen auf `startSec 0`.
Das ist das räumliche Zusammenfügen: Vier Einzelvideos werden eine durchgehende Wand.

**4. Zuschneiden.** Slot `D2`: Der Clip ist 1920 × 1080, das Panel 720 × 1224. `cover` skaliert ihn
auf **2176 × 1224** und schneidet links und rechts je **728 Pixel** weg — das ist viel, also den
Ausschnitt von Hand setzen, bis das Motiv sitzt. Bei `D1` und `D4` (648 breit) fallen je 764 Pixel
weg. Wo der Übergang hart wirkt, an der zur Naht zeigenden Seite eine weiche Kante von 12 bis 24
Pixeln setzen. Helligkeit und Kontrast der vier Clips angleichen.

**5. Auffahren prüfen.** Ansicht Bühne 3D, Kamera Zuschauer Mitte. Die Wand schrittweise öffnen.
Zu sehen sein muss: geschlossen ein sauberes Gesamtbild, geöffnet vier Teile, die auch für sich
noch etwas taugen. Was über der Mittelnaht bei x = 1368 hängt, reißt beim Auffahren auseinander.
Nähte einblenden und die Kanten zwischen D1/D2 und D3/D4 im Auge behalten: Springt dort die
Helligkeit, gehört das im Editor korrigiert und nicht später.

**6. Rendern.** Ansicht Render, Preset HAP Q, Zielordner `out/`. Erst **Trockenlauf** und die
Kommandozeile lesen. Dort muss stehen: `-r 30`, `-fps_mode cfr`, `-frames:v 600`, dazu
`-c:v hap -format hap_q`. Stimmt das, *Rendern* drücken. Für die Planung ergeben sich rund
**2,0 GB**: 2736 × 1224 Pixel × 1 Byte sind 3,35 MB je Frame und 100,5 MB/s.
HAP Q braucht vor der zusätzlichen Snappy-Kompression doppelt so viel wie HAP; die tatsächliche
Dateigröße hängt vom Bildinhalt ab. Werden die Teile einzeln bespielt, vorher *Auch Panels* anhaken — dann fallen
648 · 720 · 720 · 648 im selben Durchlauf mit heraus und sind garantiert deckungsgleich mit dem
Master.

**7. QC.** Ansicht QC, die gerenderte Datei wählen, alle Checks. Erwartet wird: `frameCount` pass
mit 600, `loopSeam` pass (Frame 0 und Frame 599 sind unterschiedlich), `seamContent` ohne Befund um
x = 1368, `specCompliance` pass mit `hap`, 2736, 1224 und `30/1`. Ein Fehlschlag bei `frameCount`
heißt fast immer, dass ein Layer kürzer ist als der Loop.

**8. Ausliefern.** Vor dem Vollrender über alle Wände geht ein 20-Sekunden-Muster ans Haus. Das ist
keine Höflichkeit, sondern der Punkt, an dem Banding, Schwarzwert, Moiré und Neon-Helligkeit auf
der echten Wand geprüft werden — auf dem Monitor sieht das alles anders aus. Erst nach der
Rückmeldung laufen die restlichen Wände und die Backup-Fassung in einem Zweitcodec.

Der Ablauf als Checkliste mit allen Entscheidungspunkten: [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

---

## Eigenes Haus einrichten

Ein Venue ist eine JSON-Datei in `config/venues/`. Der Dateiname ist frei, die `id` zählt. Anlegen
lässt sie sich in der Ansicht Venue oder von Hand; beides schreibt dieselbe Datei. Kein Code muss
angefasst werden, und ein neu angelegtes Venue steht nach dem Neuladen sofort für neue Projekte
bereit.

Das Gerüst, am Beispiel einer Halle mit einer Wand aus zwei Teilen:

```json
{
  "id": "halle-nord",
  "name": "Halle Nord",
  "fps": 30,
  "pixelPitchMm": 3.9,
  "walls": [
    {
      "id": "W",
      "label": "W — Hauptwand",
      "width": 1792, "height": 960,
      "widthM": 6.99, "heightM": 3.74,
      "panels": [
        { "id": "W1", "x": 0,   "width": 896 },
        { "id": "W2", "x": 896, "width": 896 }
      ],
      "centerSeamX": 896,
      "safeAreaPct": 0.10,
      "stage": { "z": 0, "floorOffsetM": 0, "travelMaxM": 3.5, "verified": false }
    }
  ],
  "camera": {
    "presets": [
      { "id": "audience", "label": "Zuschauer Mitte",
        "pos": [0, 1.2, -12], "target": [0, 2, 0], "fov": 40 }
    ],
    "default": "audience"
  },
  "delivery": {
    "namePattern": "{WALL}_{W}x{H}_{FPS}p_{CODEC}",
    "presets": [],
    "defaultPreset": "hap_q",
    "proxy": {
      "maxWidth": 1280,
      "args": ["-c:v", "libx264", "-crf", "26", "-preset", "veryfast",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"]
    }
  },
  "assumptions": ["Fahrweg geschätzt, im Haus nachmessen."],
  "openQuestions": ["Wird mit gemeinsamem Timecode gestartet?"]
}
```

Drei Regeln, an denen sich die meisten Fehler entscheiden:

- **Die Summe der Panelbreiten muss der Wandbreite entsprechen**, und die `x`-Werte müssen lückenlos
  aufeinanderfolgen. 896 + 896 = 1792. Stimmt das nicht, meldet Theater-Bild-Gelöte es beim Laden im Klartext,
  denn jede Panel-Datei wäre dann falsch geschnitten.
- **`stage.travelMaxM`** ist der maximale Fahrweg einer Wandhälfte in Metern. Er bestimmt, wie weit
  die 3D-Ansicht die Teile auseinanderfährt. Was geraten ist, gehört als Klartext in `assumptions`;
  `stage.verified` bleibt so lange `false`.
- **`safeAreaPct`** ist der Anteil an jeder Seite, in dem nichts Wichtiges stehen darf. 0.10 sind
  bei 1792 Pixeln 179 Pixel links und rechts.

### Pixelpitch, und warum er überall gleich sein sollte

Der Pixelpitch ist der Abstand zwischen den Mittelpunkten zweier benachbarter LEDs, in Millimetern.
Er ist die Umrechnung zwischen Pixeln und Metern: Bei 4 mm Pitch ist 1 Meter genau 250 Pixel breit,
bei 2,6 mm sind es 385, bei 6 mm nur 167. Aus dem Pitch folgt auch die sinnvolle Betrachtungsdistanz
(Faustregel: Pitch in Millimetern ≈ Mindestabstand in Metern) und damit, ab welcher Detailfeinheit
Moiré auftritt.

Haben alle Wände eines Hauses **denselben** Pitch, ist ein Pixel überall gleich groß. Ein Gebäude,
das über zwei Wände hinweg gebaut ist, behält seine Größe; eine Horizontlinie sitzt auf beiden
Wänden auf derselben Höhe; die räumliche Staffelung in der 3D-Ansicht stimmt, weil sich Pixel- und
Metermaße mit einem einzigen Faktor ineinander umrechnen lassen. Sind die Pitches verschieden, ist
das kein Fehler und Theater-Bild-Gelöte kommt damit zurecht — aber jede Grafik, die über mehrere Wände geht,
muss dann pro Wand anders skaliert werden, und die Bewertung von Details und Moiré gilt jeweils nur
für eine Wand. Wo es sich einrichten lässt: gleicher Pitch überall.

Weil die Metermaße in Herstellerunterlagen meist gerundet sind, weicht die Rechnung leicht ab. Das
mitgelieferte Beispiel-Venue nennt 4 mm Pitch, kommt aus 2736 Pixeln auf 10,90 m aber auf 251 Pixel
pro Meter. Solche Rundungen sind für die Vorschau unerheblich und für die Lieferdateien ohne jede
Bedeutung — dort zählt nur die Pixelzahl.

---

## Tastenkürzel

Sie greifen nur, wenn der Fokus nicht in einem Eingabefeld steht.

| Taste | Wirkung |
|---|---|
| `Leertaste` | Wiedergabe an / aus |
| `1` … `4` | Wand 1 bis 4 aktiv setzen (Reihenfolge aus dem Venue), Slot springt auf `master` |
| `S` | Nähte einblenden |
| `A` | Sperrzonen einblenden |
| `G` | Raster einblenden |
| `F` | Viewport auf volle Fensterbreite und zurück |
| `←` `→` `↑` `↓` | ausgewählten Layer um 1 Pixel verschieben |
| `Umschalt` + Pfeiltaste | um 10 Pixel verschieben |
| `Strg` + `S` | Projekt sofort speichern (sonst passiert das automatisch) |
| `Esc` | oberstes Fenster schließen |

Zwischen den Ansichten wird über die Schalter in der Kopfzeile gewechselt, ebenso zwischen den
Sprachen.

---

## Fehlerbehebung

### ffmpeg fehlt

Die Kopfzeile zeigt `ffmpeg fehlt`, `GET /api/health` liefert `ffmpeg.found: false` mit
`source: "none"`. Nichts, was analysiert, Proxies baut oder rendert, funktioniert dann; die
Oberfläche selbst läuft weiter.

```
npm run setup:ffmpeg
npm run doctor
```

Scheitert der Download, den Build von Hand holen und `ffmpeg` und `ffprobe` nach `bin/` im
Arbeitsverzeichnis kopieren. Theater-Bild-Gelöte sucht erst dort und dann im PATH — beides ist gleichwertig.
Nach einer Installation über die Paketverwaltung ein **neues** Terminal öffnen, sonst kennt die
laufende Sitzung den neuen PATH nicht.

### Kein hap-Encoder

`health.ffmpeg.encoders.hap === false`. Das ist der teuerste Fehler des Werkzeugs, weil er sich
lange versteckt: ffmpeg läuft, Proxies entstehen, Vorschauen sind da — nur das Lieferformat der
meisten LED-Häuser ist nicht schreibbar. Das ist der Normalfall bei ffmpeg aus Paketquellen,
egal auf welchem Betriebssystem.

```
ffmpeg -hide_banner -encoders | grep hap        # macOS, Linux
ffmpeg -hide_banner -encoders | findstr hap     # Windows
```

Kommt keine Zeile, hilft nur ein vollständiger GPL-Build. Bis der da ist, sind ProRes und MPEG-2
möglich — ProRes als Backup, MPEG-2 nur nach Absprache über die Datenrate. Wer Alpha liefert,
braucht ohnehin `hap` (HAP Alpha) oder `prores_ks` (ProRes 4444).

### Proxy fehlt

Editor und 3D-Ansicht zeigen schwarze Flächen, im Netzwerklog steht 404 auf
`/api/media/<id>/proxy`. Für diese Datei wurde kein Proxy gebaut oder der Job wurde abgebrochen.
In der Bibliothek die Datei markieren und *Proxies erzeugen*, bei einem defekten Proxy zusätzlich
*Neu erzwingen*. Der Ordner `proxies/` darf jederzeit geleert werden, er füllt sich wieder.

### Der Browser spielt HAP nicht ab

Das ist kein Fehler, sondern eine Eigenschaft von Browsern: HAP, ProRes und MPEG-2 kann keiner von
ihnen dekodieren. Deshalb zeigt die Vorschau grundsätzlich nur die H.264-Proxies, nie die Originale
und nie die Lieferdateien. Eine fertige HAP-Datei wird nicht im Browser kontrolliert, sondern in
der Ansicht QC — dort geht ffmpeg an die Datei, nicht der Browser. Wer sie mit eigenen Augen sehen
will, rendert zusätzlich ein H.264-Ansichtsexemplar oder öffnet sie in einem Abspieler, der HAP
kann.

### Port belegt

Der Serverstart bricht mit `EADDRINUSE` ab. Meistens läuft schon eine Instanz — dann genügt es,
`http://127.0.0.1:7333` im Browser zu öffnen. Sonst herausfinden, wer den Port hält:

```
netstat -ano | findstr :7333          # Windows, dann: taskkill /PID <PID> /F
lsof -i :7333                         # macOS, Linux, dann: kill <PID>
```

Der Port liegt fest, damit Lesezeichen und die Vorschau-URLs der Medien über Sitzungen hinweg
gültig bleiben. Ist er dauerhaft von etwas anderem belegt, gehört das andere Programm umgestellt.

### Zu wenig Arbeitsspeicher beim Rendern mehrerer Ausgaben

Symptome: Der Renderjob bricht mit `Cannot allocate memory` oder ohne Meldung ab, das System fängt
an zu auszulagern, oder der Browser wirft die 3D-Ansicht weg. Ursache ist immer dieselbe: Jeder
laufende ffmpeg-Durchlauf hält die Basisfläche und pro Layer einen dekodierten Frame im Speicher.
Eine Wand mit 2736 × 1224 und vier Layern liegt bei rund 40 MB je Zwischenbild — was allein
harmlos ist, aber mit jeder gleichzeitig gerenderten Wand mitwächst. Dazu kommen die
Videoelemente der Vorschau im Browser.

Der Reihe nach abarbeiten:

1. **Nacheinander rendern statt gleichzeitig.** Mehrere Wände über einen Auftrag rendern lassen,
   statt mehrere Renderjobs von Hand gleichzeitig zu starten.
2. **Vorschau schließen.** Während eines Vollrenders die Wiedergabe anhalten und die 3D-Ansicht
   verlassen; damit fallen sämtliche Videoelemente und Texturen weg.
3. **Weniger Layer je Slot.** Zehn Layer auf einer Wand bedeuten zehn gleichzeitig offene Dekoder.
   Was ohnehin fest zusammengehört, vorher in eine Datei zusammenrendern und als ein Layer benutzen.
4. **Kürzere Loops testen.** Mit `rangeSec` erst 20 Sekunden rendern; die Speichermenge hängt zwar
   nicht an der Länge, aber der Fehlversuch kostet dann Minuten statt Stunden.
5. **Plattenplatz prüfen.** Ein voller Auslagerungsspeicher sieht aus wie zu wenig RAM.
   `npm run doctor` zeigt den freien Platz auf dem Ausgabelaufwerk.

---

## Woher es kommt

Theater-Bild-Gelöte ist aus einer konkreten Produktion entstanden: dem Theater eines Kreuzfahrtschiffs mit
vier LED-Wänden, jede aus vier Teilen, die während der Show zur Bühnenmitte hin auf- und zufahren.
Der Inhalt musste in beiden Zuständen funktionieren, jedes Teil brauchte seine eigene, exakt
passende Datei, und der Mediaserver wollte HAP. Aus diesen drei Anforderungen ist das Werkzeug
gewachsen.

Von dieser Herkunft ist nichts fest eingebaut. Das Haus steckt vollständig in einer Venue-Datei,
und die mitgelieferte ist nichts weiter als ein ausführliches Beispiel. Wer eine einzelne Wand aus
zwei Teilen in einer Messehalle bespielt, eine feststehende Bühnenrückwand oder einen Ring aus
sechs Flächen, legt sein eigenes Venue an und benutzt dasselbe Werkzeug.

---

## Weiterführend

- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — der Produktionsablauf als Checkliste, mit den Entscheidungspunkten
- [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) — wie das Programm gebaut ist und wo man es erweitert
- [`docs/GITHUB.md`](docs/GITHUB.md) — was ins Repository gehört und was nie
- [`docs/OFFENE-PUNKTE.md`](docs/OFFENE-PUNKTE.md) — alles, was das Werkzeug annimmt statt weiß
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — mitarbeiten, erweitern, übersetzen
- [`shared/API.md`](shared/API.md) — der HTTP-Vertrag
- [`shared/model.js`](shared/model.js) — das Datenmodell

Lizenz: MIT, siehe [`LICENSE`](LICENSE).
