/**
 * Theater-Bild-Gelöte — Medienbibliothek.
 *
 * Ordner einlesen, Dateien mit ihren Kennwerten zeigen, Abweichungen vom
 * Zielraster deutlich benennen, Proxies erzeugen, angleichen (Conform) und
 * Material auf einen Slot legen.
 *
 * Mehrsprachig: alle sichtbaren Texte laufen durch t(). Beschriftungen, die
 * einmal gebaut und danach nur noch angezeigt werden, sammelt textGroup() ein
 * und schreibt sie beim Sprachwechsel neu.
 */

import { h, on, clear, openModal } from '../dom.js';
import {
  browse, scanLibrary, makeProxies, conform, deleteMedia, thumbUrl,
} from '../api.js';
import { store, setStatus, showError, addLayer, dropMedia } from '../store.js';
import { t, tn, register, fmtNum, fmtBytes, getLang, onLangChange } from '../i18n.js';

register('en', {
  'Die Bildrate ist ein Durchschnitt aus {frames} gezählten Bildern — der Container nennt keine verlässliche Rate (typisch für WebM). Bei variabler Rate unbedingt angleichen.': 'The frame rate is an average of {frames} counted frames; the container provides no reliable rate (typical of WebM). Conform variable-rate footage before rendering.',
  'Variable Bildrate: die Datei hat keinen festen Bildabstand. Ein Haus mit fester Bildrate verträgt das nicht — vor dem Render im Conform auf {target} fps angleichen, sonst entscheidet ffmpeg allein, welche Frames gedoppelt oder verworfen werden.': 'Variable frame rate: frames are not evenly spaced. Conform to {target} fps before rendering for a venue with a fixed frame rate; otherwise ffmpeg chooses which frames to repeat or drop.',
  /* --- Datei- und Ordnerauswahl --- */
  'Ordner wählen': 'Choose folder',
  'Datei wählen': 'Choose file',
  '▲ Übergeordnet': '▲ Parent folder',
  'Diesen Ordner wählen': 'Use this folder',
  'Auswählen': 'Select',
  'Abbrechen': 'Cancel',
  'Pfad direkt eingeben': 'Type a path directly',
  'Gehe zu': 'Go',
  'Liest …': 'Reading …',
  'Laufwerke': 'Drives',
  '{n} Eintrag': '{n} entry',
  '{n} Einträge': '{n} entries',
  'Ordner konnte nicht gelesen werden: {msg}': 'Could not read the folder: {msg}',

  /* --- Werkzeugleiste --- */
  'Ordner mit Videomaterial — Pfad eintippen oder blättern': 'Folder with footage — type a path or browse',
  'Blättern …': 'Browse …',
  'Unterordner': 'Subfolders',
  'Ordner einlesen': 'Scan folder',
  'Suchen …': 'Search …',
  'Material filtern': 'Filter footage',
  'alle': 'all',
  'nur Video': 'video only',
  'nur Bilder': 'images only',
  'ohne Proxy': 'no proxy',
  'mit Hinweisen': 'with notes',
  'falsche fps': 'wrong fps',
  'Alle fehlenden Proxies erzeugen': 'Create all missing proxies',
  'Proxy': 'Proxy',
  'Conform …': 'Conform …',
  'Aus Bibliothek': 'Remove from library',
  'Ziel': 'Target',
  'Zielwand': 'Target wall',
  'Zielslot': 'Target slot',
  'auf Slot legen': 'Place on slot',
  'Wand {id}': 'Wall {id}',
  'master (ganze Wand)': 'master (entire wall)',

  /* --- Tabelle --- */
  'Bild': 'Thumbnail',
  'Name': 'Name',
  'Auflösung': 'Resolution',
  'Dauer': 'Duration',
  'Codec': 'Codec',
  'Alpha': 'Alpha',
  'Hinweise': 'Notes',
  'Noch keine Medien. Oben einen Ordner wählen und „Ordner einlesen" drücken.':
    'No media yet. Choose a folder above and press "Scan folder".',
  '{n} ausgewählt': '{n} selected',
  '{shown} von {total} Datei': '{shown} of {total} file',
  '{shown} von {total} Dateien': '{shown} of {total} files',
  '{fps} fps': '{fps} fps',
  '≈ {fps} fps': '≈ {fps} fps',
  '{fps} fps — passt nicht zu {target} fps': '{fps} fps — does not match {target} fps',
  '≈ {fps} fps — passt nicht zu {target} fps': '≈ {fps} fps — does not match {target} fps',
  '{sec} s': '{sec} s',
  'neu': 'rebuild',
  'Proxy erzeugen': 'Create proxy',
  'Proxy neu erzeugen': 'Create the proxy again',
  '→ Slot': '→ slot',
  'Auf den oben gewählten Slot legen': 'Place on the slot chosen above',
  'Aus der Bibliothek entfernen (Quelldatei bleibt)': 'Remove from the library (the source file stays)',
  'da': 'ready',
  'fehlt': 'missing',
  'Proxy ist da — die Vorschau kann die Datei abspielen': 'Proxy is ready — the preview can play this file',
  'Kein Proxy — HAP, ProRes und MPEG-2 spielt der Browser ohne Proxy nicht ab':
    'No proxy — the browser cannot play HAP, ProRes or MPEG-2 without one',

  /* --- Hinweismarken --- */
  'nicht analysiert': 'not analysed',
  'Bibliothek neu einlesen': 'Scan the library again',
  '{fps} fps ≠ {target} fps': '{fps} fps ≠ {target} fps',
  'Quelle läuft mit {exact}, Ziel ist {target} fps. Ohne Conform rechnet ffmpeg beim Render stumm um.':
    'The source runs at {exact}, the target is {target} fps. Without a conform pass ffmpeg silently converts during the render.',
  'variable Bildrate': 'variable frame rate',
  'Variable Bildrate: die Datei hat keinen festen Bildabstand. Ein Haus mit fester Bildrate verträgt das nicht — vor dem Render im Conform auf {target} fps angleichen, sonst entscheidet ffmpeg allein, welche Frames gedoppelt oder verworfen werden.':
    'Variable frame rate: the file has no constant frame spacing. A venue running at a fixed frame rate cannot take that — conform it to {target} fps before rendering, otherwise ffmpeg alone decides which frames get duplicated or dropped.',
  'Durchschnitt': 'average',
  'Die Bildrate ist ein Durchschnitt aus {frames} gezählten Bildern — der Container nennt keine verlässliche Rate (typisch für WebM). Bei variabler Rate unbedingt angleichen.':
    'The frame rate is an average taken from {frames} counted frames — the container reports no reliable rate (typical for WebM). With a variable rate, conform it in any case.',
  'Bildrate laut {source}': 'Frame rate as reported by {source}',
  'mit Ton': 'has audio',
  'Ton wird beim Render verworfen (-an)': 'Audio is discarded during the render (-an)',
  'pc-range': 'pc range',
  'Voller Wertebereich — auf LED oft zu kontrastreich': 'Full range — often too contrasty on LED',
  '= Wand {id}': '= wall {id}',
  'Passt exakt auf eine Wand': 'Matches a wall exactly',
  'ok': 'ok',

  /* --- Meldungen --- */
  'Bitte erst einen Ordner angeben.': 'Choose a folder first.',
  'Ordner wird eingelesen (Job {job}) …': 'Scanning the folder (job {job}) …',
  'Ordner konnte nicht eingelesen werden': 'The folder could not be scanned',
  'Alle Proxies sind vorhanden.': 'All proxies are present.',
  'Nichts ausgewählt.': 'Nothing selected.',
  'Proxy wird erzeugt (Job {job}) …': 'Creating the proxy (job {job}) …',
  'Proxies werden erzeugt ({n} Dateien, Job {job}) …': 'Creating proxies ({n} files, job {job}) …',
  'Proxies konnten nicht erzeugt werden': 'The proxies could not be created',
  'Erst Material auswählen.': 'Select footage first.',
  'Server konnte das Medium nicht entfernen': 'The server could not remove this file from the library',

  /* --- Conform --- */
  'Zielordner für Conform': 'Output folder for the conform pass',
  'Conform — Frames und Raster angleichen': 'Conform — match frame rate and raster',
  '{n} Datei: {names}': '{n} file: {names}',
  '{n} Dateien: {names}': '{n} files: {names}',
  'Ziel-fps': 'Target fps',
  'fps-Modus': 'fps mode',
  'resample — Frames doppeln/verwerfen (Standard)': 'resample — duplicate/drop frames (default)',
  'duplicate — identisch, im Log klar benannt': 'duplicate — identical, named clearly in the log',
  'interpolate — bewegungskompensiert, langsam': 'interpolate — motion compensated, slow',
  'retime — Tempo ändern, keine Frames erfinden': 'retime — change speed, invent no frames',
  'Größe': 'Size',
  'unverändert': 'unchanged',
  'Farbbereich': 'Color range',
  'none — Länge lassen': 'none — keep the length',
  'trim — abschneiden': 'trim — cut off',
  'padBlack — mit Schwarz auffüllen': 'padBlack — pad with black',
  'padFreeze — letzten Frame halten': 'padFreeze — hold the last frame',
  'loop — Quelle wiederholen': 'loop — repeat the source',
  'Frames wie': 'Match frames to',
  '— keine —': '— none —',
  'Zielordner': 'Output folder',
  'Ergebnis in die Bibliothek aufnehmen': 'Add the result to the library',
  'Hinweis: „Frames wie" übernimmt Framezahl und Länge aus der gewählten Datei — das ist der Weg, mehrere Clips exakt gleich lang zu bekommen.':
    'Note: "Match frames to" takes the frame count and the length from the chosen file — that is how several clips end up exactly the same length.',
  '{n} Datei angleichen': 'Conform {n} file',
  '{n} Dateien angleichen': 'Conform {n} files',
  'Conform gestartet (Job {job}) …': 'Conform started (job {job}) …',
  'Conform konnte nicht gestartet werden': 'The conform pass could not be started',

  /* --- Bemaengelungen des Servers (server/probe.js) ---
   * Die Bibliothek ist die einzige Ansicht, die sie zeigt, also steht ihre
   * Uebersetzung hier. Uebersetzt sind nur die festen Texte; Meldungen, in
   * denen Zahlen stecken, bleiben deutsch, weil sie keinen festen Schluessel
   * haben. */
  'Variable Bildrate': 'Variable frame rate',
  'Die Datei hat keinen festen Bildabstand. Ein Haus mit fester Rate vertraegt das nicht — vor dem Render im Reiter Conform auf die Zielrate angleichen, sonst entscheidet ffmpeg allein, welche Frames gedoppelt oder verworfen werden.':
    'The file has no constant frame spacing. A venue running at a fixed frame rate cannot take that — conform it to the target rate before rendering, otherwise ffmpeg alone decides which frames get duplicated or dropped.',
  'Im Reiter Conform auf die Zielrate angleichen, sonst rechnet ffmpeg beim Render stumm um.':
    'Conform it to the target rate, otherwise ffmpeg silently converts during the render.',
  'Der Container nennt keine verlaessliche Bildrate (typisch fuer WebM). Der Wert stimmt, ist aber ein Durchschnitt — bei variabler Rate unbedingt angleichen.':
    'The container reports no reliable frame rate (typical for WebM). The value is correct, but it is an average — with a variable rate, conform it in any case.',
  'Die meisten Codecs verlangen gerade Kanten. Im Conform auf gerade Maße bringen.':
    'Most codecs require even edge lengths. Bring it to even dimensions with a conform pass.',
  'HAP arbeitet in 4x4-Blöcken. ffmpeg paddet sonst stillschweigend.':
    'HAP works in 4x4 blocks. Otherwise ffmpeg pads silently.',
  'Kein Fehler — das Material wird im Editor skaliert oder beschnitten.':
    'Not an error — the footage gets scaled or cropped in the editor.',
  'Beim Render wird der Ton mit -an verworfen. Das Haus liefert Audio getrennt.':
    'Audio is discarded with -an during the render. The venue plays audio separately.',
  'Bildsequenz — die Framerate steht nicht in den Dateien und wird vom Projekt übernommen':
    'Image sequence — the frame rate is not in the files and is taken from the project',
  'Falls die Sequenz mit einer anderen Rate gerendert wurde, im Conform korrigieren.':
    'If the sequence was rendered at a different rate, correct it with a conform pass.',
  'Bibliothek neu einlesen.': 'Scan the library again.',
  'Datei wurde noch nicht analysiert': 'The file has not been analysed yet',
});

