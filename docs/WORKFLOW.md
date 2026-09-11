# Produktionsablauf

Von Rohmaterial bis Auslieferung. Die Reihenfolge ist nicht beliebig — jeder Schritt setzt voraus,
dass der vorige sauber abgeschlossen ist.

Punkte mit **[HAUS]** sind Entscheidungen, die nicht am Schreibtisch fallen. Sie brauchen eine
Antwort von der Technik des Hauses, für das produziert wird (Haustechnik, Videoabteilung,
Produktionsleitung — je nachdem, wer den Mediaserver verantwortet). Wer sie überspringt, merkt den
Fehler im günstigen Fall beim Testrender und im ungünstigen erst auf der Bühne.

Alle Zahlenbeispiele stammen aus dem mitgelieferten Beispiel-Venue: eine Wand von 2736 × 1224 aus
vier Teilen (648 · 720 · 720 · 648), 30 fps und nominal 4 mm Pitch. HAP Q ist das gewählte
Beispielpreset; der TUI-Videoguide nennt MPEG-2 oder HAP, ohne die HAP-Variante festzulegen.
Für ein anderes Haus ändern sich die Zahlen, nicht der Ablauf.

---

## Phase 0 — Vor allem anderen

- [ ] `npm run doctor` läuft durch: Node, ffmpeg, ffprobe, die gebrauchten Encoder,
      Arbeitsverzeichnis, Venue-Dateien, freier Plattenplatz. Fehlt der Encoder des Lieferformats
      (meist `hap`), ist keine Auslieferung möglich — und das merkt man sonst erst am Rendertag.
- [ ] **Venue vollständig.** Wände, Panelaufteilung, Pixel- und Metermaße, Pixelpitch, Bildrate,
      Sperrzonen, Fahrwege, Delivery-Presets. Alles, was geschätzt ist, steht als Klartext in
      `assumptions`, und `stage.verified` bleibt `false`, bis es nachgemessen ist. Anlegen in der
      Ansicht Venue oder direkt als JSON in `config/venues/`.
- [ ] **Arbeitsverzeichnis** liegt auf einer Platte mit genug Platz. Faustregel: das Dreifache der
      erwarteten Liefermenge, weil Rohmaterial, Zwischenstände und Ausgaben nebeneinander liegen.
- [ ] **Looplänge festgelegt** und im Projekt eingetragen (`loopSeconds`). Sie bestimmt alles
      Weitere — Framezahl, Datenmenge, Rechenzeit.
- [ ] **[HAUS] Datenrate und Plattenplatz geklärt.** Vor der Produktion, nicht danach. Die Rechnung
      steht unten; die Antwort kann die Looplänge oder das Codec ändern.
- [ ] **[HAUS] Gemeinsamer Timecode oder nicht?** Werden alle Flächen framegenau zusammen
      gestartet, oder muss jede für sich sauber loopen? Davon hängt ab, ob die Flächen
      unterschiedlich lange Loops haben dürfen.
- [ ] **[HAUS] Padding-Konvention.** Manche Häuser verlangen einen Export, der von der nativen
      Auflösung abweicht (etwa zwei Pixel höher, unten schwarz aufgefüllt), weil ihr Mediaserver so
      eingerichtet ist. Das ist keine technische Notwendigkeit, sondern eine Hauskonvention — und
      sie kostet einen kompletten Neurender, wenn sie erst nach der Lieferung auftaucht.
- [ ] **[HAUS] Verbindliche Randvorgaben prüfen.** Gibt es Sicherheitszonen, Logoplätze oder eine
      Letterbox-Vorgabe? Die voreingestellten 15 % sind Kompositionshilfen der Software und keine
      belegte TUI-Vorgabe.

### Datenmenge ausrechnen

```
Bytes je Frame   = Breite × Höhe × bytesPerPixel
Bytes je Sekunde = Bytes je Frame × Bildrate
```

