/**
 * Theater-Bild-Gelöte — Einrichtung.
 *
 * Erscheint beim ersten Start und immer dann, wenn ffmpeg fehlt oder ein
 * ffmpeg ohne HAP installiert ist. Ohne HAP ist jede HAP-Auslieferung
 * unmoeglich — das muss unuebersehbar sein.
 *
 * Die Installationshinweise haengen an der Plattform, die /api/health meldet
 * (win32 / darwin / linux). Meldet der Server keine, werden alle drei gezeigt,
 * statt eine zu raten.
 */

import { h, on, clear, openModal, copyButton } from '../dom.js';
import { t, register, onLangChange } from '../i18n.js';
import { installFfmpeg, getHealth } from '../api.js';
import { store, setStatus, showError } from '../store.js';

register('en', {
  /* --- Kopf --- */
  'Einrichtung — ffmpeg': 'Setup — ffmpeg',
  'ffmpeg …': 'ffmpeg …',
  'ffmpeg fehlt': 'ffmpeg missing',
  'ffmpeg ohne HAP': 'ffmpeg without HAP',
  'Der Serverzustand ist noch nicht bekannt.': 'The server state is not known yet.',
  'ffmpeg wurde nicht gefunden.': 'ffmpeg was not found.',
  'Ohne ffmpeg kann Theater-Bild-Gelöte nichts analysieren, keine Proxies bauen und nichts rendern. Die Oberfläche funktioniert, jede Verarbeitung schlägt aber fehl.':
    'Without ffmpeg, Theater-Bild-Gelöte can analyse nothing, build no proxies and render nothing. The interface works, but every processing step will fail.',
  'Dieses ffmpeg kann kein HAP.': 'This ffmpeg cannot do HAP.',
  'Viele LED-Wiedergabesysteme verlangen .mov mit HAP bzw. HAP Q. Mit diesem Build ist eine HAP-Auslieferung unmöglich — es fehlt der Encoder im Programm, das ist keine Einstellung, die man umlegen könnte.':
    'Many LED playback systems require .mov with HAP or HAP Q. With this build a HAP delivery is impossible — the encoder is missing from the program; this is not a setting that could be switched over.',
  'Das geladene Venue „{venue}“ liefert standardmäßig „{preset}“ und braucht damit hap.':
    'The loaded venue “{venue}” delivers “{preset}” by default and therefore needs hap.',
  'ffmpeg ist einsatzbereit.': 'ffmpeg is ready.',
  'Version {version}, Quelle: {source}.': 'Version {version}, source: {source}.',
  'unbekannt': 'unknown',
  'bin/-Ordner des Projekts': 'the project’s bin/ folder',
  'System-PATH': 'system PATH',
  'Pfad': 'Path',
  'Pfad kopieren': 'Copy path',

  /* --- Encoder --- */
  'Encoder': 'Encoders',
  'vorhanden': 'present',
  'fehlt': 'missing',
  'HAP-Auslieferung (HAP / HAP Q / HAP Alpha)': 'HAP delivery (HAP / HAP Q / HAP Alpha)',
  'Ohne diesen Encoder gibt es kein lieferfähiges HAP-Format.':
    'Without this encoder there is no deliverable HAP format.',
  'ProRes als Austausch- und Archivformat': 'ProRes as exchange and archive format',
  'MPEG-2 — von älteren Mediaservern verlangt': 'MPEG-2 — required by older media servers',
  'Proxies für die Vorschau und Ansichtsexemplare zur Freigabe':
    'Proxies for the preview and review copies for approval',

  /* --- Automatischer Bezug --- */
  'ffmpeg holen': 'Get ffmpeg',
  'ffmpeg jetzt holen': 'Get ffmpeg now',
  'Wird geholt …': 'Fetching …',
  'ffmpeg wird geholt (Job {id}) — Fortschritt steht in der Jobleiste.':
    'ffmpeg is being fetched (job {id}) — progress is shown in the job bar.',
  'ffmpeg konnte nicht geholt werden': 'ffmpeg could not be fetched',
  'Erneut prüfen': 'Check again',
  'Der Knopf lädt einen passenden Build nach {dir} und prüft die benötigten Encoder. Es wird nichts am System installiert.':
    'The button downloads a suitable build into {dir} and checks the required encoders. Nothing is installed system-wide.',
  'Alternative Installation und technische Prüfung': 'Alternative installation and technical checks',
  'Serverzustand konnte nicht gelesen werden': 'The server state could not be read',

  /* --- Plattformhinweise --- */
  'Installation auf diesem System': 'Installing on this system',
  'Installation': 'Installation',
  'Der Server meldet seine Plattform nicht. Deshalb stehen hier die Wege für alle drei Systeme.':
    'The server does not report its platform, so the routes for all three systems are listed here.',
  'Windows': 'Windows',
  'macOS': 'macOS',
  'Linux': 'Linux',
  'Befehl kopieren': 'Copy command',
  'Nach der Installation ein neues Terminal öffnen — ein bereits laufendes kennt den geänderten PATH nicht.':
    'Open a new terminal after installing — one that is already running does not know the changed PATH.',
  'Auf dem Mac „ffmpeg jetzt holen“ wählen. Die passende Version für Apple Silicon oder Intel wird automatisch eingerichtet; Homebrew und Terminal sind dafür nicht nötig.':
    'On Mac, choose “Fetch ffmpeg now”. The appropriate version for Apple Silicon or Intel is set up automatically; Homebrew and Terminal are not required.',
  'Ob das Paket am Ende hap enthält, unterscheidet sich von Distribution zu Distribution.':
    'Whether the package ends up containing hap differs from distribution to distribution.',

  /* Namen der Paketverwaltungen. Sie lauten in jeder Sprache gleich, stehen
   * aber im Woerterbuch, weil sie sichtbarer Text sind. */
  'Chocolatey': 'Chocolatey',
  'Homebrew': 'Homebrew',
  'MacPorts': 'MacPorts',
  'Debian / Ubuntu': 'Debian / Ubuntu',
  'Fedora (RPM Fusion)': 'Fedora (RPM Fusion)',
  'Arch': 'Arch',

  /* --- Die zentrale Warnung --- */
  'ffmpeg aus Paketquellen kommt häufig OHNE hap': 'ffmpeg from package repositories often comes WITHOUT hap',
  'Der hap-Encoder braucht libsnappy und ist in vielen fertigen Paketen nicht einkompiliert. Ein solches ffmpeg analysiert, konvertiert und rendert alles andere einwandfrei — nur eine HAP-Auslieferung ist damit unmöglich. Deshalb nach JEDER Installation prüfen, ob hap wirklich dabei ist:':
    'The hap encoder needs libsnappy and is not compiled into many prebuilt packages. Such an ffmpeg will analyse, convert and render everything else perfectly well — only a HAP delivery is impossible with it. So after EVERY installation, check whether hap is really included:',
  'In der Ausgabe müssen {a} und {b} auftauchen. Fehlt hap, hilft nur ein anderer Build.':
    'The output must list {a} and {b}. If hap is missing, only a different build will help.',
  'Fehlt HAP, oben „ffmpeg jetzt holen“ wählen und danach die Encoder-Ampeln prüfen.':
    'If HAP is missing, choose “Fetch ffmpeg now” above and then check the encoder indicators.',

  /* --- Ordner --- */
  'Arbeitsverzeichnis und Version': 'Working directory and version',
  'Theater-Bild-Gelöte-Version': 'Theater-Bild-Gelöte version',
  'Arbeitsverzeichnis': 'Working directory',
  'System': 'System',
  'Node {v}': 'Node {v}',
  'Hier liegen Projekte, Proxies und die fertigen Dateien. Der Programmordner steht weiter unten.':
    'This is where projects, proxies and the finished files live. The program folder is listed further down.',
  'Ordner': 'Folders',
  'Programmordner': 'Program folder',
  'Projekte': 'Projects',
  'Eigene Venues': 'Your own venues',
  'Mitgelieferte Venues': 'Bundled venues',
  'Zwischenspeicher': 'Cache',
  'Proxies': 'Proxies',
  'Vorschaubilder': 'Thumbnails',
  'Zielordner': 'Output folder',
  'Programme (bin/)': 'Programs (bin/)',
  'Projektdatei': 'Project file',
  'noch keine': 'none yet',
  'Alle Pfade kommen vom Server und gelten auf dem Rechner, auf dem er läuft.':
    'All paths come from the server and refer to the machine it runs on.',
});

