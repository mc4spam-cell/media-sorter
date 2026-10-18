'use strict';

// The renderer script can be evaluated more than once in this realm; guard so
// top-level bindings (now function-scoped via the IIFE) never collide and
// listeners are only attached once.
(function () {
  if (window.__mediaSorterInit) {
    console.log('renderer.js re-evaluated; skipping init');
    return;
  }
  window.__mediaSorterInit = true;

const api = window.api;

// ---------- File types ----------
const TYPE_SETS = {
  photos: { default: ['jpg', 'jpeg', 'png', 'webp'], extra: ['gif', 'bmp', 'avif'] },
  videos: { default: ['avi', 'mpg', 'mpeg', 'mkv'], extra: ['mp4', 'mov', 'm4v', 'webm', 'wmv', 'flv', '3gp'] },
};

// ---------- State ----------
const state = {
  folder: null,
  kind: 'photos', // 'photos' | 'videos'
  items: [], // { name, path, mtimeMs, rel }
  cursor: 0, // index of the current file: keyboard focus, viewer, Enter, G/S
  sel: new Set(), // selected file PATHS (indices shift on trash/reload)
  anchor: 0, // index Shift-click / Shift+arrow ranges start from
  fullscreen: false,
  recursive: false,
  maximize: false, // upscale photos to fill the window in fullscreen
  confirmDelete: true, // ask before sending a file to the trash (X key)
  showHidden: false, // list dotfiles / dotfolders
  followSymlinks: false, // follow symbolic links when scanning
  sortBy: 'name', // 'name' | 'mtime'
  sortDir: 'asc', // 'asc' | 'desc'
  types: {
    photos: new Set(TYPE_SETS.photos.default),
    videos: new Set(TYPE_SETS.videos.default),
  },
};

// ---------- Preferences (persisted) ----------
const PREF_KEY = 'prefs';
function savePrefs() {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        recursive: state.recursive,
        maximize: state.maximize,
        confirmDelete: state.confirmDelete,
        showHidden: state.showHidden,
        followSymlinks: state.followSymlinks,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
        types: { photos: [...state.types.photos], videos: [...state.types.videos] },
      })
    );
  } catch {}
}
function loadPrefs() {
  let p;
  try {
    p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch {
    return;
  }
  if (typeof p.recursive === 'boolean') state.recursive = p.recursive;
  if (typeof p.maximize === 'boolean') state.maximize = p.maximize;
  if (typeof p.confirmDelete === 'boolean') state.confirmDelete = p.confirmDelete;
  if (typeof p.showHidden === 'boolean') state.showHidden = p.showHidden;
  if (typeof p.followSymlinks === 'boolean') state.followSymlinks = p.followSymlinks;
  if (p.sortBy === 'name' || p.sortBy === 'mtime') state.sortBy = p.sortBy;
  if (p.sortDir === 'asc' || p.sortDir === 'desc') state.sortDir = p.sortDir;
  if (p.types) {
    for (const k of ['photos', 'videos']) {
      if (Array.isArray(p.types[k])) {
        // Drop any saved extension that is no longer a known type (e.g. tiff /
        // heic removed), so it can't keep filtering with no checkbox to clear.
        const known = new Set([...TYPE_SETS[k].default, ...TYPE_SETS[k].extra]);
        state.types[k] = new Set(p.types[k].filter((e) => known.has(e)));
      }
    }
  }
}

function activeExts() {
  return [...state.types[state.kind]];
}

// Deferred per-cell video work (extraction + stop-motion), gated by an
// IntersectionObserver so a folder of hundreds of videos doesn't extract every
// file up front or run hundreds of timers at once. Photos use loading="lazy".
const cellWork = new Map(); // cell element -> video work record
let gridObserver = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const gridEl = $('grid');
const viewerEl = $('viewer');
const viewerImg = $('viewerImg');
const viewerCaption = $('viewerCaption');
const viewerError = $('viewerError');
const renameModal = $('renameModal');
const renameInput = $('renameInput');
const prefixModal = $('prefixModal');
const prefixInput = $('prefixInput');
const transferModal = $('transferModal');
const prefsModal = $('prefsModal');
const confirmModal = $('confirmModal');
const toastEl = $('toast');

// ---------- Helpers ----------
// Error text for toasts, without Electron's "Error invoking remote method
// 'x': Error: " wrapper around errors thrown in main.
function errMsg(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.add('hidden'), 1800);
}

function stopCell(st) {
  if (st && st.timer) {
    clearInterval(st.timer);
    st.timer = null;
  }
}
function stopAllTimers() {
  for (const st of cellWork.values()) stopCell(st);
}

function isModalOpen() {
  return (
    !renameModal.classList.contains('hidden') ||
    !prefixModal.classList.contains('hidden') ||
    !transferModal.classList.contains('hidden') ||
    !prefsModal.classList.contains('hidden') ||
    !confirmModal.classList.contains('hidden')
  );
}

// ---------- Loading ----------
async function pickFolder() {
  try {
    if (!api || typeof api.openFolder !== 'function') {
      throw new Error('preload bridge missing (window.api undefined)');
    }
    const folder = await api.openFolder();
    if (!folder) return;
    state.folder = folder;
    $('folderPath').textContent = folder;
    await loadList({ reset: true });
  } catch (e) {
    console.error('pickFolder failed:', e);
    toast('Open folder failed: ' + errMsg(e));
  }
}

