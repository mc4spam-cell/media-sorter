'use strict';

// Undo stack (last MAX_ENTRIES actions), owned by the main process and journaled
// to disk so a crash can't strand files.
//
// An entry is { id, ts, label, ops: [...] } where each op is typed:
//   { type: 'trash',  original, staged }  file parked in a same-folder staging dir
//   { type: 'rename', from, to }
//   { type: 'move',   from, to, crossVolume }
//   { type: 'copy',   from, to }
// A burst (trash 5 files, prefix 20 names, move 30 files) is ONE entry. New op
// types plug in by adding an UNDO handler and, if they hold staged files, a case
// in stagedOf().
//
// "Trash" no longer goes straight to the OS trash: the file is renamed into
// <its folder>/.media-sorter-staging/ (same volume -> instant, whatever its
// size). It reaches the OS trash only when its entry leaves the stack: evicted
// by the 11th action, or purged at launch / quit.

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { uniqueTarget, sameVolume, hasRoomFor, moveFile } = require('./fileops');

const STAGING_DIR = '.media-sorter-staging';
const MAX_ENTRIES = 10;
// Staging failures that fall back to a direct (non-undoable) OS trash.
const STAGING_FALLBACK = new Set(['EACCES', 'EPERM', 'EROFS']);

// beginTransfer({ totalBytes, fileCount }) (optional) reports progress while an
// undo copies bytes back across volumes; it returns { forFile(name) ->
// { onProgress, signal }, end() }.
function createUndoStack({ journalPath, trash, beginTransfer, max = MAX_ENTRIES }) {
  let entries = [];
  // { original, staged } of files whose OS-trash attempt failed; retried next purge.
  let leftovers = [];

  // Serialize every operation (and journal write): a purge, an X and a Z can
  // never interleave.
  let chain = Promise.resolve();
  function run(fn) {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  }

  async function save() {
    const tmp = journalPath + '.tmp';
    await fsp.mkdir(path.dirname(journalPath), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify({ entries, leftovers }));
    await fsp.rename(tmp, journalPath);
  }

  // Remove a staging dir once it is empty (rmdir refuses otherwise).
  async function dropStagingDir(stagedPath) {
    await fsp.rmdir(path.dirname(stagedPath)).catch(() => {});
  }

  // Send staged files ({ original, staged }) to the OS trash. Each file first
  // goes back to its original folder and name, so the OS trash shows the real
  // name and "Put Back" restores it where it came from — exactly as when X
  // trashed directly. Returns the ops whose file couldn't be trashed.
  async function trashStaged(ops) {
    const present = ops.filter((op) => fs.existsSync(op.staged));
    if (!present.length) return [];
    const files = [];
    for (const op of present) {
      let p = op.staged;
      try {
        const back = uniqueTarget(path.dirname(op.original), path.basename(op.original));
        await fsp.rename(op.staged, back);
        p = back;
      } catch {} // original folder gone or read-only: trash it from staging
      files.push({ op, p });
      await dropStagingDir(op.staged);
    }
    try {
      await trash(files.map((f) => f.p));
    } catch {
      // Batch failed: retry one by one so a single bad file doesn't block the rest.
      for (const f of files) await trash(f.p).catch(() => {});
    }
    // Still there: remember where it now is, for the next purge.
    return files
      .filter((f) => fs.existsSync(f.p))
      .map((f) => ({ original: f.op.original, staged: f.p }));
  }

  // Files an entry still holds in staging: what must reach the OS trash once the
  // entry can no longer be undone.
  function stagedOf(entry) {
    return entry.ops.filter((op) => op.type === 'trash');
  }

  async function push(entry) {
    entries.push(entry);
    while (entries.length > max) {
      const old = entries.shift();
      // Trash first, then forget: a crash in between leaves the files listed in
      // the journal, and the next purge skips whatever is already gone.
      leftovers.push(...(await trashStaged(stagedOf(old))));
    }
    await save();
  }

  // ---- Actions ----

  // Park files in their folder's staging dir as one undo entry. Files that can't
  // be staged (read-only folder…) go straight to the OS trash, not undoable.
  function trashFiles(paths) {
    return run(async () => {
      const entry = { id: crypto.randomUUID(), ts: Date.now(), label: '', ops: [] };
      const planned = paths.map((p) => {
        const id = crypto.randomBytes(4).toString('hex');
        const staged = path.join(path.dirname(p), STAGING_DIR, `${id}__${path.basename(p)}`);
        return { type: 'trash', original: p, staged };
      });
      // Journal the intent BEFORE moving anything: if we crash mid-way, the next
      // launch's purge still knows where every staged file is.
      entries.push({ ...entry, ops: planned });
      await save();
      entries.pop();

      const fallback = [];
      const errors = [];
      for (const op of planned) {
        try {
          await fsp.mkdir(path.dirname(op.staged), { recursive: true });
          await fsp.rename(op.original, op.staged);
          entry.ops.push(op);
        } catch (e) {
          if (STAGING_FALLBACK.has(e.code)) {
            try {
              await trash(op.original);
              fallback.push(op.original);
            } catch (e2) {
              errors.push({ path: op.original, message: e2.message });
            }
          } else {
            errors.push({ path: op.original, message: e.message });
          }
        }
      }

      if (entry.ops.length) {
        const n = entry.ops.length;
        entry.label = n === 1 ? `Trash ${path.basename(entry.ops[0].original)}` : `Trash ${n} files`;
        await push(entry);
      } else {
        await save(); // drop the journaled intent
      }
      return {
        trashed: [...entry.ops.map((op) => op.original), ...fallback],
        fallback,
        errors,
      };
    });
  }

  // Record an already-performed action (e.g. a rename) as one entry.
  function record(label, ops) {
    return run(() => push({ id: crypto.randomUUID(), ts: Date.now(), label, ops }));
  }

  // ---- Undo ----

  // Each handler reverses one op and returns the path the file is back at.
  // A target that got taken in the meantime gets a " (n)" suffix.
  const UNDO = {
    async trash(op) {
      if (!fs.existsSync(op.staged)) throw new Error(`no longer staged: ${path.basename(op.original)}`);
      const target = uniqueTarget(path.dirname(op.original), path.basename(op.original));
      await fsp.rename(op.staged, target);
      await dropStagingDir(op.staged);
      return target;
    },
    async rename(op) {
      if (!fs.existsSync(op.to)) throw new Error(`not found: ${path.basename(op.to)}`);
      const target = uniqueTarget(path.dirname(op.from), path.basename(op.from));
      await fsp.rename(op.to, target);
      return target;
    },
    // Back to the source folder: instant on the same volume, a copy otherwise.
    async move(op, transfer) {
      if (!fs.existsSync(op.to)) throw new Error(`not found: ${path.basename(op.to)}`);
      const target = uniqueTarget(path.dirname(op.from), path.basename(op.from));
      await moveFile(op.to, target, transfer ? transfer.forFile(path.basename(op.from)) : {});
      return target;
    },
    // The copy goes to the OS trash (never a permanent delete); nothing is
    // restored, the source never moved.
    async copy(op) {
      if (!fs.existsSync(op.to)) throw new Error(`not found: ${path.basename(op.to)}`);
      await trash(op.to);
      return null;
    },
  };

  // Bytes each source folder must receive to undo the cross-volume moves of an
  // entry. Refuse the whole undo up front (entry kept) if one lacks room.
  async function checkRoomForUndo(entry) {
    const need = new Map();
    let count = 0;
    for (const op of entry.ops) {
      if (op.type !== 'move' || !fs.existsSync(op.to)) continue;
      const dir = path.dirname(op.from);
      if (!fs.existsSync(dir) || (await sameVolume(op.to, dir))) continue;
      need.set(dir, (need.get(dir) || 0) + (await fsp.stat(op.to)).size);
      count++;
    }
    let total = 0;
    for (const [dir, bytes] of need) {
      const room = await hasRoomFor(dir, bytes);
      if (!room.ok) throw new Error(room.message);
      total += bytes;
    }
    return { totalBytes: total, fileCount: count };
  }

  // Undo the latest entry, ops in reverse order. One failure doesn't stop the
  // others; the entry is consumed, except for ops interrupted by a cancel
  // (their file is still at the destination), which stay undoable.
  function pop() {
    return run(async () => {
      const entry = entries[entries.length - 1];
      if (!entry) return null;
      const { totalBytes, fileCount } = await checkRoomForUndo(entry);
      const transfer = totalBytes && beginTransfer ? beginTransfer({ totalBytes, fileCount }) : null;
      const restored = [];
      const errors = [];
      const interrupted = [];
      try {
        for (const op of [...entry.ops].reverse()) {
          try {
            const back = await UNDO[op.type](op, transfer);
            if (back) restored.push(back);
          } catch (e) {
            if (e.name === 'AbortError') interrupted.unshift(op);
            else errors.push(e.message);
          }
        }
      } finally {
        if (transfer) transfer.end();
      }
      entries.pop();
      if (interrupted.length) entries.push({ ...entry, ops: interrupted });
      await save();
      return {
        label: entry.label,
        restored: restored.reverse(),
        errors,
        cancelled: interrupted.length > 0,
      };
    });
  }

  function peek() {
    const entry = entries[entries.length - 1];
    return entry ? entry.label : null;
  }

  // ---- Purge ----

  // Send every staged file (from memory and from the journal on disk — the
  // previous run's, after a crash) to the OS trash and clear the stack.
  function purge() {
    return run(async () => {
      let staged = [...leftovers, ...entries.flatMap(stagedOf)];
      try {
        const j = JSON.parse(await fsp.readFile(journalPath, 'utf8'));
        staged.push(...(j.leftovers || []), ...(j.entries || []).flatMap(stagedOf));
      } catch {} // no journal yet, or unreadable
      staged = [...new Map(staged.map((op) => [op.staged, op])).values()];
      entries = [];
      leftovers = await trashStaged(staged);
      await save();
      return { purged: staged.length - leftovers.length, failed: leftovers.length };
    });
  }

  return { trashFiles, record, pop, peek, purge };
}

module.exports = { createUndoStack, STAGING_DIR, MAX_ENTRIES };