/* ==========================================================================
 * Plattformabhaengige Installationswege
 * ========================================================================== */

/**
 * Befehle je Plattform. Sie gehen bewusst NICHT durch t(): wer sie kopiert,
 * fuehrt sie aus — sie muessen in jeder Sprache Zeichen fuer Zeichen gleich
 * sein. Uebersetzt wird nur, was daneben steht.
 */
const COMMANDS = {
  win32: [
    { by: 'winget', cmd: 'winget install BtbN.FFmpeg.GPL' },
    { by: 'choco', cmd: 'choco install ffmpeg-full' },
  ],
  darwin: [],
  linux: [
    { by: 'apt', cmd: 'sudo apt install ffmpeg' },
    { by: 'dnf', cmd: 'sudo dnf install ffmpeg' },
    { by: 'pacman', cmd: 'sudo pacman -S ffmpeg' },
  ],
};

/** Wer den Befehl ausfuehrt — steht als Beschriftung daneben. */
function managerLabel(by) {
  switch (by) {
    case 'winget': return 'winget';
    case 'choco': return t('Chocolatey');
    case 'brew': return t('Homebrew');
    case 'port': return t('MacPorts');
    case 'apt': return t('Debian / Ubuntu');
    case 'dnf': return t('Fedora (RPM Fusion)');
    case 'pacman': return t('Arch');
    default: return by;
  }
}