// Monotonic token so overlapping listings can't clobber each other: a slow
// api.list() that resolves after a newer call is discarded.
// reset: a new folder or mode — start on the first file. Otherwise (re-sort,
// type filter, undo…) keep the selection for files still listed, and the cursor
// on the same file when it's still there.
let listSeq = 0;
async function loadList({ reset = false } = {}) {
  if (!state.folder) return;
  const seq = ++listSeq;
  const prevCursorPath = cursorItem() ? cursorItem().path : null;
  stopAllTimers();
  let items;
  try {
    items = await api.list(state.folder, {
      exts: activeExts(),
      recursive: state.recursive,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      showHidden: state.showHidden,
      followSymlinks: state.followSymlinks,
    });
  } catch (e) {
    if (seq !== listSeq) return; // superseded; stay silent
    toast('List failed: ' + errMsg(e));
    return;
  }
  if (seq !== listSeq) return; // a newer loadList() started: drop this stale result
  state.items = items;
  if (reset) {
    state.cursor = 0;
    state.sel = new Set(items.length ? [items[0].path] : []);
  } else {
    const listed = new Set(items.map((it) => it.path));
    state.sel = new Set([...state.sel].filter((p) => listed.has(p)));
    const idx = items.findIndex((it) => it.path === prevCursorPath);
    state.cursor = idx >= 0 ? idx : Math.max(0, Math.min(state.cursor, items.length - 1));
    if (!state.sel.size && items.length) state.sel.add(items[state.cursor].path);
  }
  state.anchor = state.cursor;
  renderGrid();
  updateCount();
}

function updateCount() {
  const n = state.sel.size;
  $('count').textContent =
    `${state.items.length} ${state.kind}` + (n > 1 ? ` · ${n} selected` : '');
}

// ---------- Grid rendering ----------
// Tear down the previous render's deferred work and start a fresh observer.
function resetGrid() {
  if (gridObserver) gridObserver.disconnect();
  stopAllTimers();
  cellWork.clear();
  queue.length = 0;
  gridObserver = new IntersectionObserver(onIntersect, {
    root: gridEl,
    rootMargin: '400px 0px', // start work a bit before a tile scrolls in
    threshold: 0,
  });
}

// Cell element per item index, so selection repaints don't query the DOM.
let cells = [];

function renderGrid() {
  resetGrid();
  gridEl.innerHTML = '';
  cells = [];
  state.items.forEach((item, idx) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.idx = String(idx);
    cells.push(cell);

    const label = document.createElement('div');
    label.className = 'label';
    // When scanning subfolders, show the relative path so duplicates are clear.
    label.textContent = state.recursive && item.rel ? item.rel : item.name;
    cell.title = item.path;

    const img = document.createElement('img');
    img.alt = item.name;

    if (state.kind === 'photos') {
      // Native lazy-loading: thousands of off-screen photos aren't decoded
      // until they approach the viewport.
      img.loading = 'lazy';
      img.src = api.toFileURL(item.path);
      // Some files can't be decoded (corrupt / unexpected codec) — show the ext.
      img.addEventListener('error', () => {
        if (cell.querySelector('.badge')) return;
        const b = document.createElement('div');
        b.className = 'badge';
        b.textContent = (item.name.split('.').pop() || '').toUpperCase();
        cell.appendChild(b);
      });
      cell.appendChild(img);
    } else {
      cell.classList.add('loading');
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'VIDEO';
      cell.appendChild(img);
      cell.appendChild(badge);
      // Extraction + animation are deferred to the observer (near-viewport only).
      cellWork.set(cell, {
        item,
        img,
        cell,
        started: false,
        frames: null,
        timer: null,
        frameIndex: 0,
        visible: false,
      });
    }

    cell.appendChild(label);
    // Click selects (Shift: range, Cmd/Ctrl: toggle); double-click opens.
    cell.addEventListener('click', (e) => {
      if (e.shiftKey) select(idx, 'range');
      else if (e.metaKey || e.ctrlKey) select(idx, 'toggle');
      else select(idx);
    });
    cell.addEventListener('dblclick', (e) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      select(idx);
      openCurrent();
    });
    gridEl.appendChild(cell);
    if (state.kind === 'videos') gridObserver.observe(cell);
  });
  paintSelection();
  scrollCursorIntoView();
}

// ---------- Video stop-motion (lazy, viewport-gated) ----------
// Limit concurrent ffmpeg extractions.
const MAX_CONCURRENT = 2;
let running = 0;
const queue = [];

// Called when video tiles enter or leave the (padded) viewport.
function onIntersect(entries) {
  for (const e of entries) {
    const st = cellWork.get(e.target);
    if (!st) continue;
    if (e.isIntersecting) {
      st.visible = true;
      if (!st.started) queueExtract(st); // first approach: extract
      else startAnimation(st); // back on screen: resume
    } else {
      st.visible = false;
      stopCell(st); // off screen: pause the stop-motion timer
    }
  }
}

function queueExtract(st) {
  st.started = true;
  queue.push(st);
  pump();
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const st = queue.shift();
    if (!st.cell.isConnected) continue; // re-rendered away before we got to it
    running++;
    extractFrames(st).finally(() => {
      running--;
      pump();
    });
  }
}

