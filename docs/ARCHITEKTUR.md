# Architektur

Wie Theater-Bild-Gelöte gebaut ist, und wo man ansetzt, wenn man es erweitert.

---

## 1. Zwei Hälften

**Server** — Node ab 18, ESM, `express`. Bindet auf `127.0.0.1:7333`. Er ist die einzige Instanz,
die das Dateisystem sehen und Prozesse starten darf. Seine Aufgaben:

- Ordner lesen und Dateien mit `ffprobe` analysieren
- `ffmpeg` per `child_process.spawn` starten und die Ausgabe in Jobs verwandeln
- das Projekt laden, speichern, validieren
- die Client-Dateien statisch ausliefern
- Proxies streamen, mit HTTP-Range, damit `<video>` springen kann

**Client** — reine ES-Module, die der Browser direkt lädt. **Kein Bundler, kein Build-Schritt.**
`three` kommt über eine Import Map aus `/vendor/three.module.js`. Eine Datei ändern, F5 drücken,
fertig. Das ist eine bewusste Entscheidung: Ein Werkzeug, das in einer laufenden Produktion benutzt
wird, darf nicht daran scheitern, dass eine Buildkette nach einem Update nicht mehr durchläuft.
Abhängigkeiten sind ausschließlich `express` und `three`; alles andere kommt aus der
Node-Standardbibliothek.

**Dazwischen** liegen zwei Dateien, die für beide Seiten verbindlich sind:

- `shared/model.js` — das Datenmodell. Wird vom Server per `import` und vom Client per
  `<script type="module">` geladen, es ist buchstäblich dieselbe Datei. Damit kann sich das
  Verständnis davon, was ein Layer ist, nicht auseinanderentwickeln.
- `shared/API.md` — der HTTP-Vertrag. Wer dort etwas ändert, ändert es auf beiden Seiten.

### Datenfluss

```
Bedienelement
   -> store.set(patch)              client/src/store.js
   -> Abonnenten werden benachrichtigt
        -> stage3d.update(state)    three-Szene neu bestuecken
        -> panelEditor.update(state)
        -> Kopfzeile, Listen, Statuszeile
   -> api.putProject(project)       client/src/api.js  ->  PUT /api/project
   -> Server schreibt project.tbg.json (Autosave bei jedem PUT)
```

Alles, was länger dauert als ein Tastendruck, ist ein **Job**: Scan, Proxy, Conform, Render, QC,
ffmpeg-Installation. Der Client startet ihn per POST, bekommt eine `jobId` und hört ab da auf
`GET /api/jobs/stream` (SSE) mit. Kein Polling.

Jedes Job-Objekt trägt ein Feld `command` mit der vollständigen, lesbaren ffmpeg-Kommandozeile. Das
ist keine Kosmetik: Es ist die Zusage, dass kein Schritt der Pipeline eine Black Box ist.
`POST /api/preview/filtergraph` liefert dieselbe Kommandozeile, ohne irgendetwas zu starten.

### Fehler

Kein gefangener Fehler bleibt still. Jeder wird geloggt und landet im Job (`error`) oder als
`{ error, detail }` in der HTTP-Antwort. Die Client-Funktionen in `api.js` werfen bei `!res.ok` mit
der Servermeldung als `message` — die steht dann im Klartext in der Statuszeile.

---

## 2. Arbeitsverzeichnis und Plattformen

Theater-Bild-Gelöte schreibt nichts an unerwartete Orte. Alles, was entsteht, liegt im **Arbeitsverzeichnis**,
das beim ersten Start abgefragt wird:

| Eintrag | Inhalt |
|---|---|
| `project.tbg.json` | das aktuelle Projekt, Autosave bei jedem `PUT /api/project` |
| `out/` | Standardziel für Renderausgaben |
| `proxies/` | H.264-Proxies für die Browservorschau |
| `thumbs/` | Posterframes |
| `.cache/` | ffprobe-Ergebnisse und QC-Arbeitsordner |
| `bin/` | lokales ffmpeg und ffprobe |
| `config/venues/` | die Venue-Dateien |

