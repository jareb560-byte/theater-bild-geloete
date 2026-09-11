# Offene Punkte

Alles, was das Werkzeug **annimmt** statt weiß. Jeder Punkt ist eine Stelle, an der eine Zahl
gesetzt oder eine Grenze gezogen wurde, weil ohne sie nichts rechnen kann — nicht, weil sie belegt
wäre.

Die Datei hat zwei Teile, und sie sind streng getrennt:

- **Teil A — gilt für jeden Nutzer.** Grenzen des Werkzeugs selbst und die Fragen, die jedes Haus
  beantworten muss. Wer Theater-Bild-Gelöte benutzt, liest diesen Teil.
- **Teil B — gilt nur für das Beispiel-Venue `mein-schiff-theater`.** Die konkreten Annahmen der
  Produktion, aus der das Werkzeug entstanden ist. Für ein anderes Haus ist das höchstens eine
  Vorlage dafür, welche Art von Frage man stellen sollte.

Maschinenlesbar steht all das im jeweiligen Venue unter `assumptions` und `openQuestions`; jede Wand
trägt zusätzlich `stage.verified` — dieses Feld gehört auf `true`, sobald die Geometrie bestätigt
ist.

---

# Teil A — gilt für jeden Nutzer

## A1. Eine Bildrate und eine Looplänge für das ganze Projekt

**Angenommen:** Alle Flächen eines Projekts laufen mit derselben Bildrate (`project.fps`, aus dem
Venue) und derselben Looplänge (`project.loopSeconds`).

**Warum:** Das ist der Fall, in dem Flächen gemeinsam gestartet werden können. Unterschiedliche
Längen nebeneinander sind möglich, aber sie brauchen entweder einen gemeinsamen Vielfachen oder
einen Mediaserver, der jede Fläche für sich loopen lässt.

**Wenn es nicht passt:** Muss jede Fläche für sich loopen und mit anderer Länge, ist das gemeinsame
`loopSeconds` eine unnötige Einschränkung — dann braucht es pro Wand ein eigenes Projekt oder eine
Modelländerung in `shared/model.js`. Der umgekehrte Fall ist gefährlicher: Wird gemeinsam gestartet
und eine Fläche ist einen einzigen Frame länger, laufen die Flächen mit jedem Durchlauf weiter
auseinander. Deshalb prüft der QC-Check `frameCount` hart gegen `Looplänge × Bildrate`.

## A2. Wände sind Rechtecke, senkrecht geteilt

**Angenommen:** Eine Wand ist ein Rechteck, ihre Panels sind nebeneinander angeordnet, jedes Panel
ist so hoch wie die Wand, und die Panelbreiten summieren sich lückenlos auf die Wandbreite.

**Warum:** Das deckt bewegliche LED-Wände ab, wie sie im Bühnenbetrieb gebaut werden, und macht die
gesamte Geometrie zu einer einzigen Zahlenreihe.

**Wenn es nicht passt:** Übereinandergestapelte Panelreihen, L-förmige Flächen, gebogene Wände oder
gegeneinander verdrehte Segmente lassen sich mit diesem Modell nicht abbilden. Ein Ausweg ist,
solche Flächen als **mehrere Wände** zu definieren; die Panelaufteilung innerhalb einer Wand bleibt
aber eindimensional. `server/venues.js` meldet jede Lücke und jede Überlappung beim Laden, weil
sonst jede Panel-Datei falsch geschnitten wäre.

## A3. Fahrwege: nach außen, symmetrisch

**Angenommen:** Die Teile fahren waagerecht nach außen, die linke Hälfte nach links, die rechte nach
rechts, um die Mitte freizugeben. `travelMode` kennt `2+2` (beide Teile einer Hälfte fahren gleich
weit) und `4x` (Außenteile fahren weiter als Innenteile). Der maximale Weg ist
`stage.travelMaxM`, im Zweifel die halbe Wandbreite.

**Wenn es nicht passt:** Flächen, die hochfahren, kippen, schwenken oder auf einer Kurve laufen,
bildet die 3D-Ansicht nicht ab. Einzelne Teile lassen sich über
`walls.<id>.slots.<panelId>.travelOverrideM` auf einen festen Meterwert setzen; damit sind auch
asymmetrische Stellungen darstellbar, aber keine anderen Bewegungsarten. **Die Lieferdateien sind
davon nie betroffen** — der Fahrweg ist reine Vorschau.

## A4. Die Vorschau ist eine Näherung, der Render ist die Wahrheit

**Angenommen:** Was Editor und 3D-Ansicht zeigen, entspricht dem, was ffmpeg rendert.

