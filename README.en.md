# Theater-Bild-Gelöte

Repository: [jareb560-byte/theater-bild-geloete](https://github.com/jareb560-byte/theater-bild-geloete)
(private; requires an authorized GitHub account). GitHub Pages is not enabled.
Run the application locally. No npm package has been published.

*Deutsche Fassung: [README.md](README.md)*

Anyone feeding an LED wall built from several moving sections faces three problems at once. The
content has to work closed **and** open, once the sections have travelled apart and gaps stand
between them. The individual sections need files that match their pixel width exactly, run
frame-accurately to the same length, and show no brightness step across the seams. And in the end
the house asks for codecs — HAP, ProRes, MPEG-2 — that no ordinary editing suite writes. That is
what Theater-Bild-Gelöte is for: it ingests any source material, conforms frame rate and raster, places it on
wall and panel surfaces, shows in a 3D stage what the result looks like closed and open, renders
the delivery files and checks them against the venue spec. It runs entirely on your own machine,
with no cloud, and every ffmpeg call is visible in plain text before it starts.

## What it is not

Theater-Bild-Gelöte is **not an editing suite**. It cuts no scenes, mixes no audio and has no effects. It is
**not a media server** — it plays nothing during the show, triggers nothing and talks to no
console. It replaces **neither DaVinci Resolve nor Premiere nor After Effects**. It sits in
between: behind the application where the content is created, and in front of the server that puts
it on the wall. Everything to do with wall geometry, panel layout, seams, travel, loop lengths and
delivery formats is Theater-Bild-Gelöte's job. Everything else explicitly is not.

---

## Installation

With access to the private repository:

```sh
git clone https://github.com/jareb560-byte/theater-bild-geloete.git
cd theater-bild-geloete
```

You need **Node 18 or newer**. Theater-Bild-Gelöte fetches everything else itself.

```
node --version        # must report v18.x or higher
```

Open a terminal in the extracted source folder containing `package.json`.
This working version has not been published as an npm package, so `npx` is not
an installation option. Start the local version with:

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

`npm run setup:ffmpeg` obtains an ffmpeg build that carries the encoders you need and places it in
`bin/` inside the working folder. Nothing is installed system-wide and nothing is written to your
PATH. After that, `npm run doctor` answers the question of whether this machine can render today.

What matters is not *that* ffmpeg is present but *which* ffmpeg. The `hap` encoder is missing from
many prebuilt packages. Without it everything else keeps working — only delivery in the most common
LED format is impossible, and that usually surfaces on render day. The check is always the same:

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

`setup:ffmpeg` downloads the BtbN GPL build and extracts `ffmpeg.exe` and `ffprobe.exe` into
`bin\`. If a corporate firewall blocks the download:

```
winget install BtbN.FFmpeg.GPL
```

Then open a **new** terminal so the PATH is current, and run `npm run doctor`. The slim
"essentials" builds and the Microsoft Store packages generally cannot do HAP.

### macOS

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

If the automatic route does not get through, use Homebrew:

```
brew install ffmpeg
ffmpeg -hide_banner -encoders | grep hap
```

If the second command prints no line containing `hap`, that build is unsuitable. Fetch a full
static build instead and copy its `ffmpeg` and `ffprobe` into `bin/` inside the working folder.
On Apple Silicon everything runs natively; Rosetta is not needed.

### Linux

```
npm ci
npm run setup:ffmpeg
npm start -- --open
```

The distribution's ffmpeg (`apt install ffmpeg`, `dnf install ffmpeg`) is convenient but, depending
on the distribution, cannot do HAP — the most common stumbling block on Linux. Check with:

```
ffmpeg -hide_banner -encoders | grep hap
```

If the encoder is missing, download a static GPL build, unpack it and put `ffmpeg` and `ffprobe`
into `bin/` inside the working folder. Do not forget to make them executable (`chmod +x`). Theater-Bild-Gelöte
always looks in `bin/` first and only then on the PATH.

---

## First run

On the very first start an assistant opens and asks three things. After that the tool is set up,
and the assistant only returns if one of the three is missing.

**1. Working folder.** The folder Theater-Bild-Gelöte works in: project file, proxies, poster frames, analysis
cache, render output, the local ffmpeg. Pick a folder on your fastest disk with plenty of room —
render output reaches double-digit gigabytes quickly. The folder can be changed at any time; the
old files stay where they are.

| Item | Contents |
|---|---|
| `project.tbg.json` | the current project, saved on every change |
| `out/` | default target for render output |
| `proxies/` | H.264 proxies for browser preview |
| `thumbs/` | poster frames for the library |
| `.cache/` | ffprobe results, so a rescan is fast |
| `bin/` | local ffmpeg and ffprobe |
| `config/venues/` | the venues this installation knows |

**2. ffmpeg.** The assistant shows whether ffmpeg was found, where it came from and which encoders
it carries — as a traffic light, one line per encoder. If something is missing, a button fetches
the right build and the progress runs as a job at the bottom of the window. As long as `hap` is
missing, that stays red, permanently, because otherwise the gap only shows up at delivery time.

**3. Venue.** A venue is the description of a house. A complete example ships with the tool
(`mein-schiff-theater`, the theatre this tool grew out of). You can work with it right away to get
a feel for the tool, or create your own straight away — see [Setting up your own
venue](#setting-up-your-own-venue).

After that the server runs on `http://127.0.0.1:7333` and the interface opens in your browser. The
server binds to `127.0.0.1` only; nobody reaches it from outside.

The interface is available in **German and English**; switch it in the header, and the choice is
remembered. Numbers, file sizes and metric measurements are formatted per language.

For development use `npm run dev` instead — Node restarts on every server change. The client is not
built, so F5 in the browser is enough.

---

## The principle in five sentences

1. A **venue** describes the house: which walls exist, which panels they are built from, how large
   they are in pixels and in metres, how far the sections travel, what frame rate is used and which
   formats have to be delivered.
2. A **project** describes one show in that house: loop length, background, the material used and
   everything that was done to it.
3. Every wall has **slots** — one for the whole surface (`master`) and one per panel.
4. Every slot holds **layers**: a layer is a source file with crop, position, image correction and
   timing, and that is exactly what the picture is made of.
5. Rendering always covers the **whole wall in a single ffmpeg pass**; the individual panel files
   are cut from that same finished surface and therefore match it exactly.

The benefit of this shape: four clips side by side on four panels (spatial assembly) and three
clips one after another on `master` (temporal assembly) are the same model — slot, layer, start
time. Both at once is the normal case.

---

## The six views

**Library.** This is where material comes in. Scan a folder and every file is analysed with
ffprobe: resolution, frame rate, codec, pixel format, duration, frame count, alpha, colour range.
Every deviation from the target is listed as a note on the file. Proxies are generated from here as
well — without them the editor and the 3D stage stay black, because no browser can play HAP, ProRes
or MPEG-2. Conforming to target frame rate and target length also starts here.

**Editor.** The flat working view on one wall or one panel. Slots on the left, layers inside them.
This is where you crop, move, scale, match brightness against the neighbouring clip and soften the
transition to the neighbouring panel with a feather. The crop is always in source pixels, the
position in slot pixels; both are shown as numbers, not just as handles.

**3D stage.** The walls stand as surfaces in space, with a floor and a human figure for scale.
This is where you check what actually counts: the picture has to work closed as one continuous
surface and open, when the sections stand apart and reveal the wall behind. Clicking a panel
activates its slot. LED look, bezel width, black lift and brightness are display settings only and
change nothing in the render.

**Render.** Choose wall, delivery preset and output folder. Before the start the view shows the
complete ffmpeg command line including the filtergraph that is about to run. "Dry run" gives you
that line and nothing else. Running jobs show progress and log lines and can be cancelled. On
request the individual panel files fall out of the same pass.

**QC.** Checks a finished file against the venue spec: frame count, loop seam (frame 0 and the last
frame must not be identical), content across the panel seams, use of the safe areas, black level and
peak brightness, banding, moiré, flicker frequency and compliance with the specification. Every
check returns pass, warn, fail or skip with one sentence of reasoning and, where useful, an image as
evidence.

**Venue.** The house itself: create walls, divide them into panels, enter pixel and metric
dimensions, set frame rate and pixel pitch, define travel and safe areas, maintain delivery presets.
Contradictions are reported immediately — for instance when the panel widths do not add up to the
wall width. It is stored as JSON in `config/venues/`; you can just as well write and share that file
by hand.

---

## A full pass, with real numbers

Starting point: one wall, **2736 × 1224 pixels**, built from four panels — **648 · 720 · 720 ·
648** pixels wide, all 1224 high. The centre seam sits at **x = 1368**, which is where the sections
part. This example uses **30 fps** and the **HAP Q** preset. The TUI guide specifies MPEG-2 or
HAP; confirm the HAP variant with the venue. The loop is to be **20 seconds** long,
which is **600 frames**. Four separate clips, each 1920 × 1080 at 25 fps, are to go side by side
onto the four sections.

**1. Ingest.** Library view, scan the folder holding the four clips. Each clip then carries the
note `25 fps instead of 30 fps`. Select all four, *generate proxies*, wait until the preview images
appear.

**2. Conform.** Keep the four selected, *conform*. Target rate 30 fps, mode `resample` — frames are
duplicated, the image itself is left untouched. Duration 20 seconds, mode `loop`, so that all four
are the same length. Result: four new files with exactly 600 frames.

**3. Place.** Editor view, select the wall. Activate slot `D1`, drop the first conformed clip in as
a layer, then the same for `D2`, `D3`, `D4`. All four layers sit at `startSec 0`. That is spatial
assembly: four separate videos become one continuous wall.

**4. Crop.** Slot `D2`: the clip is 1920 × 1080, the panel 720 × 1224. `cover` scales it to
**2176 × 1224** and cuts **728 pixels** off each side — that is a lot, so set the crop by hand until
the subject sits right. On `D1` and `D4` (648 wide) 764 pixels are lost per side. Where the
transition looks hard, add a feather of 12 to 24 pixels on the side facing the seam. Match
brightness and contrast across the four clips.

**5. Check the travel.** 3D stage view, camera centre audience. Open the wall step by step. What you
must see: closed, one clean overall image; open, four sections that still hold up on their own.
Anything sitting across the centre seam at x = 1368 is torn apart when the wall opens. Show the
seams and watch the edges between D1/D2 and D3/D4: if brightness steps there, fix it in the editor
now, not later.

**6. Render.** Render view, preset HAP Q, output folder `out/`. Run a **dry run** first and read the
command line. It has to contain `-r 30`, `-fps_mode cfr`, `-frames:v 600` and
`-c:v hap -format hap_q`. If it does, press *render*. Budget approximately **2.0 GB**:
2736 × 1224 pixels at 1 byte is 3.35 MB per frame, or 100.5 MB/s. Before the additional
Snappy compression, HAP Q needs twice the storage of HAP; actual file size depends on the content.
If the sections are fed individually, tick *panels as well* beforehand — then
648 · 720 · 720 · 648 come out of the same pass and are guaranteed to match the master.

**7. QC.** QC view, select the rendered file, run all checks. Expected: `frameCount` pass with 600,
`loopSeam` pass (frame 0 and frame 599 differ), `seamContent` clear around x = 1368,
`specCompliance` pass with `hap`, 2736, 1224 and `30/1`. A `frameCount` failure almost always means
a layer is shorter than the loop.

**8. Deliver.** Before the full render across all walls, a 20-second sample goes to the house. That
is not politeness but the point at which banding, black level, moiré and neon brightness are judged
on the actual wall — on a monitor all of that looks different. Only after the response do the
remaining walls and the backup version in a second codec run.

The procedure as a checklist with all decision points: [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

---

## Setting up your own venue

A venue is a JSON file in `config/venues/`. The file name is free, the `id` is what counts. You can
create it in the Venue view or by hand; both write the same file. No code needs touching, and a
newly created venue is available for new projects after a reload.

The skeleton, using a hall with one wall made of two sections:

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

Three rules decide most of the mistakes:

- **The panel widths must add up to the wall width**, and the `x` values must follow each other
  without gaps. 896 + 896 = 1792. If that does not hold, Theater-Bild-Gelöte says so in plain text on load,
  because every panel file would then be cut wrong.
- **`stage.travelMaxM`** is the maximum travel of one half of the wall, in metres. It determines how
  far the 3D view pulls the sections apart. Anything estimated belongs in `assumptions` as plain
  text, and `stage.verified` stays `false` until it is confirmed.
- **`safeAreaPct`** is the share of each side in which nothing important may sit. 0.10 of 1792
  pixels is 179 pixels left and right.

### Pixel pitch, and why it should be the same everywhere

Pixel pitch is the distance between the centres of two neighbouring LEDs, in millimetres. It is the
conversion between pixels and metres: at 4 mm pitch one metre is exactly 250 pixels wide, at 2.6 mm
it is 385, at 6 mm only 167. The pitch also implies the sensible viewing distance (rule of thumb:
pitch in millimetres ≈ minimum distance in metres) and therefore the level of detail at which moiré
starts.

If all walls in a house share the **same** pitch, a pixel is the same physical size everywhere. A
building spanning two walls keeps its size; a horizon line sits at the same height on both walls;
the spatial staggering in the 3D view is correct, because pixels and metres convert with a single
factor. If the pitches differ, that is not an error and Theater-Bild-Gelöte copes — but every graphic spanning
more than one wall then has to be scaled per wall, and any judgement about detail and moiré applies
to one wall only. Where you have the choice: same pitch everywhere.

Because the metric figures in manufacturer documents are usually rounded, the arithmetic drifts
slightly. The bundled example venue states a 4 mm pitch but arrives at 251 pixels per metre from
2736 pixels across 10.90 m. Such rounding is irrelevant for the preview and completely irrelevant
for the delivery files — there, only the pixel count counts.

---

## Keyboard shortcuts

They only apply when the focus is not inside an input field.

| Key | Effect |
|---|---|
| `Space` | playback on / off |
| `1` … `4` | activate wall 1 to 4 (order taken from the venue), slot jumps to `master` |
| `S` | show seams |
| `A` | show safe areas |
| `G` | show grid |
| `F` | viewport to full window width and back |
| `←` `→` `↑` `↓` | nudge the selected layer by 1 pixel |
| `Shift` + arrow key | nudge by 10 pixels |
| `Ctrl` + `S` | save the project immediately (otherwise it happens automatically) |
| `Esc` | close the topmost dialog |

Views are switched with the buttons in the header, and so is the language.

---

## Troubleshooting

### ffmpeg is missing

The header shows `ffmpeg missing`, `GET /api/health` reports `ffmpeg.found: false` with
`source: "none"`. Nothing that analyses, builds proxies or renders will work; the interface itself
keeps running.

```
npm run setup:ffmpeg
npm run doctor
```

If the download fails, fetch the build by hand and copy `ffmpeg` and `ffprobe` into `bin/` inside
the working folder. Theater-Bild-Gelöte looks there first and on the PATH second — both are equally valid.
After installing through a package manager, open a **new** terminal, otherwise the running session
does not know the new PATH.

### No hap encoder

`health.ffmpeg.encoders.hap === false`. This is the most expensive fault in the tool, because it
hides for a long time: ffmpeg runs, proxies appear, previews are there — only the delivery format of
most LED houses cannot be written. This is the normal case with ffmpeg from package repositories, on
any operating system.

```
ffmpeg -hide_banner -encoders | grep hap        # macOS, Linux
ffmpeg -hide_banner -encoders | findstr hap     # Windows
```

If no line comes back, only a full GPL build helps. Until it arrives, ProRes and MPEG-2 are
possible — ProRes as a backup, MPEG-2 only after agreeing the data rate. Anyone delivering alpha
needs `hap` (HAP Alpha) or `prores_ks` (ProRes 4444) anyway.

### Proxy is missing

Editor and 3D stage show black surfaces, the network log shows 404 on `/api/media/<id>/proxy`. No
proxy was built for that file, or the job was cancelled. Select the file in the library and
*generate proxies*, adding *force rebuild* for a broken proxy. The `proxies/` folder may be emptied
at any time; it refills itself.

### The browser will not play HAP

That is not a fault but a property of browsers: none of them can decode HAP, ProRes or MPEG-2. This
is why the preview only ever plays the H.264 proxies, never the originals and never the delivery
files. A finished HAP file is not inspected in the browser but in the QC view — there ffmpeg reads
the file, not the browser. To see it with your own eyes, render an additional H.264 review copy or
open it in a player that handles HAP.

### Port in use

The server aborts with `EADDRINUSE`. Usually an instance is already running — then simply open
`http://127.0.0.1:7333`. Otherwise find out who is holding the port:

```
netstat -ano | findstr :7333          # Windows, then: taskkill /PID <PID> /F
lsof -i :7333                         # macOS, Linux, then: kill <PID>
```

The port is fixed so that bookmarks and the media preview URLs stay valid across sessions. If it is
permanently occupied by something else, that other program should move.

### Out of memory when rendering several outputs at once

Symptoms: the render job aborts with `Cannot allocate memory` or without any message, the system
starts swapping, or the browser drops the 3D view. The cause is always the same: every running
ffmpeg pass holds the base surface plus one decoded frame per layer in memory. A wall of
2736 × 1224 with four layers sits at roughly 40 MB per intermediate image — harmless on its own, but
it grows with every wall rendered in parallel. On top of that come the preview video elements in the
browser.

Work through this in order:

1. **Render one after another rather than in parallel.** Let one job render several walls in
   sequence instead of starting several render jobs by hand at the same time.
2. **Close the preview.** During a full render, stop playback and leave the 3D view; that releases
   every video element and texture.
3. **Fewer layers per slot.** Ten layers on one wall mean ten decoders open at once. Anything that
   belongs together permanently should be pre-rendered into one file and used as a single layer.
4. **Test with shorter loops.** Render 20 seconds first via `rangeSec`; memory does not depend on
   length, but a failed attempt then costs minutes instead of hours.
5. **Check disk space.** A full swap file looks exactly like too little RAM. `npm run doctor` shows
   the free space on the output drive.

---

## Where it comes from

Theater-Bild-Gelöte grew out of one specific production: the theatre of a cruise ship with four LED walls, each
built from four sections that travel towards and away from centre stage during the show. The content
had to work in both states, every section needed its own exactly matching file, and the media server
wanted HAP. The tool grew out of those three requirements.

None of that origin is baked in. The house lives entirely in a venue file, and the one that ships
with the tool is nothing more than a thorough example. If you feed a single wall of two sections in
an exhibition hall, a fixed upstage wall or a ring of six surfaces, you write your own venue and use
the same tool.

---

## Further reading

- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — the production procedure as a checklist, with the decision points
- [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) — how the program is built and where to extend it
- [`docs/GITHUB.md`](docs/GITHUB.md) — what belongs in the repository and what never does
- [`docs/OFFENE-PUNKTE.md`](docs/OFFENE-PUNKTE.md) — everything the tool assumes rather than knows
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributing, extending, translating
- [`shared/API.md`](shared/API.md) — the HTTP contract
- [`shared/model.js`](shared/model.js) — the data model

Licence: MIT, see [`LICENSE`](LICENSE).

*The German documentation is the source; this English version is kept in step with it.*