`server/paths.js` ist die einzige Stelle, die diese Orte kennt; alle anderen Module fragen dort
nach. Die Ordner werden beim Start rekursiv und idempotent angelegt. `GET /api/health` gibt sie
mit aus, damit Oberfläche und `npm run doctor` dieselbe Wahrheit zeigen.

Drei Regeln, die für jeden Pfad im Projekt gelten und keine Ausnahme kennen:

- **Pfade werden mit `node:path` gebaut, nie mit String-Verkettung.** Ein Arbeitsverzeichnis darf
  Leerzeichen, Punkte und Umlaute enthalten.
- **Keine Annahme über Laufwerksbuchstaben.** `C:\` ist genauso wenig gesetzt wie `/home`. Auf
  Windows liefert `GET /api/fs/browse` ohne `path` die Laufwerksliste, auf macOS und Linux die
  Wurzel.
- **Vergleiche unter Windows case-unempfindlich** (`isInside()` in `server/paths.js`), weil das
  Dateisystem es auch ist. `safeJoin()` stellt sicher, dass keine Anfrage aus dem erlaubten
  Verzeichnis herausklettert.

Plattformunterschiede gibt es an genau drei Stellen, und sie sind alle gekapselt: der Suffix `.exe`
für die ffmpeg-Programme, das Entpacken des heruntergeladenen Builds und die Ermittlung des freien
Plattenplatzes (`fs.statfsSync`, mit Rückfall auf ein Systemwerkzeug). Der Rest des Codes weiß
nicht, auf welchem Betriebssystem er läuft — und soll es auch nicht wissen.

---

## 3. Kommandozeile

Alles, was ohne Oberfläche gebraucht wird, liegt in `server/cli/`:

| Aufruf | Wirkung |
|---|---|
| `npx Theater-Bild-Gelöte` | Server starten, ohne das Repository zu klonen |
| `npm start` | Server starten |
| `npm run dev` | Server mit Neustart bei jeder Änderung (`node --watch`) |
| `npm run doctor` | Selbstprüfung: Node, ffmpeg, Encoder, Arbeitsordner, Venues, Plattenplatz. Exitcode 1, wenn etwas Kritisches fehlt — damit lässt sich der Aufruf in ein Startskript hängen |
| `npm run setup:ffmpeg` | ffmpeg mit den gebrauchten Encodern nach `bin/` holen |
| `npm run render` | Rendern ohne Oberfläche, für Stapelläufe |

Die CLI-Module benutzen dieselben Funktionen wie der Server; `install-ffmpeg.js` wird sowohl von
`npm run setup:ffmpeg` als auch von `POST /api/ffmpeg/install` aufgerufen. Es gibt keinen zweiten
Weg, der etwas anders macht.

`npm run setup:ffmpeg` läuft **nur auf ausdrückliche Aktion**, nie automatisch beim Start. Scheitert
der Download, gibt das Modul eine vollständige Anleitung für den Weg von Hand aus — Fehler bleiben
nie stumm und nie unbeantwortet.

---

## 4. Das Slot/Layer-Modell

Der Kern von `shared/model.js`. Drei Ebenen, hier am Beispiel einer Wand aus vier Teilen:

```
Wand D  (2736 x 1224)
 |
 +- Slot "master"   x=0     2736 x 1224      <- die ganze Wand
 +- Slot "D1"       x=0      648 x 1224
 +- Slot "D2"       x=648    720 x 1224
 +- Slot "D3"       x=1368   720 x 1224
 +- Slot "D4"       x=2088   648 x 1224
       |
       +- Layer  -> mediaId + transform + filters + time
       +- Layer
