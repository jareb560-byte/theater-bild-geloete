# Überarbeitung September 2026

Die Arbeitsoberfläche ordnet Bühne, Medien, Wände und Einstellungen neu. Die 3D-Ansicht
enthält einen modellierten Portalrahmen, Vorhänge, Bühnentechnik, Bodenmaterial, Licht und
eine Referenzfigur. Theater- und Technikdarstellung lassen sich umschalten; Prüfhilfen und
Darstellungseffekte beeinflussen keine Lieferdatei.

## Geometrie und Quellen

Das Beispiel-Venue wurde mit dem TUI-Videoguide, Version 1.3 vom 24. März 2026, abgeglichen.
Die Pixelraster und Panelbreiten von A–D stimmen mit dem Guide überein. Die Track-Abstände
aus der Skizze auf Seite 8 ergeben, als Meter interpretiert, relative Positionen
A = 0, B = 1,6, C = 4,3 und D = 6,9. Der nominale Maßstab beträgt 250 Pixel pro Meter
bei 4 mm Pitch; die 3D-Wände verwenden die gerundeten Metermaße aus der Tabelle.

Portal, Zuschauerraum, Kameras, Fahrwege, Unterkanten und Holo-Metermaße bleiben Annahmen.
Die Raumausstattung ist eine schematische Theaterdarstellung. Die 15-%-Randzonen sind frei
gewählte Kompositionshilfen. Der Guide belegt weder diese Randvorgabe noch eine bestimmte
HAP-Variante. `stage.verified` und `house.verified` bleiben deshalb `false`.

Die Maße von Agora, La Cage, Blaue Flora und ScreenBand wurden ebenfalls an den Guide
angepasst. Beim ScreenBand umfasst das Gesamtmaß die Zwischenräume; deren einzelne Breiten
bleiben unbekannt. Die widersprüchlichen Rasterangaben der MultiPlex-Projektion sind als
offene Zuordnung dokumentiert. Das Quelldokument wird nicht mit dem Programm verteilt.

## Funktion und Auslieferung

- HAP Q wird mit 1 Byte pro Pixel vor Snappy-Kompression kalkuliert, statt mit 0,5.
  Dateigrößen bleiben Planungswerte und hängen auch vom Inhalt ab.
- Regressionen bei Zeitbereichen, skalierter Vorschau, Effekten und Job-Status wurden
  korrigiert und mit automatisierten Prüfungen abgesichert.
- Der CLI-Starter wird nun von Git und dem npm-Paket erfasst. Paketname und Lockfile-Version
  stimmen überein; die Anleitung setzt kein bereits veröffentlichtes npm-Paket voraus.
- `npm run build:web` erstellt die Browser-Fassung mit strikter Prüfung.
  Der Pages-Workflow verwendet die tatsächliche Repository-Adresse.
- Pushes auf `main`/`master` und Pull Requests erhalten Regressionstests, einen CLI-Aufruf
  und einen Browser-Build.
  Der Desktop-Release-Workflow prüft das Versions-Tag und erstellt einen Release-Entwurf.

## Verifiziert

Ein frisches `npm ci` in einem separaten Ordner installierte die 69 Abhängigkeiten.
CLI-Hilfe, JavaScript-Syntax der Builder und der strikte Browser-Build liefen erfolgreich.
`npm pack --dry-run` enthält den CLI-Starter und keine FFmpeg-Binaries.

Alle 15 Regressionstests liefen auf Windows mit den vorhandenen FFmpeg-/FFprobe-Binaries
ohne übersprungene Tests. Die Encoderprüfung erzeugte HAP Q, ProRes 422 und MPEG-2 in MOV,
jeweils mit separaten Paneldateien, und kontrollierte Raster, Codec und Framezahl per ffprobe.
Das ersetzt keinen Wiedergabetest auf dem Mediaserver des Hauses.

Zusätzlich geprüft: Syntax aller 44 JavaScript-Dateien sowie die lokale Oberfläche im Browser
mit Theater-/Technikdarstellung, Kamerawahl, Panel-Editor, Größenberechnung und schmalen
Fenstern. Eine separate lokale Bühnenprobe verwendet vorhandene Produktionsmotive auf
A, B und D. Das ursprüngliche Projekt und sein Bildmaterial bleiben außerhalb des Repositorys.

Autosave wird vor Vorschau, Rendern, Conform, Schnitt und QC vollständig abgewartet.
Wartende Jobs halten den Projektstand vom Klickzeitpunkt fest. Speicherfehler bleiben sichtbar
und werden mit wachsendem Abstand erneut versucht. Das Projektmenü bietet eine JSON-Sicherung.

GitHub-Pages-Bereitstellung und Release-Downloads wurden in dieser lokalen Überarbeitung
noch nicht veröffentlicht oder als externe Dienste verifiziert.

Das Veröffentlichungsziel für den Quellcode ist das private Repository
[jareb560-byte/theater-bild-geloete](https://github.com/jareb560-byte/theater-bild-geloete).
GitHub Pages ist nicht aktiviert; sein Workflow ist ausschließlich manuell startbar.
Ein normaler Push veröffentlicht keine Website. `private: true` verhindert eine versehentliche
npm-Veröffentlichung. Lokal starten: im Projektordner `npm ci`, bei Bedarf
`npm run setup:ffmpeg`, anschließend `npm start -- --open`.
