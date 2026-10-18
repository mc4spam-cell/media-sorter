'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  uniqueTarget,
  sameVolume,
  hasRoomFor,
  copyWithProgress,
  moveFile,
} = require('./lib/fileops');
const { createUndoStack, STAGING_DIR } = require('./lib/undo');
const { rotateFile } = require('./lib/rotate');
// ffmpeg-static resolves to a bundled binary. If the app is ever packed into an
// asar, the executable lives in the unpacked sibling dir — handle both.
let ffmpegPath = require('ffmpeg-static');
if (ffmpegPath && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

// trash@7 is ESM-only; load it lazily from CommonJS.
// glob: false — trash expands paths as glob patterns by default, so trashing
// "a*.jpg" would also trash "ab.jpg". Our paths are always literal.
let trashFn = null;
async function getTrash() {
  if (!trashFn) {
    const mod = await import('trash');
    trashFn = (paths) => mod.default(paths, { glob: false });
  }
  return trashFn;
}

// Created once the app is ready (needs the userData path). Primary instance only:
// a second instance must never purge the running one's staged files.
let undoStack = null;
const PURGE_TIMEOUT_MS = 10000; // don't let a stuck trash call block quitting

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
      // Declared explicitly (not just relying on Electron's default) so the
      // renderer stays sandboxed across Electron upgrades. The preload only
      // uses electron's contextBridge/ipcRenderer, which work when sandboxed.
      sandbox: true,
    },
  });
  mainWindow = win;

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Disable native page pinch-zoom so the app's own zoom handling is authoritative.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  // Shortcuts ignore Ctrl/Cmd: Cmd+X must act exactly like X (FN-17). But the
  // default application menu (live even with the bar hidden, Linux included)
  // grabs Cmd/Ctrl+R (reload), +M (minimize), +Z/X/C/A (edit roles) and +0
  // (zoom) before the page sees them. Intercept those and forward them as the
  // bare key — except while a text field has focus, where they stay editing
  // shortcuts (select all, copy, paste, undo in the rename dialog).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || textEditing) return;
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    if (!FORWARDED_SHORTCUTS.has(key)) return;
    e.preventDefault();
    win.webContents.send('shortcut', { key: input.key, shift: input.shift });
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

// Keys the app binds that a Ctrl/Cmd combo must not steal (see createWindow).
// Cmd/Ctrl+Q, +W and +H are left to the menu (quit, close, hide).
const FORWARDED_SHORTCUTS = new Set([
  'a', 'c', 'g', 'm', 'r', 's', 'x', 'z', '0',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape',
]);
// True while a text field has focus in the renderer (reported over IPC).
let textEditing = false;
ipcMain.on('ui:textEditing', (_e, on) => {
  textEditing = !!on;
});

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

  // Purge the undo staging before quitting: staged files go to the OS trash.
  // Hold the quit once, run the purge (bounded), then quit for real.
  let purgedForQuit = false;
  app.on('before-quit', (e) => {
    if (purgedForQuit || !undoStack) return;
    e.preventDefault();
    purgedForQuit = true;
    const timeout = new Promise((r) => setTimeout(r, PURGE_TIMEOUT_MS));
    Promise.race([undoStack.purge(), timeout])
      .catch(() => {})
      .finally(() => app.quit());
  });

  app.whenReady().then(() => {
    // Initial launch file from the command line (Linux/Windows); macOS may have
    // already set pendingFile via the open-file event above.
    if (!pendingFile) pendingFile = fileArgFrom(process.argv);
    undoStack = createUndoStack({
      journalPath: path.join(app.getPath('userData'), 'undo-journal.json'),
      trash: async (p) => (await getTrash())(p),
      beginTransfer,
      rotate: (p, dir) => rotateFile(p, dir, { ffmpegPath }),
    });
    // Recover from a crash: whatever the last run left staged goes to the OS
    // trash. Queued ahead of any trash/undo the user triggers.
    undoStack.purge().catch(() => {});
    createWindow();
    // Best-effort, fire-and-forget: keep the frame cache from growing forever.
    pruneFrameCache().catch(() => {});
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
  const {
    exts = [],
    recursive = false,
    sortBy = 'name',
    sortDir = 'asc',
    showHidden = false,
    followSymlinks = false,
  } = opts || {};
  const extSet = new Set(exts.map((e) => '.' + String(e).toLowerCase().replace(/^\./, '')));
  const out = [];
  // Real paths of visited directories, to break symlink loops when following
  // links. Only consulted when followSymlinks is on.
  const seenDirs = new Set();

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir (permissions, etc.) — skip
    }
    for (const ent of entries) {
      // Skip dotfiles/dotfolders unless the user opted to show hidden entries.
      if (!showHidden && ent.name.startsWith('.')) continue;
      // Never list the undo staging dir, even with hidden entries shown.
      if (ent.name === STAGING_DIR) continue;
      const full = path.join(dir, ent.name);

      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      // Symlinks come back as neither file nor dir (readdir uses lstat).
      // Resolve the target type only when the user opted to follow links.
      if (ent.isSymbolicLink()) {
        if (!followSymlinks) continue;
        try {
          const st = await fsp.stat(full); // follows the link
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue; // broken link
        }
      }

      if (isDir) {
        if (recursive) {
          if (followSymlinks) {
            // Visit each real directory once so a link back up can't loop.
            let real;
            try {
              real = await fsp.realpath(full);
            } catch {
              real = full;
            }
            if (seenDirs.has(real)) continue;
            seenDirs.add(real);
          }
          await walk(full);
        }
        continue;
      }
      if (!isFile) continue;
      if (!extSet.has(path.extname(ent.name).toLowerCase())) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = (await fsp.stat(full)).mtimeMs;
      } catch {}
      out.push({ name: ent.name, path: full, mtimeMs, rel: path.relative(folder, full) });
    }
  }

  if (followSymlinks) {
    try {
      seenDirs.add(await fsp.realpath(folder));
    } catch {}
  }
  await walk(folder);

  const dir = sortDir === 'desc' ? -1 : 1;
  // In recursive mode, sort by the relative path so files group under their
  // folder (otherwise same-named files from different folders interleave).
  const nameKey = recursive ? 'rel' : 'name';
  out.sort((a, b) => {
    if (sortBy === 'mtime') return (a.mtimeMs - b.mtimeMs || 0) * dir;
    return a[nameKey].localeCompare(b[nameKey], undefined, { numeric: true }) * dir;
  });
  return out;
});

