# Theater-Bild-Gelöte — API-Vertrag

Verbindlich für Server **und** Client. Wer hier etwas ändert, ändert es auf beiden Seiten.

Basis: `http://127.0.0.1:7333`. Alle Antworten JSON, alle Fehler `{ "error": "text", "detail": "..." }`
mit passendem HTTP-Status. Erfolgreiche Antworten sind das nackte Objekt, kein Envelope.

---

## Systemzustand

### `GET /api/health`
```json
{
  "ok": true,
  "version": "0.1.0",
  "ffmpeg": {
    "found": true,
    "path": "D:\\...\\studio\\bin\\ffmpeg.exe",
    "source": "bundled" | "path" | "none",
    "version": "n7.0",
    "encoders": { "hap": true, "prores_ks": true, "mpeg2video": true, "libx264": true }
  },
  "ffprobe": { "found": true, "path": "..." },
  "paths": { "root": "...", "cache": "...", "proxies": "...", "out": "..." }
}
```
`encoders.hap === false` ist der wichtigste Fehlerfall: dann ist ein ffmpeg-Build ohne
HAP installiert und Delivery ans Schiff ist unmöglich. Der Client muss das prominent zeigen.

### `POST /api/ffmpeg/install`
Startet einen Job, der den BtbN-GPL-Build nach `bin/` holt. → `{ "jobId": "..." }`
Läuft **nur auf ausdrückliche Aktion des Nutzers**, nie automatisch beim Start.

---

## Venues

- `GET /api/venues` → `[{ id, name, wallCount }]`
- `GET /api/venues/:id` → das volle Venue-JSON aus `config/venues/`

---

## Projekt

- `GET  /api/project` → aktuelles Projekt (Modell aus `shared/model.js`)
- `PUT  /api/project` — Body = Projekt → `{ "ok": true, "modifiedAt": "..." }`
- `POST /api/project/new` — Body `{ venueId, name }` → Projekt
- `POST /api/project/open` — Body `{ path }` → Projekt
- `POST /api/project/save` — Body `{ path? }` → `{ ok, path }`
- `GET  /api/project/validate` → `[{ level: "error"|"warn"|"info", where, msg, hint }]`

Autosave: Der Server schreibt bei jedem `PUT` nach `project.tbg.json` im Projektordner.

---

## Medien

### `POST /api/library/scan`
Body `{ "roots": ["D:\\...\\04_render"], "recursive": true }` → `{ "jobId": "..." }`
Ergebnis des Jobs: `{ "media": [ Media, ... ] }` — bereits geprobt.

### `POST /api/media/add`
Body `{ "paths": ["..."] }` → `{ "media": [ Media ] }` (synchron, probet sofort)

### `POST /api/media/proxy`
Body `{ "mediaIds": [...], "force": false }` → `{ "jobId": "..." }`
Erzeugt browsertaugliche H.264-Proxies. **Pflicht** für HAP/ProRes/MPEG-2-Quellen,
weil der Browser die nicht abspielen kann.

### `GET /api/media/:id/proxy`
Streamt die Proxydatei. **Muss HTTP-Range unterstützen**, sonst kann `<video>` nicht springen.
404 wenn noch kein Proxy da ist.

### `GET /api/media/:id/thumb`
JPEG, Posterframe. 404 wenn nicht vorhanden.

### `DELETE /api/media/:id`
Entfernt aus der Bibliothek. Löscht **nie** die Quelldatei, nur Proxy und Thumb.

---

## Dateisystem-Browser

### `GET /api/fs/browse?path=D:\Ordner`
```json
{
  "path": "D:\\Ordner",
  "parent": "D:\\",
  "entries": [{ "name": "x.mov", "path": "...", "dir": false, "sizeBytes": 123, "mtime": "..." }],
  "drives": ["C:\\", "D:\\"]
}
```
`path` weglassen → Laufwerksliste. Der Server darf nur lesen, nie schreiben.

---

## Verarbeitung

Alle folgenden Endpunkte antworten mit `{ "jobId": "..." }` und arbeiten asynchron.

