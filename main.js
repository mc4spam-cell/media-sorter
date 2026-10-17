'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
// ffmpeg-static resolves to a bundled binary. If the app is ever packed into an
// asar, the executable lives in the unpacked sibling dir — handle both.
let ffmpegPath = require('ffmpeg-static');
if (ffmpegPath && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

// trash@7 is ESM-only; load it lazily from CommonJS.
let trashFn = null;
async function getTrash() {
  if (!trashFn) {
    const mod = await import('trash');
    trashFn = mod.default;
  }
  return trashFn;
}

let mainWindow = null;
// A file the app was asked to open (via the OS "Open with" / file association)
// before a window was ready to receive it. The renderer pulls it once on init.
let pendingFile = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#000000',
    title: 'Media Sorter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Disable native page pinch-zoom so the app's own zoom handling is authoritative.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

// Some file managers launch the .desktop entry (Exec ... %U) with a file:// URI
// rather than a plain path. Convert those back to a filesystem path.
function argToPath(a) {
  if (!a.startsWith('file://')) return a;
  try {
    let rest = a.slice('file://'.length); // '/home/x' or 'host/home/x'
    const slash = rest.indexOf('/');
    if (slash > 0) rest = rest.slice(slash); // drop an optional host part
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

// Find the first CLI argument that is an existing file — the path a file manager
// passes when launching via "Open with". Skips the executable, the "." dev arg
// and any --flags; accepts both plain paths and file:// URIs. Returns an absolute
// path, or null.
function fileArgFrom(argv) {
  for (const raw of (argv || []).slice(1)) {
    if (!raw || raw.startsWith('-')) continue;
    const a = argToPath(raw);
    if (!a) continue;
    try {
      if (fs.statSync(a).isFile()) return path.resolve(a);
    } catch {}
  }
  return null;
}

// Hand a file to the renderer, waiting for the page to finish loading if needed.
function sendOpenFile(filePath) {
  if (!mainWindow || !filePath) return;
  const wc = mainWindow.webContents;
  const send = () => wc.send('open-file', filePath);
  if (wc.isLoading()) wc.once('did-finish-load', send);
  else send();
}

// macOS delivers "Open with" through this event, which can fire before the app
// is ready. Buffer it until a window exists; the renderer then pulls it.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (mainWindow) sendOpenFile(p);
  else pendingFile = p;
});

// Single instance: a second "Open with" launch should reuse the running window
// (Linux/Windows pass the file on the new process's argv).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileArgFrom(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (f) sendOpenFile(f);
    }
  });

  app.whenReady().then(() => {
    // Initial launch file from the command line (Linux/Windows); macOS may have
    // already set pendingFile via the open-file event above.
    if (!pendingFile) pendingFile = fileArgFrom(process.argv);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Renderer pulls the launch file once, on init (consumes it).
ipcMain.handle('app:getPendingFile', () => {
  const f = pendingFile;
  pendingFile = null;
  return f;
});

// ---------- IPC: folder picker ----------
ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// ---------- IPC: list files ----------
ipcMain.handle('fs:list', async (_e, folder, opts) => {
  const { exts = [], recursive = false, sortBy = 'name', sortDir = 'asc' } = opts || {};
  const extSet = new Set(exts.map((e) => '.' + String(e).toLowerCase().replace(/^\./, '')));
  const out = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir (permissions, etc.) — skip
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!extSet.has(path.extname(ent.name).toLowerCase())) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = (await fsp.stat(full)).mtimeMs;
      } catch {}
      out.push({ name: ent.name, path: full, mtimeMs, rel: path.relative(folder, full) });
    }
  }

  await walk(folder);

  const dir = sortDir === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    if (sortBy === 'mtime') return (a.mtimeMs - b.mtimeMs || 0) * dir;
    return a.name.localeCompare(b.name, undefined, { numeric: true }) * dir;
  });
  return out;
});

// ---------- IPC: trash ----------
ipcMain.handle('file:trash', async (_e, filePath) => {
  const trash = await getTrash();
  await trash(filePath);
  return true;
});