// Stop the spinner and turn the corner badge into a "no preview" marker,
// used both when extraction errors out and when it yields zero frames.
function markNoPreview(cell) {
  cell.classList.remove('loading');
  const lbl = cell.querySelector('.badge');
  if (lbl) lbl.textContent = 'NO PREVIEW';
}

function startAnimation(st) {
  if (!st.frames || st.frames.length < 2 || st.timer) return;
  st.img.src = api.toFileURL(st.frames[st.frameIndex]);
  // Each frame stays for 1s -> stop-motion / timelapse effect.
  st.timer = setInterval(() => {
    if (!st.cell.isConnected) {
      stopCell(st);
      return;
    }
    st.frameIndex = (st.frameIndex + 1) % st.frames.length;
    st.img.src = api.toFileURL(st.frames[st.frameIndex]);
  }, 1000);
}

async function extractFrames(st) {
  if (!st.cell.isConnected) return;
  let frames;
  try {
    frames = await api.videoFrames(st.item.path, st.item.mtimeMs);
  } catch (e) {
    markNoPreview(st.cell);
    return;
  }
  if (!st.cell.isConnected) return;
  // Extraction completed but produced nothing (corrupt file, unsupported
  // codec, empty video): show "NO PREVIEW" instead of a perpetual spinner.
  if (!frames || !frames.length) {
    markNoPreview(st.cell);
    return;
  }
  st.cell.classList.remove('loading');
  st.frames = frames;
  st.frameIndex = 0;
  st.img.src = api.toFileURL(frames[0]);
  // Animate only if still on screen (and more than one frame).
  if (st.visible) startAnimation(st);
}

// ---------- Selection ----------
// The cursor is the current file; the selection is a set of paths the bulk
// actions (X, and later move/copy/batch rename) apply to in the grid.
function cursorItem() {
  return state.items[state.cursor];
}

// Selected items, in list order.
function selectedItems() {
  return state.items.filter((it) => state.sel.has(it.path));
}

// What an action applies to: the selection in the grid, only the displayed
// photo in the fullscreen viewer.
function actionTargets() {
  if (state.fullscreen) return cursorItem() ? [cursorItem()] : [];
  return selectedItems();
}

// Move the cursor to idx and update the selection:
//   'only'   select just this file (plain click, arrows)
//   'toggle' add/remove it (Cmd/Ctrl-click)
//   'range'  select anchor..idx (Shift-click, Shift+arrows)
function select(idx, mode = 'only') {
  if (!state.items.length) return;
  idx = Math.max(0, Math.min(idx, state.items.length - 1));
  const p = state.items[idx].path;
  if (mode === 'toggle') {
    if (state.sel.has(p)) state.sel.delete(p);
    else state.sel.add(p);
    state.anchor = idx;
  } else if (mode === 'range') {
    const [a, b] = [Math.min(state.anchor, idx), Math.max(state.anchor, idx)];
    state.sel = new Set(state.items.slice(a, b + 1).map((it) => it.path));
  } else {
    state.sel = new Set([p]);
    state.anchor = idx;
  }
  state.cursor = idx;
  paintSelection();
  scrollCursorIntoView();
  if (state.fullscreen) updateViewer();
}

// Select these paths (those listed), cursor on the first one.
function selectPaths(paths) {
  const want = new Set(paths);
  const idx = state.items.findIndex((it) => want.has(it.path));
  if (idx < 0) return false;
  select(idx);
  for (const it of state.items) if (want.has(it.path)) state.sel.add(it.path);
  paintSelection();
  return true;
}

function selectAll() {
  state.sel = new Set(state.items.map((it) => it.path));
  paintSelection();
}

function paintSelection() {
  gridEl.classList.toggle('multi', state.sel.size > 1);
  cells.forEach((c, i) => {
    c.classList.toggle('selected', state.sel.has(state.items[i].path));
    c.classList.toggle('cursor', i === state.cursor);
  });
  updateCount();
}

function move(delta, extend = false) {
  if (!state.items.length) return;
  select(state.cursor + delta, extend && !state.fullscreen ? 'range' : 'only');
}

function scrollCursorIntoView() {
  const cell = cells[state.cursor];
  if (cell) cell.scrollIntoView({ block: 'nearest' });
}

// ---------- Fullscreen viewer (photos only) ----------
function openViewer() {
  if (state.kind !== 'photos' || !state.items.length) return;
  state.fullscreen = true;
  viewerEl.classList.remove('hidden');
  updateViewer();
}

function closeViewer() {
  state.fullscreen = false;
  viewerEl.classList.add('hidden');
}

// Open the current file: fullscreen viewer for photos, OS player for videos
// (double-click / Enter).
function openCurrent() {
  if (state.kind === 'photos') openViewer();
  else playCurrent();
}

// Play the current video in the system's default player (Chromium can't
// decode avi/mpg/mkv, so we hand off to the OS).
async function playCurrent() {
  const item = cursorItem();
  if (!item) return;
  try {
    await api.openExternal(item.path);
  } catch (e) {
    toast('Cannot open video: ' + errMsg(e));
  }
}

// Open the current file in a specific external editor (GIMP / Shotcut).
async function openWithApp(app) {
  const item = cursorItem();
  if (!item) return;
  const label = app === 'gimp' ? 'GIMP' : 'Shotcut';
  try {
    await api.openWith(item.path, app);
    toast(`Opening in ${label}…`);
  } catch (e) {
    toast(`Cannot open in ${label}: ${errMsg(e)}`);
  }
}

