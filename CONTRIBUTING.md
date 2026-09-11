# Contributing to Theater-Bild-Gelöte

This file is written in English so that the code base stays approachable from outside the
German-speaking part of the industry. The user interface and the main documentation are German
first; see the short German summary at the end of this file. Reference documents:
[`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) (design), [`shared/API.md`](shared/API.md) (HTTP
contract), [`shared/model.js`](shared/model.js) (data model).

---

## How the program is put together

1. **Server** — Node 18+, ESM, `express`, bound to `127.0.0.1:7333`. The only part allowed to touch
   the file system and spawn processes.
2. **Client** — plain ES modules the browser loads directly. **No bundler, no build step.**
   Change a file, press F5.
3. `three` is served from `node_modules` through an import map; `express` and `three` are the only
   two dependencies in the entire project.
4. `shared/model.js` is imported by both sides — literally the same file — so the definition of a
   slot, a layer or a project cannot drift apart.
5. `shared/API.md` is the contract between the two halves. Change it there first, then on both
   sides.
6. Anything slower than a keystroke is a **job**: scan, proxy, conform, render, QC, ffmpeg install.
   The client starts it with a POST and follows `GET /api/jobs/stream` (SSE). No polling.
7. Every job carries the full ffmpeg command line in `job.command`; `POST /api/preview/filtergraph`
   returns the same line without running anything. No step of the pipeline is a black box.
8. `server/ops/` holds the actual work — filtergraph, render, conform, proxy, QC. `server/index.js`
   only knows the contract, not the internals.
9. The venue JSON files in `config/venues/` describe the houses; nothing about a specific venue is
   hard-coded anywhere in the source.
10. **No caught error stays silent.** Every one is logged and reported in plain language, either in
    `job.error` or as `{ error, detail }` in the HTTP response.

---

## Running it, and knowing that it runs

```
npm install
npm run doctor      # can this machine render today?
npm run dev         # server with restart on change
```

You know it is running when:

- the terminal prints the banner with version, interface URL, working folder and output folder;
- `http://127.0.0.1:7333/api/health` answers with `"ok": true`, an `ffmpeg` block with
  `found: true` and an `encoders` map;
- the interface opens at `http://127.0.0.1:7333` and the header shows the venue name, frame rate and
  pixel pitch;
- the status line at the bottom reads *Bereit.* / *Ready.* instead of an error.

The most common startup faults, and what they mean:

| Symptom | Cause |
|---|---|
| `EADDRINUSE` | an instance is already running, or something else holds port 7333 |
| header shows `ffmpeg fehlt` | no ffmpeg in the working folder's `bin/` and none on the PATH |
| `encoders.hap: false` | ffmpeg present but built without HAP — delivery impossible |
| 3D view black, 404 on `/api/media/.../proxy` | no proxy built for that file yet |
| `three ist nicht installiert` | `npm install` has not run |

---

## Adding a venue

A venue is a JSON file in `config/venues/`. The file name is free, the `id` is what counts; it shows
up in `GET /api/venues` and is passed as `venueId` to `POST /api/project/new`. No code changes.
Either write the file or use the Venue view, which writes the same shape.

```json
{
  "id": "halle-nord",
  "name": "Halle Nord",
  "fps": 30,
  "pixelPitchMm": 3.9,
  "walls": [
    {
      "id": "W",
      "label": "W — main wall",
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
  "assumptions": ["Travel estimated, measure on site."],
  "openQuestions": ["Is playback started on a shared timecode?"]
}
```

`id`, `fps` and `walls[]` with `width`, `height` and at least one panel are mandatory;
`makeWallState()` builds the slots from them. `stage.z` and `stage.travelMaxM` are what the 3D view
needs. The panel widths must add up to the wall width and the `x` offsets must be contiguous —
`server/venues.js` checks this on load and warns loudly, because otherwise every panel file is cut
wrong. Anything estimated belongs in `assumptions`; the tool displays that list, and it is the basis
for [`docs/OFFENE-PUNKTE.md`](docs/OFFENE-PUNKTE.md).

A file may contain either a single venue object or `{ "venues": [ ... ] }`. Secondary venues inherit
camera presets, frame rate, pitch and delivery block from the base venue when they omit them.

---

## Adding a delivery preset

An object in `delivery.presets` of the venue in question. `args` is passed to ffmpeg unchanged,
`codecTag` ends up in the file name via `deliveryName()`, and `bytesPerPixel` only drives the size
estimate in the interface.

```json
{
  "id": "prores422hq",
  "label": "ProRes 422 HQ — backup, high quality",
  "ext": "mov",
  "codecTag": "ProRes422HQ",
  "args": ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-an"],
  "bytesPerPixel": 0.92,
  "alpha": false,
  "note": "Only when the backup is used as source material for further work."
}
```

The `id` has to be unique within the venue. If the encoder named in `args` is missing from the
installed ffmpeg, `GET /api/health` does not list it under `encoders`, and the render job fails with
a message instead of silently producing something else.

---

## Adding a QC check

All checks live in `server/ops/qc.js`. Three edits are needed, in this order:

1. an entry in the exported `CHECKS` array (id and German label — the label is the user-visible
   text and goes through the translation layer in the client);
2. an exported function that performs the check;
3. a `case` in `dispatch()` that calls it.

The return value must match the shape in `shared/API.md`: `{ id, label, status, message, detail,
artifacts }` with `status` being one of `pass`, `warn`, `fail`, `skip`.

```js
// server/ops/qc.js

export const CHECKS = [
  // … vorhandene Eintraege …
  { id: 'columnDrift', label: 'Helligkeitssprung an der Naht' },
];

/**
 * Prueft, ob die mittlere Helligkeit ueber eine Panelnaht springt.
 * Rein messend - der Check aendert nichts an der Datei.
 */
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

```js
// in dispatch()
case 'columnDrift':
  return await columnDrift(ctx, file, venue, wallId);
```

Do not catch your own errors: `guarded()` wraps every check, turns a failed ffmpeg call into a
`skip` with the reason attached and never lets one check kill the whole job. Return `skip` with a
sentence of explanation when a precondition is missing; throw only when something is genuinely
broken. Evidence images go into the QC work folder and are reported as
`artifacts: [{ type: 'image', path: '…' }]`.

New check ids are usable in `POST /api/qc/run` immediately, and they belong in the table in
`shared/API.md`.

---

## Translations

The interface is German first. **The German text is the key**, so German works with no dictionary at
all, and a missing translation shows readable German rather than `render.button.label`. Everything is
in `client/src/i18n.js`.

Every module registers its own dictionary right after its imports. There is no central dictionary
file, so two people never edit the same file:

```js
import { t, tn, register, onLangChange, fmtNum, fmtMeters } from '../i18n.js';

register('en', {
  'Rendern': 'Render',
  'Zielordner': 'Output folder',
  'Naht': 'Seam',
  'Sperrzone': 'Safe area',
  '{n} Dateien': '{n} files',
});
```

Rules:

- Every string a human reads goes through `t()` — including titles, placeholders, `aria-label`,
  error messages and empty states. Static markup is annotated with `data-i18n`,
  `data-i18n-placeholder`, `data-i18n-title` or `data-i18n-aria` and translated by `applyStatic()`.
- Use `tn(n, one, many)` for singular and plural; `{n}` is filled in for you.
- Never format numbers by hand. `fmtNum(value, digits)`, `fmtBytes(bytes)` and `fmtMeters(metres)`
  produce a comma in German and a point in English. Any leftover `toFixed(…).replace(…)` is a bug.
- If your module has an `update(state)` function, register `onLangChange(() => redraw())` so the
  view rebuilds when the language changes.
- Translate into the vocabulary of the trade, not word by word: Wand = wall, Panel = panel, Naht =
  seam, Fahrweg = travel, Sperrzone = safe area, Loop = loop, Bildrate = frame rate, Ausschnitt =
  crop, Deckkraft = opacity, weiche Kante = feather, Auslieferung = delivery, Bibliothek = library,
  Bühne = stage, Zuschauer = audience.

**Adding a new language.** Add it to `LANGUAGES` in `client/src/i18n.js`:

```js
export const LANGUAGES = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
];
```

Then add a `register('nl', { … })` call to each UI module next to its existing `register('en', …)`.
The language switch in the header picks the new entry up automatically, the choice is stored in
`localStorage`, and `fmtNum()` needs a locale mapping for the new id. Untranslated strings fall back
to German, so a partial translation is usable from the first commit.

---

## Code style

- **ESM everywhere**, Node 18 or newer. No CommonJS, no transpiler, no build step. If a change
  requires a build step, it is the wrong change.
- **No new dependencies without a strong reason.** `express` and `three` are the entire dependency
  list, and it should stay that way. Everything else comes from the Node standard library. A new
  dependency needs an argument in the pull request explaining why the standard library is not
  enough.
- **Paths go through `node:path`**, never string concatenation, and never an assumption about drive
  letters. Windows, macOS and Linux all have to work.
- **Identifiers in English, comments in German** without umlauts (`ae`, `oe`, `ue`, `ss`). Comments
  explain *why* something is the way it is; what the code does should be readable from the code.
  The long comment blocks about past bugs in `client/src/main.js` are the intended style: they stop
  the next person from reintroducing the bug.
- **User-facing text is German** and goes through `t()`.
- **No caught error stays silent.** `catch` blocks either log with context and re-throw, or turn the
  problem into a message the user can read. An empty `catch {}` is only acceptable with a comment
  saying why the failure is genuinely irrelevant.
- **Do not break the render pipeline.** `server/ops/` produces verified output; changes there need a
  before/after comparison with real files.

---

## Licence

MIT, see [`LICENSE`](LICENSE). The copyright line reads:

```
Copyright (c) 2026 Theater-Bild-Gelöte contributors
```

That is a deliberate placeholder. The project owner enters their own name or organisation there;
until then the line stays exactly as it is. Do not add per-file copyright headers, and do not add
your name to `LICENSE` in a pull request — contributions keep their authorship in the Git history.

---

## Kurzfassung auf Deutsch

- **Aufbau.** Server (Node 18+, ESM, `express`, nur `127.0.0.1:7333`) und Client (reine ES-Module,
  **kein Bundler, kein Build-Schritt**). Dazwischen `shared/model.js` (dasselbe Datenmodell auf
  beiden Seiten) und `shared/API.md` (HTTP-Vertrag). Alles, was länger dauert als ein Tastendruck,
  ist ein Job mit sichtbarer ffmpeg-Kommandozeile.
- **Starten.** `npm install`, `npm run doctor`, `npm run dev`. Es läuft, wenn das Banner im Terminal
  steht, `/api/health` mit `ok: true` antwortet und die Statuszeile *Bereit.* zeigt.
- **Venue hinzufügen.** JSON-Datei in `config/venues/`, kein Code. Die Summe der Panelbreiten muss
  der Wandbreite entsprechen, sonst warnt der Server beim Laden. Geschätztes gehört in
  `assumptions`.
- **Delivery-Preset hinzufügen.** Ein Objekt in `delivery.presets` des Venues. `args` geht
  unverändert an ffmpeg, `codecTag` in den Dateinamen, `bytesPerPixel` nur in die
  Größenabschätzung.
- **QC-Check hinzufügen.** In `server/ops/qc.js`: Eintrag in `CHECKS`, Funktion schreiben, `case` in
  `dispatch()`. Rückgabe nach `shared/API.md`. Eigene Fehler nicht abfangen — `guarded()` macht
  daraus ein sauberes `skip`.
- **Übersetzen.** Der deutsche Text ist der Schlüssel. Jedes Modul meldet sein eigenes Wörterbuch
  mit `register('en', { … })` direkt nach den Importen an; es gibt keine zentrale Wörterbuchdatei.
  Zahlen nie von Hand formatieren, sondern `fmtNum`, `fmtBytes`, `fmtMeters` benutzen. Neue Sprache:
  Eintrag in `LANGUAGES` in `client/src/i18n.js`, dann pro Modul ein weiteres `register(...)`.
- **Codestil.** ESM, keine neuen Abhängigkeiten ohne guten Grund, Pfade über `node:path`,
  Bezeichner englisch, Kommentare deutsch ohne Umlaute und mit Begründung, Oberflächentexte deutsch
  durch `t()`. Kein gefangener Fehler bleibt still.
- **Lizenz.** MIT. Die Zeile `Copyright (c) 2026 Theater-Bild-Gelöte contributors` in `LICENSE` ist ein
  Platzhalter, den der Projektinhaber selbst ersetzt.
