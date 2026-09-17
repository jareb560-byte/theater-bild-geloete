import { h, modal } from '../dom.js';
import { t, register, onLangChange } from '../i18n.js';

register('en', {
  'Kurzanleitung': 'Quick start',
  'Dein erster Bühnenentwurf': 'Your first stage design',
  'Browser-Fassung': 'Browser edition',
  'Desktop-Fassung': 'Desktop edition',
  'Von der leeren Wand zur räumlichen Vorschau – in vier Schritten.':
    'From an empty wall to a spatial preview in four steps.',
  'Bühne erkunden': 'Explore the stage',
  'Unter „3D-Bühne“ die Kamera wählen und links die Wände öffnen. Ziehen dreht die Kamera, das Mausrad zoomt. Die Testbilder zeigen zunächst leere Flächen.':
    'In “3D stage”, choose a camera and open the walls on the left. Drag to orbit, scroll to zoom. Test patterns initially mark empty surfaces.',
  'Eigenes Material laden': 'Load your footage',
  'Unter „Bibliothek“ auf „Ordner hinzufügen“ klicken und einen lokalen Ordner wählen. Für die Vorschau H.264/MP4, WebM oder Bilder verwenden. Die Ordnerauswahl braucht Chrome oder Edge.':
    'In “Library”, click “Add folder” and choose a local folder. Use H.264/MP4, WebM or images for preview. Folder selection requires Chrome or Edge.',
  'Unter „Bibliothek“ einen Quellordner einlesen. Für Videos bei Bedarf Proxies erzeugen, damit der Browser sie als Vorschau abspielen kann.':
    'In “Library”, scan a source folder. Create proxies for videos as needed so the browser can play them in the preview.',
  'Auf die Wand legen': 'Place it on a wall',
  'Datei markieren, Zielwand und Slot wählen, dann „Platzieren“. „Ganze Wand“ füllt die ganze Wand; A1, A2 usw. sind einzelne Panels. Im „Panel-Editor“ Ausschnitt und Position anpassen.':
    'Select a file, choose the target wall and slot, then click “Place”. “Whole wall” fills the whole wall; A1, A2 and so on are individual panels. Adjust crop and position in “Panel editor”.',
  'Prüfen und sichern': 'Check and save',
  'Zurück in „3D-Bühne“ geschlossen und geöffnet prüfen. Über „···“ neben dem Projektnamen die Projektdatei herunterladen. Für den Desktop dieselben Medien separat bereithalten.':
    'Return to “3D stage” and check both closed and open positions. Download the project file using “···” beside the project name. Keep the same media files separately for the desktop edition.',
  'Video erstellen': 'Create a video',
  'Unter „Export“ eine Wand wählen, zuerst einen kurzen Ausschnitt testen und „MP4 erstellen“ anklicken. Danach „MP4 herunterladen“ wählen. Das Video enthält die flache Wand in voller Pixelauflösung, ohne Ton.':
    'In “Export”, choose a wall, test a short section first and click “Create MP4”. Then choose “Download MP4”. The video contains the flat wall at full pixel resolution, without audio.',
  'MP4 im Browser, Lieferformate am Desktop': 'MP4 in your browser, delivery formats on desktop',
  'Die Website lädt deine Medien nicht hoch. Sichere die Planung über „··· → Projektdatei herunterladen“ als .tbg.json. Nach dem Neuladen den Medienordner bei Bedarf erneut einlesen.':
    'The website does not upload your media. Back up your plan as a .tbg.json file using “··· → Download project file”. Scan the media folder again after reloading if needed.',
  'Desktop herunterladen': 'Download desktop',
  'MP4 entsteht direkt auf deinem Rechner. Dafür eine aktuelle Version von Chrome oder Edge verwenden und den Tab geöffnet lassen. HAP, ProRes, MPEG-2, separate Paneldateien, Conform und Qualitätskontrolle brauchen die Desktop-Fassung mit FFmpeg.':
    'MP4 is created directly on your computer. Use a current version of Chrome or Edge and keep the tab open. HAP, ProRes, MPEG-2, separate panel files, conforming and quality control require the desktop edition with FFmpeg.',
  'Für Liefer-Videos „Export“ öffnen, das Format des Hauses wählen und zunächst einen kurzen Testrender prüfen. „QC“ kontrolliert anschließend die Ausgabe. FFmpeg muss eingerichtet sein.':
    'For delivery videos, open “Export”, choose the venue format and check a short test render first. “QC” then checks the output. FFmpeg must be configured.',
  'Die Raumausstattung und Fahrwege sind eine Annäherung. Verbindliche Maße und Lieferformate mit dem Haus abstimmen.':
    'The theatre surround and travel are indicative. Confirm definitive dimensions and delivery formats with the venue.',
  'Jederzeit wieder oben über „Anleitung“ öffnen.': 'Reopen this any time using “Guide” at the top.',
  'Medien hinzufügen': 'Add media',
  'Tastenkürzel ansehen': 'View keyboard shortcuts',
});

const SEEN_KEY = 'tbg.quick-start.browser.v2';