// Formats Chromium can't decode (tiff, heic…) fail to load in the viewer the
// same way they do in the grid. Show a centered notice instead of a broken
// image, mirroring the grid's extension badge.
function showViewerError(item) {
  const ext = (item.name.split('.').pop() || '').toUpperCase();
  viewerError.textContent = ext ? `Cannot preview · ${ext}` : 'Cannot preview';
  viewerError.classList.remove('hidden');
  viewerImg.style.visibility = 'hidden';
}
function hideViewerError() {
  viewerError.classList.add('hidden');
  viewerImg.style.visibility = '';
}

function updateViewer() {
  const item = cursorItem();
  if (!item) return closeViewer();
  resetZoom();
  hideViewerError();
  viewerImg.src = api.toFileURL(item.path);
  viewerCaption.textContent = `${item.name}  ·  ${state.cursor + 1}/${state.items.length}`;
}

// ---------- Zoom & pan in the fullscreen viewer ----------
// transform-origin is 0 0 (set in CSS); we track scale + pixel translation and
// keep the point under the cursor fixed while zooming.
const zoom = { scale: 1, tx: 0, ty: 0, baseLeft: 0, baseTop: 0, baseW: 0, baseH: 0, measured: false };
const ZOOM_MAX = 8;

function applyZoom() {
  viewerImg.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
  viewerImg.style.cursor = zoom.scale > 1 ? 'grab' : 'default';
}

function resetZoom() {
  zoom.scale = 1;
  zoom.tx = 0;
  zoom.ty = 0;
  zoom.measured = false;
  applyZoom();
}

// Record the image's fit-to-screen rect (valid only at scale 1, no translate).
function measureBase() {
  const r = viewerImg.getBoundingClientRect();
  if (r.width > 0) {
    zoom.baseLeft = r.left;
    zoom.baseTop = r.top;
    zoom.baseW = r.width;
    zoom.baseH = r.height;
    zoom.measured = true;
  }
}

function zoomAt(cx, cy, factor) {
  if (!zoom.measured) {
    measureBase();
    if (!zoom.measured) return;
  }
  const cur = viewerImg.getBoundingClientRect();
  const fx = (cx - cur.left) / cur.width; // fraction of image under cursor
  const fy = (cy - cur.top) / cur.height;
  const newScale = Math.min(ZOOM_MAX, Math.max(1, zoom.scale * factor));
  const newW = zoom.baseW * newScale;
  const newH = zoom.baseH * newScale;
  zoom.scale = newScale;
  if (newScale === 1) {
    zoom.tx = 0;
    zoom.ty = 0;
  } else {
    zoom.tx = cx - fx * newW - zoom.baseLeft;
    zoom.ty = cy - fy * newH - zoom.baseTop;
  }
  applyZoom();
}

// Size the viewer image to the window. With "Maximize" on, scale up to the
// largest size that fits (aspect ratio preserved); otherwise never exceed
// native size. The element is sized to the image itself (no letterbox), which
// keeps the cursor-anchored zoom math correct.
function applyFit() {
  const nw = viewerImg.naturalWidth;
  const nh = viewerImg.naturalHeight;
  if (!nw || !nh) return;
  let s = Math.min(window.innerWidth / nw, window.innerHeight / nh);
  if (!state.maximize) s = Math.min(s, 1);
  viewerImg.style.width = Math.round(nw * s) + 'px';
  viewerImg.style.height = Math.round(nh * s) + 'px';
}

function refitViewer() {
  applyFit();
  resetZoom();
  measureBase();
}

viewerImg.addEventListener('load', () => {
  hideViewerError();
  refitViewer();
});
viewerImg.addEventListener('error', () => {
  const item = cursorItem();
  if (state.fullscreen && item) showViewerError(item);
});
window.addEventListener('resize', () => {
  if (state.fullscreen) refitViewer();
});

// Wheel / trackpad-pinch (pinch arrives as ctrl+wheel) zooms toward the cursor.
viewerEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    zoomAt(e.clientX, e.clientY, factor);
  },
  { passive: false }
);

// Drag to pan when zoomed in.
let panning = false;
let panStartX = 0;
let panStartY = 0;
let panOrigX = 0;
let panOrigY = 0;
let dragMoved = false;

viewerImg.addEventListener('mousedown', (e) => {
  if (zoom.scale <= 1) return;
  panning = true;
  dragMoved = false;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panOrigX = zoom.tx;
  panOrigY = zoom.ty;
  viewerImg.style.cursor = 'grabbing';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  zoom.tx = panOrigX + (e.clientX - panStartX);
  zoom.ty = panOrigY + (e.clientY - panStartY);
  if (Math.abs(e.clientX - panStartX) + Math.abs(e.clientY - panStartY) > 3) dragMoved = true;
  applyZoom();
});

window.addEventListener('mouseup', () => {
  if (!panning) return;
  panning = false;
  viewerImg.style.cursor = zoom.scale > 1 ? 'grab' : 'default';
});

// A fresh press anywhere in the viewer starts a new click cycle. Without this,
// `dragMoved` stayed true after a pan drag (it was only reset on mousedown over
// the image, when zoomed), so a later click on the black background no longer
// closed the viewer. Clearing it here makes background-click-to-close work again.
viewerEl.addEventListener('mousedown', () => {
  dragMoved = false;
});