**Warum:** Beide arbeiten mit denselben Zahlen aus demselben Modell.

**Wenn es abweicht:** Der Browser spielt H.264-Proxies ab, nicht die Originale; Skalierung,
Mischmodi, weiche Kanten und Bildkorrektur rechnet die Grafikkarte nicht bitgenau so wie ffmpeg;
ein Farbmanagement gibt es weder hier noch dort. Für Layout, Ausschnitt, Nähte und Timing ist die
Vorschau belastbar. Für Banding, Schwarzwert, Moiré und Spitzenhelligkeit ist sie es nicht — das
entscheidet der Testrender auf der echten Wand (Phase 5 in `docs/WORKFLOW.md`).

## A5. Ein Projekt, ein Rechner, kein Mehrbenutzerbetrieb

**Angenommen:** Es läuft eine Instanz mit genau einem geöffneten Projekt, und niemand ändert dieselbe
Projektdatei gleichzeitig von woanders. Der Server bindet fest auf `127.0.0.1:7333`.

**Wenn es nicht passt:** Zwei gleichzeitig laufende Instanzen auf demselben Arbeitsverzeichnis
überschreiben sich gegenseitig den Autosave. Wer zu zweit an einer Show arbeitet, teilt sich die
Arbeit über getrennte Projektdateien und führt sie über die Versionsverwaltung zusammen — die
Projektdatei ist Text und lässt sich vergleichen (siehe `docs/GITHUB.md`).

## A6. Kein Ton

**Angenommen:** Es geht ausschließlich um Bild. Alle Delivery-Presets enthalten `-an`, und die
Tonspuren einer Quelle werden zwar gemeldet (`probe.audioStreams`), aber nie verarbeitet.

**Wenn es nicht passt:** Ton läuft im Bühnenbetrieb praktisch immer über einen anderen Weg. Wer ihn
doch in der Lieferdatei braucht, muss ihn nachträglich mit ffmpeg dazumultiplexen.

## A7. Die Größenabschätzung ist eine Planungshilfe

**Grundlage:** HAP (BC1/DXT1) verwendet 0,5 Byte/Pixel, HAP Q (YCoCg-BC3/DXT5) und
HAP Alpha (BC3/DXT5) jeweils 1 Byte/Pixel. Das beschreibt die Texturdaten vor zusätzlicher
Snappy-Kompression, nicht die garantierte Dateigröße. Die HAP-Varianten werden im Werkzeug
aus dem Encoderformat erkannt, sodass ein alter falscher Preset-Schätzwert korrigiert wird.

**Ungewiss:** Kompression und Container-Overhead hängen vom Inhalt und Export ab. Für ProRes
und H.264 sind die Byte-pro-Pixel-Werte grobe Näherungen. MPEG-2 wird über eine Zielbitrate
gesteuert; beispielsweise entsprechen 80 Mbit/s ungefähr 10 MB/s.

**Prüfen:** Nach einem repräsentativen Testrender Dateigröße und Wiedergabe am Mediaserver
messen. Kürzere Loops verringern die Dateimenge, nicht die Datenrate pro Sekunde.

## A8. Pixelpitch und Metermaße sind gerundet

**Angenommen:** `pixelPitchMm` und die Metermaße der Wände passen zueinander.

**Warum:** In Herstellerunterlagen sind die Metermaße üblicherweise auf Zentimeter gerundet.
Rechnet man Pixel gegen Meter, kommt selten genau der Nennpitch heraus.

**Wenn es abweicht:** Für die Lieferdateien bedeutet es **nichts** — dort zählt nur die Pixelzahl.
Für die 3D-Ansicht können kleine geometrische Abweichungen entstehen. Relevant wird es nur, wenn
Flächen mit unterschiedlichem Pitch bündig zusammenpassen sollen; dann lieber nachmessen, als
nachrechnen.

## A9. Übersetzungen fallen auf Deutsch zurück

**Angenommen:** Deutsch ist vollständig, Englisch ist eine Übersetzung, weitere Sprachen gibt es
nicht.

**Wenn etwas fehlt:** Ein nicht übersetzter Text erscheint auf Deutsch — sichtbar, aber nicht
kaputt. Neue Texte im Code brauchen ihren englischen Eintrag im `register()`-Aufruf des jeweiligen
Moduls, sonst bleibt die englische Oberfläche stellenweise deutsch. Wie man das ergänzt, steht in
`CONTRIBUTING.md`.

## A10. ffmpeg ist Sache des Rechners, nicht des Projekts