```

Ein **Slot** ist eine rechteckige Fläche in Wandkoordinaten. Ein **Layer** ist eine Quelle, die in
diesem Slot liegt, mit Zuschnitt, Position, Bildkorrektur und Zeit.

Der Gewinn dieser Form: Räumliches und zeitliches Zusammenfügen sind dasselbe Modell.

- Vier Clips auf `D1`…`D4`, alle bei `startSec` 0 → **räumlicher Merge.** Vier Einzelvideos werden
  eine durchgehende Wand.
- Drei Clips auf `master`, `startSec` 0 / 15 / 30 → **zeitlicher Merge.** Drei Einzelvideos werden
  ein durchgehendes Video.
- Beides gleichzeitig ist erlaubt und der Normalfall.

Zwei Konventionen, die man kennen muss:

- **`transform.crop` ist in Quellpixeln, `transform.dest` in Slotpixeln.** Bei `fit != 'manual'`
  wird `dest` beim Rendern aus `fit` und `crop` neu berechnet; der Editor schreibt es trotzdem mit,
  damit die Oberfläche eine Zahl anzeigen kann.
- **Renderreihenfolge kommt aus `wallLayersInOrder()`**: erst `master`, dann die Panels in
  Spec-Reihenfolge, innerhalb eines Slots nach `time.startSec`. Panel-Layer liegen also immer über
  dem Master. Wer beides belegt, bekommt vom Validator einen `info`-Hinweis — kein Fehler, aber
  selten Absicht.

Die Framezahl kommt aus einer einzigen Funktion:

```js
targetFrameCount(project)   // loopSeconds * fps, minus dem doppelten Schlussframe
```

Bei 20 Sekunden und 30 fps sind das **600**. Diese Zahl geht als `-frames:v 600` in den
ffmpeg-Aufruf und wird vom QC-Check `frameCount` gegengeprüft. `dropDuplicateEndFrame` ist der
Grund, warum Frame 600 nicht mitgerendert wird: Er wäre identisch mit Frame 0, und ein doppelter
Frame im Loop ist auf der Wand als Stocken sichtbar.

Die Fahrwege der Wandteile stecken ebenfalls im Modell: `panelTravelM()` rechnet aus `travel`
(0 bis 1), `travelMode` (`2+2` oder `4x`) und `stage.travelMaxM` den Weg jedes Teils in Metern aus,
`centerGapM()` die sichtbare Öffnung in der Mitte. Das ist reine Anzeige und ändert nichts am
Render — aber es ist die Grundlage der Prüfung, ob ein Bild aufgefahren noch trägt.

---

## 5. Warum eine Wand in EINEM ffmpeg-Durchlauf gerendert wird

Naheliegend wäre, die Panels einzeln zu rendern und die Dateien nebeneinanderzulegen. Das wäre
falsch, aus vier Gründen:

**Nähte.** Skalierung, `eq`-Korrektur und Kompression sind nichtlinear. Zwei getrennte Läufe über
zwei benachbarte Bildbereiche ergeben an der Grenze einen Sprung — mal in der Helligkeit, mal im
Rauschmuster, mal in der Quantisierung eines Verlaufs. Auf feinem Pitch und aus einiger Entfernung
ist das eine sichtbare senkrechte Linie. In einem Durchlauf entsteht die Naht überhaupt nicht: bis
zum Schnitt gibt es nur eine einzige Fläche.

**Farbe und Gamma.** `format`, `colorspace` und Dithering wirken einmal auf die gesamte Fläche. Vier
Läufe heißen vier Rundungsentscheidungen.

**Framezahl.** `-frames:v 600` gilt für die Ausgabe. Vier getrennte Läufe können unterschiedlich
enden, wenn eine Quelle einen Frame kürzer ist — und dann laufen die vier Teile auf der Bühne
auseinander.

**Zeit.** Die Basisfläche wird einmal erzeugt, jede Quelle einmal dekodiert. Vier Läufe über
dieselbe Wand dekodieren viermal.

Panel-Einzeldateien entstehen deshalb **im selben Durchlauf** per `crop` aus der fertigen Fläche
(`alsoPanels: true`). Damit sind sie deckungsgleich mit dem Master. Der Weg über
`POST /api/render/panels` mit `fromMaster` schneidet nachträglich aus einer bereits fertigen Datei —
geht auch, kostet aber eine zweite Kompressionsstufe und ist die Notlösung, wenn der Master schon
geliefert ist.

---

## 6. Wie der Filtergraph entsteht

Der Aufbau ist immer derselbe, in sechs Stufen.

**Stufe 1 — Basisfläche.** Ein `lavfi`-Eingang in Wandgröße, in `project.background`:

```
-f lavfi -i "color=c=black:s=2736x1224:r=30:d=20"
```

**Stufe 2 — ein Eingang pro Layer**, in der Reihenfolge aus `wallLayersInOrder()`. Der Pfad kommt
aus `media.absPath`, `-ss` aus `layer.time.inSec`.

**Stufe 3 — pro Layer eine Filterkette.** Immer in dieser Reihenfolge:

1. Zeit: `trim` / `setpts` aus `time` (`speed` wird zu `setpts=PTS/speed`, `loop` zu `loop`)
2. Quellzuschnitt: `crop` aus `transform.crop`, in **Quellpixeln**
3. Geometrie: `scale` nach `transform.fit`, dann `crop` auf Slotgröße, dazu `rotate`, `hflip`,
   `vflip`
4. Bild: `eq` aus `filters` (brightness, contrast, saturation, gamma), `hue`, `gblur`
5. Kante: `feather` wird zu einem Alphaverlauf an den betroffenen Seiten
6. `format`, `setsar=1`

**Stufe 4 — Overlay-Kette.** Jeder Layer wird auf das Zwischenergebnis gelegt, an
`slot.x + transform.dest.x`. `blend` steuert den Modus, `opacity` die Deckung.

**Stufe 5 — Ausgabeformat.** `format=rgba` für HAP, `format=yuv422p10le` für ProRes 422,
`format=yuv420p` für MPEG-2 und H.264. Kommt aus dem Preset.

**Stufe 6 — Ausgabeargumente.** `-r <fps> -fps_mode cfr -frames:v <N> -an`, dann die `args` des
Delivery-Presets aus dem Venue-JSON.

### Vollständiges Beispiel: eine Wand, vier Clips auf vier Panels, 20 s, HAP Q

```
bin/ffmpeg -y -hide_banner -nostdin -progress pipe:1 -nostats
  -f lavfi -i "color=c=black:s=2736x1224:r=30:d=20"
  -i ".../d1_conform.mov"
  -i ".../d2_conform.mov"
  -i ".../d3_conform.mov"
  -i ".../d4_conform.mov"
  -filter_complex "
    [0:v]setsar=1,format=rgba[bg];
    [1:v]fps=30,scale=648:1224:force_original_aspect_ratio=increase,crop=648:1224,setsar=1,format=rgba[l1];
    [bg][l1]overlay=x=0:y=0:eof_action=pass[c1];
    [2:v]fps=30,scale=720:1224:force_original_aspect_ratio=increase,crop=720:1224,eq=brightness=-0.04,setsar=1,format=rgba[l2];
    [c1][l2]overlay=x=648:y=0:eof_action=pass[c2];
    [3:v]fps=30,scale=720:1224:force_original_aspect_ratio=increase,crop=720:1224,setsar=1,format=rgba[l3];
    [c2][l3]overlay=x=1368:y=0:eof_action=pass[c3];
    [4:v]fps=30,scale=648:1224:force_original_aspect_ratio=increase,crop=648:1224,setsar=1,format=rgba[l4];
    [c3][l4]overlay=x=2088:y=0:eof_action=pass[out]"
  -map "[out]" -r 30 -fps_mode cfr -frames:v 600 -an
  -c:v hap -format hap_q -chunks 4
  "out/D_2736x1224_30p_HAP.mov"