/** A short workflow guide; desktop setup remains in onboarding.js. */
export function createQuickStart({ browser = false, onView, onShortcuts } = {}) {
  let handle = null;
  let shownThisSession = false;

  function open() {
    if (handle) return handle;
    const steps = [
      [t('Bühne erkunden'), t('Unter „3D-Bühne“ die Kamera wählen und links die Wände öffnen. Ziehen dreht die Kamera, das Mausrad zoomt. Die Testbilder zeigen zunächst leere Flächen.')],
      [t('Eigenes Material laden'), browser
        ? t('Unter „Bibliothek“ auf „Ordner hinzufügen“ klicken und einen lokalen Ordner wählen. Für die Vorschau H.264/MP4, WebM oder Bilder verwenden. Die Ordnerauswahl braucht Chrome oder Edge.')
        : t('Unter „Bibliothek“ einen Quellordner einlesen. Für Videos bei Bedarf Proxies erzeugen, damit der Browser sie als Vorschau abspielen kann.')],
      [t('Auf die Wand legen'), t('Datei markieren, Zielwand und Slot wählen, dann „Platzieren“. „Ganze Wand“ füllt die ganze Wand; A1, A2 usw. sind einzelne Panels. Im „Panel-Editor“ Ausschnitt und Position anpassen.')],
      browser
        ? [t('Video erstellen'), t('Unter „Export“ eine Wand wählen, zuerst einen kurzen Ausschnitt testen und „MP4 erstellen“ anklicken. Danach „MP4 herunterladen“ wählen. Das Video enthält die flache Wand in voller Pixelauflösung, ohne Ton.')]
        : [t('Prüfen und sichern'), t('Zurück in „3D-Bühne“ geschlossen und geöffnet prüfen. Über „···“ neben dem Projektnamen die Projektdatei herunterladen. Für den Desktop dieselben Medien separat bereithalten.')],
    ];
    const body = h('div.quick-start',
      h('div.quick-start-intro',
        h('span.eyebrow', browser ? t('Browser-Fassung') : t('Desktop-Fassung')),
        h('h2', t('Dein erster Bühnenentwurf')),
        h('p', t('Von der leeren Wand zur räumlichen Vorschau – in vier Schritten.'))),
      h('ol.quick-start-steps', ...steps.map(([title, text], index) =>
        h('li', h('span.quick-start-number', { 'aria-hidden': 'true' }, String(index + 1)),
          h('div', h('h3', title), h('p', text))))),
      h('div.quick-start-delivery',
        h('h3', t('MP4 im Browser, Lieferformate am Desktop')),
        browser ? h('p', t('Die Website lädt deine Medien nicht hoch. Sichere die Planung über „··· → Projektdatei herunterladen“ als .tbg.json. Nach dem Neuladen den Medienordner bei Bedarf erneut einlesen.')) : null,
        h('p', browser
          ? t('MP4 entsteht direkt auf deinem Rechner. Dafür eine aktuelle Version von Chrome oder Edge verwenden und den Tab geöffnet lassen. HAP, ProRes, MPEG-2, separate Paneldateien, Conform und Qualitätskontrolle brauchen die Desktop-Fassung mit FFmpeg.')
          : t('Für Liefer-Videos „Export“ öffnen, das Format des Hauses wählen und zunächst einen kurzen Testrender prüfen. „QC“ kontrolliert anschließend die Ausgabe. FFmpeg muss eingerichtet sein.')),
        browser ? h('a.browser-desktop-link', { href: 'https://github.com/jareb560-byte/theater-bild-geloete/releases/latest', target: '_blank', rel: 'noopener noreferrer' }, t('Desktop herunterladen')) : null),
      h('p.quick-start-note', t('Die Raumausstattung und Fahrwege sind eine Annäherung. Verbindliche Maße und Lieferformate mit dem Haus abstimmen.')),
      h('div.quick-start-tail',
        h('span', t('Jederzeit wieder oben über „Anleitung“ öffnen.')),
        h('button.btn.sm.ghost', { type: 'button', onClick: () => onShortcuts?.() }, t('Tastenkürzel ansehen'))));
    handle = modal({
      title: t('Kurzanleitung'), body,
      actions: [
        ...(browser ? [{ label: t('Video erstellen'), onClick: () => onView?.('render') }] : []),
        { label: t('Medien hinzufügen'), onClick: () => onView?.('library') },
        { label: t('Bühne erkunden'), kind: 'primary', onClick: () => onView?.('stage3d') },
      ],
      onClose: () => {
        handle = null;
        if (browser) {
          try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* Guide stays accessible without storage. */ }
        }
      },
    });
    handle.el.classList.add('quick-start-dialog');
    handle.el.setAttribute('aria-label', t('Kurzanleitung'));
    handle.el.scrollTop = 0;
    handle.el.focus({ preventScroll: true });
    shownThisSession = true;
    return handle;
  }

  function showOnFirstVisit() {
    if (!browser || shownThisSession) return;
    try { if (localStorage.getItem(SEEN_KEY) === '1') return; } catch { /* Show once this session. */ }
    open();
  }

  onLangChange(() => {
    if (!handle) return;
    handle.close();
    open();
  });

  return { open, showOnFirstVisit };
}