// Double-click resets to fit.
viewerImg.addEventListener('dblclick', (e) => {
  e.preventDefault();
  resetZoom();
});

// ---------- Trash ----------
// Entry point for the X key / delete action. Honors the "Confirm before
// deleting" preference: when on, ask first; when off, trash straight away.
// Applies to the selection in the grid, to the displayed photo in the viewer.
// Targets are captured now, so the confirmation acts on what it announced.
function trashCurrent() {
  const items = actionTargets();
  if (!items.length) return;
  if (state.confirmDelete) openConfirmDelete(items);
  else doTrash(items);
}

async function doTrash(items) {
  let res;
  try {
    res = await api.trash(items.map((it) => it.path));
  } catch (e) {
    toast('Trash failed: ' + errMsg(e));
    return;
  }
  if (!res.trashed.length) {
    toast('Trash failed: ' + (res.errors[0] ? res.errors[0].message : 'unknown error'));
    return;
  }
  const gone = new Set(res.trashed);
  // Land the cursor where the first trashed file was.
  const first = state.items.findIndex((it) => gone.has(it.path));
  state.items = state.items.filter((it) => !gone.has(it.path));
  for (const p of gone) state.sel.delete(p);

  const n = res.trashed.length;
  const what = n === 1 ? items.find((it) => gone.has(it.path)).name : `${n} files`;
  let msg = `Trashed ${what}`;
  // Files that couldn't be staged (read-only folder) went straight to the OS trash.
  if (res.fallback.length === n) msg += ' (cannot be undone)';
  else if (res.fallback.length) msg += ` · Z to undo (${res.fallback.length} not undoable)`;
  else msg += ' · Z to undo';
  if (res.errors.length) msg += ` · ${res.errors.length} failed`;
  toast(msg);

  renderGrid();
  if (!state.items.length) {
    closeViewer();
    updateCount();
    return;
  }
  select(Math.min(Math.max(first, 0), state.items.length - 1));
}

// ---------- Undo (Z / Cmd+Z / Ctrl+Z) ----------
// The stack lives in main; we reload the listing and land on the restored file.
let undoBusy = false;
async function undoLast() {
  if (undoBusy) return;
  undoBusy = true;
  try {
    const res = await api.undo();
    if (!res) {
      toast('Nothing to undo');
      return;
    }
    await loadList();
    // Land on the restored file(s), selected together (refreshes the viewer).
    if (!selectPaths(res.restored)) {
      if (!state.items.length) closeViewer();
      else if (state.fullscreen) updateViewer();
    }
    toast(
      res.errors.length
        ? `Undone: ${res.label} · ${res.restored.length} restored, ${res.errors.length} failed (${res.errors[0]})`
        : `Undone: ${res.label}`
    );
  } catch (e) {
    toast('Undo failed: ' + errMsg(e));
  } finally {
    undoBusy = false;
  }
}

// ---------- Rename ----------
// The file the open rename dialog applies to.
let renameTarget = null;

function openRename() {
  const items = actionTargets();
  if (!items.length) return;
  if (items.length > 1) {
    openPrefix(items);
    return;
  }
  const item = (renameTarget = items[0]);
  renameModal.classList.remove('hidden');
  renameInput.value = item.name;
  renameInput.focus();
  // Select the base name (without extension) for quick editing.
  const dot = item.name.lastIndexOf('.');
  renameInput.setSelectionRange(0, dot > 0 ? dot : item.name.length);
}

function closeRename() {
  renameModal.classList.add('hidden');
}

async function confirmRename() {
  const item = renameTarget;
  renameTarget = null;
  if (!item) return closeRename();
  const newName = renameInput.value;
  closeRename();
  if (!newName || newName === item.name) return;
  try {
    const newPath = await api.rename(item.path, newName);
    const wasSelected = state.sel.delete(item.path);
    item.path = newPath;
    item.name = newPath.split(/[/\\]/).pop();
    // Keep the subfolder label (recursive mode) in step with the new name.
    if (item.rel) item.rel = item.rel.replace(/[^/\\]*$/, item.name);
    if (wasSelected) state.sel.add(newPath);
    toast(`Renamed to ${item.name} · Z to undo`);
    renderGrid();
    if (state.fullscreen) updateViewer();
  } catch (e) {
    toast('Rename failed: ' + errMsg(e));
  }
}

// ---------- Batch rename (prefix) ----------
// R with several files selected: prepend a prefix to every name, as one undo
// entry. The preview is indicative; main resolves collisions with " (n)".
const PREVIEW_MAX = 10;
let prefixTargets = [];

function openPrefix(items) {
  prefixTargets = items;
  $('prefixTitle').textContent = `Add a prefix to ${items.length} files`;
  prefixInput.value = '';
  updatePrefixPreview();
  prefixModal.classList.remove('hidden');
  prefixInput.focus();
}

function closePrefix() {
  prefixModal.classList.add('hidden');
}

function updatePrefixPreview() {
  const prefix = prefixInput.value.replace(/[/\\]/g, '_'); // as main sanitizes it
  const list = $('prefixPreview');
  list.innerHTML = '';
  for (const it of prefixTargets.slice(0, PREVIEW_MAX)) {
    const li = document.createElement('li');
    const after = document.createElement('span');
    after.className = 'after';
    after.textContent = prefix + it.name;
    li.append(`${it.name} → `, after);
    list.appendChild(li);
  }
  if (prefixTargets.length > PREVIEW_MAX) {
    const li = document.createElement('li');
    li.textContent = `… and ${prefixTargets.length - PREVIEW_MAX} more`;
    list.appendChild(li);
  }
  $('prefixOk').disabled = !prefixInput.value.trim();
}