/** Befehl, mit dem sich das Ergebnis pruefen laesst. */
function verifyCommand(platform) {
  return platform === 'win32'
    ? 'ffmpeg -hide_banner -encoders | findstr /i hap'
    : 'ffmpeg -hide_banner -encoders | grep -i hap';
}

/** Anzeigename einer Plattform. */
function platformLabel(platform) {
  if (platform === 'win32') return t('Windows');
  if (platform === 'darwin') return t('macOS');
  return t('Linux');
}

/** Ein Satz Zusatzwissen je Plattform. */
function platformHint(platform) {
  if (platform === 'win32') {
    return t('Nach der Installation ein neues Terminal öffnen — ein bereits laufendes kennt den geänderten PATH nicht.');
  }
  if (platform === 'darwin') {
    return t('Auf dem Mac „ffmpeg jetzt holen“ wählen. Die passende Version für Apple Silicon oder Intel wird automatisch eingerichtet; Homebrew und Terminal sind dafür nicht nötig.');
  }
  return t('Ob das Paket am Ende hap enthält, unterscheidet sich von Distribution zu Distribution.');
}

/** Klartextname eines Pfades aus health.paths; unbekannte Schluessel roh. */
function pathLabel(key) {
  switch (key) {
    case 'root': return t('Programmordner');
    case 'workspace': return t('Arbeitsverzeichnis');
    case 'projects': return t('Projekte');
    case 'venues': return t('Eigene Venues');
    case 'builtinVenues': return t('Mitgelieferte Venues');
    case 'cache': return t('Zwischenspeicher');
    case 'proxies': return t('Proxies');
    case 'thumbs': return t('Vorschaubilder');
    case 'out': return t('Zielordner');
    case 'bin': return t('Programme (bin/)');
    case 'project': return t('Projektdatei');
    default: return key;
  }
}

/** Kurze Systemzeile aus dem, was der Server ueber sich meldet. */
function systemLine(state, platform) {
  const health = (state && state.health) || {};
  const ws = (state && state.workspace) || {};
  const p = (typeof health.platform === 'object' && health.platform)
    || (typeof ws.platform === 'object' && ws.platform) || {};
  const parts = [platformLabel(platform)];
  if (p.release) parts.push(String(p.release));
  if (p.arch) parts.push(String(p.arch));
  if (p.node) parts.push(t('Node {v}', { v: p.node }));
  return parts.join(' · ');
}

/**
 * Das Arbeitsverzeichnis — der Ordner, in dem Projekte, Proxies und Renders
 * des Nutzers liegen. Das ist NICHT der Programmordner.
 */
function workspaceDir(state) {
  const ws = (state && state.workspace) || {};
  const hd = (state && state.health) || {};
  return ws.workspace || hd.workspace
    || (hd.paths && (hd.paths.workspace || hd.paths.root)) || '';
}