/* ==========================================================================
 * Beschriftungen, die den Sprachwechsel ueberleben muessen
 * ========================================================================== */

/**
 * Sammelt gesetzte Beschriftungen ein, damit sie bei einem Sprachwechsel
 * erneut geschrieben werden koennen. Ohne das bleibt gebautes Markup in der
 * alten Sprache stehen.
 */
function textGroup() {
  const jobs = [];
  return {
    /** Textinhalt setzen. */
    txt(el, de, vars) { jobs.push(() => { el.textContent = t(de, vars); }); return el; },
    /** Platzhalter setzen. */
    ph(el, de) { jobs.push(() => { el.placeholder = t(de); }); return el; },
    /** Titel (Tooltip) setzen. */
    ttl(el, de, vars) { jobs.push(() => { el.title = t(de, vars); }); return el; },
    /** Beliebige eigene Zeichenarbeit anmelden. */
    add(fn) { jobs.push(fn); },
    apply() {
      for (const fn of jobs) {
        try {
          fn();
        } catch (e) {
          console.error('[library] Beschriftung konnte nicht gesetzt werden:', e);
          setStatus(`Beschriftung konnte nicht gesetzt werden: ${e.message}`, 'err');
        }
      }
    },
  };
}

/* ==========================================================================
 * Datei-/Ordnerauswahl — wird auch von render.js und qc.js benutzt
 * ========================================================================== */