async function confirmPrefix() {
  const prefix = prefixInput.value;
  const items = prefixTargets;
  if (!prefix.trim() || !items.length) return;
  closePrefix();
  prefixTargets = [];
  let res;
  try {
    res = await api.renameBatch(items.map((it) => it.path), prefix);
  } catch (e) {
    toast('Rename failed: ' + errMsg(e));
    return;
  }
  // Update the listed items in place; the selection follows the new paths.
  const byPath = new Map(items.map((it) => [it.path, it]));
  let suffixed = 0;
  for (const { from, to } of res.renamed) {
    const item = byPath.get(from);
    const name = to.split(/[/\\]/).pop();
    if (name !== prefix.replace(/[/\\]/g, '_') + item.name) suffixed++;
    if (state.sel.delete(from)) state.sel.add(to);
    item.path = to;
    item.name = name;
    if (item.rel) item.rel = item.rel.replace(/[^/\\]*$/, name);
  }
  renderGrid();
  const n = res.renamed.length;
  let msg = n ? `Prefixed ${n} file${n > 1 ? 's' : ''} · Z to undo` : 'Nothing renamed';
  if (suffixed) msg += ` · ${suffixed} got a " (n)" suffix`;
  if (res.errors.length) msg += ` · ${res.errors.length} failed (${res.errors[0].message})`;
  toast(msg);
}

prefixInput.addEventListener('input', updatePrefixPreview);
prefixInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') confirmPrefix();
  else if (e.key === 'Escape') closePrefix();
});
$('prefixCancel').addEventListener('click', closePrefix);
$('prefixOk').addEventListener('click', confirmPrefix);

// ---------- Move / copy (M / C) ----------
// Pick a destination folder, then let main move/copy the targets. Main pushes
// progress while bytes are copied (copy, cross-volume move, or an undo bringing
// files back); the overlay shows only then.
function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

let transferBusy = false;
async function transferTo(mode) {
  const items = actionTargets();
  if (!items.length || transferBusy) return;
  let dest;
  try {
    dest = await api.openFolder();
  } catch (e) {
    toast('Cannot pick a folder: ' + errMsg(e));
    return;
  }
  if (!dest) return;
  transferBusy = true;
  let res;
  try {
    res = await api.transfer(items.map((it) => it.path), dest, mode);
  } catch (e) {
    toast(`${mode === 'move' ? 'Move' : 'Copy'} failed: ${errMsg(e)}`);
    return;
  } finally {
    transferBusy = false;
  }

  const n = res.done.length;
  const folderName = pathBase(dest);
  let msg = n
    ? `${mode === 'move' ? 'Moved' : 'Copied'} ${n === 1 ? pathBase(res.done[0].from) : n + ' files'} to ${folderName} · Z to undo`
    : `Nothing ${mode === 'move' ? 'moved' : 'copied'}`;
  if (res.cancelled) msg += ' · cancelled';
  if (res.skipped) msg += ` · ${res.skipped} already there`;
  if (res.errors.length) msg += ` · ${res.errors.length} failed (${res.errors[0].message})`;

  // Moved files leave the listing (or reappear under a subfolder in recursive
  // mode); a copy only shows up if it landed inside the current folder.
  const inside = dest === state.folder || dest.startsWith(state.folder.replace(/\/+$/, '') + '/');
  if (n && (mode === 'move' || inside)) {
    await loadList();
    if (!state.items.length) closeViewer();
    else if (state.fullscreen) updateViewer();
  }
  toast(msg);
}

api.onTransferProgress((p) => {
  transferModal.classList.remove('hidden');
  $('transferName').textContent = p.name;
  const pct = p.bytesTotal ? Math.min(100, (100 * p.bytesDone) / p.bytesTotal) : 0;
  $('transferBar').style.width = pct.toFixed(1) + '%';
  $('transferStats').textContent =
    `${p.fileIndex}/${p.fileCount} · ${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`;
});
api.onTransferEnd(() => {
  transferModal.classList.add('hidden');
  $('transferBar').style.width = '0';
});
$('transferCancel').addEventListener('click', () => api.cancelTransfer());

// ---------- Tabs ----------
function setKind(kind) {
  if (state.kind === kind) return;
  state.kind = kind;
  closeViewer();
  $('tabPhotos').classList.toggle('active', kind === 'photos');
  $('tabVideos').classList.toggle('active', kind === 'videos');
  buildTypesPopover(); // type list is per-mode
  loadList({ reset: true });
}

