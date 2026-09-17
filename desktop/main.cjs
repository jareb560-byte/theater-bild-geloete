'use strict';
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { listenLocal } = require('./local-server.cjs');

const smokeFile = process.env.TBG_DESKTOP_SMOKE;
let window;
let local;
let projects;
let jobs;
let mayClose = false;
let closing = false;
let origin;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window) { window.show(); window.focus(); } });
  app.whenReady().then(boot).catch(fail);
}

function writeSmoke(result) {
  if (smokeFile) fs.writeFileSync(smokeFile, JSON.stringify(result, null, 2));
}

async function fail(err) {
  console.error(err);
  writeSmoke({ ok: false, error: err?.stack || String(err) });
  if (!smokeFile) dialog.showErrorBox('Theater-Bild-Gelöte konnte nicht starten', String(err?.message || err));
  app.exit(1);
}

async function boot() {
  // Keep the same workspace as the CLI, so an existing project is adopted.
  // Never write into the signed/installed program directory.
  const moduleAt = (file) => import(pathToFileURL(path.join(__dirname, '..', 'server', file)).href);
  const [{ app: serverApp }, projectModule, jobModule] = await Promise.all([
    moduleAt('index.js'), moduleAt('project.js'), moduleAt('jobs.js'),
  ]);
  projects = projectModule;
  jobs = jobModule;
  projects.current(); // Load the workspace autosave before the first window.
  // Stable origin preserves UI preferences. Fall back safely if another local
  // process occupies it; authentication is per launch regardless of port.
  local = await listenLocal(serverApp, smokeFile ? 0 : 17333);
  origin = local.origin;
  const appSession = session.fromPartition('persist:tbg-desktop');
  appSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'X-TBG-Desktop': local.token } });
  });
  appSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' && contents?.getURL().startsWith(origin + '/')));
  appSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && requestingOrigin === origin);
  createWindow(appSession);
  await window.loadURL(origin);
  if (smokeFile) {
    // Exercise the real packaged HTTP server AND sandboxed renderer, including
    // Three.js imports. CI checks FFmpeg separately on the native OS/architecture.
    const result = await window.webContents.executeJavaScript(`(async () => {
      const health = await fetch('/api/health').then(r => r.json());
      const three = await import('three');
      const store = await import('/src/store.js');
      return { ok: health.ok && !!three.Scene && typeof store.flushSave === 'function',
        platform: health.platform, nodeInRenderer: typeof process !== 'undefined',
        hasApp: !!document.querySelector('#app') };
    })()`);
    writeSmoke(result);
    await shutdown();
    app.exit(result.ok && result.hasApp && !result.nodeInRenderer ? 0 : 1);
  }
}

function createWindow(appSession) {
  window = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1000, minHeight: 700,
    backgroundColor: '#101418', title: 'Theater-Bild-Gelöte', show: false,
    webPreferences: { session: appSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Datei', submenu: [{ label: 'Arbeitsordner öffnen', click: async () => { const p = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'paths.js')).href); await shell.openPath(p.paths.workspace); } }, { type: 'separator' }, { role: 'quit', label: 'Beenden' }] },
    { label: 'Bearbeiten', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ansicht', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  window.once('ready-to-show', () => { if (!smokeFile) window.show(); });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', async (event) => {
    // beforeunload can also represent uncommitted venue edits.
    const answer = dialog.showMessageBoxSync(window, { type: 'warning', message: 'Ungespeicherte Änderungen verwerfen?', buttons: ['Zurück zur App', 'Änderungen verwerfen'], defaultId: 0, cancelId: 0 });
    if (answer === 1) event.preventDefault();
    else { mayClose = false; closing = false; }
  });
  window.on('close', (event) => {
    if (mayClose || smokeFile) return;
    event.preventDefault();
    if (!closing) closeSafely();
  });
  window.on('closed', () => { window = null; app.quit(); });
}

function openExternal(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && url.hostname === 'github.com') shell.openExternal(url.href);
  } catch { /* no external protocols or local file navigation */ }
}

async function closeSafely() {
  closing = true;
  try {
    const active = jobs.list().filter(j => ['running', 'queued'].includes(j.status));
    if (active.length) {
      const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Es laufen noch Aufträge.', detail: 'Beim Beenden werden laufende Render- und Downloadaufträge abgebrochen.', buttons: ['Weiterarbeiten', 'Aufträge abbrechen und beenden'], defaultId: 0, cancelId: 0 });
      if (answer.response === 0) return;
    }
    const saved = await window.webContents.executeJavaScript(`import('/src/store.js').then(async s => !s.isDirty() || await s.flushSave())`);
    if (!saved) {
      await dialog.showMessageBox(window, { type: 'error', message: 'Das Projekt konnte nicht gespeichert werden.', detail: 'Die App bleibt offen. Prüfe den Arbeitsordner und speichere erneut.' });
      return;
    }
    const persisted = projects.autosaveNow();
    if (!persisted) throw new Error('Das Projekt konnte nicht auf die Festplatte geschrieben werden. Prüfe freien Speicherplatz und Schreibrechte.');
    mayClose = true;
    window.close();
  } catch (err) {
    dialog.showErrorBox('Speichern fehlgeschlagen', err.message);
  } finally { closing = false; }
}

async function shutdown() {
  for (const job of jobs?.list() || []) if (['running', 'queued'].includes(job.status)) jobs.cancel(job.id);
  projects?.autosaveNow();
  local?.server.closeAllConnections();
  if (local) await new Promise(resolve => local.server.close(resolve));
}

app.on('before-quit', (event) => {
  if (window && !mayClose && !smokeFile) { event.preventDefault(); if (!closing) closeSafely(); }
});
app.on('will-quit', () => { shutdown().catch(console.error); });
app.on('window-all-closed', () => app.quit());