**Angenommen:** Auf dem Rechner ist ein ffmpeg vorhanden, das die Encoder des gewählten
Delivery-Presets kann.

**Wenn es nicht stimmt:** Der häufigste Fall ist ein ffmpeg **ohne** `hap` — verbreitet bei
Paketinstallationen auf allen Betriebssystemen. Dann läuft alles außer der Auslieferung. `npm run
doctor` und die Einrichtungsansicht zeigen die Encoder einzeln an; die Prüfung gehört an den Anfang
jedes Projekts, nicht ans Ende.

---

## A11. Was jedes Haus beantworten muss

Diese sechs Fragen kann kein Werkzeug beantworten. Sie sind in `docs/WORKFLOW.md` mit **[HAUS]**
markiert, und sie gehören in die `openQuestions` des eigenen Venues, bis die Antwort da ist.

| Frage | Blockiert | Was passiert ohne Antwort |
|---|---|---|
| Verlangt das Haus eine Padding-Konvention (Export abweichend von der nativen Auflösung)? | Vollrender | Die Datei hat die falsche Höhe, der Mediaserver skaliert sie, die Pixelzuordnung zur Wand ist nicht mehr 1:1. Teuerster Fehler überhaupt. |
| Welche Datenrate und wie viel Plattenplatz verkraftet der Mediaserver? | Looplänge und Codec | Die Wiedergabe ruckelt oder Layer fallen aus — im laufenden Betrieb, nicht im Test. |
| Gemeinsamer Timecode über alle Flächen, oder loopt jede für sich? | Looplängen-Konzept | Bei gemeinsamem Start reicht ein Frame Unterschied, damit die Flächen mit jedem Durchlauf auseinanderlaufen. |
| Welches Lieferformat genau — und gibt es eine Obergrenze für Dateigrößen? | Vollrender | Neurender des Encode-Schritts, wenn es das falsche war. |
| Was bedeutet die Sperrzone am Rand: Sicherheitszone, Logoplatz oder Streckfläche? | Layout | Entweder wird Fläche verschenkt, oder es fehlt genau dort etwas. |
| Welche Öffnungspositionen werden in der Show tatsächlich gefahren? | Prüfung in der 3D-Ansicht | Das Layout ist auf einen Zustand hin optimiert, der nie eintritt. |

Dazu kommt die Geometrie für die räumliche Vorschau: Abstand der Flächen zueinander (`stage.z`),
Höhe der Unterkante über dem Boden (`stage.floorOffsetM`) und der maximale Fahrweg
(`stage.travelMaxM`). Solange die geschätzt sind, bleibt `stage.verified` auf `false` — die
Lieferdateien sind davon nicht betroffen, die Beurteilung von Tiefe und Parallaxe schon.

---

# Teil B — gilt nur für das Beispiel-Venue `mein-schiff-theater`

Quelle für die belegten Werte: der Videoguide des Hauses, Version 1.3 vom 24. März 2026,
Entertainment Technology. Der Dateiname enthält ein abweichendes Datum; maßgeblich ist der
Dokumentstand auf den Seiten. Die folgenden Punkte unterscheiden Quellenangaben und Annahmen. Für jedes andere Haus sind diese Punkte gegenstandslos; sie bleiben als
Beispiel dafür stehen, wie sauber getrennt gehört, was man weiß, und was man annimmt.

Die Punkte B1 bis B4 und B9 betreffen nur die 3D-Vorschau. B5 bis B8 betreffen die Lieferdateien
selbst und sollten vor einem Vollrender geklärt sein.

## B1. Z-Abstände der Wände

**Aus der Skizze:** Seite 8 zeigt A→B = 1,6, B→C = 2,7 und C→D = 2,6. Als Meter
interpretiert und auf A = 0 bezogen ergeben sich **A = 0 · B = 1,6 · C = 4,3 · D = 6,9 m**.
Die frühere Aussage, der Guide enthalte keine Tiefenmaße, war falsch.

**Noch offen:** Die Skizze nennt die Einheit nicht ausdrücklich. Einheit und Bezug müssen mit
einem Aufmaß bestätigt werden. A = 0 ist der Modellursprung und nicht automatisch die
Bühnenkante. Die Abstände bestimmen Verdeckung und Parallaxe; die Pixelraster der
Lieferdateien bleiben unverändert. → `stage.z` pro Wand; `stage.verified` bleibt `false`.

## B2. floorOffsetM — Unterkante der Wände

**Angenommen:** 0 für alle vier Wände, also Unterkante auf dem Bühnenboden.