### `POST /api/conform`
Frames und Raster angleichen.
```json
{
  "mediaIds": ["med_..."],
  "target": {
    "fps": 30,
    "fpsMode": "resample" | "duplicate" | "interpolate" | "retime",
    "width": null, "height": null,
    "fit": "cover",
    "pixFmt": "yuv420p",
    "colorRange": "tv",
    "durationSec": null,
    "durationMode": "none" | "trim" | "padBlack" | "padFreeze" | "loop",
    "syncToMediaId": null
  },
  "outDir": "...",
  "addToLibrary": true
}
```
- `fpsMode`
  - `resample` — `fps=30` Filter, Frames werden gedoppelt/verworfen. Standard, verlustfrei im Bild.
  - `duplicate` — identisch, explizit benannt für Klarheit im Log.
  - `interpolate` — `minterpolate`, bewegungskompensiert. Langsam, kann Artefakte machen.
  - `retime` — `setpts`, Video läuft schneller/langsamer, kein Frame wird erfunden.
- `syncToMediaId` gesetzt → `durationSec` wird aus dessen Framezahl übernommen,
  `durationMode` greift. Das ist „Frames angleichen" im Sinne des Nutzers.

### `POST /api/render/wall`
```json
{ "wallId": "D", "presetId": "hap_q", "outDir": "...", "outName": null,
  "rangeSec": null, "dryRun": false, "alsoPanels": false }
```
`dryRun: true` → Job endet sofort mit `result.command`, ohne zu rendern.
`alsoPanels: true` → schneidet zusätzlich D1..D4 im selben Durchlauf.

### `POST /api/render/panels`
`{ "wallId": "D", "presetId": "hap_q", "outDir": "...", "fromMaster": "pfad|null" }`
`fromMaster` gesetzt → schneidet eine fertige Masterdatei. Sonst rendert es aus dem Projekt.

### `POST /api/render/all`
`{ "presetIds": ["hap_q","prores422"], "outDir": "...", "walls": ["A","B","C","D"], "alsoPanels": false }`

### `POST /api/render/still`
`{ "wallId": "D", "atSec": 0, "outPath": "...", "scale": 1 }` → PNG. Für Contact Sheets und Freigaben.

---

## QC

`POST /api/qc/run` mit `{ "checks": ["loopSeam", ...], "wallId": "D", "path": "..." }` → `{ jobId }`

Jobresultat:
```json
{ "checks": [ {
    "id": "loopSeam",
    "label": "Loop-Naht",
    "status": "pass" | "warn" | "fail" | "skip",
    "message": "Erster und letzter Frame unterscheiden sich (SSIM 0.82) — sauber.",
    "detail": {},
    "artifacts": [{ "type": "image", "path": "..." }]
} ] }
```

Checks:
| id | prüft |
|---|---|
| `frameCount` | Framezahl == Looplänge × fps, kein doppelter Schlussframe |
| `loopSeam` | Frame 0 vs. letzter Frame per SSIM — identisch = Stocken im Loop |
| `seamContent` | Detailenergie in den Spalten um die Panelnähte → Motiv über der Naht? |
| `safeArea` | Belegung der äußeren 15 % |
| `blackLevel` | Schwarzwert und Spitzenhelligkeit, Histogramm |
| `banding` | Gradientenstufen in dunklen Flächen |
| `moire` | Hochfrequenzanteil nahe der Nyquistgrenze des Pitches |
| `flicker` | Frequenzanalyse der mittleren Helligkeit über Zeit, gegen Kamerashutter |
| `specCompliance` | Auflösung, fps, Codec, pix_fmt gegen Venue-Spec |

---

## Jobs

- `GET  /api/jobs` → `[Job]` (neueste zuerst, max. 200)
- `GET  /api/jobs/:id` → `Job`
- `POST /api/jobs/:id/cancel` → `{ ok }`
- `GET  /api/jobs/stream` → **SSE**

Job-Objekt:
```json
{
  "id": "job_...", "type": "render.wall", "label": "Wand D → HAP Q",
  "status": "queued" | "running" | "done" | "error" | "cancelled",
  "progress": 0.42,
  "startedAt": "...", "endedAt": null,
  "command": "ffmpeg -y -f lavfi ...",
  "log": ["..."],
  "result": null, "error": null
}
```

SSE-Nachrichten, je eine Zeile `data: {...}`:
- `{ "type": "job",  "job": Job }` — Statuswechsel oder Fortschritt
- `{ "type": "log",  "id": "job_...", "line": "..." }`
- `{ "type": "hello", "jobs": [Job] }` — direkt nach Verbindungsaufbau

---

## Render-Vorschau ohne Rendern

### `POST /api/preview/filtergraph`
`{ "wallId": "D" }` → `{ "inputs": [...], "filterComplex": "...", "map": "[out]", "command": "ffmpeg ..." }`

Das ist die Sichtprüfung für den Nutzer: **jeder ffmpeg-Aufruf ist im Klartext sichtbar
und kopierbar.** Kein Schritt der Pipeline ist eine Black Box.
