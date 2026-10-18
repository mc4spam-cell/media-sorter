# Media Sorter

A small cross-platform desktop app (Electron) to quickly sort **photos** and **videos**.
Built and tested on macOS, targets **Ubuntu Linux** for daily use.

## Features

### Photos (`.jpg` `.jpeg` `.png` `.webp`)
- **Thumbnail grid** view and a **fullscreen** view (black background, image fit-to-screen, never stretched).
- Double-click a thumbnail (or press **Enter**) to open it fullscreen; **Esc** returns to the grid.

### Videos (`.avi` `.mpg` `.mpeg` `.mkv`)
- **Thumbnail grid** only.
- Each thumbnail is an animated **stop-motion / timelapse**: up to **20 frames spread across the whole video** (one every **60 s** for clips up to ~20 min, then a wider step so long videos are still covered end to end), each shown for **1 s**, looping.
- Frames are extracted with a bundled `ffmpeg` (no system install needed) and cached, so a folder is fast to reopen.
- Double-click a thumbnail (or press **Enter**) to **play the video in your system's default player** — Chromium can't decode avi/mpg/mkv, so playback is handed off to the OS (`xdg-open` on Linux, the default app on macOS).

### Keyboard (both modes)
| Key | Action |
|-----|--------|
| ↑ ↓ | previous / next |
| ← → | rotate the photo 90° left / right (the whole selection in the grid) |
| **Enter** | open fullscreen (photos) / play in system player (videos) |
| **Shift** + ↑ ↓ | extend the selection |
| **A** | select all |
| **Esc** | leave fullscreen / keep only the current file selected |
| **X** | send the selection to the trash |
| **Z** | undo the last action (up to 10) |
| **R** | rename the current file; with several selected, add a prefix to all of them |
| **M** / **C** | move / copy the selection to a folder |
| **G** | open the current **photo** in GIMP |
| **S** | open the current **video** in Shotcut |
| **0** | reset zoom to fit (fullscreen photo) |

**Cmd** (macOS) or **Ctrl** (Linux) + any of these keys does exactly the same as the key alone (Cmd+Z = Z, Ctrl+A = A…), except inside a text field, where they keep their usual editing meaning.

In the fullscreen viewer, X/R/M/C and ←/→ act on the displayed photo only. In Videos mode, ←/→ do nothing.

**Rotation** is saved into the file and is lossless: JPEGs get their EXIF orientation updated (instant, all other metadata kept), PNG/BMP/WebP pixels are rotated losslessly (a lossy WebP is rewritten as lossless WebP, which can make it larger). The file's modification date is kept, and Z undoes it. GIF and AVIF can't be rotated.

`G`/`S` launch the editor via `open -a` on macOS and the `gimp`/`shotcut` binary on Linux. If the editor isn't installed, a toast says so.

### Browsing controls (toolbar)
- **Sort** by **Name** or **Date modified**, with an **↑/↓** button to flip ascending/descending.
- **Subfolders** checkbox — when on, the folder is scanned recursively and each tile shows its path relative to the chosen folder.
- **Types ▾** menu — per-mode checkboxes to include/exclude file extensions. Defaults are jpg/jpeg/png/webp (photos) and avi/mpg/mpeg/mkv (videos); a set of extra formats (gif, bmp, avif / mp4, mov, m4v, webm, wmv, flv, 3gp) can be toggled on. The listed photo formats are all ones Chromium can display; if a file still can't be decoded (corrupt, or an unexpected codec), the tile shows the extension instead of a preview.
- All of the above — plus the thumbnail size — are **remembered** between launches.

### Zoom (trackpad)
- **Fullscreen photo**: pinch (or scroll) to zoom toward the cursor; drag to pan when zoomed in; double-click or **0** to reset to fit.
- **Maximize** toolbar toggle: when on, every fullscreen photo is scaled up to the largest size that fits the window (aspect ratio preserved), instead of capping at the photo's native size. Pinch-zoom still works on top of it. Remembered between launches.
- **Thumbnail grids**: pinch (Ctrl + scroll) to grow/shrink the tiles. Plain two-finger scroll still scrolls the grid. The chosen size is remembered.

