'use strict';

// Rotate a photo file by 90° (cw / ccw), in place, keeping its mtime so the
// "Date modified" sort doesn't move it.
//   JPEG      : rewrite the EXIF Orientation tag — lossless, instant, every
//               other metadata (date, GPS…) kept. Viewers, Chromium included,
//               display the image according to that tag.
//   PNG, BMP  : ffmpeg rotates the pixels, lossless.
//   WebP      : ffmpeg rotates the pixels into lossless WebP (exact pixels;
//               a lossy source file may grow).
// Rotating back the other way restores the image exactly, which is how undo
// works. No Electron dependency.

const path = require('path');
const fsp = require('fs/promises');
const { spawn } = require('child_process');

// [filter prefix, encoder args]. WebP converts to RGBA *before* rotating, so
// the lossless output is exactly the rotated RGBA pixels and rotating back
// gives them back bit for bit (a lossy WebP is decoded as YUV; its first
// conversion to RGBA is the only, imperceptible, rounding step).
const PIXEL_FORMATS = {
  '.png': ['', ['-c:v', 'png']],
  '.bmp': ['', ['-c:v', 'bmp']],
  '.webp': ['format=rgba,', ['-c:v', 'libwebp', '-lossless', '1']],
};
const JPEG_EXTS = new Set(['.jpg', '.jpeg']);

function canRotate(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return JPEG_EXTS.has(ext) || ext in PIXEL_FORMATS;
}

// ---------- JPEG: EXIF Orientation ----------
// Orientation after rotating the displayed image 90° clockwise; ccw is the
// inverse map. Values 1-8 per the EXIF spec (2,4,5,7 are the mirrored ones).
const CW = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 };
const CCW = Object.fromEntries(Object.entries(CW).map(([a, b]) => [b, Number(a)]));
const TAG_ORIENTATION = 0x0112;
const TYPE_SHORT = 3;

// Locate the EXIF APP1 segment. Returns { app1, insertAt } where app1 is
// { start, length } (start = the FF E1 marker) or null, and insertAt is where a
// new APP1 belongs (after SOI and an APP0/JFIF segment, if any).
function findExif(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG file');
  let off = 2;
  let insertAt = 2;
  while (off + 4 <= buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xe1 && buf.toString('latin1', off + 4, off + 10) === 'Exif\0\0') {
      return { app1: { start: off, length: len }, insertAt };
    }
    if (marker === 0xe0 && off === 2) insertAt = off + 2 + len;
    off += 2 + len;
  }
  return { app1: null, insertAt };
}

// Apply `map` (CW or CCW) to the JPEG's orientation. Returns the new buffer.
function rotateJpegBuffer(buf, map) {
  const { app1, insertAt } = findExif(buf);

  if (!app1) {
    // No EXIF at all: insert a minimal APP1 holding only the orientation.
    const tiff = Buffer.alloc(26);
    tiff.write('MM', 0, 'latin1');
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4); // IFD0 right after the header
    tiff.writeUInt16BE(1, 8); // one entry
    tiff.writeUInt16BE(TAG_ORIENTATION, 10);
    tiff.writeUInt16BE(TYPE_SHORT, 12);
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(map[1], 18); // value, left-justified in the 4-byte slot
    tiff.writeUInt32BE(0, 22); // no next IFD
    const head = Buffer.alloc(4);
    head.writeUInt16BE(0xffe1, 0);
    head.writeUInt16BE(2 + 6 + tiff.length, 2);
    const seg = Buffer.concat([head, Buffer.from('Exif\0\0', 'latin1'), tiff]);
    return Buffer.concat([buf.subarray(0, insertAt), seg, buf.subarray(insertAt)]);
  }

  const segEnd = app1.start + 2 + app1.length;
  const t = app1.start + 10; // TIFF header
  const le = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd0 = t + u32(t + 4);
  const count = u16(ifd0);
  if (ifd0 + 2 + count * 12 + 4 > segEnd) throw new Error('corrupt EXIF');

  for (let i = 0; i < count; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== TAG_ORIENTATION) continue;
    // Orientation present: rewrite its value in place.
    const out = Buffer.from(buf);
    const cur = map[u16(e + 8)] ? u16(e + 8) : 1;
    if (le) out.writeUInt16LE(map[cur], e + 8);
    else out.writeUInt16BE(map[cur], e + 8);
    return out;
  }

  // EXIF without an Orientation entry: write a copy of IFD0 with the extra
  // entry at the end of the segment and repoint the header to it. Nothing else
  // moves, so every other offset in the EXIF block stays valid.
  const entries = [];
  for (let i = 0; i < count; i++) entries.push(buf.subarray(ifd0 + 2 + i * 12, ifd0 + 14 + i * 12));
  const added = Buffer.alloc(12);
  const w16 = (b, v, o) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b, v, o) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  w16(added, TAG_ORIENTATION, 0);
  w16(added, TYPE_SHORT, 2);
  w32(added, 1, 4);
  w16(added, map[1], 8);
  entries.push(added);
  entries.sort((a, b) => (le ? a.readUInt16LE(0) - b.readUInt16LE(0) : a.readUInt16BE(0) - b.readUInt16BE(0)));
  const pad = (segEnd - t) % 2; // TIFF offsets must be even
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  w16(ifd, entries.length, 0);
  entries.forEach((e, i) => e.copy(ifd, 2 + i * 12));
  buf.copy(ifd, 2 + entries.length * 12, ifd0 + 2 + count * 12, ifd0 + 2 + count * 12 + 4); // next IFD
  const newLen = app1.length + pad + ifd.length;
  if (newLen > 0xffff) throw new Error('EXIF block too large');
  const seg = Buffer.concat([buf.subarray(app1.start, segEnd), Buffer.alloc(pad), ifd]);
  seg.writeUInt16BE(newLen, 2);
  const newIfd0 = segEnd + pad - t;
  if (le) seg.writeUInt32LE(newIfd0, 10 + 4);
  else seg.writeUInt32BE(newIfd0, 10 + 4);
  return Buffer.concat([buf.subarray(0, app1.start), seg, buf.subarray(segEnd)]);
}

