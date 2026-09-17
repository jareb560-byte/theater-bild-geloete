# Die Browser-Fassung

**[Theater-Bild-Gelöte online öffnen](https://jareb560-byte.github.io/theater-bild-geloete/)**.
Die Website bietet 3D-Bühne, Panel-Editor, Projektplanung und MP4-Export ohne Installation.
Die Schaltfläche **Anleitung** erklärt den Einstieg und bleibt jederzeit erreichbar.

Für HAP und andere Hausformate: **[Windows-Setup](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest/download/Theater-Bild-Geloete-0.3.0-Windows-x64-Setup.exe)** ·
**[Mac Apple Silicon](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest/download/Theater-Bild-Geloete-0.3.0-macOS-arm64.dmg)** ·
**[Mac Intel](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest/download/Theater-Bild-Geloete-0.3.0-macOS-x64.dmg)**.
[Installationshilfe](INSTALLATION.md) · [HAP exportieren](../README.md#hap-exportieren).

## Ein Video direkt online erstellen

1. In **Bibliothek → Ordner hinzufügen** einen lokalen Medienordner auswählen. Für Videos
   ein browsergeeignetes Format wie H.264/MP4 oder WebM verwenden; Bilder gehen ebenfalls.
2. Datei markieren, Zielwand und Slot wählen und **Platzieren**. `master` füllt die
   ganze Wand, A1/A2 usw. sind einzelne Panels. Im **Panel-Editor** den Ausschnitt einstellen.
3. **Export** öffnen und eine Wand wählen. Zuerst mit **Ausschnitt** einen kurzen Bereich
   testen, zum Beispiel 0 bis 5 Sekunden. **Ganzer Loop** exportiert die volle Projektlänge.
4. **MP4 erstellen** anklicken und den Tab geöffnet lassen. Der Fortschritt erscheint im
   Renderbereich; **Export abbrechen** beendet den laufenden Vorgang.
5. Nach Abschluss **MP4 herunterladen** anklicken. Die fertige Datei bleibt dort verfügbar,
   bis ein neuer Export sie ersetzt oder die Seite geschlossen oder neu geladen wird.

Es entsteht eine H.264-MP4 **ohne Ton**, in der Pixelauflösung der gewählten Wand und mit
der Bildrate des Projekts. Die aktiven Layer, ihre Anordnung und ihr zeitlicher Verlauf
werden zu einer flachen Wandfläche zusammengesetzt. Die 3D-Raumausstattung, Panelfahrten,
Kamera und Hilfslinien sind nicht Teil dieses Videos. Der Export verwendet den Projektstand
beim Start; spätere Änderungen beeinflussen diesen laufenden Export nicht.

Die Verarbeitung läuft auf dem eigenen Rechner. Es gibt keinen Upload der Medien,
keinen Render-Server und keine nutzungsabhängigen Renderkosten. Große Auflösungen und lange
Loops brauchen entsprechend Zeit und Arbeitsspeicher. Die fertige Datei wird bis zum Download
im Browser gehalten; deshalb zuerst einen kurzen Ausschnitt prüfen.
Pro Video gilt eine Grenze von **256 MB**. Bildfilter und weiche Übergänge werden vor dem
Export mit einem Hinweis abgewiesen. Harte Schnitte, Zuschnitt, Anordnung und Deckkraft
sind möglich; für darüber hinausgehende Bearbeitung die lokale Fassung verwenden.

## Was geht, was nicht

| Funktion | Lokal | Browser |
|---|---|---|
| 3D-Bühne, Panel-Editor, Venues und Projektplanung | ja | ja |
| H.264-MP4 einer ganzen Wand, ohne Ton | ja | ja, bei unterstützter Auflösung |
| Vorschau der Medien | über FFmpeg-Proxies | browsergeeignete Videos und Bilder |
| HAP, ProRes, MPEG-2 | ja | nein |
| Separate Paneldateien | ja | nein |
| Conform und technische Qualitätskontrolle | ja | nein |
| FFmpeg-Befehl anzeigen und prüfen | ja | nein |

MP4 ist für Ansicht und Weitergabe geeignet. Ob es als Lieferformat akzeptiert wird, muss
mit dem Haus abgestimmt werden. Ein erfolgreicher MP4-Export bestätigt keine TUI-Abnahme.
Für vorgeschriebene HAP-, ProRes- oder MPEG-2-Dateien und technische QC bleibt die lokale
Fassung mit FFmpeg erforderlich.

## Browser und Medien

Eine aktuelle Version von **Chrome oder Edge** verwenden. Die Ordnerauswahl und der
MP4-Export brauchen Browserfunktionen, die nicht überall verfügbar sind. Die Seite muss
über HTTPS oder lokal über `localhost` aufgerufen werden. Auch bei einem unterstützten Browser
kann eine besonders große oder ungewöhnliche Wandauflösung vom Rechner nicht unterstützt werden;
der Export zeigt dann eine Fehlermeldung. Als Ausweichweg dient die lokale Fassung.

HAP, ProRes und MPEG-2 sind für diese Browservorschau kein geeigneter Ausgangspunkt.
Für die Online-Arbeit eine H.264-/MP4- oder WebM-Kopie verwenden. Nicht abspielbare oder
fehlende Quelldateien lassen sich nicht durch die Projektdatei ersetzen.

Nach einem Neuladen gegebenenfalls denselben Medienordner erneut einlesen. Die Planung
bleibt gespeichert, aber der Browser benötigt wieder Zugriff auf die lokalen Dateien.

## Projekt sichern und lokal weiterarbeiten

**··· neben dem Projektnamen → Projektdatei herunterladen** speichert eine `.tbg.json`.
Sie enthält die Planung und Medienverweise, nicht die Medien selbst. Im Browser lässt sie
sich über **··· → Projektdatei öffnen** wieder laden. Eine heruntergeladene MP4 ersetzt
diese bearbeitbare Projektdatei nicht.

Für ein Online-Projekt, dessen Medien aus einem gemeinsamen Ordner eingelesen wurden:

1. Die heruntergeladene `.tbg.json` in genau diesen Medienordner legen; die Unterordnerstruktur
   beibehalten. Die relativen Medienverweise werden lokal von der Projektdatei aus aufgelöst.
2. In der lokalen Anwendung **··· neben dem Projektnamen → Projektdatei öffnen** wählen.
   Zum Medienordner navigieren und die `.tbg.json` auswählen. Der Dateidialog bietet auch
   **Pfad direkt eingeben**, um zu einem anderen Ordner zu wechseln.
3. Die Zuordnung der Medien kontrollieren und unter **Export** das benötigte Hausformat wählen.
   Zuerst einen kurzen Testrender erstellen, danach die Ausgabe in **QC** prüfen.

Der Einrichtungsassistent bietet zusätzlich eine Liste der Projekte aus
`<Arbeitsverzeichnis>/projects/`. **Projektdatei öffnen** kann auch Dateien außerhalb dieses
Ordners laden. Die Medienpfade müssen weiterhin passen; das bloße Kopieren der Projektdatei
verschiebt die Medien nicht.
Bei mehreren Quellordnern oder nachträglich verschobenen Dateien die Verweise vor dem Rendern
prüfen. Ein erneuter Bibliotheksscan ersetzt derzeit kein zuverlässiges Neuverknüpfen aller Layer.

Beim Start aus dem Quellcode kann ein Projekt auch mit
`npm start -- --open --project "C:\Medienordner\Projekt.tbg.json"` geöffnet werden.

## Veröffentlichung und eigene Builds

Der Quellcode liegt im öffentlichen Repository
[jareb560-byte/theater-bild-geloete](https://github.com/jareb560-byte/theater-bild-geloete).
Die Browser-Version wird öffentlich über GitHub Pages bereitgestellt.
**[Desktop herunterladen](https://github.com/jareb560-byte/theater-bild-geloete/releases/latest)**
führt zu den verfügbaren Installationsdateien für Windows und Mac. Ein normaler Push
führt die Prüfungen aus. Der Workflow **„Browser-Fassung veroeffentlichen“** startet nur
manuell über `workflow_dispatch`; Pages muss als Quelle **GitHub Actions** verwenden.

Lokal bauen:

```sh
npm ci
npm run build:web
```

`dist-web/` ist die fertige Website. Sie benötigt einen Webserver; ein Doppelklick auf
`index.html` funktioniert wegen der Modulimporte nicht. Der strenge Build überprüft die
lokalen Imports und bricht bei Warnungen ab. Die mitgelieferten Browser-Bibliotheken
werden mit veröffentlicht; es wird kein externer Renderdienst eingebunden.

Für Desktop-Pakete gibt es `npm run build:portable`. Passende Versions-Tags starten den
Release-Workflow und erzeugen einen Entwurf. Ein npm-Paket wird nicht veröffentlicht.

## Was öffentlich ist

Die Website, die nötigen Browserdateien und mitgelieferten Bühnenvorlagen sind öffentlich
abrufbar. Auch das Quellcode-Repository ist öffentlich.
Produktionsbilder, Videos, lokale Projekte und der TUI-PDF-Guide gehören nicht zum Website-Paket.
Ausgewähltes eigenes Material wird im Browser verarbeitet und nicht zu GitHub hochgeladen.
Der Browserspeicher ist keine dauerhafte Sicherung: wichtige Projekte als `.tbg.json` herunterladen.

## Wenn etwas nicht geht

- **MP4-Erstellung nicht verfügbar:** einen aktuellen Chrome oder Edge nutzen und die Seite
  über HTTPS öffnen. Bei einer nicht unterstützten Auflösung lokal rendern.
- **Medien fehlen nach dem Neuladen:** denselben Medienordner erneut einlesen und Zugriff erlauben.
- **Video bleibt schwarz oder Export bricht ab:** prüfen, ob die Quelldatei im Browser abspielbar
  ist. Mit einem kurzen Ausschnitt testen; gegebenenfalls ein browsergeeignetes Ausgangsformat nutzen.
- **Projekt ist weg:** nach geleertem Browserspeicher die gesicherte `.tbg.json` öffnen und
  den Medienordner erneut einlesen.
- **Weiße Seite nach eigenem Build:** mit einem Webserver öffnen; auf fehlende Dateien und
  falsche Pfade prüfen. `npm run build:web` führt die strenge Build-Prüfung aus.