// ---------- IPC: rename ----------
ipcMain.handle('file:rename', async (_e, oldPath, newName) => {
  const dir = path.dirname(oldPath);
  // Keep the original extension if the user didn't type one.
  const oldExt = path.extname(oldPath);
  let safe = newName.trim();
  if (!safe) throw new Error('Empty name');
  // Strip any path separators the user may have typed.
  safe = safe.replace(/[/\\]/g, '_');
  if (!path.extname(safe)) safe += oldExt;
  let target = path.join(dir, safe);
  if (target === oldPath) return oldPath;
  // Avoid clobbering an existing file: append " (n)".
  const base = safe.slice(0, safe.length - path.extname(safe).length);
  const ext = path.extname(safe);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  await fsp.rename(oldPath, target);
  return target;
});

// ---------- External launch helpers ----------
// When the app runs as an AppImage, its runtime injects LD_LIBRARY_PATH and
// various plugin paths pointing at Electron's bundled libraries. A child GUI
// app (VLC, GIMP, Shotcut…) would inherit those and load incompatible libs —
// causing misplaced windows, frozen UIs and crashes. Strip them so children
// launch with a clean, system environment. AppRun saves originals as *_ORIG.
const LOADER_VARS = [
  'LD_LIBRARY_PATH', 'LD_PRELOAD',
  'GTK_PATH', 'GTK_IM_MODULE_FILE',
  'GDK_PIXBUF_MODULE_FILE', 'GDK_PIXBUF_MODULEDIR',
  'GIO_MODULE_DIR', 'GIO_EXTRA_MODULES',
  'QT_PLUGIN_PATH', 'QT_QPA_PLATFORM_PLUGIN_PATH', 'QTWEBENGINEPROCESS_PATH',
  'FONTCONFIG_FILE', 'FONTCONFIG_PATH',
  'GSETTINGS_SCHEMA_DIR',
  'GST_PLUGIN_SYSTEM_PATH', 'GST_PLUGIN_SYSTEM_PATH_1_0', 'GST_PLUGIN_PATH', 'GST_PLUGIN_PATH_1_0',
  'PYTHONPATH', 'PYTHONHOME', 'PERLLIB',
];
const RESTORE_VARS = ['LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS'];

function childEnv() {
  const env = { ...process.env };
  for (const k of LOADER_VARS) {
    const orig = env[k + '_ORIG'];
    if (orig != null && orig !== '') env[k] = orig;
    else delete env[k];
  }
  // Restore values the AppImage runtime saved before modifying them.
  for (const k of RESTORE_VARS) {
    const orig = env[k + '_ORIG'];
    if (orig != null) env[k] = orig;
  }
  delete env.CHROME_DESKTOP;
  return env;
}

// Launch a GUI program fully detached (own session) with a clean environment.
function spawnDetached(cmd, args, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore', env: childEnv() });
    p.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e.code === 'ENOENT' ? new Error(`${label || cmd} is not installed`) : e);
    });
    p.on('spawn', () => {
      if (settled) return;
      settled = true;
      p.unref();
      resolve(true);
    });
  });
}

// ---------- IPC: open in system default player ----------
ipcMain.handle('file:open', async (_e, filePath) => {
  if (process.platform === 'linux') {
    // Use xdg-open with a sanitized env (see childEnv) instead of shell.openPath,
    // which would hand the AppImage's polluted env to the default player.
    return spawnDetached('xdg-open', [filePath], 'the default video player');
  }
  const err = await shell.openPath(filePath); // '' on success
  if (err) throw new Error(err);
  return true;
});

// ---------- IPC: open in a specific external editor ----------
// macOS launches via `open -a <App>`; Linux runs the binary directly.
const EXTERNAL_APPS = {
  gimp: { mac: 'GIMP', linux: 'gimp', label: 'GIMP' },
  shotcut: { mac: 'Shotcut', linux: 'shotcut', label: 'Shotcut' },
};

