# Die Browser-Fassung

Theater-Bild-Gelöte gibt es zweimal. Die **Desktop-Fassung** wird entpackt und gestartet und kann
alles. Die **Browser-Fassung** liegt als Adresse im Netz, braucht keine Installation und kann
3D-Bühne, Panel-Editor, Venue-Verwaltung und Projektplanung.

**[Online-Version öffnen](https://jareb560-byte.github.io/theater-bild-geloete/)**.
Die Schaltfläche **Anleitung** erklärt die Bedienung in wenigen Schritten.

Beide benutzen denselben Quelltext. Der Unterschied ist eine einzige Datei: statt mit einem
lokalen Server zu reden, arbeitet die Browser-Fassung gegen den Speicher des Browsers und die
Dateien, die du ihr zeigst.

---

## Wofür die Browser-Fassung da ist

Zum **Planen und Zeigen**. Du schickst jemandem eine Adresse, er klickt drauf und sieht die
Bühne — ohne Installation, ohne Warnung, auch vom Tablet in der Probe.

Konkret: die Panelaufteilung durchdenken, Fahrwege ausprobieren, prüfen ob ein Motiv die
Mittelnaht überlebt, sehen ab wann ein aufgefahrenes Panel für den Zuschauer verschwindet,
ein neues Haus anlegen und durchrechnen.

Nicht dafür da ist sie, die Lieferdateien zu erzeugen. Das bleibt am Desktop.

---

## Was geht, was nicht

| | Desktop | Browser |
|---|---|---|
| 3D-Bühne, Panels fahren, Sichtgrenzen | ja | **ja** |
| Panel-Editor, Croppen, Einrasten | ja | **ja** |
| Venues anlegen und rechnen | ja | **ja** |
| Nähte und Sperrzonen prüfen | ja | **ja** |
| ffmpeg-Befehl erzeugen und kopieren | ja | **ja** |
| Vorschau von Videomaterial | jedes Format | nur was der Browser abspielt |
| Bildrate angleichen (Conform) | ja | nein |
| Rendern und Ausliefern | ja | nein |
| Qualitätskontrolle | ja | nein |

### Rendern in der lokalen Fassung

Diese Browser-Fassung enthält keinen ffmpeg-Encoder und keinen Renderdienst. Conform,
Lieferdateien und die technische Qualitätskontrolle nutzen deshalb weiterhin ffmpeg auf
dem eigenen Rechner. GitHub Pages stellt die Oberfläche bereit; die Verarbeitung der
Projektplanung findet im Browser statt.

---

## Der Ablauf zwischen beiden Fassungen

Die Projektdatei ist die Brücke. Sie ist ein paar Kilobyte groß und verweist relativ auf das
Material — nicht das Video wandert hin und her, sondern das Rezept.

1. Im Browser planen: Wände belegen, Fahrwege festlegen, Ausschnitte setzen.
2. **Projekt speichern** — es wird als `.tbg.json` heruntergeladen.
3. Die Datei in der Desktop-Fassung öffnen.
4. Dort rendern und ausliefern.

Der kurze Weg für einen einzelnen Render: In der Browser-Fassung gibt es die
Filtergraph-Vorschau. Sie erzeugt den vollständigen ffmpeg-Befehl im Klartext — den kannst du
kopieren und auf einem Rechner mit ffmpeg einfach einfügen. Dafür braucht es die
Desktop-Fassung gar nicht.

---

## Welche Browser

**Chrome und Edge** können alles. Sie beherrschen die File System Access API, über die du der
Seite einen Ordner zeigst.

**Firefox und Safari** können das nicht. Dort laufen 3D-Bühne, Editor, Venue-Verwaltung und
Filtergraph normal, aber der Knopf „Ordner einlesen" meldet im Klartext, dass dieser Browser
das nicht unterstützt. Es scheitert nichts stillschweigend.

Videomaterial muss außerdem etwas sein, das der Browser abspielen kann: **H.264 in MP4 oder MOV,
oder WebM**. HAP, ProRes und MPEG-2 dekodiert kein Browser — solche Dateien erscheinen in der
Bibliothek mit einem deutlichen Hinweis, und die Vorschau bleibt schwarz. Zum Planen reicht das
oft, weil Auflösung und Länge trotzdem angezeigt werden.

---

## Veröffentlichen

Der Quellcode liegt im privaten Repository
[jareb560-byte/theater-bild-geloete](https://github.com/jareb560-byte/theater-bild-geloete).
Die öffentliche Browser-Version wird über GitHub Pages bereitgestellt:
[Theater-Bild-Gelöte online](https://jareb560-byte.github.io/theater-bild-geloete/).
Ein normaler Push führt die Prüfungen aus. Die Veröffentlichung einer neuen Browser-Fassung
wird separat gestartet.

Einmalig einrichten:

1. Repository auf GitHub anlegen und den Code hochladen.
2. Dort unter **Settings → Pages → Build and deployment** als Quelle **„GitHub Actions"**
   einstellen. Der Veröffentlichungsjob benötigt diese Pages-Konfiguration.
3. Den Workflow **„Browser-Fassung veroeffentlichen“** unter **Actions** manuell starten.

`.github/workflows/pages.yml` ist ausschließlich manuell über `workflow_dispatch` startbar.
Nach einer erfolgreichen Bereitstellung steht die tatsächliche Adresse unter **Settings → Pages**.

Selbst bauen und anschauen geht auch ohne GitHub:

```bash
node tools/build-web.js --out dist-web
```

Der Ordner `dist-web/` ist die fertige Seite. **Wichtig:** Sie funktioniert nur über einen
Webserver, nicht per Doppelklick auf die `index.html` — ES-Module lassen sich nicht über
`file://` laden.

`npm run build:web` führt denselben Build mit `--strict` aus. Warnungen führen dabei zu
einem Fehlerstatus. Der Pages-Workflow übergibt die tatsächliche Repository-Adresse aus
dem GitHub-Kontext; lokale Builds bekommen ohne `--repo` keinen Downloadlink zu einer
unbekannten Release-Seite.

Für Desktop-Pakete gibt es `npm run build:portable`. Ein Versions-Tag, das zur Version in
`package.json` passt, startet den Release-Workflow. Dieser erstellt einen Entwurf mit den
Archiven. Bei manueller Ausführung muss ein bereits vorhandenes Versions-Tag angegeben werden.
Ein npm-Paket wird von keinem der Workflows veröffentlicht.

---

## Was öffentlich ist

Die Website und die für ihre Funktion nötigen Browserdateien sind öffentlich abrufbar.
Das private GitHub-Repository ist dadurch nicht öffentlich. Ein privates Repository bedeutet
keinen Zugangsschutz für diese Pages-Website.

Veröffentlicht werden die Anwendung und die mitgelieferten Bühnenvorlagen. Produktionsbilder,
Videos, lokale Projekte und der TUI-PDF-Guide gehören nicht zum Website-Paket.
Ausgewähltes eigenes Material wird im Browser verarbeitet und nicht zu GitHub hochgeladen.
Eigene Projekte liegen im Browserspeicher; für eine dauerhafte Sicherung als `.tbg.json`
herunterladen. Die Projektdatei enthält die Anordnung und Medienverweise, nicht die Medien selbst.

---

## Wenn etwas nicht geht

**Weiße Seite.** Fast immer ein Pfadproblem. Prüfen, ob `.nojekyll` im Wurzelverzeichnis der
Seite liegt und ob in den Entwicklerwerkzeugen unter „Netzwerk" ein 404 auftaucht. Das
Bauskript meldet solche Fälle beim Bauen; mit `--strict` bricht es dann sogar ab.

**„Ordner einlesen" tut nichts.** Falscher Browser — Chrome oder Edge nehmen.

**Video bleibt schwarz.** Format, das der Browser nicht dekodiert (HAP, ProRes, MPEG-2). In
der Bibliothek steht der Hinweis dazu.

**Projekt ist weg.** Das Projekt liegt im Speicher des Browsers für diese Adresse. Wird der
Browserspeicher geleert, ist es fort. Deshalb: alles, was zählt, über **Projekt speichern** als
Datei sichern. Das ist ohnehin der Weg zur Desktop-Fassung.

**Nach dem Neuladen sind die Videos weg.** Der Browser darf Ordner nicht dauerhaft ohne
Nachfrage lesen. Die Seite merkt sich den Ordner und fragt beim nächsten Start nach der
Erlaubnis; wird sie verweigert, muss der Ordner neu eingelesen werden. Das Projekt selbst
bleibt davon unberührt.
