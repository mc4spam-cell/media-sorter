'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Build a file:// URL without Node's url module, which isn't available in the
// sandboxed preload. Encode each path segment so spaces, #, ? etc. are safe.
function toFileURL(p) {
  const norm = String(p).replace(/\\/g, '/');
  let joined = norm.split('/').map(encodeURIComponent).join('/');
  if (!joined.startsWith('/')) joined = '/' + joined;
  return 'file://' + joined;
}

contextBridge.exposeInMainWorld('api', {
  toFileURL,
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  list: (folder, opts) => ipcRenderer.invoke('fs:list', folder, opts),
  trash: (paths) => ipcRenderer.invoke('file:trash', paths),
  undo: () => ipcRenderer.invoke('undo:pop'),
  peekUndo: () => ipcRenderer.invoke('undo:peek'),
  rename: (oldPath, newName) => ipcRenderer.invoke('file:rename', oldPath, newName),
  renameBatch: (paths, prefix) => ipcRenderer.invoke('file:renameBatch', paths, prefix),
  openExternal: (filePath) => ipcRenderer.invoke('file:open', filePath),
  openWith: (filePath, app) => ipcRenderer.invoke('file:openWith', filePath, app),
  videoFrames: (filePath, mtimeMs) => ipcRenderer.invoke('video:frames', filePath, mtimeMs),
  // File passed at launch via the OS "Open with" (pulled once on init).
  getPendingFile: () => ipcRenderer.invoke('app:getPendingFile'),
  // Files opened while the app is already running (pushed from main).
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
});