// ---------- Open a specific file (OS "Open with") ----------
// The preload sandbox has no Node path module, so parse POSIX paths by hand.
function pathDir(p) {
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}
function pathBase(p) {
  const s = String(p).replace(/\/+$/, '');
  return s.slice(s.lastIndexOf('/') + 1);
}
function extOfName(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
function kindForExt(ext) {
  for (const k of ['photos', 'videos']) {
    if (TYPE_SETS[k].default.includes(ext) || TYPE_SETS[k].extra.includes(ext)) return k;
  }
  return 'photos';
}

// Whether an extension belongs to a known photo/video type set. Used to reject
// "Open with" on arbitrary non-media files instead of mislabeling them photos.
function isKnownExt(ext) {
  return (
    !!ext &&
    ['photos', 'videos'].some(
      (k) => TYPE_SETS[k].default.includes(ext) || TYPE_SETS[k].extra.includes(ext)
    )
  );
}

// Load the file's folder as the working folder, then select and show the file so
// the arrow keys walk its siblings.
async function openPath(filePath) {
  if (!filePath) return;
  const dir = pathDir(filePath);
  const name = pathBase(filePath);
  const ext = extOfName(name);

  // "Open with" can hand us any file. Refuse non-media extensions rather than
  // classifying them as photos and polluting the saved Types set.
  if (!isKnownExt(ext)) {
    toast(`Unsupported file type${ext ? ' (.' + ext + ')' : ''}`);
    return;
  }

  const kind = kindForExt(ext);

  // Ensure this extension is enabled, or neither the file nor its siblings list.
  if (ext && !state.types[kind].has(ext)) {
    state.types[kind].add(ext);
    savePrefs();
  }

  // Switch to the matching mode (photos/videos) and folder.
  state.kind = kind;
  closeViewer();
  $('tabPhotos').classList.toggle('active', kind === 'photos');
  $('tabVideos').classList.toggle('active', kind === 'videos');
  buildTypesPopover();

  state.folder = dir;
  $('folderPath').textContent = dir;
  await loadList({ reset: true });

  // Select the opened file (fall back to name if the exact path doesn't match).
  let idx = state.items.findIndex((it) => it.path === filePath);
  if (idx < 0) idx = state.items.findIndex((it) => it.name === name);
  if (idx >= 0) {
    select(idx);
    if (kind === 'photos') openViewer();
  } else {
    toast('File not found in folder: ' + name);
  }
}

// ---------- File-type popover ----------
const typesBtn = $('typesBtn');
const typesPopover = $('typesPopover');

function buildTypesPopover() {
  const set = TYPE_SETS[state.kind];
  const enabled = state.types[state.kind];
  const row = (ext, extra) =>
    `<label class="chk"><input type="checkbox" data-ext="${ext}"${enabled.has(ext) ? ' checked' : ''}> .${ext}${
      extra ? ' <span class="muted">extra</span>' : ''
    }</label>`;
  typesPopover.innerHTML =
    '<div class="pop-title">Default</div>' +
    set.default.map((e) => row(e, false)).join('') +
    '<div class="pop-title">Other types</div>' +
    set.extra.map((e) => row(e, true)).join('');
  typesPopover.querySelectorAll('input[data-ext]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cb.dataset.ext);
      else enabled.delete(cb.dataset.ext);
      savePrefs();
      loadList();
    });
  });
}

// ---------- Events ----------
$('pickBtn').addEventListener('click', pickFolder);
$('tabPhotos').addEventListener('click', () => setKind('photos'));
$('tabVideos').addEventListener('click', () => setKind('videos'));

// Sort field / direction
$('sortBy').addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  savePrefs();
  loadList();
  // Hand focus back to the grid so the arrow keys navigate thumbnails again
  // instead of cycling this dropdown's options.
  e.target.blur();
});
$('sortDir').addEventListener('click', () => {
  state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  $('sortDir').textContent = state.sortDir === 'asc' ? '↑' : '↓';
  savePrefs();
  loadList();
});

// Subfolders
$('recursive').addEventListener('change', (e) => {
  state.recursive = e.target.checked;
  savePrefs();
  loadList();
  e.target.blur(); // return focus to the grid (arrow keys navigate thumbnails)
});

// Maximize photos in fullscreen
$('maximize').addEventListener('change', (e) => {
  state.maximize = e.target.checked;
  savePrefs();
  if (state.fullscreen) refitViewer();
  e.target.blur(); // return focus to the grid (arrow keys navigate thumbnails)
});

// Types popover open/close
typesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  typesPopover.classList.toggle('hidden');
});
typesPopover.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => typesPopover.classList.add('hidden'));
$('renameCancel').addEventListener('click', closeRename);
$('renameOk').addEventListener('click', confirmRename);

const helpModal = $('helpModal');
function openHelp() { helpModal.classList.remove('hidden'); }
function closeHelp() { helpModal.classList.add('hidden'); }
$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(); });

// ---------- Preferences modal ----------
function openPrefs() {
  $('confirmDelete').checked = state.confirmDelete;
  $('showHidden').checked = state.showHidden;
  $('followSymlinks').checked = state.followSymlinks;
  prefsModal.classList.remove('hidden');
  $('confirmDelete').focus();
}
function closePrefs() { prefsModal.classList.add('hidden'); }
$('prefsBtn').addEventListener('click', openPrefs);
$('prefsClose').addEventListener('click', closePrefs);
prefsModal.addEventListener('click', (e) => { if (e.target === prefsModal) closePrefs(); });
$('confirmDelete').addEventListener('change', (e) => {
  state.confirmDelete = e.target.checked;
  savePrefs();
});
// These change what the scan returns, so reload the current folder.
$('showHidden').addEventListener('change', (e) => {
  state.showHidden = e.target.checked;
  savePrefs();
  loadList();
});
$('followSymlinks').addEventListener('change', (e) => {
  state.followSymlinks = e.target.checked;
  savePrefs();
  loadList();
});