// Defense-in-depth: the renderer is local and trusted, but still validate that
// a mutating/opening operation targets an existing regular file before acting,
// so a malformed or unexpected path fails fast and cleanly. stat() follows
// symlinks, matching how fs:list decides an entry is a file.
async function assertRegularFile(filePath, label = 'File') {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error(`${label}: invalid path`);
  }
  let st;
  try {
    st = await fsp.stat(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
  if (!st.isFile()) throw new Error(`${label} is not a regular file: ${filePath}`);
  return st;
}

// ---------- IPC: trash (undoable) ----------
// Files are parked in their folder's staging dir as one undo entry (see
// lib/undo.js). Returns { trashed, fallback, errors }: `fallback` lists files
// that went straight to the OS trash (not undoable).
ipcMain.handle('file:trash', async (_e, paths) => {
  const valid = [];
  const errors = [];
  for (const p of [].concat(paths)) {
    try {
      await assertRegularFile(p);
      valid.push(p);
    } catch (e) {
      errors.push({ path: p, message: e.message });
    }
  }
  const res = valid.length
    ? await undoStack.trashFiles(valid)
    : { trashed: [], fallback: [], errors: [] };
  res.errors.push(...errors);
  return res;
});

// ---------- IPC: undo ----------
// Undo the latest action. Returns { label, restored, errors }, or null when
// there is nothing to undo.
ipcMain.handle('undo:pop', () => undoStack.pop());
ipcMain.handle('undo:peek', () => undoStack.peek());

// ---------- IPC: rename ----------
ipcMain.handle('file:rename', async (_e, oldPath, newName) => {
  await assertRegularFile(oldPath);
  const dir = path.dirname(oldPath);
  const oldExt = path.extname(oldPath);
  let safe = newName.trim();
  if (!safe) throw new Error('Empty name');
  // Strip any path separators the user may have typed.
  safe = safe.replace(/[/\\]/g, '_');
  // Always keep the original extension. We append it unless the typed name
  // already ends with it (case-insensitive, then normalized to oldExt). The
  // whole typed string is otherwise the base name, so a descriptive dot
  // (e.g. "budget.2024") is no longer mistaken for an extension and can't
  // drop the real one. A file that had no extension keeps the name as typed.
  if (oldExt) {
    if (safe.toLowerCase().endsWith(oldExt.toLowerCase())) {
      safe = safe.slice(0, safe.length - oldExt.length) + oldExt;
    } else {
      safe += oldExt;
    }
  }
  if (path.join(dir, safe) === oldPath) return oldPath;
  // Avoid clobbering an existing file: append " (n)".
  const target = uniqueTarget(dir, safe);
  await fsp.rename(oldPath, target);
  await undoStack.record(`Rename ${path.basename(oldPath)}`, [
    { type: 'rename', from: oldPath, to: target },
  ]);
  return target;
});

// ---------- Transfers (move / copy) with progress ----------
// One byte-copying transfer at a time (a move/copy, or an undo bringing files
// back across volumes). Progress is pushed to the renderer, which shows an
// overlay with a Cancel button.
let activeTransfer = null;
const PROGRESS_INTERVAL_MS = 100;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function beginTransfer({ totalBytes, fileCount }) {
  if (activeTransfer) throw new Error('Another transfer is running');
  const ctrl = new AbortController();
  let base = 0; // bytes of the files already finished
  let fileIndex = 0;
  let lastSent = 0;
  const t = {
    signal: ctrl.signal,
    abort: () => ctrl.abort(),
    // Options for one copy/move: reports overall progress, honors Cancel.
    forFile(name) {
      fileIndex++;
      let fileBytes = 0;
      const report = (force) => {
        const now = Date.now();
        if (!force && now - lastSent < PROGRESS_INTERVAL_MS) return;
        lastSent = now;
        sendToRenderer('transfer:progress', {
          name, fileIndex, fileCount, bytesDone: base + fileBytes, bytesTotal: totalBytes,
        });
      };
      report(true);
      return {
        signal: ctrl.signal,
        onProgress: (done, size) => {
          fileBytes = done;
          if (done >= size) {
            base += size;
            fileBytes = 0;
          }
          report(false);
        },
      };
    },
    end() {
      if (activeTransfer === t) activeTransfer = null;
      sendToRenderer('transfer:end');
    },
  };
  activeTransfer = t;
  return t;
}

ipcMain.handle('file:transferCancel', () => {
  if (activeTransfer) activeTransfer.abort();
});

// Move or copy files into destDir. Same-volume moves are instant renames;
// copies and cross-volume moves stream with progress, after checking the
// destination has room. Name collisions get " (n)". The batch is ONE undo
// entry (also when cancelled midway: what was done stays undoable).
// Returns { done: [{from, to}], skipped, errors, cancelled }.
ipcMain.handle('file:transfer', async (_e, paths, destDir, mode) => {
  if (mode !== 'move' && mode !== 'copy') throw new Error('Unknown mode: ' + mode);
  let st;
  try {
    st = await fsp.stat(destDir);
  } catch {
    throw new Error(`Destination not found: ${destDir}`);
  }
  if (!st.isDirectory()) throw new Error(`Not a folder: ${destDir}`);

  const errors = [];
  let skipped = 0;
  const jobs = []; // { src, size, copies }
  for (const src of [].concat(paths)) {
    try {
      const s = await assertRegularFile(src);
      // Moving a file into its own folder is a no-op.
      if (mode === 'move' && path.dirname(src) === destDir) {
        skipped++;
        continue;
      }
      const copies = mode === 'copy' || !(await sameVolume(src, destDir));
      jobs.push({ src, size: s.size, copies });
    } catch (e) {
      errors.push({ path: src, message: e.message });
    }
  }

  const totalBytes = jobs.reduce((n, j) => n + (j.copies ? j.size : 0), 0);
  if (totalBytes) {
    const room = await hasRoomFor(destDir, totalBytes);
    if (!room.ok) throw new Error(room.message);
  }

  const fileCount = jobs.filter((j) => j.copies).length;
  const transfer = totalBytes ? beginTransfer({ totalBytes, fileCount }) : null;
  const ops = [];
  let cancelled = false;
  try {
    for (const job of jobs) {
      if (transfer && transfer.signal.aborted) {
        cancelled = true;
        break;
      }
      const to = uniqueTarget(destDir, path.basename(job.src));
      const opts = job.copies && transfer ? transfer.forFile(path.basename(job.src)) : {};
      try {
        if (mode === 'copy') {
          await copyWithProgress(job.src, to, opts);
          ops.push({ type: 'copy', from: job.src, to });
        } else {
          const { crossVolume } = await moveFile(job.src, to, opts);
          ops.push({ type: 'move', from: job.src, to, crossVolume });
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          cancelled = true;
          break;
        }
        errors.push({ path: job.src, message: e.message });
      }
    }
  } finally {
    if (transfer) transfer.end();
  }

  if (ops.length) {
    const n = ops.length;
    const verb = mode === 'move' ? 'Move' : 'Copy';
    const what = n === 1 ? path.basename(ops[0].from) : `${n} files`;
    await undoStack.record(`${verb} ${what} to ${path.basename(destDir)}`, ops);
  }
  return { done: ops.map(({ from, to }) => ({ from, to })), skipped, errors, cancelled };
});

// ---------- IPC: rotate photos 90° ----------
// Rotates each file in place (lib/rotate.js: lossless; mtime kept), one at a
// time. The batch is ONE undo entry. Returns { rotated: [path], errors }.
ipcMain.handle('file:rotate', async (_e, paths, dir) => {
  if (dir !== 'cw' && dir !== 'ccw') throw new Error('Unknown direction: ' + dir);
  const rotated = [];
  const errors = [];
  for (const p of [].concat(paths)) {
    try {
      await assertRegularFile(p);
      await rotateFile(p, dir, { ffmpegPath });
      rotated.push(p);
    } catch (e) {
      errors.push({ path: p, message: e.message });
    }
  }
  if (rotated.length) {
    const what = rotated.length === 1 ? path.basename(rotated[0]) : `${rotated.length} files`;
    await undoStack.record(
      `Rotate ${what} ${dir === 'cw' ? 'right' : 'left'}`,
      rotated.map((p) => ({ type: 'rotate', path: p, dir }))
    );
  }
  return { rotated, errors };
});

// ---------- IPC: batch rename (prefix) ----------
// Renames each file to <prefix><name> in its own folder, one at a time so a
// collision created by an earlier file of the batch is seen by the next (" (n)"
// suffix). The whole batch is ONE undo entry. Returns { renamed: [{from, to}],
// errors }.
ipcMain.handle('file:renameBatch', async (_e, paths, prefix) => {
  if (typeof prefix !== 'string' || !prefix.trim()) throw new Error('Empty prefix');
  // A prefix is part of a name: no path separators.
  const safe = prefix.replace(/[/\\]/g, '_');
  const renamed = [];
  const errors = [];
  for (const p of [].concat(paths)) {
    try {
      await assertRegularFile(p);
      const to = uniqueTarget(path.dirname(p), safe + path.basename(p));
      await fsp.rename(p, to);
      renamed.push({ from: p, to });
    } catch (e) {
      errors.push({ path: p, message: e.message });
    }
  }
  if (renamed.length) {
    await undoStack.record(
      `Prefix "${safe}" on ${renamed.length} file${renamed.length > 1 ? 's' : ''}`,
      renamed.map(({ from, to }) => ({ type: 'rename', from, to }))
    );
  }
  return { renamed, errors };
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
  await assertRegularFile(filePath);
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
  await assertRegularFile(filePath);

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

// Frame-cache housekeeping. The cache at userData/frames grows one dir per
// (video path + mtime), and nothing ever removed it: a re-encoded, renamed or
// trashed video leaves its frames behind forever. We prune on startup, evicting
// first by age, then least-recently-used until under a size cap. A cache hit
// bumps the dir's mtime (see the video:frames handler) so "LRU" tracks real use.
const CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const CACHE_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

async function dirSize(dir) {
  let total = 0;
  const files = await fsp.readdir(dir).catch(() => []);
  for (const f of files) {
    const st = await fsp.stat(path.join(dir, f)).catch(() => null);
    if (st && st.isFile()) total += st.size;
  }
  return total;
}

async function pruneFrameCache() {
  const root = path.join(app.getPath('userData'), 'frames');
  const names = await fsp.readdir(root).catch(() => null);
  if (!names) return; // nothing cached yet

  const now = Date.now();
  const entries = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    // Evict anything untouched for longer than the max age.
    if (now - st.mtimeMs > CACHE_MAX_AGE_MS) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    entries.push({ dir, mtimeMs: st.mtimeMs, size: await dirSize(dir) });
  }

  // Oldest (least recently used) first, then drop until under the byte cap.
  let total = entries.reduce((n, e) => n + e.size, 0);
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const e of entries) {
    if (total <= CACHE_MAX_BYTES) break;
    await fsp.rm(e.dir, { recursive: true, force: true }).catch(() => {});
    total -= e.size;
  }
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
    if (cached.length) {
      // Bump mtime so this dir counts as recently used for cache pruning.
      const now = new Date();
      fsp.utimes(dir, now, now).catch(() => {});
      return cached;
    }
  }

  await fsp.mkdir(dir, { recursive: true });

  const dur = await probeDuration(filePath);

  // Build the list of timestamps to sample. We take at most MAX_FRAMES frames
  // and spread them across the WHOLE video: keep the 1-frame-per-minute cadence
  // for short/medium clips, but widen the step for long videos (interval =
  // dur / MAX_FRAMES) so the stop-motion covers the full duration instead of
  // stopping ~MAX_FRAMES minutes in.
  let stamps;
  if (dur && dur > FRAME_INTERVAL_SEC) {
    const interval = Math.max(FRAME_INTERVAL_SEC, dur / MAX_FRAMES);
    stamps = [];
    for (let t = 0; t < dur && stamps.length < MAX_FRAMES; t += interval) {
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