/**
 * Blaettert per /api/fs/browse durch das Dateisystem.
 * opts: { title, mode: 'dir' | 'file', start }
 * Rueckgabe: Promise<string|null> — absoluter Pfad oder null bei Abbruch.
 */
export function pickPath(opts = {}) {
  const mode = opts.mode === 'file' ? 'file' : 'dir';
  return new Promise((resolve) => {
    const g = textGroup();
    let current = opts.start || '';
    let done = false;

    const crumb = h('div.mono.nowrap.grow', { style: 'font-size:12px' });
    const listEl = h('div.fsList');
    const info = h('div.dim', { style: 'font-size:12px' });
    const btnUp = g.txt(h('button.btn.sm', { type: 'button' }), '▲ Übergeordnet');
    const btnTake = g.txt(h('button.btn.acc', { type: 'button' }),
      mode === 'dir' ? 'Diesen Ordner wählen' : 'Auswählen');
    const btnCancel = g.txt(h('button.btn', { type: 'button' }), 'Abbrechen');
    const btnGoto = g.txt(h('button.btn.sm', { type: 'button' }), 'Gehe zu');
    const manual = g.ph(h('input', { type: 'text', class: 'grow', value: current }), 'Pfad direkt eingeben');
    on(btnGoto, 'click', () => load(manual.value.trim()));

    let selectedFile = null;

    const modal = openModal({
      title: t(opts.title || (mode === 'dir' ? 'Ordner wählen' : 'Datei wählen')),
      body: h('div.col',
        h('div.row', btnUp, crumb),
        listEl,
        info,
        h('div.row', manual, btnGoto),
      ),
      footer: [btnCancel, btnTake],
      onClose: () => { stopLang(); if (!done) { done = true; resolve(null); } },
    });

    const finish = (val) => { done = true; stopLang(); modal.close(); resolve(val); };
    on(btnCancel, 'click', () => finish(null));
    on(btnTake, 'click', () => {
      if (mode === 'dir') finish(current || null);
      else finish(selectedFile);
    });

    async function load(path) {
      info.textContent = t('Liest …');
      try {
        const data = await browse(path || undefined);
        current = data.path || '';
        selectedFile = null;
        btnTake.disabled = mode === 'file';
        crumb.textContent = current || t('Laufwerke');
        crumb.title = current;
        manual.value = current;
        btnUp.disabled = !data.parent;
        btnUp.onclick = () => load(data.parent || '');
        clear(listEl);

        if (Array.isArray(data.drives) && (!current || data.drives.length)) {
          for (const d of data.drives) {
            const row = h('div.fsRow.dir', h('span', '💽'), h('span', d));
            on(row, 'click', () => load(d));
            listEl.appendChild(row);
          }
        }
        const coll = getLang() === 'de' ? 'de' : 'en';
        const entries = [...(data.entries || [])].sort((a, b) =>
          (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || String(a.name).localeCompare(String(b.name), coll));
        for (const e of entries) {
          if (!e.dir && mode === 'dir') continue;
          const row = h('div.fsRow',
            { class: e.dir ? 'fsRow dir' : 'fsRow' },
            h('span', e.dir ? '📁' : '🎞'),
            h('span.grow.nowrap', e.name),
            e.dir ? null : h('span.sz', e.sizeBytes ? fmtBytes(e.sizeBytes) : ''));
          on(row, 'click', () => {
            if (e.dir) { load(e.path); return; }
            selectedFile = e.path;
            btnTake.disabled = false;
            for (const r of listEl.querySelectorAll('.fsRow')) r.style.background = '';
            row.style.background = '#221a20';
          });
          if (!e.dir) on(row, 'dblclick', () => finish(e.path));
          listEl.appendChild(row);
        }
        info.textContent = tn(entries.length, '{n} Eintrag', '{n} Einträge');
      } catch (e) {
        info.textContent = '';
        clear(listEl);
        console.error('[library] Ordner konnte nicht gelesen werden:', e);
        listEl.appendChild(h('div.msg.err', t('Ordner konnte nicht gelesen werden: {msg}', { msg: e.message })));
      }
    }

    g.apply();
    // Sprachwechsel: Beschriftungen neu setzen und die Liste neu aufbauen,
    // damit auch Groessenangaben und die Sortierung stimmen.
    const stopLang = onLangChange(() => { g.apply(); load(current); });

    load(current);
  });
}

/* ==========================================================================
 * Bibliotheksansicht
 * ========================================================================== */

export function createLibraryView() {
  const g = textGroup();
  const selection = new Set();
  let filterText = '';
  let filterKind = 'alle';
  let lastMedia = null;
  let lastFps = null;
  let targetWall = null;
  let targetSlot = 'master';

  const scanPath = g.ph(h('input', { type: 'text', class: 'grow' }),
    'Ordner mit Videomaterial — Pfad eintippen oder blättern');
  const chkRecursive = h('input', { type: 'checkbox', checked: true });
  const lblRecursive = g.txt(h('span.dim'), 'Unterordner');
  const btnBrowse = g.txt(h('button.btn', { type: 'button' }), 'Blättern …');
  const btnScan = g.txt(h('button.btn.acc', { type: 'button' }), 'Ordner einlesen');
  const search = g.ph(h('input', { type: 'search', style: 'width:180px' }), 'Suchen …');
  g.add(() => { search.setAttribute('aria-label', t('Suchen …')); });
  const kindOpts = [
    g.txt(h('option', { value: 'alle' }), 'alle'),
    g.txt(h('option', { value: 'video' }), 'nur Video'),
    g.txt(h('option', { value: 'image' }), 'nur Bilder'),
    g.txt(h('option', { value: 'noproxy' }), 'ohne Proxy'),
    g.txt(h('option', { value: 'issues' }), 'mit Hinweisen'),
    g.txt(h('option', { value: 'fps' }), 'falsche fps'),
  ];
  const kindSel = h('select', ...kindOpts);
  g.add(() => { kindSel.setAttribute('aria-label', t('Material filtern')); });
  const btnAllProxies = g.txt(h('button.btn', { type: 'button' }), 'Alle fehlenden Proxies erzeugen');
  const btnSelProxy = g.txt(h('button.btn.sm', { type: 'button' }), 'Proxy');
  const btnSelConform = g.txt(h('button.btn.sm', { type: 'button' }), 'Conform …');
  const btnSelDrop = g.txt(h('button.btn.sm.danger', { type: 'button' }), 'Aus Bibliothek');
  const wallSel = h('select');
  const slotSel = h('select');
  g.add(() => {
    wallSel.setAttribute('aria-label', t('Zielwand'));
    slotSel.setAttribute('aria-label', t('Zielslot'));
  });
  const btnPlace = g.txt(h('button.btn.sm.acc', { type: 'button' }), 'auf Slot legen');
  const lblTarget = g.txt(h('span.dim'), 'Ziel');
  const selInfo = h('span.dim', { style: 'font-size:12px' });

  const tbody = h('tbody');
  const table = h('table.tbl',
    h('thead', h('tr',
      h('th', { style: 'width:26px' }, ''),
      g.txt(h('th', { style: 'width:80px' }), 'Bild'),
      g.txt(h('th'), 'Name'),
      g.txt(h('th.num'), 'Auflösung'),
      h('th.num', 'fps'),
      g.txt(h('th.num'), 'Dauer'),
      g.txt(h('th'), 'Codec'),
      g.txt(h('th'), 'Alpha'),
      g.txt(h('th'), 'Proxy'),
      g.txt(h('th'), 'Hinweise'),
      h('th', ''))),
    tbody);
  const listBox = h('div.libList.grow', table);
  const emptyNote = g.txt(h('div.msg.info', { style: 'display:none' }),
    'Noch keine Medien. Oben einen Ordner wählen und „Ordner einlesen" drücken.');

  const el = h('div.viewbody',
    h('div.vpBar',
      scanPath, btnBrowse,
      h('label.row', { style: 'gap:4px' }, chkRecursive, lblRecursive),
      btnScan,
      h('span.sep'), search, kindSel,
      h('span.right'), btnAllProxies),
    h('div.vpBar',
      selInfo, btnSelProxy, btnSelConform, btnSelDrop,
      h('span.sep'),
      lblTarget, wallSel, slotSel, btnPlace),
    h('div.pad.grow', { style: 'min-height:0' }, emptyNote, listBox));

  /* -------------------------------------------------------------- Aktionen */

  on(btnBrowse, 'click', async () => {
    const p = await pickPath({ title: 'Ordner einlesen', mode: 'dir', start: scanPath.value.trim() });
    if (p) scanPath.value = p;
  });

  on(btnScan, 'click', async () => {
    const root = scanPath.value.trim();
    // In der Browser-Fassung gibt es keine Pfade: scanLibrary() oeffnet dort
    // selbst den Ordner-Auswahldialog und ignoriert das Argument. Bestuende
    // man auf einem ausgefuellten Feld, gaebe es gar keinen Weg, Material in
    // die Bibliothek zu bekommen — der Knopf "Blättern" laeuft ueber browse(),
    // und das lehnt die Browser-Fassung ab.
    if (!root && !window.__TBG_MODE) {
      setStatus(t('Bitte erst einen Ordner angeben.'), 'warn');
      return;
    }
    btnScan.disabled = true;
    try {
      const res = await scanLibrary(root ? [root] : [], chkRecursive.checked);
      setStatus(t('Ordner wird eingelesen (Job {job}) …', { job: res.jobId }));
    } catch (e) {
      showError(t('Ordner konnte nicht eingelesen werden'), e);
    } finally {
      btnScan.disabled = false;
    }
  });

  on(search, 'input', () => { filterText = search.value.trim().toLowerCase(); renderRows(store.get()); });
  on(kindSel, 'change', () => { filterKind = kindSel.value; renderRows(store.get()); });

  on(btnAllProxies, 'click', async () => {
    const st = store.get();
    const ids = (st.media || []).filter((m) => m.kind !== 'image' && !(m.proxy && m.proxy.ready)).map((m) => m.id);
    if (ids.length === 0) { setStatus(t('Alle Proxies sind vorhanden.'), 'ok'); return; }
    await startProxies(ids);
  });

  on(btnSelProxy, 'click', () => startProxies([...selection]));
  on(btnSelDrop, 'click', () => {
    if (selection.size === 0) return;
    for (const id of [...selection]) {
      dropMedia(id);
      // deleteMedia() gibt in der Browser-Fassung die blob-URL frei. Ohne den
      // Aufruf haelt jede entfernte Datei bis zum Neuladen Speicher fest.
      deleteMedia(id).catch(() => { /* serverseitig nur Aufraeumen, Fehler egal */ });
    }
    selection.clear();
    renderRows(store.get());
  });
  on(btnSelConform, 'click', () => openConformDialog([...selection]));

  on(wallSel, 'change', () => { targetWall = wallSel.value; fillSlots(store.get()); });
  on(slotSel, 'change', () => { targetSlot = slotSel.value; });
  on(btnPlace, 'click', () => {
    if (selection.size === 0) { setStatus(t('Erst Material auswählen.'), 'warn'); return; }
    for (const id of selection) addLayer(wallSel.value, slotSel.value, id);
  });

  async function startProxies(ids) {
    if (!ids || ids.length === 0) { setStatus(t('Nichts ausgewählt.'), 'warn'); return; }
    try {
      const res = await makeProxies(ids, false);
      setStatus(ids.length === 1
        ? t('Proxy wird erzeugt (Job {job}) …', { job: res.jobId })
        : t('Proxies werden erzeugt ({n} Dateien, Job {job}) …', { n: fmtNum(ids.length, 0), job: res.jobId }));
    } catch (e) {
      showError(t('Proxies konnten nicht erzeugt werden'), e);
    }
  }

  /* -------------------------------------------------------------- Conform */

  function openConformDialog(ids) {
    const st = store.get();
    const media = (st.media || []).filter((m) => ids.includes(m.id));
    if (media.length === 0) { setStatus(t('Erst Material auswählen.'), 'warn'); return; }
    const fps = st.project?.fps || 30;
    const dg = textGroup();

    const fFps = h('input', { type: 'number', step: '0.001', value: String(fps) });
    const fMode = h('select',
      dg.txt(h('option', { value: 'resample' }), 'resample — Frames doppeln/verwerfen (Standard)'),
      dg.txt(h('option', { value: 'duplicate' }), 'duplicate — identisch, im Log klar benannt'),
      dg.txt(h('option', { value: 'interpolate' }), 'interpolate — bewegungskompensiert, langsam'),
      dg.txt(h('option', { value: 'retime' }), 'retime — Tempo ändern, keine Frames erfinden'));
    const fW = dg.ph(h('input', { type: 'number' }), 'unverändert');
    const fH = dg.ph(h('input', { type: 'number' }), 'unverändert');
    const fFit = h('select', h('option', { value: 'cover' }, 'cover'), h('option', { value: 'contain' }, 'contain'),
      h('option', { value: 'stretch' }, 'stretch'), h('option', { value: 'native' }, 'native'));
    const fPix = h('select', h('option', { value: 'yuv420p' }, 'yuv420p'), h('option', { value: 'yuv422p10le' }, 'yuv422p10le'),
      h('option', { value: 'yuva444p10le' }, 'yuva444p10le'), h('option', { value: 'rgba' }, 'rgba'));
    const fRange = h('select', h('option', { value: 'tv' }, 'tv (16–235)'), h('option', { value: 'pc' }, 'pc (0–255)'));
    const fDur = dg.ph(h('input', { type: 'number', step: '0.001' }), 'unverändert');
    const fDurMode = h('select',
      dg.txt(h('option', { value: 'none' }), 'none — Länge lassen'),
      dg.txt(h('option', { value: 'trim' }), 'trim — abschneiden'),
      dg.txt(h('option', { value: 'padBlack' }), 'padBlack — mit Schwarz auffüllen'),
      dg.txt(h('option', { value: 'padFreeze' }), 'padFreeze — letzten Frame halten'),
      dg.txt(h('option', { value: 'loop' }), 'loop — Quelle wiederholen'));
    const fSync = h('select', dg.txt(h('option', { value: '' }), '— keine —'),
      ...(st.media || []).map((m) => h('option', { value: m.id }, m.name)));
    const fOut = h('input', { type: 'text', class: 'grow', value: '' });
    const fAdd = h('input', { type: 'checkbox', checked: true });
    const btnOutBrowse = dg.txt(h('button.btn.sm', { type: 'button' }), 'Blättern …');
    on(btnOutBrowse, 'click', async () => {
      const p = await pickPath({ title: 'Zielordner für Conform', mode: 'dir', start: fOut.value.trim() });
      if (p) fOut.value = p;
    });

    const names = media.map((m) => m.name).join(', ');
    const infoLine = h('div.msg.info');
    dg.add(() => {
      infoLine.textContent = tn(media.length, '{n} Datei: {names}', '{n} Dateien: {names}', { names });
    });
    const hintLine = dg.txt(h('p.dim'),
      'Hinweis: „Frames wie" übernimmt Framezahl und Länge aus der gewählten Datei — '
      + 'das ist der Weg, mehrere Clips exakt gleich lang zu bekommen.');
    const lblAdd = dg.txt(h('span'), 'Ergebnis in die Bibliothek aufnehmen');
    const btnGo = h('button.btn.acc', { type: 'button' });
    dg.add(() => {
      btnGo.textContent = tn(media.length, '{n} Datei angleichen', '{n} Dateien angleichen');
    });

    const modal = openModal({
      title: t('Conform — Frames und Raster angleichen'),
      body: h('div.col',
        infoLine,
        row(dg, 'Ziel-fps', fFps, 'fps'),
        row(dg, 'fps-Modus', fMode),
        h('div.row', dg.txt(h('span.lbl', { style: 'width:78px' }), 'Größe'), fW, h('span.dim', '×'), fH, h('span.dim', 'px'), fFit),
        row(dg, 'pix_fmt', fPix),
        row(dg, 'Farbbereich', fRange),
        h('div.row', dg.txt(h('span.lbl', { style: 'width:78px' }), 'Dauer'), fDur, h('span.dim', 's'), fDurMode),
        row(dg, 'Frames wie', fSync),
        h('div.row', dg.txt(h('span.lbl', { style: 'width:78px' }), 'Zielordner'), fOut, btnOutBrowse),
        h('label.row', fAdd, lblAdd),
        hintLine),
      footer: [btnGo],
      onClose: () => stopLang(),
    });

    dg.apply();
    const stopLang = onLangChange(() => dg.apply());

    on(btnGo, 'click', async () => {
      btnGo.disabled = true;
      const body = {
        mediaIds: media.map((m) => m.id),
        target: {
          fps: Number(fFps.value) || fps,
          fpsMode: fMode.value,
          width: fW.value ? Number(fW.value) : null,
          height: fH.value ? Number(fH.value) : null,
          fit: fFit.value,
          pixFmt: fPix.value,
          colorRange: fRange.value,
          durationSec: fDur.value ? Number(fDur.value) : null,
          durationMode: fDurMode.value,
          syncToMediaId: fSync.value || null,
        },
        outDir: fOut.value.trim() || null,
        addToLibrary: fAdd.checked,
      };
      try {
        const res = await conform(body);
        setStatus(t('Conform gestartet (Job {job}) …', { job: res.jobId }));
        stopLang();
        modal.close();
      } catch (e) {
        btnGo.disabled = false;
        showError(t('Conform konnte nicht gestartet werden'), e);
      }
    });
  }

  function row(grp, label, input, unit) {
    return h('div.row', grp.txt(h('span.lbl', { style: 'width:78px' }), label), input, unit ? h('span.dim', unit) : null);
  }

  /* -------------------------------------------------------------- Zeichnen */

  function fillWalls(state) {
    const walls = Object.keys(state.project?.walls || {});
    if (!targetWall || !walls.includes(targetWall)) targetWall = state.ui.activeWallId || walls[0];
    clear(wallSel);
    for (const w of walls) wallSel.appendChild(h('option', { value: w }, t('Wand {id}', { id: w })));
    wallSel.value = targetWall || '';
    fillSlots(state);
  }

  function fillSlots(state) {
    const wall = state.project?.walls?.[wallSel.value];
    const slots = wall ? Object.keys(wall.slots) : [];
    if (!slots.includes(targetSlot)) targetSlot = slots[0] || 'master';
    clear(slotSel);
    for (const s of slots) {
      slotSel.appendChild(h('option', { value: s }, s === 'master' ? t('master (ganze Wand)') : s));
    }
    slotSel.value = targetSlot;
  }

  function matches(m, fps) {
    if (filterText && !String(m.name || '').toLowerCase().includes(filterText)
      && !String(m.absPath || '').toLowerCase().includes(filterText)) return false;
    switch (filterKind) {
      case 'video': return m.kind !== 'image';
      case 'image': return m.kind === 'image';
      case 'noproxy': return !(m.proxy && m.proxy.ready);
      case 'issues': return (m.issues || []).length > 0;
      case 'fps': return m.probe && m.kind !== 'image' && Math.abs((m.probe.fps || 0) - fps) > 0.01;
      default: return true;
    }
  }

  function renderRows(state) {
    const media = state.media || [];
    const fps = state.project?.fps || 30;
    clear(tbody);
    emptyNote.style.display = media.length === 0 ? '' : 'none';

    const shown = media.filter((m) => matches(m, fps));
    for (const m of shown) tbody.appendChild(mediaRow(m, fps, state));

    selInfo.textContent = selection.size
      ? t('{n} ausgewählt', { n: fmtNum(selection.size, 0) })
      : tn(media.length, '{shown} von {total} Datei', '{shown} von {total} Dateien',
        { shown: fmtNum(shown.length, 0), total: fmtNum(media.length, 0) });
    const none = selection.size === 0;
    btnSelProxy.disabled = none;
    btnSelConform.disabled = none;
    btnSelDrop.disabled = none;
    btnPlace.disabled = none;
  }

  /**
   * fps-Zelle. Zwei Sonderfaelle aus der Dateianalyse:
   *   probe.variableFps   - variable Bildrate, fuer ein Haus mit fester Rate
   *                         ein echtes Problem -> deutliche Warnmarke
   *   probe.fpsSource     - 'gezaehlt' heisst: der Wert ist ein ermittelter
   *                         Durchschnitt, kein Containerwert -> dezente Marke
   */
  function fpsCell(m, fps) {
    const p = m.probe;
    if (!p) return h('td.num.dim', '—');
    const isVideo = m.kind !== 'image';
    const off = isVideo && Math.abs((p.fps || 0) - fps) > 0.01;
    const counted = isVideo && p.fpsSource === 'gezaehlt';
    const vfr = isVideo && !!p.variableFps;

    const key = counted
      ? (off ? '≈ {fps} fps — passt nicht zu {target} fps' : '≈ {fps} fps')
      : (off ? '{fps} fps — passt nicht zu {target} fps' : '{fps} fps');
    const value = h('span',
      { style: off ? 'color:var(--warn)' : '' },
      t(key, { fps: fmtNum(p.fps, 3), target: fmtNum(fps, 3) }));
    if (counted) {
      value.title = t('Die Bildrate ist ein Durchschnitt aus {frames} gezählten Bildern — der Container '
        + 'nennt keine verlässliche Rate (typisch für WebM). Bei variabler Rate unbedingt angleichen.',
      { frames: fmtNum(p.frames || 0, 0) });
    } else if (p.fpsSource) {
      value.title = t('Bildrate laut {source}', { source: p.fpsSource });
    }

    const marks = [];
    if (counted) {
      marks.push(h('span.dim', { style: 'font-size:11px;margin-left:4px', title: value.title }, t('Durchschnitt')));
    }
    if (vfr) {
      marks.push(h('span.tag.warn', {
        style: 'margin-left:4px',
        title: t('Variable Bildrate: die Datei hat keinen festen Bildabstand. Ein Haus mit fester Bildrate '
          + 'verträgt das nicht — vor dem Render im Conform auf {target} fps angleichen, sonst entscheidet '
          + 'ffmpeg allein, welche Frames gedoppelt oder verworfen werden.', { target: fmtNum(fps, 3) }),
      }, t('variable Bildrate')));
    }
    return h('td.num', value, ...marks);
  }

  function mediaRow(m, fps, state) {
    const p = m.probe || null;
    const sel = selection.has(m.id);
    const chk = h('input', { type: 'checkbox', checked: sel, 'aria-label': t('Auswählen') });
    on(chk, 'change', () => {
      if (chk.checked) selection.add(m.id); else selection.delete(m.id);
      renderRows(store.get());
    });

    const img = h('img.th', { src: thumbUrl(m.id), alt: '', loading: 'lazy' });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });

    const proxyReady = !!(m.proxy && m.proxy.ready);
    const btnProxy = h('button.btn.sm', {
      type: 'button',
      title: t(proxyReady ? 'Proxy neu erzeugen' : 'Proxy erzeugen'),
    }, t(proxyReady ? 'neu' : 'Proxy'));
    on(btnProxy, 'click', () => startProxies([m.id]));

    const btnPlaceOne = h('button.btn.sm', { type: 'button', title: t('Auf den oben gewählten Slot legen') }, t('→ Slot'));
    on(btnPlaceOne, 'click', () => addLayer(wallSel.value, slotSel.value, m.id));

    const btnDel = h('button.btn.sm.ghost', {
      type: 'button',
      title: t('Aus der Bibliothek entfernen (Quelldatei bleibt)'),
      'aria-label': t('Aus der Bibliothek entfernen (Quelldatei bleibt)'),
    }, '✕');
    on(btnDel, 'click', async () => {
      dropMedia(m.id);
      selection.delete(m.id);
      try { await deleteMedia(m.id); } catch (e) { showError(t('Server konnte das Medium nicht entfernen'), e); }
      renderRows(store.get());
    });

    const tr = h('tr.libRow', { class: sel ? 'libRow sel' : 'libRow' },
      h('td', chk),
      h('td', img),
      h('td', h('div.nowrap', { style: 'max-width:280px', title: m.absPath || '' }, m.name),
        h('div.dim.nowrap', { style: 'max-width:280px;font-size:11px', title: m.absPath || '' }, m.relPath || m.absPath || '')),
      p ? h('td.num', `${p.width}×${p.height}`) : h('td.num.dim', '—'),
      fpsCell(m, fps),
      p ? h('td.num', t('{sec} s', { sec: fmtNum(p.durationSec, 2) })) : h('td.num.dim', '—'),
      p ? h('td', h('span.tag', p.codec || '?')) : h('td.dim', '—'),
      h('td', p && p.hasAlpha ? h('span.tag.info', t('Alpha')) : h('span.dim', '—')),
      h('td', proxyReady
        ? h('span.tag.ok', { title: t('Proxy ist da — die Vorschau kann die Datei abspielen') }, t('da'))
        : h('span.tag.warn', { title: t('Kein Proxy — HAP, ProRes und MPEG-2 spielt der Browser ohne Proxy nicht ab') }, t('fehlt'))),
      h('td', h('div.issues', issueTags(m, fps, state))),
      h('td', h('div.row', { style: 'gap:3px' }, btnProxy, btnPlaceOne, btnDel)));

    on(tr, 'click', (ev) => {
      if (ev.target.closest('button') || ev.target === chk) return;
      chk.checked = !chk.checked;
      chk.dispatchEvent(new Event('change'));
    });
    return tr;
  }

  function issueTags(m, fps, state) {
    const out = [];
    const p = m.probe;

    if (!p) out.push(h('span.tag.warn', { title: t('Bibliothek neu einlesen') }, t('nicht analysiert')));

    if (p && m.kind !== 'image' && Math.abs((p.fps || 0) - fps) > 0.01) {
      out.push(h('span.tag.warn', {
        title: t('Quelle läuft mit {exact}, Ziel ist {target} fps. Ohne Conform rechnet ffmpeg beim Render stumm um.',
          { exact: p.fpsExact || fmtNum(p.fps, 3), target: fmtNum(fps, 3) }),
      }, t('{fps} fps ≠ {target} fps', { fps: fmtNum(p.fps, 3), target: fmtNum(fps, 3) })));
    }
    if (p && p.audioStreams > 0) {
      out.push(h('span.tag', { title: t('Ton wird beim Render verworfen (-an)') }, t('mit Ton')));
    }
    if (p && p.colorRange === 'pc') {
      out.push(h('span.tag.info', { title: t('Voller Wertebereich — auf LED oft zu kontrastreich') }, t('pc-range')));
    }

    const venue = state.venue;
    if (p && venue) {
      const wall = venue.walls?.find((w) => w.width === p.width && w.height === p.height);
      if (wall) out.push(h('span.tag.ok', { title: t('Passt exakt auf eine Wand') }, t('= Wand {id}', { id: wall.id })));
    }

    // Bemaengelungen des Servers. Der Text kommt deutsch herein; t() laesst ihn
    // stehen, solange niemand eine Uebersetzung dafuer angemeldet hat.
    for (const i of m.issues || []) {
      if (typeof i === 'string') out.push(h('span.tag.warn', t(i)));
      else {
        out.push(h('span.tag', {
          class: `tag ${i.level === 'error' ? 'err' : i.level === 'info' ? 'info' : 'warn'}`,
          title: i.hint ? t(i.hint) : '',
        }, t(i.msg || String(i))));
      }
    }
    if (out.length === 0) out.push(h('span.tag.ok', t('ok')));
    return out;
  }

  /* -------------------------------------------------------------- update */

  function update(state) {
    if (!state.project) return;
    fillWalls(state);
    if (state.media !== lastMedia || state.project.fps !== lastFps) {
      lastMedia = state.media;
      lastFps = state.project.fps;
      // Auswahl auf noch vorhandene Medien beschraenken
      for (const id of [...selection]) if (!lastMedia.some((m) => m.id === id)) selection.delete(id);
      renderRows(state);
    }
  }

  g.apply();
  // Sprachwechsel: feste Beschriftungen neu setzen UND den Zwischenspeicher
  // verwerfen, sonst bleiben die Tabellenzeilen in der alten Sprache stehen.
  onLangChange(() => {
    g.apply();
    lastMedia = null;
    lastFps = null;
    const st = store.get();
    if (st.project) fillWalls(st);
    renderRows(st);
  });

  return { el, update, get selection() { return [...selection]; } };
}