// ---------- Delete confirmation modal ----------
// Files the open confirmation dialog will trash.
let pendingTrash = [];
function openConfirmDelete(items) {
  pendingTrash = items;
  $('confirmText').textContent =
    items.length === 1
      ? `“${items[0].name}” will be moved to the trash (Z to undo).`
      : `${items.length} files will be moved to the trash (Z to undo).`;
  confirmModal.classList.remove('hidden');
  // Focus the confirm button so Enter activates it natively (no double-fire
  // with the global keydown handler) and Esc still cancels.
  $('confirmOk').focus();
}
function closeConfirmDelete() { confirmModal.classList.add('hidden'); }
$('confirmCancel').addEventListener('click', closeConfirmDelete);
$('confirmOk').addEventListener('click', () => {
  closeConfirmDelete();
  doTrash(pendingTrash);
});
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirmDelete(); });

// Click the black background to close — but not after a pan drag, and not when
// clicking the image itself.
viewerEl.addEventListener('click', (e) => {
  if (e.target === viewerEl && !dragMoved) closeViewer();
});

// ---------- Grid thumbnail sizing (trackpad pinch = ctrl+wheel) ----------
const TILE_KEY = 'tileSize';
const TILE_MIN = 110;
const TILE_MAX = 480;

function setTile(px) {
  const v = Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round(px)));
  document.documentElement.style.setProperty('--tile', v + 'px');
  try {
    localStorage.setItem(TILE_KEY, String(v));
  } catch {}
}

(function initTile() {
  let saved = 0;
  try {
    saved = parseInt(localStorage.getItem(TILE_KEY) || '', 10);
  } catch {}
  if (saved) setTile(saved);
})();

gridEl.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return; // plain two-finger scroll keeps scrolling the grid
    e.preventDefault();
    const cur =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tile')) || 200;
    setTile(cur * Math.exp(-e.deltaY * 0.01));
  },
  { passive: false }
);

renameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') confirmRename();
  else if (e.key === 'Escape') closeRename();
});

// Shortcuts deliberately ignore Ctrl/Cmd/Alt: Cmd+X acts exactly like X, which
// stays robust when modifier mappings differ (VMs, macOS vs Linux). See FN-17.
// Only Shift matters (it extends the selection with the arrows).
function onKey(e) {
  if (!transferModal.classList.contains('hidden')) {
    if (e.key === 'Escape') api.cancelTransfer();
    return; // copy in progress: swallow other keys
  }
  if (!helpModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeHelp();
    return; // shortcuts window open: swallow other keys
  }
  if (!confirmModal.classList.contains('hidden')) {
    // Enter is handled natively by the focused confirm button (see openConfirmDelete).
    if (e.key === 'Escape') closeConfirmDelete();
    return;
  }
  if (!prefsModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closePrefs();
    return;
  }
  if (isModalOpen()) return; // modal handles its own keys
  // Don't hijack keys while a form control (sort menu, checkboxes) is focused.
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  switch (e.key) {
    case 'z':
    case 'Z':
      e.preventDefault();
      undoLast();
      break;
    case 'a':
    case 'A':
      e.preventDefault();
      if (!state.fullscreen) selectAll(); // grid only
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      move(1, e.shiftKey); // Shift extends the selection
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      move(-1, e.shiftKey);
      break;
    case 'Enter':
      if (state.fullscreen) break;
      openCurrent();
      break;
    case 'Escape':
      if (state.fullscreen) closeViewer();
      // Grid: collapse a multi-selection back to the current file.
      else if (state.sel.size > 1 && cursorItem()) select(state.cursor);
      break;
    case '0':
      if (state.fullscreen) resetZoom();
      break;
    case 'x':
    case 'X':
      trashCurrent();
      break;
    case 'r':
    case 'R':
      e.preventDefault();
      openRename();
      break;
    case 'g':
    case 'G':
      if (state.kind === 'photos') openWithApp('gimp');
      break;
    case 's':
    case 'S':
      if (state.kind === 'videos') openWithApp('shotcut');
      break;
    case 'm':
    case 'M':
      transferTo('move');
      break;
    case 'c':
    case 'C':
      transferTo('copy');
      break;
  }
}
document.addEventListener('keydown', onKey);

// Ctrl/Cmd combos that main took away from the app menu arrive here as the bare
// key, and go through the very same handler.
api.onShortcut(({ key, shift }) =>
  onKey({
    key,
    shiftKey: shift,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: document.activeElement || document.body,
    preventDefault() {},
  })
);

// Tell main when a text field has focus, so Ctrl/Cmd+A/C/V/Z keep editing it.
function isTextField(el) {
  return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'));
}
document.addEventListener('focusin', (e) => api.setTextEditing(isTextField(e.target)));
document.addEventListener('focusout', () => api.setTextEditing(false));

// ---------- Init ----------
loadPrefs();
$('sortBy').value = state.sortBy;
$('sortDir').textContent = state.sortDir === 'asc' ? '↑' : '↓';
$('recursive').checked = state.recursive;
$('maximize').checked = state.maximize;
buildTypesPopover();

// Open a file handed over by the OS "Open with" — at launch (pulled once) and
// for any further files while the app stays running (pushed from main).
if (api && typeof api.getPendingFile === 'function') {
  api.getPendingFile().then((f) => { if (f) openPath(f); }).catch(() => {});
}
if (api && typeof api.onOpenFile === 'function') {
  api.onOpenFile((f) => { if (f) openPath(f); });
}
})();