**Noch offen:** Der Guide nennt Wandhöhen, aber keine verlässlichen Unterkanten über dem
Bühnenboden. Daraus lässt sich keine gemeinsame Aufhängungshöhe ableiten. Eine abweichende
Unterkante verschiebt Motive wie Horizonte oder Fensterreihen in der räumlichen Vorschau.
→ `stage.floorOffsetM` pro Wand.

## B3. travelMaxM — wie weit die Teile fahren

**Angenommen:** halbe Wandbreite. A = 5,20 m · B = 2,88 m · C = 2,88 m · D = 5,45 m. Der Videoguide
beschreibt horizontale Bewegung, nennt aber keine numerischen Fahrwege oder Parkkoordinaten.

**Wenn es falsch ist:** Fahren die Teile weniger weit, ist die Vorschau pessimistisch — unkritisch.
Fahren sie weiter oder asymmetrisch, reißt beim Auffahren mehr vom Motiv auseinander als erwartet.
→ `stage.travelMaxM` pro Wand, für einzelne Teile `travelOverrideM` im Projekt.

## B4. Holo — Position und Metermaß

**Angenommen:** z = −1,5 m (also vor Wand A, im Portal), 7,65 m × 4,78 m, `floorOffsetM = 0`.
Belegt sind nur 1920 × 1200 und "Portal-Mitte, Gaze".

**Wenn es falsch ist:** Die halbtransparente Fläche steht in der Vorschau an der falschen Stelle,
und damit stimmt jede Beurteilung darüber, was durch sie hindurch noch zu sehen ist. Die
Lieferdatei bleibt 1920 × 1200 mit Alpha. Anders als bei den LED-Wänden ist das eine **Projektion**;
die Pitch-Rechnung gilt hier ausdrücklich nicht. → `holo.stage`.

## B5. Padding-Konvention beim HAP-Export

**Arbeitsvorgabe für A–D:** native Auflösung ohne Padding. Ihre Kantenlängen passen zum
4×4-Blockraster der HAP-Texturkompression.

**Belegt für Blaue Flora:** Seite 11 verlangt 2070 × 1532 für den HAP-Export statt der nativen
2070 × 1530. Eine Vorschrift, auf welcher Seite zusätzliche Pixel einzufügen sind, steht dort
nicht. Diese gesonderte Angabe gilt nicht automatisch für die Theater-Wände A–D.

**Noch offen:** Abweichungen vom nativen Raster nur nach Vorgabe der Haustechnik übernehmen.
→ `exportOverride` mit `width`, `height` und einer dokumentierten Begründung.

## B6. Datenrate und Plattenplatz

**Planungswert:** A–D in HAP Q plus Holo in HAP Alpha erzeugen bei 30 fps vor Snappy rund
**393 MB/s** Texturdaten und **94,3 GB** für vier Minuten. Das ist keine gemessene Leserate
und keine bestätigte Leistungsgrenze des Mediaservers. Die Tabelle steht in
`docs/WORKFLOW.md`, Phase 0.

**Noch offen:** Repräsentativen Testrender auf dem vorgesehenen System prüfen. Zusätzliche
Paneldateien benötigen weiteren Speicher. Kürzere Loops sparen Kapazität; bei zu hoher
Leserate müssen Codec, Preset oder Wiedergabekonzept angepasst werden.

## B7. HAP oder HAP Q, und gibt es eine Grenze für die Dateigröße?

**Belegt:** Der Guide verlangt für das Schiff .mov mit MPEG-2 oder HAP bei 30 fps;
für Alpha HAP Alpha. Das Berliner Backup ist .mov mit ProRes 422 beziehungsweise
ProRes 4444 Alpha.

**Arbeitsvorgabe:** HAP Q ist als Beispielpreset gewählt, im Guide aber nicht ausdrücklich
genannt. Die HAP-Variante, Datenrate und mögliche Dateigrößenlimits müssen mit dem Haus
abgestimmt werden. Ein höheres Qualitätsniveau ersetzt keinen Wiedergabetest.
→ `delivery.defaultPreset`.

## B8. Gemeinsamer Timecode über A–D?

**Angenommen:** Alle Flächen laufen gleich lang und werden gemeinsam gestartet; deshalb hat das
Projekt ein einziges `loopSeconds`. Der Videoguide beschreibt die Ansteuerung, sagt aber nichts über
Framegenauigkeit. Siehe A1. → `loopSeconds`, `dropDuplicateEndFrame`.

## B9. Öffnungspositionen der konkreten Show

**Angenommen:** Es wird von vollständig geschlossen bis vollständig geöffnet gefahren; die Vorschau
zeigt beide Endzustände und alles dazwischen stufenlos. Welche Positionen die Show tatsächlich
anfährt, ist eine Regie-Entscheidung und steht in keiner technischen Unterlage.