```

Die x-Werte 0 / 648 / 1368 / 2088 sind exakt die `panels[].x` aus dem Venue-JSON. Der Dateiname
kommt aus `deliveryName()` und dem `namePattern` des Venues.

Mit `alsoPanels: true` hängen sich vier weitere Ausgaben an denselben Aufruf:

```
  -filter_complex "... ;[out]split=5[m][s1][s2][s3][s4];
    [s1]crop=648:1224:0:0[p1]; [s2]crop=720:1224:648:0[p2];
    [s3]crop=720:1224:1368:0[p3]; [s4]crop=648:1224:2088:0[p4]"
  -map "[m]"  ... "out/D_2736x1224_30p_HAP.mov"
  -map "[p1]" ... "out/D1_648x1224_30p_HAP.mov"
  -map "[p2]" ... "out/D2_720x1224_30p_HAP.mov"
  -map "[p3]" ... "out/D3_720x1224_30p_HAP.mov"
  -map "[p4]" ... "out/D4_648x1224_30p_HAP.mov"
```

### Fortschritt

`-progress pipe:1 -nostats` schreibt Schlüssel-Wert-Zeilen nach stdout. Ausgewertet werden zwei:

```
frame=317
out_time_us=10566667
```

`progress` im Job ist `frame / targetFrameCount(project)` — also `317 / 600 = 0,53`. Alles andere
aus dem ffmpeg-Ausgabestrom wandert unverändert in `job.log`.

---

## 7. Mehrsprachigkeit

Die Oberfläche ist deutsch, Englisch kommt per Übersetzung. Der ganze Mechanismus steht in
`client/src/i18n.js` und ist bewusst klein: **der deutsche Text ist der Schlüssel.**

```js
import { t, tn, register, onLangChange, fmtNum, fmtMeters } from '../i18n.js';