/**
 * Plattform des Servers: 'win32', 'darwin', 'linux' oder null.
 *
 * Vertrag: /api/health liefert `platform` als Objekt { os, label, ... }; wird
 * nur eine Zeichenkette geliefert, gilt die auch. Fehlt beides, wird die
 * Plattform aus der Form der Pfade abgeleitet. Laesst sich auch das nicht
 * entscheiden, kommt null zurueck und die Oberflaeche zeigt alle drei Wege,
 * statt einen zu raten.
 */
export function serverPlatform(source) {
  const p = source && source.platform;
  const os = typeof p === 'string' ? p : (p && p.os);
  if (os === 'win32' || os === 'darwin' || os === 'linux') return os;
  const paths = (source && source.paths) || {};
  const root = paths.root || (source && source.root) || '';
  if (/^[A-Za-z]:[\\/]/.test(root) || root.includes('\\')) return 'win32';
  if (/^\/Users\//.test(root)) return 'darwin';
  if (root.startsWith('/')) return 'linux';
  return null;
}

/** Reichen die vorhandenen Encoder fuer eine Auslieferung? */
export function ffmpegLevel(health) {
  const f = health && health.ffmpeg;
  if (!f || !f.found) return 'err';
  const enc = f.encoders || {};
  if (!enc.hap) return 'err';
  if (!enc.prores_ks || !enc.mpeg2video) return 'warn';
  return 'ok';
}

export function ffmpegSummary(health) {
  const f = health && health.ffmpeg;
  if (!health) return t('ffmpeg …');
  if (!f || !f.found) return t('ffmpeg fehlt');
  const enc = f.encoders || {};
  if (!enc.hap) return t('ffmpeg ohne HAP');
  return `ffmpeg ${f.version || ''} ${f.source === 'bundled' ? '(bin/)' : '(PATH)'}`.trim();
}

/** Braucht das geladene Venue hap? Liefert das Preset-Label oder null. */
function hapPreset(venue) {
  const del = venue && venue.delivery;
  const presets = (del && del.presets) || [];
  const def = presets.find((p) => p.id === del.defaultPreset) || presets[0];
  if (!def) return null;
  const usesHap = String(def.codecTag || '').toLowerCase().includes('hap')
    || (Array.isArray(def.args) && def.args.includes('hap'));
  return usesHap ? (def.label || def.id) : null;
}

export function createSetupView() {
  let handle = null;
  const body = h('div.col');

  function open() {
    if (handle) { render(store.get()); return handle; }
    handle = openModal({
      title: t('Einrichtung — ffmpeg'),
      body,
      onClose: () => { handle = null; },
    });
    render(store.get());
    return handle;
  }

  function close() {
    if (handle) handle.close();
  }

  async function refreshHealth() {
    try {
      const health = await getHealth();
      store.set({ health });
      setStatus(ffmpegSummary(health), ffmpegLevel(health) === 'ok' ? 'ok' : 'warn');
    } catch (e) {
      showError(t('Serverzustand konnte nicht gelesen werden'), e);
    }
  }

  function encoderRow(id, label, ok, note) {
    return h('div.row',
      h('span.amp', { class: ok ? 'amp ok' : 'amp err' }),
      h('b', { style: 'min-width:110px' }, id),
      h('span.dim', label),
      h('span.right.tag', { class: ok ? 'tag ok' : 'tag err' }, ok ? t('vorhanden') : t('fehlt')),
      note ? h('div', { style: 'flex-basis:100%' }, h('span.dim', { style: 'font-size:11.5px' }, note)) : null,
    );
  }

  /** Ein Block mit Befehlen fuer eine Plattform. */
  function platformBlock(key) {
    const commands = COMMANDS[key];
    if (!commands) return null;
    return h('div.col', { style: 'gap:4px' },
      h('b', platformLabel(key)),
      ...commands.map((c) => h('div.row',
        h('span.dim', { style: 'min-width:120px;font-size:11.5px' }, managerLabel(c.by)),
        h('div.cmdbox.grow', c.cmd),
        copyButton(() => c.cmd, t('Befehl kopieren')))),
      h('span.dim', { style: 'font-size:11.5px' }, platformHint(key)));
  }

  function render(state) {
    const health = state.health;
    const f = (health && health.ffmpeg) || null;
    const enc = (f && f.encoders) || {};
    const found = !!(f && f.found);
    const platform = serverPlatform(health) || serverPlatform(state.workspace);
    clear(body);

    // ---------------------------------------------------------- Lagebericht
    if (!health) {
      body.appendChild(h('div.msg.info', t('Der Serverzustand ist noch nicht bekannt.')));
    } else if (!found) {
      body.appendChild(h('div.msg.err',
        h('b', t('ffmpeg wurde nicht gefunden.')), h('br'),
        t('Ohne ffmpeg kann Theater-Bild-Gelöte nichts analysieren, keine Proxies bauen und nichts rendern. Die Oberfläche funktioniert, jede Verarbeitung schlägt aber fehl.')));
    } else if (!enc.hap) {
      const preset = hapPreset(state.venue);
      body.appendChild(h('div.msg.err',
        h('b', t('Dieses ffmpeg kann kein HAP.')), h('br'),
        t('Viele LED-Wiedergabesysteme verlangen .mov mit HAP bzw. HAP Q. Mit diesem Build ist eine HAP-Auslieferung unmöglich — es fehlt der Encoder im Programm, das ist keine Einstellung, die man umlegen könnte.'),
        preset ? h('br') : null,
        preset
          ? t('Das geladene Venue „{venue}“ liefert standardmäßig „{preset}“ und braucht damit hap.',
            { venue: state.venue.name || state.venue.id, preset })
          : null));
    } else {
      body.appendChild(h('div.msg.ok',
        h('b', t('ffmpeg ist einsatzbereit.')), ' ',
        t('Version {version}, Quelle: {source}.', {
          version: f.version || t('unbekannt'),
          source: f.source === 'bundled' ? t('bin/-Ordner des Projekts')
            : f.source === 'path' ? t('System-PATH') : f.source,
        })));
    }

    if (found && f.path) {
      body.appendChild(h('div.row', h('span.dim', { style: 'min-width:64px' }, t('Pfad')),
        h('span.mono.grow.nowrap', { title: f.path }, f.path),
        copyButton(() => f.path, t('Pfad kopieren'))));
    }

    // ------------------------------------------------------ Arbeitsverzeichnis
    if (health) {
      body.appendChild(h('h3', t('Arbeitsverzeichnis und Version')));
      const work = workspaceDir(state) || '—';
      const rows = [
        h('tr', h('td', { style: 'width:150px' }, t('Theater-Bild-Gelöte-Version')),
          h('td.mono', health.version || t('unbekannt'))),
        h('tr', h('td', t('Arbeitsverzeichnis')),
          h('td.mono.nowrap', { title: work }, work)),
      ];
      if (platform) {
        rows.push(h('tr', h('td', t('System')),
          h('td.mono', systemLine(state, platform))));
      }
      body.appendChild(h('table.tbl', h('tbody', rows)));
      body.appendChild(h('span.dim', { style: 'font-size:11px' },
        t('Hier liegen Projekte, Proxies und die fertigen Dateien. Der Programmordner steht weiter unten.')));
    }

    // ---------------------------------------------------------- Encoder-Ampel
    body.appendChild(h('h3', t('Encoder')));
    body.appendChild(h('div.col',
      encoderRow('hap', t('HAP-Auslieferung (HAP / HAP Q / HAP Alpha)'), !!enc.hap,
        enc.hap ? null : t('Ohne diesen Encoder gibt es kein lieferfähiges HAP-Format.')),
      encoderRow('prores_ks', t('ProRes als Austausch- und Archivformat'), !!enc.prores_ks),
      encoderRow('mpeg2video', t('MPEG-2 — von älteren Mediaservern verlangt'), !!enc.mpeg2video),
      encoderRow('libx264', t('Proxies für die Vorschau und Ansichtsexemplare zur Freigabe'), !!enc.libx264),
    ));

    // ---------------------------------------------------------- Automatik
    body.appendChild(h('h3', t('ffmpeg holen')));
    const btnInstall = h('button.btn.acc', { type: 'button' }, t('ffmpeg jetzt holen'));
    on(btnInstall, 'click', async () => {
      btnInstall.disabled = true;
      btnInstall.textContent = t('Wird geholt …');
      try {
        const res = await installFfmpeg();
        setStatus(t('ffmpeg wird geholt (Job {id}) — Fortschritt steht in der Jobleiste.', { id: res.jobId }));
      } catch (e) {
        showError(t('ffmpeg konnte nicht geholt werden'), e);
      } finally {
        btnInstall.disabled = false;
        btnInstall.textContent = t('ffmpeg jetzt holen');
      }
    });

    const btnCheck = h('button.btn', { type: 'button' }, t('Erneut prüfen'));
    on(btnCheck, 'click', () => { refreshHealth().then(() => render(store.get())); });

    const binDir = (health && health.paths && health.paths.bin) || 'bin/';
    body.appendChild(h('p.dim',
      t('Der Knopf lädt einen passenden Build nach {dir} und prüft die benötigten Encoder. Es wird nichts am System installiert.',
        { dir: binDir })));
    body.appendChild(h('div.row', btnInstall, btnCheck));

    // ---------------------------------------------------------- Plattformwege
    const manual = h('details.setup-manual', h('summary', t('Alternative Installation und technische Prüfung')));
    body.appendChild(manual);
    manual.appendChild(h('h3', platform ? t('Installation auf diesem System') : t('Installation')));
    if (!platform) {
      manual.appendChild(h('span.dim', { style: 'font-size:11.5px' },
        t('Der Server meldet seine Plattform nicht. Deshalb stehen hier die Wege für alle drei Systeme.')));
      for (const key of ['win32', 'darwin', 'linux']) manual.appendChild(platformBlock(key));
    } else {
      manual.appendChild(platformBlock(platform));
    }

    // ------------------------------------------------------- hap-Warnung
    // Ohne bekannte Plattform beide Schreibweisen zeigen: findstr gibt es nur
    // unter Windows, grep nur auf den anderen beiden.
    const verifyCmds = platform
      ? [verifyCommand(platform)]
      : [verifyCommand('win32'), verifyCommand('linux')];
    manual.appendChild(h('div.msg.warn',
      h('b', t('ffmpeg aus Paketquellen kommt häufig OHNE hap')), h('br'),
      t('Der hap-Encoder braucht libsnappy und ist in vielen fertigen Paketen nicht einkompiliert. Ein solches ffmpeg analysiert, konvertiert und rendert alles andere einwandfrei — nur eine HAP-Auslieferung ist damit unmöglich. Deshalb nach JEDER Installation prüfen, ob hap wirklich dabei ist:')));
    for (const cmd of verifyCmds) {
      manual.appendChild(h('div.row',
        h('div.cmdbox.grow', cmd),
        copyButton(() => cmd, t('Befehl kopieren'))));
    }
    manual.appendChild(h('p.dim',
      t('In der Ausgabe müssen {a} und {b} auftauchen. Fehlt hap, hilft nur ein anderer Build.',
        { a: 'hap', b: 'prores_ks' })));
    manual.appendChild(h('p.dim',
      t('Fehlt HAP, oben „ffmpeg jetzt holen“ wählen und danach die Encoder-Ampeln prüfen.')));

    // ---------------------------------------------------------- Pfade
    if (health && health.paths) {
      body.appendChild(h('h3', t('Ordner')));
      const rows = Object.entries(health.paths).map(([k, v]) =>
        h('tr',
          h('td', { style: 'width:150px' }, pathLabel(k)),
          h('td.mono.nowrap', { title: v || '' }, v || t('noch keine'))));
      body.appendChild(h('table.tbl', h('tbody', rows)));
      body.appendChild(h('span.dim', { style: 'font-size:11px' },
        t('Alle Pfade kommen vom Server und gelten auf dem Rechner, auf dem er läuft.')));
    }
  }

  function update(state) {
    if (handle) render(state);
  }

  /* Sprachwechsel: der Rumpf wird neu gezeichnet; die Titelzeile gehoert dem
   * Dialog selbst, also wird er einmal geschlossen und neu geoeffnet. */
  onLangChange(() => {
    if (!handle) return;
    const old = handle;
    handle = null;
    old.close();
    open();
  });

  return { open, close, update, get isOpen() { return !!handle; } };
}