**Wenn es falsch ist:** Das Layout wurde auf einen Zustand hin optimiert, der nie eintritt — und der
Zustand, der eintritt, wurde nie geprüft. → keine Konfiguration, sondern eine Prüfhandlung in der
3D-Ansicht.

## B10. Bedeutung der 15-Prozent-Zonen

**Arbeitshilfe:** `safeAreaPct: 0.15` ist eine frei gewählte Kompositionshilfe der Software.
Der Videoguide nennt keine 15-Prozent-Sicherheitszone. Die grauen Balken der Beispielbilder
sind nicht als verbindliche Randvorgabe beschriftet.

**Noch offen:** Gibt das Haus tatsächlich Sicherheits-, Logo- oder Letterbox-Zonen vor?
Nur eine solche Vorgabe darf als verbindliche Einschränkung des Bildbereichs gelten.
15 Prozent von Wand D entsprechen rund 410 Pixeln je Seite. → `safeAreaPct` pro Wand.

## B11. Wand A — 6,00 m oder 6,05 m?

**Angenommen:** der Tabellenwert 6,00 m. Aus 1512 px bei 4 mm Pitch folgen rechnerisch 6,048 m; die
Metermaße im Videoguide sind gerundet.

**Wenn es falsch ist:** 48 mm auf 6 m, also 0,8 Prozent — in der Vorschau nicht zu sehen, für die
Lieferdateien ohne Bedeutung. Siehe A8. → `heightM` von Wand A.

## B12. bytesPerPixel der Presets

**Codec-Grundlage:** HAP = 0,5; HAP Q und HAP Alpha = 1 Byte/Pixel vor zusätzlicher
Snappy-Kompression. Die frühere Gleichsetzung von HAP und HAP Q war falsch.

**Grobe Näherungen:** ProRes 422 = 0,62, ProRes 4444 Alpha = 1,4 und H.264 = 0,02 Byte/Pixel.
MPEG-2 benötigt eine Planung über die konfigurierte Bitrate statt einer allgemeinen
Byte-pro-Pixel-Zahl. Siehe A7.

## B13. Portal, Bühnenraum und Publikum

**Angenommen:** Portalöffnung 11,60 × 7,00 m; Bühne 24 × 11 m; Zuschauerraum bis 19 m
Entfernung und 8,50 m seitlich. Kamerapositionen, Sitzreihen, Vorhänge und Beleuchtung sind
Teil der schematischen Vorschau. Der Guide enthält dafür kein ausreichendes Aufmaß.

**Folge:** Sichtgrenzen und der Eindruck des Zuschauerraums sind keine Vermessung des echten
Theaters. Für verbindliche Beurteilungen müssen der `house`-Block, Kameras und Aufhängung
an bestätigte Maße angepasst werden. `house.verified` bleibt bis dahin `false`.

---

## Zusammengefasst

**Für das Beispiel-Venue**, in der Reihenfolge der Dringlichkeit:

1. Padding beim HAP-Export für A/B/C/D — ja oder nein? (B5, teuerster Fehler)
2. Datenrate und Plattenplatz anhand eines Testrenders; Planung vor Snappy: 393 MB/s, 94,3 GB bei vier Minuten. (B6)
3. HAP oder HAP Q, und gibt es eine Grenze für die Dateigröße? (B7)
4. Gemeinsamer Timecode über A–D oder loopt jede Fläche für sich? (B8)
5. Verbindliche Randvorgaben des Hauses; die 15-Prozent-Zonen sind nur Arbeitshilfen. (B10)
6. Skizzenmaße bestätigen; Aufhängung, Fahrwege, Holo, Portal und Publikum aufmessen. (B1 bis B4, B9, B13)

Die Lieferanforderungen müssen für einen verbindlichen Vollrender geklärt sein. Frei gewählte
Kompositionshilfen sind keine zusätzliche Hausvorgabe. Die offene Raumgeometrie begrenzt die
Verlässlichkeit der Vorschau; sie verändert die bestätigten Pixelraster nicht.

**Für ein eigenes Haus** dieselbe Übung, aber mit den eigenen Werten: Tabelle A11 abarbeiten, jede
verbleibende Annahme als Klartextzeile in `assumptions` des eigenen Venues schreiben,
`stage.verified` erst auf `true` setzen, wenn nachgemessen wurde. Eine Annahme, die aufgeschrieben
ist, kostet eine Rückfrage. Eine Annahme, die niemand aufgeschrieben hat, kostet einen Rendertag.