register('en', {
  'Rendern': 'Render',
  'Zielordner': 'Output folder',
  '{n} Dateien': '{n} files',
});

t('Rendern')                  // 'Rendern' | 'Render'
tn(n, '{n} Datei', '{n} Dateien')
fmtMeters(10.4)               // '10,40 m' | '10.40 m'
```

Warum so und nicht mit erfundenen Schlüsseln wie `render.button.label`:

- Deutsch funktioniert ohne jedes Wörterbuch. Fällt eine Übersetzung aus, steht dort deutscher
  Klartext statt eines Schlüsselnamens.
- Beim Lesen des Codes sieht man sofort, was auf dem Schirm steht.
- Es gibt **keine zentrale Wörterbuchdatei**. Jedes Modul meldet seine eigenen Übersetzungen direkt
  nach den Importen an; damit arbeiten nie zwei Leute in derselben Datei, und die Übersetzung steht
  neben dem Text, den sie betrifft.

Der Preis: Ändert sich der deutsche Text, greift die Übersetzung nicht mehr. Dafür ist der Ausfall
harmlos (es steht Deutsch da) und auffindbar.

Statisches Markup wird mit `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` und
`data-i18n-aria` ausgezeichnet und von `applyStatic()` übersetzt; der deutsche Originaltext bleibt
im Markup stehen, weil er der Schlüssel ist. Ein Modul mit `update(state)` meldet sich per
`onLangChange(() => neu zeichnen)` an, damit ein Sprachwechsel die Ansicht neu aufbaut. Zahlen,
Größen und Metermaße laufen über `fmtNum`, `fmtBytes` und `fmtMeters` — von Hand gesetzte Kommas
sind ein Fehler, weil sie im Englischen falsch stehen.

Serverseitige Meldungen sind deutsch und werden im Client übersetzt, wenn sie in der Oberfläche
landen. Logzeilen von ffmpeg bleiben, wie sie sind.

---

## 8. Erweitern

### 8.1 Ein neues Venue

Eine neue JSON-Datei in `config/venues/`. Der Dateiname ist egal, die `id` zählt; sie taucht in
`GET /api/venues` auf und wird beim Anlegen eines Projekts (`POST /api/project/new`) als `venueId`
übergeben. Kein Code muss angefasst werden.

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
  "camera": { "presets": [ { "id": "audience", "label": "Zuschauer Mitte",
                             "pos": [0, 1.2, -12], "target": [0, 2, 0], "fov": 40 } ],
              "default": "audience" },
  "delivery": {
    "namePattern": "{WALL}_{W}x{H}_{FPS}p_{CODEC}",
    "presets": [],
    "defaultPreset": "hap_q",
    "proxy": { "maxWidth": 1280,
               "args": ["-c:v","libx264","-crf","26","-preset","veryfast",
                        "-pix_fmt","yuv420p","-movflags","+faststart","-an"] }
  },
  "assumptions": ["Fahrweg geschaetzt, im Haus nachmessen."],
  "openQuestions": ["Gemeinsamer Timecode ueber alle Flaechen?"]
}
```

