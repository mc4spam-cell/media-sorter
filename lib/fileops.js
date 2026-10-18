'use strict';

// File helpers shared by the rename, undo and (later) move/copy features. No
// Electron dependency, so they can be exercised with plain Node.

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

// A free path for `name` inside `dir`: the name itself, or "base (n).ext" with
// the first n that doesn't exist yet.
function uniqueTarget(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let target = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return target;
}

// Whether a file and a directory live on the same device. A hint only (used to
// decide whether to show progress / check free space): the authority is the
// EXDEV error from fs.rename.
async function sameVolume(filePath, dir) {
  const [a, b] = await Promise.all([fsp.stat(filePath), fsp.stat(dir)]);
  return a.dev === b.dev;
}

// Bytes available to the current user on the volume holding `dir`.
async function freeBytes(dir) {
  const st = await fsp.statfs(dir);
  return st.bavail * st.bsize;
}

// Stream-copy src to dst, reporting progress. Writes to "dst.part" and renames
// on success so a half-copied file never sits under the final name; removes the
// partial file on error or abort. Preserves atime/mtime (copying would otherwise
// reset them and break the "Date modified" sort). Never overwrites dst.
async function copyWithProgress(src, dst, { onProgress, signal } = {}) {
  const st = await fsp.stat(src);
  if (fs.existsSync(dst)) throw new Error(`Destination exists: ${dst}`);
  const part = dst + '.part';
  let done = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (onProgress) onProgress(done, st.size);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(
      fs.createReadStream(src),
      counter,
      fs.createWriteStream(part, { flags: 'wx' }),
      { signal }
    );
    await fsp.utimes(part, st.atime, st.mtime);
    await fsp.rename(part, dst);
  } catch (e) {
    await fsp.rm(part, { force: true }).catch(() => {});
    throw e;
  }
  return st.size;
}

// Move src to dst: an instant rename on the same volume, otherwise a copy (with
// progress) followed by removing the source once the copy's size is verified.
async function moveFile(src, dst, opts = {}) {
  if (fs.existsSync(dst)) throw new Error(`Destination exists: ${dst}`);
  try {
    await fsp.rename(src, dst);
    return { crossVolume: false };
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
  }
  const size = await copyWithProgress(src, dst, opts);
  const copied = await fsp.stat(dst);
  if (copied.size !== size) {
    await fsp.rm(dst, { force: true }).catch(() => {});
    throw new Error(`Copy size mismatch for ${src}`);
  }
  await fsp.unlink(src);
  return { crossVolume: true };
}

module.exports = { uniqueTarget, sameVolume, freeBytes, copyWithProgress, moveFile };