// Current EXIF orientation of a JPEG buffer (1 when absent). For tests/tools.
function jpegOrientation(buf) {
  const { app1 } = findExif(buf);
  if (!app1) return 1;
  const t = app1.start + 10;
  const le = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd0 = t + u32(t + 4);
  for (let i = 0; i < u16(ifd0); i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === TAG_ORIENTATION) return u16(e + 8);
  }
  return 1;
}

// ---------- Pixel formats: ffmpeg ----------
function runFfmpeg(ffmpegPath, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], env });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').pop()}`))
    );
  });
}

// WebP needs ffmpeg's libwebp encoder, which the Linux arm64 build of
// ffmpeg-static lacks. Use the bundled ffmpeg when it has it, else a system
// one (e.g. `sudo apt install ffmpeg`). Absolute paths only: no PATH lookup.
const SYSTEM_FFMPEGS = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
const libwebpCache = new Map(); // binary -> Promise<boolean>

function hasLibwebp(bin, env) {
  if (!libwebpCache.has(bin)) {
    libwebpCache.set(
      bin,
      new Promise((resolve) => {
        let out = '';
        const p = spawn(bin, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'], env });
        p.stdout.on('data', (d) => (out += d.toString()));
        p.on('error', () => resolve(false));
        p.on('close', () => resolve(/\slibwebp\s/.test(out)));
      })
    );
  }
  return libwebpCache.get(bin);
}

async function webpFfmpeg(ffmpegPath, env, fallbacks = SYSTEM_FFMPEGS) {
  for (const bin of [ffmpegPath, ...fallbacks].filter(Boolean)) {
    if (await hasLibwebp(bin, env)) return bin;
  }
  throw new Error('WebP rotation needs ffmpeg with the libwebp encoder — install it (Ubuntu: sudo apt install ffmpeg)');
}

// ---------- Entry point ----------
// Rotate filePath by 90° ('cw' | 'ccw') in place; atomic (temp file + rename)
// and mtime/atime preserved. env: environment for ffmpeg (main passes a clean
// one); webpFallbacks: system ffmpegs to try for WebP (tests override it).
async function rotateFile(filePath, dir, { ffmpegPath, env, webpFallbacks } = {}) {
  if (dir !== 'cw' && dir !== 'ccw') throw new Error('Unknown direction: ' + dir);
  const ext = path.extname(filePath).toLowerCase();
  const st = await fsp.stat(filePath);
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.rotating${ext}`);
  try {
    if (JPEG_EXTS.has(ext)) {
      const out = rotateJpegBuffer(await fsp.readFile(filePath), dir === 'cw' ? CW : CCW);
      await fsp.writeFile(tmp, out);
    } else if (ext in PIXEL_FORMATS) {
      const bin = ext === '.webp' ? await webpFfmpeg(ffmpegPath, env, webpFallbacks) : ffmpegPath;
      if (!bin) throw new Error('ffmpeg unavailable');
      const [prefix, encoder] = PIXEL_FORMATS[ext];
      await runFfmpeg(bin, [
        '-v', 'error', '-i', filePath,
        '-vf', prefix + (dir === 'cw' ? 'transpose=1' : 'transpose=2'),
        '-frames:v', '1', ...encoder, '-y', tmp,
      ], env);
    } else {
      throw new Error(`rotation not supported for ${ext || 'this file'} (JPEG, PNG, BMP, WebP only)`);
    }
    await fsp.utimes(tmp, st.atime, st.mtime);
    await fsp.rename(tmp, filePath);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { rotateFile, canRotate, rotateJpegBuffer, jpegOrientation, CW, CCW };