HAP verwendet 0,5 Byte/Pixel, HAP Q und HAP Alpha jeweils 1 Byte/Pixel für die Texturdaten vor
zusätzlicher Snappy-Kompression. Die [HAP-Spezifikation](https://github.com/Vidvox/hap/blob/master/documentation/HapVideoDRAFT.md)
beschreibt diese zweite Kompressionsstufe. Die tatsächlichen Dateien können dadurch kleiner sein.
Für ProRes 422, ProRes 4444 Alpha und H.264 dienen 0,62, 1,4 und 0,02 Byte/Pixel als grobe
Planungswerte. Bei einem MPEG-2-Preset mit `-b:v 80M` ergeben sich näherungsweise 10 MB/s;
ein fixer Byte-pro-Pixel-Wert beschreibt diese eingestellte Bitrate nicht zuverlässig.

Für das Beispiel-Venue bei 30 fps, A–D in HAP Q und Holo in HAP Alpha, vor Snappy-Kompression:

| Fläche | MB/Frame | MB/s | 2-min-Loop | 4-min-Loop |
|---|---|---|---|---|
| A 2592×1512 | 3,92 | 117,6 | 14,1 GB | 28,2 GB |
| B 1440×1224 | 1,76 | 52,9 | 6,3 GB | 12,7 GB |
| C 1440×1224 | 1,76 | 52,9 | 6,3 GB | 12,7 GB |
| D 2736×1224 | 3,35 | 100,5 | 12,1 GB | 24,1 GB |
| Holo 1920×1200 Alpha | 2,30 | 69,1 | 8,3 GB | 16,6 GB |
| **Summe** | | **393 MB/s** | **ca. 47,1 GB** | **ca. 94,3 GB** |

Die Tabelle ist eine Planungsgröße. Die tatsächliche Leserate muss mit repräsentativem Inhalt am
Mediaserver geprüft werden; zusätzlich ausgegebene Paneldateien benötigen weiteren Speicher.
Kürzere Loops reduzieren die Dateimenge, aber nicht die Datenrate pro Sekunde. Ein anderes
Codec oder ein sparsameres Preset kann die Datenrate senken und muss zum Wiedergabesystem passen.

---

## Phase 1 — Rohmaterial sichten

- [ ] Ansicht **Bibliothek**, Quellordner scannen. Jede Datei wird mit ffprobe analysiert.
- [ ] Hinweisspalte durchgehen. Interessant sind vier Dinge: Bildrate ≠ Zielrate, Auflösung passt
      nicht zum Zielslot, Alpha vorhanden, wo keins hingehört, Farbbereich `pc` statt `tv`.
- [ ] Alles markieren, **Proxies erzeugen**. Ohne Proxy bleiben Editor und 3D-Ansicht schwarz — der
      Browser kann HAP, ProRes und MPEG-2 nicht dekodieren.
- [ ] Material, das offensichtlich nicht taugt (zu klein, zu kurz, falsches Seitenverhältnis), jetzt
      aussortieren, nicht erst im Editor.

**Entscheidungspunkt: hochskalieren oder neu beschaffen?**
Ein Clip mit 1920 px Breite auf einem 720 px breiten Panel ist unkritisch — er wird kleiner. Ein
Clip mit 1280 px Breite auf einer 2736 px breiten Wand als Vollbild muss um Faktor 2,1
hochskaliert werden und sieht auf feinem Pitch matschig aus. Dann lieber neu rendern oder neu
beschaffen. Als Faustregel: Der Skalierungsfaktor nach oben sollte 1,3 nicht überschreiten, und was
über 1,5 liegt, sieht man.

---

## Phase 2 — Angleichen (Conform)

Ziel: Alle Quellen laufen auf der Zielbildrate und haben dieselbe Framezahl.

- [ ] Betroffene Dateien markieren, **Conform**.
- [ ] Zielrate = `fps` des Venues.
- [ ] fps-Modus wählen (siehe Tabelle).
- [ ] Dauer angleichen: `syncToMediaId` auf den Leitclip setzen oder `durationSec` von Hand, dazu
      passenden `durationMode`.
- [ ] Ergebnis in der Bibliothek prüfen: Framezahl muss exakt `Looplänge × Bildrate` sein.

### Welcher fps-Modus wann

| Modus | ffmpeg | Wann |
|---|---|---|
| `resample` | `fps=<ziel>` | **Standard.** 25 → 30, 24 → 30. Frames werden gedoppelt, das Bild selbst wird nicht angefasst. Bei ruhigen Bildern unsichtbar. |
| `duplicate` | identisch zu `resample` | Wenn im Log ausdrücklich stehen soll, dass gedoppelt wurde. Nur eine Benennung, kein anderes Ergebnis. |
| `interpolate` | `minterpolate` | Nur bei schnellen, gleichmäßigen Kamerafahrten, wo das Doppeln als Ruckeln sichtbar wird. Langsam (Faktor 20 bis 50) und macht bei Neon, Regen, Partikeln und Gitterstrukturen zuverlässig Artefakte. **Immer erst an fünf Sekunden testen.** |
| `retime` | `setpts` | Wenn der Clip schneller oder langsamer laufen soll und kein Frame erfunden werden darf. 25-fps-Material auf 30 fps ergibt eine um 20 % schnellere Bewegung. Nur bei abstraktem Material, nie bei etwas mit erkennbarem Tempo. |

### Welcher Dauer-Modus wann

| Modus | Wann |
|---|---|
| `trim` | Quelle ist länger als der Loop. Standardfall. |
| `loop` | Quelle ist kürzer und läuft in sich sauber durch. Achtung: Die Naht der Quelle wird dann mehrfach sichtbar. |
| `padBlack` | Quelle ist kürzer und soll danach schwarz sein. Nur sinnvoll, wenn das Bild ohnehin ausblendet. |
| `padFreeze` | Quelle ist kürzer und der letzte Frame steht. Fällt auf LED sofort auf. Notlösung. |
| `none` | Nichts anfassen. Nur, wenn die Länge schon stimmt. |

---

## Phase 3 — Layout: Master oder Einzelpanels

**Der wichtigste Entscheidungspunkt im ganzen Ablauf.**

| Fall | Slot | Beispiel |
|---|---|---|
| Ein durchgehendes Bild über die ganze Wand | `master` | Eine Wand als Vollbild — Himmel, Skyline, Tiefe. |
| Eigenständige Bilder nebeneinander | die Panel-Slots | Vier Einzelclips, die auch dann noch funktionieren, wenn die Teile auseinanderstehen. |
| Grundbild plus Ergänzung auf einzelnen Teilen | `master` **und** Panel-Slots | Durchgehender Himmel auf `master`, darüber auf zwei Panels ein Neonschild. Panel-Layer liegen immer über dem Master. |

Für jede Wand, die im Betrieb auffährt, gilt: **randgewichtet aufbauen** — Detail und Architektur in
den äußeren Dritteln, Mitte ruhig. Geschlossen ergibt das eine Front, geöffnet einen linken und
einen rechten Rahmen um das, was dahinter steht.

Und die Regel, die alles andere übersteuert: **kein bildtragendes Motiv über der Mittelnaht.** Wo
sie liegt, steht im Venue als `centerSeamX` (im Beispiel-Venue bei 1368 bzw. 1296 bzw. 720).

Ablauf:

- [ ] Ansicht **Editor**, Wand wählen, Slot wählen, Layer anlegen.
- [ ] Zeit setzen: `startSec` für den zeitlichen Aufbau, `inSec`/`outSec` für den Ausschnitt aus der
      Quelle. Drei Clips auf `master` mit `startSec` 0 / 15 / 30 ergeben ein durchgehendes Video aus
      drei Teilen.
- [ ] Zuschnitt und Position setzen. `cover` ist der Standard und schneidet über; wo das zu viel
      wegnimmt, den Zuschnitt von Hand legen.
- [ ] Helligkeit, Kontrast und Sättigung der Nachbarclips angleichen.
- [ ] An den Panelkanten eine weiche Kante setzen, wo der Übergang hart wirkt. 12 bis 24 Pixel
      reichen meistens.
- [ ] **Projekt prüfen** (`GET /api/project/validate`). Alle `error` müssen weg sein, alle `warn`
      bewusst entschieden.

---

## Phase 4 — In der 3D-Ansicht prüfen

Jedes Bild muss in **zwei Zuständen** funktionieren. Das prüft nur diese Ansicht.

- [ ] Ansicht **Bühne 3D**, Kamera aus der Zuschauermitte.
- [ ] **Geschlossen** (`travel` = 0): durchgehendes Bild, keine Helligkeitsstufe an den Nähten, kein
      Versatz.
- [ ] **Aufgefahren** (`travel` = 1): Was passiert mit dem Motiv über der Mittelnaht? Was sieht man
      durch die Öffnung? Steht dort auf der dahinterliegenden Fläche etwas Sinnvolles?
- [ ] **Zwischenstellungen.** Der hässlichste Moment ist selten offen oder zu, sondern irgendwo
      dazwischen.
- [ ] Andere Kamerapositionen prüfen — Rang, Seitenplatz. Von der Seite verdecken vordere Flächen
      große Teile der hinteren; was dort komponiert wurde, ist für einen Teil des Publikums nie zu
      sehen.
- [ ] Sperrzonen einblenden: Liegt in den äußeren Prozenten etwas, das nicht fehlen darf?
- [ ] Nähte und Drahtgitter zur Kontrolle, ob die Panelgrenzen dort liegen, wo sie liegen sollen.

Was in der 3D-Ansicht zu sehen ist, ist nur so belastbar wie die Geometrie im Venue. Solange
`stage.verified` auf `false` steht, ist die Parallaxe eine Planungshilfe. Die Track-Abstände des
Beispiel-Venues stammen aus der bemaßten Skizze auf Seite 8; Portal, Publikum, Fahrwege und
Aufhängung benötigen weiterhin ein Aufmaß. Siehe `docs/OFFENE-PUNKTE.md`.

---

## Phase 5 — Testrender und Freigabe [HAUS]

**Der wichtigste Punkt des ganzen Ablaufs.** Vor dem Vollrender geht ein Muster ans Haus.

- [ ] Ansicht **Render**, eine repräsentative Wand, `rangeSec` auf 20 Sekunden, Lieferpreset.
- [ ] Erst **Trockenlauf**. Die Kommandozeile lesen und kontrollieren: Bildrate, `-fps_mode cfr`,
      `-frames:v` gleich der Sollframezahl, Codec-Argumente des Presets.
- [ ] Rendern, QC laufen lassen (Phase 7), erst dann verschicken.
- [ ] Muster ans Haus. Konkret zu prüfen sind fünf Dinge, und keines davon lässt sich am Monitor
      beurteilen:
      1. **Banding in dunklen Verläufen.** Große dunkle Flächen sind auf LED die schwerste Übung.
         Wenn es bandet, kann Dithering helfen — billig zu prüfen, teuer, wenn der Vollrender schon
         abgeschlossen ist.
      2. **Schwarzwert.** Viele Panels heben Schwarz an; Silhouetten leben davon, dass Schwarz
         wirklich schwarz ist.
      3. **Moiré** an feinen Strukturen — Streben, Gitter, Geländer, feine Schrift.
      4. **Helligkeit gesättigter Farben.** Neon wirkt auf dem Monitor stimmig und auf der Wand
         regelmäßig brutal zu hell.
      5. **Flackerfrequenz** gegen die Kamerarate, falls die Show mitgeschnitten wird.
- [ ] **Nicht weitermachen, bis die Rückmeldung da ist.** Ein Vollrender ohne Freigabe des Musters
      ist im schlechtesten Fall zweistellig viele Gigabyte Ausschuss und ein Tag Rechenzeit.

---

## Phase 6 — Vollrender

- [ ] **[HAUS] Welches Preset?** Die konkrete HAP-Variante, Datenrate und das Format des Backups
      abstimmen. HAP Q braucht vor Snappy doppelt so viele Texturdaten wie HAP.
- [ ] **[HAUS] Werden Einzelpanels gebraucht?** Wenn die Regie die Teile getrennt bespielen will,
      *Auch Panels* anhaken. Die Panels entstehen dann per Crop im selben Durchlauf und sind
      garantiert deckungsgleich mit dem Master. Nachträglich aus einer fertigen Datei zu schneiden
      geht auch (`fromMaster`), kostet aber eine zweite Kompressionsstufe.
- [ ] Wände rendern. Die auffälligste Fläche zuerst ist praktisch, weil dort Probleme am ehesten
      auffallen.
- [ ] **Achtung bei pixelidentischen Flächen.** Zwei Wände mit derselben Auflösung sind nach dem
      Render nicht mehr unterscheidbar; der Dateiname ist das einzige Merkmal. Einmal ausdrücklich
      kontrollieren.
- [ ] Flächen mit Transparenz separat rendern, mit einem Alpha-Preset.
- [ ] Backup-Fassung in einem zweiten Codec, wenn das Haus oder das eigene Archiv sie verlangt.

### Codec-Wahl auf einen Blick

| Familie | Wofür | Bemerkung |
|---|---|---|
| HAP Q | LED-Delivery nach Formatabstimmung | Arbeitsvorgabe des Beispiels; 1 Byte/px vor Snappy. |
| HAP | LED-Delivery | Vom TUI-Guide neben MPEG-2 genannt; 0,5 Byte/px vor Snappy. |
| HAP Alpha | Flächen mit Transparenz | Im TUI-Guide für Alpha genannt; 1 Byte/px vor Snappy. |
| ProRes 422 | Backup und Weiterverarbeitung | Nicht als Lieferformat an ein Haus, das HAP erwartet. |
| ProRes 4444 Alpha | Backup mit Transparenz | Groß, aber verlustarm. |
| MPEG-2 | Alternative, wo HAP nicht geht | Datenrate **vor** der Produktion abstimmen. |
| H.264 | Freigabe und Ansicht; Delivery nur bei entsprechender Hausvorgabe | Für die Theater-Wände A–D nicht als Lieferformat vorgegeben; ScreenBand nutzt laut Guide H.264/MP4. |

---

## Phase 7 — QC

Ansicht **QC**, Datei wählen, alle Checks laufen lassen. Pflicht für jede Datei, die das Haus
verlässt, auch für das Testmuster.

| Check | Was ein Fehlschlag bedeutet |
|---|---|
| `frameCount` | Framezahl ≠ Looplänge × Bildrate. Fast immer ein Layer, der kürzer ist als der Loop. |
| `specCompliance` | Auflösung, Bildrate, Codec oder `pix_fmt` weichen von der Venue-Spec ab. **Immer ein Ausschlusskriterium.** |
| `loopSeam` | Frame 0 und letzter Frame sind identisch → doppelter Frame → sichtbares Stocken bei jedem Durchlauf. `dropDuplicateEndFrame` prüfen. |
| `seamContent` | Bildtragendes Motiv über einer Panelnaht. Reißt beim Auffahren auseinander. |
| `safeArea` | Wichtiges liegt in den Sperrzonen. |
| `blackLevel` | Schwarz ist nicht schwarz, oder Spitzen sind zu hell. |
| `banding` | Stufen in dunklen Verläufen. Dither im Layer einschalten und neu rendern. |
| `moire` | Hochfrequenz nahe der Grenze des Pixelpitches. Feine Strukturen leicht weichzeichnen. |
| `flicker` | Frequenz, die mit dem Kamerashutter schlagen kann. |
| `contactSheet` | Kein Prüfkriterium, sondern ein Beleg: eine Bildreihe über den Loop, gut für Freigaben. |

- [ ] Alle `fail` beseitigt.
- [ ] Alle `warn` bewusst entschieden und in `notes` im Projekt vermerkt.
- [ ] Bei jeder Neuberechnung: QC neu laufen lassen, nicht das alte Ergebnis annehmen.

Ein `skip` ist kein Erfolg. Er heißt, dass der Check seine Voraussetzung nicht hatte — meist eine
fehlende Angabe im Projekt oder eine Datei, die ffprobe nicht lesen konnte. Die Begründung steht in
der Meldung.

---

## Phase 8 — Ausliefern

- [ ] **Dateinamen kontrollieren.** Das Schema kommt aus `delivery.namePattern` des Venues, etwa
      `{WALL}_{W}x{H}_{FPS}p_{CODEC}`. Wand, Auflösung und Codec stehen im Namen, weil auf dem
      Mediaserver mehrere Fassungen nebeneinanderliegen.
- [ ] **Gegenprobe mit ffprobe**, unabhängig vom Werkzeug:

```
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt \
        -of default=nw=1 out/<datei>.mov
```

Muss zeigen: das erwartete Codec, die Wandmaße, die Bildrate als exakten Bruch (`30/1`) und die
Framezahl exakt `Looplänge × Bildrate`.

- [ ] **Pixelidentische Flächen ein zweites Mal kontrollieren.** Im Zweifel den ersten Frame beider
      Dateien nebeneinanderlegen.
- [ ] **Vollständigkeit**: jede Fläche im Lieferformat, dazu Alpha-Flächen, Backups und die
      Einzelpanels, falls bestellt.
- [ ] **Ablage**: lokale Platte, Backup, Auslieferung — drei getrennte Wege, siehe
      `docs/GITHUB.md`. Kein Video ins Repository.
- [ ] **Projektdatei committen** und den Stand markieren (`git tag lieferung-<datum>`). Das ist der
      Stand, aus dem sich jede gelieferte Datei wiederherstellen lässt — die eigentliche
      Absicherung.
- [ ] **Kurzes Übergabeprotokoll**: welche Dateien, welche Looplänge, welches Codec, welche `warn`
      aus dem QC bewusst stehen geblieben sind.

---

## Vor dem nächsten Projekt

- [ ] Was im Haus nachgemessen wurde, ins Venue eintragen und `stage.verified` auf `true` setzen.
- [ ] Beantwortete `openQuestions` aus dem Venue entfernen, mit der Antwort in der Commit-Nachricht.
- [ ] Was sich als Konvention des Hauses herausgestellt hat (Padding, Datenrate, Namensschema), als
      Delivery-Preset festschreiben — dann muss es niemand noch einmal herausfinden.

Die Liste dessen, was das Werkzeug annimmt statt weiß, steht in `docs/OFFENE-PUNKTE.md`.