Pflicht sind `id`, `fps` und `walls[]` mit `width`, `height` und mindestens einem Panel;
`makeWallState()` baut daraus die Slots. `stage.z` und `stage.travelMaxM` braucht die 3D-Ansicht.
`server/venues.js` prüft beim Laden, ob die Summe der Panelbreiten der Wandbreite entspricht und ob
die `x`-Offsets lückenlos aufeinanderfolgen; stimmt das nicht, warnt es laut, denn jede Panel-Datei
wäre dann falsch geschnitten. Was geschätzt ist, gehört in `assumptions` — das Werkzeug zeigt diese
Liste an, und sie ist die Grundlage für `docs/OFFENE-PUNKTE.md`.

Eine Datei darf entweder ein einzelnes Venue enthalten oder `{ "venues": [ … ] }`. Nebenvenues erben
Kamerapresets, Bildrate, Pitch und Delivery-Block vom Basisvenue, wenn sie sie weglassen.

### 8.2 Der Venue-Editor

Die Ansicht **Venue** schreibt genau diese Dateien. Sie ist kein zweiter Datenpfad, sondern eine
Oberfläche auf dasselbe JSON: Wände anlegen, Panels aufteilen, Maße eintragen, Delivery-Presets
pflegen. Widersprüche meldet sie sofort und mit derselben Begründung wie der Server beim Laden —
insbesondere die Summenprüfung der Panelbreiten.

Wer ein Venue lieber im Editor schreibt, kann das; wer es lieber von Hand schreibt oder aus einer
Herstellerunterlage generiert, ebenso. Beide Wege ergeben dieselbe Datei, und eine Venue-Datei ist
das, was man weitergibt, wenn ein zweiter Rechner dasselbe Haus bespielen soll.

### 8.3 Ein neues Delivery-Preset

Ein Objekt in `delivery.presets` des jeweiligen Venue-JSON. `args` wird unverändert an ffmpeg
weitergereicht, `codecTag` landet über `deliveryName()` im Dateinamen, `bytesPerPixel` steuert nur
die Größenabschätzung in der Oberfläche.

```json
{
  "id": "prores422hq",
  "label": "ProRes 422 HQ — Backup, hohe Qualität",
  "ext": "mov",
  "codecTag": "ProRes422HQ",
  "args": ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-an"],
  "bytesPerPixel": 0.92,
  "alpha": false
}
```

Danach steht das Preset in der Ansicht Render zur Auswahl und in `POST /api/render/wall` als
`presetId`. Zwei Dinge beachten: Die `id` muss innerhalb des Venues eindeutig sein, und wenn der
Encoder aus `args` im installierten ffmpeg fehlt, meldet `GET /api/health` ihn nicht unter
`encoders` — dann bricht der Job mit einer Fehlermeldung ab, statt still etwas anderes zu tun.

### 8.4 Ein neuer QC-Check

Alle Checks liegen in `server/ops/qc.js`. Drei Änderungen, in dieser Reihenfolge:

1. ein Eintrag in der exportierten Liste `CHECKS` (`id` und deutsches `label`),
2. eine exportierte Funktion, die den Check ausführt,
3. ein `case` in `dispatch()`, der sie aufruft.

Die Rückgabe muss der Form aus `shared/API.md` entsprechen:
`{ id, label, status, message, detail, artifacts }` mit `status` aus `pass`, `warn`, `fail`, `skip`.