ipcMain.handle('file:openWith', async (_e, filePath, appKey) => {
  const spec = EXTERNAL_APPS[appKey];
  if (!spec) throw new Error('Unknown app: ' + appKey);

  if (process.platform === 'darwin') {
    // `open` exits quickly and returns non-zero if the app isn't installed.
    return await new Promise((resolve, reject) => {
      let err = '';
      const p = spawn('open', ['-a', spec.mac, filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0 ? resolve(true) : reject(new Error(err.trim() || `${spec.label} not found`))
      );
    });
  }

  // Linux / other: launch the GUI binary detached with a clean environment.
  return spawnDetached(spec.linux, [filePath], spec.label);
});

// ---------- IPC: extract video frames (stop-motion) ----------
const FRAME_INTERVAL_SEC = 60; // one frame per 60s of video
const MAX_FRAMES = 20; // cap so very long videos stay reasonable
const FFMPEG_TIMEOUT_MS = 20000; // a single seek+decode should be quick

function cacheDirFor(filePath, mtimeMs) {
  const hash = crypto
    .createHash('sha1')
    .update(`${filePath}:${mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(app.getPath('userData'), 'frames', hash);
}

// Run ffmpeg, rejecting on non-zero exit or timeout.
function runFfmpeg(args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timeout'));
    }, timeoutMs);
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`));
    });
  });
}

// Read the duration (seconds) by parsing ffmpeg's banner on stderr.
function probeDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15000);
    proc.stderr.on('data', (d) => (err += d.toString()));
    const finish = () => {
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      if (!m) return resolve(null);
      resolve(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
    };
    proc.on('error', () => resolve(null));
    proc.on('close', finish);
  });
}

async function listFrameFiles(dir) {
  const files = (await fsp.readdir(dir))
    .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
    .sort();
  return files.map((f) => path.join(dir, f));
}

ipcMain.handle('video:frames', async (_e, filePath, mtimeMs) => {
  const dir = cacheDirFor(filePath, mtimeMs);
  const doneMarker = path.join(dir, '.done');

  // Return cached frames if extraction already completed.
  if (fs.existsSync(doneMarker)) {
    const cached = await listFrameFiles(dir);
    if (cached.length) return cached;
  }

  await fsp.mkdir(dir, { recursive: true });

  const dur = await probeDuration(filePath);

  // Build the list of timestamps to sample, one per FRAME_INTERVAL_SEC.
  let stamps;
  if (dur && dur > FRAME_INTERVAL_SEC) {
    stamps = [];
    for (let t = 0; t < dur && stamps.length < MAX_FRAMES; t += FRAME_INTERVAL_SEC) {
      stamps.push(t);
    }
  } else {
    // Short or unknown-duration video: a single representative frame near the start.
    stamps = [dur ? Math.min(1, dur / 2) : 1];
  }

  // Fast keyframe seek (-ss before -i) so we decode ~1 frame per stamp,
  // instead of decoding the whole file.
  let idx = 1;
  for (const t of stamps) {
    const out = path.join(dir, `frame_${String(idx).padStart(4, '0')}.jpg`);
    try {
      await runFfmpeg([
        '-ss', String(t),
        '-i', filePath,
        '-frames:v', '1',
        '-vf', 'scale=400:-2',
        '-q:v', '4',
        '-y', out,
      ]);
      if (fs.existsSync(out)) idx++;
    } catch (e) {
      // Skip this timestamp; a missing frame just shortens the stop-motion.
    }
  }

  let frames = await listFrameFiles(dir);

  // Last-ditch fallback: very first frame, no seek.
  if (frames.length === 0) {
    await runFfmpeg([
      '-i', filePath,
      '-frames:v', '1',
      '-vf', 'scale=400:-2',
      '-y', path.join(dir, 'frame_0001.jpg'),
    ]).catch(() => {});
    frames = await listFrameFiles(dir);
  }

  if (frames.length) await fsp.writeFile(doneMarker, '');
  return frames;
});
