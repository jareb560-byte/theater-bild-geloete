# Theater-Bild-Gelöte installieren

Die Desktop-App läuft in einem eigenen Fenster. Node, npm und ein Terminal sind nicht nötig. Projekte und Medien bleiben auf dem eigenen Rechner.

## Windows 10/11, 64 Bit

`Theater-Bild-Geloete-<Version>-Windows-x64-Setup.exe` öffnen, den Installationsordner auswählen und installieren. Die App lässt sich danach über Startmenü oder Desktop-Verknüpfung öffnen. Eine Installation nur für das eigene Benutzerkonto braucht normalerweise keine Administratorrechte.

## macOS 13 (Ventura) oder neuer

Für Apple Silicon (M1 und neuer) die Datei `macOS-arm64.dmg`, für Intel die Datei `macOS-x64.dmg` wählen. Das DMG öffnen und Theater-Bild-Geloete in „Programme“ ziehen; von dort starten.

Die ersten Pakete besitzen noch kein Windows-Herausgeberzertifikat und keine Apple-Developer-ID/Notarisierung. Windows SmartScreen beziehungsweise macOS Gatekeeper können daher beim ersten Öffnen warnen oder den Start blockieren. Nur einen bewusst von diesem Projekt geladenen Installer freigeben: unter Windows über „Weitere Informationen“, unter macOS über „Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen“. Die App verändert diese Schutzfunktionen nicht. Auf verwalteten Rechnern kann eine Freigabe durch die Administration nötig sein.

## Rendern mit HAP und ProRes

Beim ersten Start im Assistenten „ffmpeg jetzt holen“ auswählen. Einmalig ist Internet nötig. Die App lädt FFmpeg und FFprobe direkt beim jeweiligen Anbieter, passend zum System, in den Arbeitsordner und prüft HAP und ProRes. Danach funktionieren Import, Vorschau und Rendering offline. Auf dem Mac werden Intel und Apple Silicon getrennt unterstützt, ohne Homebrew und ohne Terminal.

FFmpeg ist nicht im Installer enthalten. Windows bezieht den GPL-Build von [BtbN](https://github.com/BtbN/FFmpeg-Builds); macOS die signierten Builds von [Martin Riedl](https://ffmpeg.martin-riedl.de/). FFmpeg und die enthaltenen Bibliotheken besitzen eigene Lizenzen; Anbieter, Build-Informationen und Quellen sind dort dokumentiert. Das Studio spricht FFmpeg als separates Programm an.

Standard-Arbeitsordner: `theater-bild-geloete` im eigenen Benutzerordner. Er bleibt bei Updates und Deinstallation erhalten. Der Menüpunkt „Datei → Arbeitsordner öffnen“ öffnet ihn.