### Selection, undo, move & copy
- **Click** selects a thumbnail, **double-click** opens it. **Cmd/Ctrl-click** adds or removes a file, **Shift-click** selects a range.
- **Undo** (Z) reverts the last 10 actions — trash, rename, prefix, move, copy — each burst at once. A trashed file is first parked in a hidden `.media-sorter-staging` folder next to it (instant even for huge videos) and reaches the **system trash** (Finder Trash on macOS, Trash on Ubuntu) when it leaves the undo history or when the app quits; a folder that can't host it (read-only) sends it straight to the trash, not undoable.
- **Move / copy** (M / C): pick a folder; moves on the same disk are instant, copies and moves to another disk show a progress bar with Cancel, after checking there's enough free space. Name clashes get a ` (n)` suffix.

## Run (development)

```bash
npm install
npm start
```

Click **Open folder…**, then switch between the **Photos** and **Videos** tabs.

## Install permanently

Prebuilt packages for each release are on the
[GitHub Releases page](https://github.com/mc4spam-cell/media-sorter/releases/latest).
The current **v1.2.1** release ships the macOS Intel build; the Apple Silicon
and Ubuntu packages are still those of v1.1.0 (newer builds to follow):

| Platform | Latest prebuilt asset |
|----------|-------|
| macOS — Intel | `Media.Sorter-1.2.1-x64.dmg` ([v1.2.1](https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.2.1)) |
| macOS — Apple Silicon | `Media.Sorter-1.1.0-arm64.dmg` ([v1.1.0](https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.1.0)) |
| Ubuntu / Debian | `media-sorter_1.1.0_amd64.deb` ([v1.1.0](https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.1.0)) |

### macOS
1. Download the `.dmg` for your architecture from the release page above
   (Apple Silicon = `arm64`, Intel = `x64`, `intel` up to v1.1.0), **or** build it yourself:
   ```bash
   npm install
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
   ```
   A self-built `.dmg` lands in `dist/` named per architecture (`-x64` / `-arm64`).
2. Open the `.dmg` and drag **Media Sorter** into **Applications**.
3. The app is **unsigned**, so the first launch is blocked by Gatekeeper. Either:
   - **Right-click** the app → **Open** → **Open**, or
   - run `xattr -dr com.apple.quarantine "/Applications/Media Sorter.app"` once.

### Ubuntu / Linux
The quickest option is the prebuilt `media-sorter_1.1.0_amd64.deb` from the
[release page](https://github.com/mc4spam-cell/media-sorter/releases/latest):
`sudo apt install ./media-sorter_1.1.0_amd64.deb`.

To build it yourself, do so **on the Linux machine** (so the correct Linux ffmpeg binary is fetched — a build made on macOS would ship the macOS ffmpeg and video thumbnails would not work).

**Easiest — the one-shot script:**
```bash
git clone https://github.com/mc4spam-cell/media-sorter.git
cd media-sorter
bash install-ubuntu.sh
```
It installs prerequisites (Node ≥ 22.12, FUSE), optionally GIMP/Shotcut, builds, and offers to install the `.deb`.

**Manual:**
```bash
sudo apt install -y nodejs npm        # if not already installed
git clone https://github.com/mc4spam-cell/media-sorter.git && cd media-sorter
npm install
npm run dist:linux                     # produces dist/*.AppImage and dist/*.deb
```
Then either:
- make the AppImage executable and run it: `chmod +x dist/*.AppImage && ./dist/*.AppImage`, or
- install the deb: `sudo apt install ./dist/*.deb` (launch from your app menu).

## Notes
- `ffmpeg` ships with the app via `ffmpeg-static`; nothing to install separately. (G/S editor shortcuts do require GIMP/Shotcut installed.)
- The build uses `asar: false` so the bundled `ffmpeg` and `trash` binaries stay directly executable.
- Extracted video frames are cached under the app's user-data directory, keyed by file path + modification time.
- Frame extraction is capped at 20 frames per video, spaced by `max(60s, duration/20)` so the 20 frames span the whole video while short clips keep the one-per-minute cadence.
- Thumbnails load lazily: photos use native lazy-loading, and a video only extracts/animates its frames when it scrolls near the viewport (its timer pauses off-screen), so folders of thousands of files stay responsive.