```js
// server/ops/qc.js

export const CHECKS = [
  // … vorhandene Eintraege …
  { id: 'columnDrift', label: 'Helligkeitssprung an der Naht' },
];

/** Prueft, ob die mittlere Helligkeit ueber eine Panelnaht springt. */
export async function columnDrift(ctx, file, venue, wallId) {
  const def = { id: 'columnDrift', label: 'Helligkeitssprung an der Naht' };

  const wall = (venue?.walls || []).find((w) => w.id === wallId);
  if (!wall) return skipResult(def, 'Ohne Wand ist die Naht unbekannt.');

  const x = wall.centerSeamX;
  const out = await runFfmpeg(ctx, [
    '-i', file,
    '-vf', `crop=16:${wall.height}:${x - 8}:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
    '-f', 'null', '-',
  ]);

  const values = [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  if (values.length === 0) return skipResult(def, 'Keine Messwerte erhalten.');

  const spread = Math.max(...values) - Math.min(...values);
  return {
    ...def,
    status: spread > 6 ? 'fail' : spread > 3 ? 'warn' : 'pass',
    message: `Helligkeitsspanne an der Naht x=${x}: ${spread.toFixed(1)} von 255.`,
    detail: { seamX: x, spread, frames: values.length },
    artifacts: [],
  };
}
```

Wichtig: Der Check fängt seine eigenen Fehler **nicht** ab. `guarded()` legt sich um jeden Aufruf,
macht aus einem gescheiterten ffmpeg-Lauf ein `skip` mit Begründung und lässt nie einen einzelnen
Check den ganzen Job umbringen. Wer eine Bedingung nicht prüfen kann, gibt `skip` mit einem Satz
zurück; geworfen wird nur, wenn wirklich etwas kaputt ist. Belegbilder gehören in den
QC-Arbeitsordner und werden als `artifacts: [{ type: 'image', path: '…' }]` gemeldet.

Neue Check-Ids sind sofort in `POST /api/qc/run` benutzbar und gehören in die Tabelle in
`shared/API.md`.

### 8.5 Eine neue Sprache

Eintrag in `LANGUAGES` in `client/src/i18n.js`, dann pro UI-Modul ein weiteres
`register('<id>', { … })` neben dem vorhandenen. Unübersetzte Texte fallen auf Deutsch zurück, eine
angefangene Übersetzung ist also ab dem ersten Commit benutzbar. Details in `CONTRIBUTING.md`.

---

## 9. Ordnerübersicht

```
Theater-Bild-Gelöte/
  package.json          nur express und three
  LICENSE               MIT
  README.md  README.en.md  CONTRIBUTING.md
  server/
    index.js            Express, Routen, statische Auslieferung
    paths.js            Arbeitsverzeichnis, node:path-Helfer, safeJoin
    ffmpeg.js           ffmpeg/ffprobe finden, Encoder ermitteln
    jobs.js             Jobverwaltung und SSE-Bus
    venues.js           Venue-Dateien lesen, pruefen, vererben
    project.js          laden, speichern, autosave, validieren
    library.js probe.js fsbrowse.js
    cli/                doctor.js, install-ffmpeg.js, render.js
    ops/                filtergraph.js, render.js, conform.js, proxy.js,
                        slice.js, deliver.js, qc.js   (die Renderpipeline)
  client/
    index.html          Import Map fuer three
    src/
      main.js           Rahmen, Tastenkuerzel, Wiedergabeschleife
      store.js          Zustand, set/get/subscribe
      api.js            eine Funktion pro Endpunkt aus shared/API.md
      i18n.js           Mehrsprachigkeit
      dom.js            kleine DOM-Helfer
      media/videoPool.js
      three/stage3d.js
      editor/panelEditor.js
      ui/               library, render, qc, inspector, jobs, setup
  shared/
    model.js            Datenmodell, von beiden Seiten importiert
    API.md              HTTP-Vertrag
  config/venues/        Beschreibungen der Haeuser
  docs/                 diese Dokumentation
  bin/ .cache/ proxies/ thumbs/ out/     erzeugt, nicht versionieren
```
