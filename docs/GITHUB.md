# Versionsverwaltung: Rezept ja, Ergebnis nein

Die Anwendung selbst ist seit dem 17. September 2026 öffentlich:
[Quellcode](https://github.com/jareb560-byte/theater-bild-geloete),
[Online-Studio](https://jareb560-byte.github.io/theater-bild-geloete/) und
[Downloads](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest).
Die folgenden Empfehlungen für private Repositories beziehen sich auf eigene Kundenprojekte.
Bildmaterial, Videos und der ursprüngliche PDF-Guide werden nicht mit der Anwendung veröffentlicht.

Für ein Theater-Bild-Gelöte-Projekt gilt eine einzige Regel, und alles Weitere folgt daraus:

> **In das Repository kommt, was die Show beschreibt. Nicht, was die Show ausspielt.**

Also: Quelltext, Venue-Dateien, Projektdateien, Dokumentation — ja. Rohmaterial, Proxies,
Renderausgaben, Lieferdateien — nein, unter keinen Umständen, auch nicht "nur kurz" und auch nicht
in einem privaten Repository.

Das ist keine Geschmacksfrage. Es folgt aus den Datenmengen, die bei unkomprimierten und
leichtkomprimierten LED-Formaten anfallen, und aus der Art, wie Git arbeitet. Beides steht unten mit
Zahlen.

---

## 1. Die Rechnung

Die Datenmenge einer LED-Ausgabe lässt sich vorher ausrechnen, und Theater-Bild-Gelöte tut das auch (Feld
`bytesPerPixel` je Delivery-Preset):

```
Bytes je Frame  = Breite × Höhe × bytesPerPixel
Bytes je Sekunde = Bytes je Frame × Bildrate
```

HAP verwendet BC1/DXT1 mit **0,5 Byte pro Pixel**, HAP Q (YCoCg-BC3/DXT5) und HAP Alpha
verwenden **1 Byte pro Pixel**. Das sind Texturdaten vor zusätzlicher Snappy-Kompression;
Dateigrößen und tatsächliche Leseraten hängen vom Bildinhalt ab. Die [HAP-Spezifikation](https://github.com/Vidvox/hap/blob/master/documentation/HapVideoDRAFT.md)
beschreibt die Formate und die optionale zweite Kompressionsstufe.

Für **2736 × 1224 Pixel bei 30 fps in HAP Q** ergeben sich als Planungswerte:

| Was | Größe vor zusätzlicher Kompression |
|---|---|
| ein Frame | 3,35 MB |
| eine Sekunde | 100,5 MB |
| ein 20-Sekunden-Loop | ca. 2,0 GB |
| ein 4-Minuten-Loop | ca. 24,1 GB |
| A, B, C und D in HAP Q plus Holo in HAP Alpha, 4 Minuten | ca. 94,3 GB |

Alle fünf Flächen zusammen ergeben rund **393 MB/s** Texturdaten bei 30 fps. Zusätzliche
Paneldateien brauchen weiteren Platz. Verbindliche Speicher- und Wiedergabeplanung sollte
anhand eines repräsentativen Testrenders und der realen Serverkonfiguration erfolgen.

Solche Renderdateien gehören auf den Medien- oder Projekt-Datenträger. Im Git-Repository
bleiben Quelltext und Projektbeschreibungen. So kann ein Checkout schnell aufgebaut werden,
ohne bei jeder Codeänderung große Medienbestände zu übertragen.

---

## 2. Warum Binärdateien in Git grundsätzlich nicht funktionieren

Auch wenn die Dateien kleiner wären, bliebe der Punkt bestehen. Git ist für Text gebaut.

**Keine Deltas.** Git speichert Änderungen zwischen Versionen als Differenz. Bei Text funktioniert
das hervorragend: Eine geänderte Zeile kostet ein paar hundert Byte. Ein Video ist bereits
komprimiert; ändert man einen einzigen Frame, sieht der Bytestrom danach überall anders aus. Git
kann kein sinnvolles Delta bilden und legt die **komplette neue Datei** als neuen Blob ab. Zehn
Renderversionen einer Wand sind zehnmal 12 GB, nicht 12 GB plus ein bisschen.

**Die Historie wächst nur in eine Richtung.** `git rm` löscht die Datei aus dem Arbeitsstand, nicht
aus der Historie. Der Blob bleibt für immer im Repository. Wer versehentlich einen 12-GB-Render
committet, hat ihn dauerhaft drin — heraus kommt er nur mit einem Historien-Rewrite
(`git filter-repo`), und der macht jeden anderen Klon ungültig.

**Clone wird unbenutzbar.** `git clone` holt standardmäßig die gesamte Historie. Ein Repository mit
ein paar Renderständen ist damit ein Download von hunderten Gigabyte — bei jedem neuen Rechner, bei
jedem Kollegen, bei jedem automatischen Lauf. Das Repository ist dann faktisch tot.

**Keine sinnvollen Diffs, keine sinnvollen Merges.** Der eigentliche Nutzen von Git —
nachvollziehen, was sich geändert hat, und zwei Arbeitsstände zusammenführen — existiert bei
Binärdateien nicht. Man bekommt alle Kosten von Git und keinen seiner Vorteile.

---

## 3. Was hineingehört

| Hinein | Warum |
|---|---|
| `server/`, `client/`, `shared/` | der Quelltext |
| `config/venues/*.json` | die Beschreibung der Häuser — klein, textlich, diffbar |
| `project.tbg.json` und Varianten davon | die Beschreibung der Shows |
| `README.md`, `README.en.md`, `docs/`, `CONTRIBUTING.md`, `LICENSE` | die Dokumentation |
| `package.json`, `package-lock.json` | die Abhängigkeiten (genau zwei) |

| Draußen | Warum |
|---|---|
| `node_modules/` | wird aus `package-lock.json` wiederhergestellt |
| `bin/ffmpeg*` und `bin/ffprobe*` | die ffmpeg-Programme kommen per `npm run setup:ffmpeg`; `bin/theater-bild-geloete.js` gehört zum Quelltext |
| `.cache/`, `proxies/`, `thumbs/` | Ableitungen, jederzeit neu erzeugbar |
| `out/`, `renders/` | die Renderausgaben, siehe Abschnitt 1 |
| Rohmaterial jeder Art | gehört auf eine Platte, nicht in eine Historie |
| Unterlagen des Kunden (PDF, Pläne, Kontaktdaten) | siehe Abschnitt 6 |

Damit bleibt ein Theater-Bild-Gelöte-Repository im niedrigen einstelligen Megabytebereich. Genau dort spielt
Git seine Stärken aus: Historie, Rückrollen, Vergleichen, Arbeiten auf einem zweiten Rechner.

Die mitgelieferte `.gitignore` deckt das ab. Die Zeilen mit den Videoformaten sind bewusst pauschal:
Es ist besser, eine harmlose Datei ausdrücklich mit `git add -f` hinzuzufügen, als versehentlich
einen Render zu committen.

---

## 4. Wohin das Video stattdessen geht

Drei getrennte Wege, und sie bleiben getrennt:

1. **Lokale Platte** — der Arbeitsstand. Schnell, direkt am Werkzeug. Das ist der Ordner, den
   Theater-Bild-Gelöte als Arbeitsverzeichnis benutzt.
2. **NAS oder externe Platte** — das Backup. Ein Ordnerabgleich reicht, kein Versionssystem. Jeder
   Renderstand bekommt einen Ordner mit Datum; das ist die Versionierung, die man hier tatsächlich
   braucht.
3. **Die Auslieferung** — getrennt von beidem, über den Weg, den das Haus vorgibt. Nie dieselbe
   Ablage, aus der gearbeitet wird, sonst wird irgendwann ein Zwischenstand geliefert.

---

## 5. Projektdateien sinnvoll versionieren

Hier wird die Trennung von einer Notlösung zu einem echten Vorteil.

Eine Projektdatei ist ein paar Kilobyte JSON. Sie beschreibt vollständig, welche Datei auf welchem
Slot liegt, wie sie zugeschnitten, skaliert und korrigiert ist, wann sie im Loop läuft und mit
welchem Preset gerendert wird. Der Verweis auf das Medium ist **relativ** (`relPath` im Modell),
nicht absolut — das Projekt funktioniert also auch, wenn das Material auf einem anderen Rechner in
einem anderen Ordner liegt.

Daraus folgt:

- Die Datei ist **klein**. Sie kostet im Repository nichts.
- Die Datei ist **diffbar**. `git diff` zeigt im Klartext, dass ein Panel um 40 Pixel verschoben und
  die Helligkeit eines Layers um 0,05 gesenkt wurde. Genau diese Information sucht man drei Wochen
  später.
- Die Datei macht jeden Render **reproduzierbar**. Einen Commit von vor zwei Wochen auschecken,
  starten, rendern — heraus kommt derselbe Stand. Der 12-GB-Render muss nirgends aufbewahrt werden,
  weil er jederzeit wiederherstellbar ist.

**Versioniert wird das Rezept, nicht das Ergebnis.**

Was sich in der Praxis bewährt:

- **Eine Datei pro Show-Fassung**, nicht eine Datei für alles. `show-premiere.tbg.json`,
  `show-kurzfassung.tbg.json`. Wer Fassungen über Branches trennt, verliert den direkten
  Vergleich; nebeneinanderliegende Dateien lassen sich zeilenweise vergleichen.
- **Vor und nach jedem Vollrender committen.** Der Commit vor dem Render ist der Stand, aus dem die
  Dateien entstanden sind. Ohne ihn ist die Reproduzierbarkeit nur behauptet.
- **Den Commit benennen wie eine Notiz an sich selbst.** Nicht "Update", sondern
  "D2 um 40 px nach links, Motiv war über der Naht" oder "Loop auf 120 s, Datenrate mit Haus
  geklärt". Der Commit ist das Protokoll der Entscheidungen — das ist der eigentliche Wert.
- **Den ausgelieferten Stand markieren.** `git tag lieferung-2026-04-18`. Damit ist Monate später
  ohne Suchen klar, welcher Stand auf der Wand lief.
- **Venue-Änderungen einzeln committen.** Wenn ein Maß im Haus nachgemessen wurde, gehört diese
  Änderung allein in einen Commit, mit der Quelle in der Nachricht. Venue-Werte sind der
  Bezugsrahmen für alles andere; wer sie zusammen mit zwanzig Layer-Verschiebungen committet, kann
  später nicht mehr sagen, wann sich was geändert hat.
- **`assumptions` und `openQuestions` pflegen.** Wird eine Annahme durch eine Messung ersetzt,
  verschwindet die Zeile aus `assumptions`, `stage.verified` geht auf `true`, und die Nachricht sagt
  woher. Das ist die kürzeste Form von Dokumentation, die noch funktioniert.

---

## 6. Vertraulichkeit bei Kundenprojekten

Sobald für einen Auftraggeber gearbeitet wird, kommt zu allem Technischen Folgendes hinzu:

- **Technische Unterlagen des Kunden gehören nicht ins Repository.** Videoguides, Pläne, Riggingpläne,
  Angebote — auch nicht in ein privates Repository, auch nicht in `docs/`. Die daraus abgeleiteten
  Maße und Formate in `config/venues/` sind unkritisch: Das sind Zahlen, die für die Arbeit gebraucht
  werden. Das Originaldokument ist es nicht.
- **Kontaktdaten gehören nicht ins Repository.** Keine Namen mit Mailadressen oder Telefonnummern in
  Kommentaren, Commit-Nachrichten oder Notizfeldern. Wo eine Zuständigkeit benannt werden muss,
  reicht die Rolle ("Haustechnik", "Produktionsleitung").
- **Logos, Markenzeichen und Bildmaterial des Kunden gehören nicht ins Repository.** Weder als
  Testmaterial noch als Beispielbild in der Dokumentation.
- **Kundenprojekte bleiben in privaten Repositories.** Nicht "erst mal öffentlich, später
  umstellen" — was einmal öffentlich war, ist geklont und in Suchindizes.
- **Vor dem ersten Push prüfen, was tatsächlich aufgenommen wird**, und zwar mit `git status` und
  `git ls-files`, nicht durch Hinsehen. Der erste Push ist der letzte Moment, in dem ein Fehler
  billig zu beheben ist.

Als Trockenlauf vor dem allerersten Push:

```bash
git add -A
git status --short
git ls-files
```

Taucht dort eine `.mov`, eine `.mp4` oder ein `.pdf` auf, ist die `.gitignore` falsch.

Umgekehrt gilt: Das Werkzeug selbst enthält nichts Vertrauliches. Wer Theater-Bild-Gelöte weitergibt oder
veröffentlicht, gibt Quelltext, Dokumentation und die Venue-Dateien weiter, die er weitergeben will
— die Maße eines Hauses sind in aller Regel unkritisch, das Material der Show ist es nicht.

---

## 7. Alternativen, kurz abgewogen

**Nur lokal, kein Repository.** Kostet nichts und ist sofort da. Es gibt aber kein Backup des Codes,
keinen Weg auf einen zweiten Rechner und keine Möglichkeit, einen Stand von letzter Woche
wiederherzustellen. Für ein Werkzeug in einer laufenden Produktion ist das zu wenig. Der Verlust
wäre nicht das Video — das liegt auf der Platte — sondern die gesamte Arbeit an Code und
Projektdateien.

**Git LFS.** Technisch der richtige Mechanismus für große Dateien in Git, aber nicht in dieser
Größenordnung. Sinnvoll wäre LFS allenfalls für wenige **Referenzdateien**, die sich nie ändern und
klein sind: ein Fünf-Sekunden-Testmuster für die QC, ein Referenz-Standbild. Für Renderstände: nein.

**Selbst gehosteter Dienst (Gitea, Forgejo) auf dem NAS.** Keine Datei- oder Repositorygrenzen außer
der Plattengröße, die Daten bleiben im Haus — bei Kundenprojekten ein echtes Argument. Dafür kommen
Updates, Backups des Servers selbst und Erreichbarkeit von unterwegs dazu. Und die Argumente aus
Abschnitt 2 gelten weiter: Auch ein eigener Server macht Git nicht zu einem guten Videoarchiv.
Lohnt sich, wenn ohnehin ein NAS mit Containern läuft und mehrere Projekte davon profitieren.

**Firmeneigene Plattform (Azure DevOps, GitLab).** Naheliegend, wenn die Firma ohnehin dort
arbeitet und die Konten existieren. Die Repository-Grenzen sind ähnlich streng, an der
entscheidenden Stelle gewinnt man also nichts.

**Empfehlung für Kundenprojekte:** ein privates Repository für eigene Venue- und Projektdateien, Video
vollständig außerhalb auf lokaler Platte plus Backup. Kein LFS. Das ist die einzige Kombination
ohne laufende Kosten, ohne Wartung, mit reproduzierbaren Renders und ohne die Möglichkeit, sich das
Repository dauerhaft zu ruinieren.

---

## 8. Einrichten

**Diese Befehle führt der Nutzer selbst aus.** Sie legen ein Repository an und veröffentlichen Code
— nichts, was ein Werkzeug oder ein Assistent ungefragt im Hintergrund tun sollte. Vor dem `push`
Abschnitt 6 abarbeiten.

**Schritt 1 — Repository lokal anlegen.**

```bash
cd <Theater-Bild-Gelöte-ordner>
git init -b main
```

**Schritt 2 — `.gitignore` prüfen** (die mitgelieferte deckt den Normalfall ab), dann ansehen, was
aufgenommen würde:

```bash
git add -A
git status --short
git ls-files
```

Erst weitermachen, wenn in dieser Liste ausschließlich Quelltext, JSON und Markdown steht.

**Schritt 3 — erster Commit.**

```bash
git commit -m "Theater-Bild-Gelöte: Grundgeruest, Datenmodell, API-Vertrag, Venue <name>"
```

Danach in kleinen Schritten weiter, statt alles in einem Rutsch:

```bash
git add config/venues/halle-nord.json
git commit -m "Venue Halle Nord: Wandmasse aus Aufmass vom 12.03., Fahrweg noch geschaetzt"

git add docs/
git commit -m "Doku: Workflow, Architektur, offene Punkte"
```

**Schritt 4 — privates Repository beim Hoster anlegen und pushen.**

```bash
git remote add origin <url-des-privaten-repositories>
git push -u origin main
```

**Schritt 5 — kontrollieren.** In der Weboberfläche des Hosters nachsehen: Das Repository muss als
**privat** gekennzeichnet sein, und die Dateiliste darf keine Videodatei und kein Kundendokument
enthalten. Die Größe des Repositories sollte im niedrigen einstelligen Megabytebereich liegen. Steht
dort etwas Dreistelliges, ist etwas mitgerutscht — dann sofort klären, solange die Historie noch
kurz ist.
