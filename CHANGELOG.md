# Changelog

All notable changes to **Media Sorter** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [1.2.0] — 2026-10-18

### Added
- **Undo (Z).** The last 10 actions can be undone: trash,
  rename, prefix rename, move and copy. A burst (5 files trashed, 30 files
  moved) is undone in one go, and the restored files are selected. A trashed
  file is first parked in a hidden `.media-sorter-staging` folder next to it
  (instant whatever its size); it reaches the system trash, under its
  original name and location, once it leaves the undo history or when the
  app quits or relaunches (crash recovery). Read-only folders fall back to a
  direct, non-undoable trash.
- **Multi-selection.** Cmd/Ctrl-click toggles a file, Shift-click and
  Shift+arrows select a range, A selects all, Esc keeps only the
  current file. X trashes the whole selection (one confirmation, one undo).
  The selection survives re-sorting and type filters.
- **Batch rename by prefix.** R with several files selected adds a prefix to
  every name, with a live before → after preview; collisions get " (n)".
- **Move / copy to a folder (M / C).** Same-disk moves are instant; copies
  and moves to another disk stream with a progress bar and Cancel (Esc),
  after checking free space (plus a safety margin), and keep the file's
  modification date. Name clashes get " (n)".

### Changed
- **Click selects, double-click opens** a thumbnail (photo viewer or video
  player). Enter still opens the current file.
- In the fullscreen viewer, X/R/M/C act on the displayed photo only.
- Error toasts no longer show Electron's "Error invoking remote method"
  prefix.

### Fixed
- **Cmd/Ctrl + a shortcut now always does what the key alone does.** The
  default Electron menu (active even with the menu bar hidden, Linux
  included) used to grab Cmd/Ctrl+R (reloaded the app), Cmd/Ctrl+M
  (minimized the window), Cmd/Ctrl+Z/X/C/A and Cmd/Ctrl+0. Inside a text
  field these combos keep their editing meaning.

## [1.1.0] — 2026-10-17

### Added
- **Keyboard-shortcuts button.** An ⓘ button in the toolbar opens a dialog
  listing every shortcut; the always-on help footer is gone. Global keys are
  ignored while the dialog is open (Esc closes it).
- **Open a file from the OS "Open with".** Launching Media Sorter on an image
  (file association / right-click → Open with) loads the image's parent folder
  as the working folder, switches to the matching Photos/Videos mode, selects the
  file and opens the fullscreen viewer, so ←/→ walk the folder. Works on both
  macOS (`open-file` event) and Linux (command-line argument, including `file://`
  URIs). Image `fileAssociations` are declared so the entry registers on install
  (the Linux `.deb` registers it; the AppImage does not).

## [1.0.1] — 2026-06-06

### Fixed
- **External apps launched from the Linux AppImage** (VLC, GIMP, Shotcut) now run
  with a sanitized environment and fully detached. The AppImage runtime injected
  `LD_LIBRARY_PATH` and GTK/Qt/GStreamer plugin paths pointing at Electron's bundled
  libraries; child apps inherited them and loaded incompatible libraries, which caused
  misplaced video windows, an unresponsive VLC UI, crashes, and zombie processes.
  Launching now strips those variables (restoring any `*_ORIG`) and detaches the child
  into its own session.

## [1.0.0] — 2026-06-04

Initial release. A cross-platform (macOS + Ubuntu/Linux) Electron app to sort photos
and videos.

### Photos (`jpg` `jpeg` `png` `webp`)
- Thumbnail grid and a fullscreen viewer (black background, fit-to-window, no stretch).
- **Maximize** toggle: scale every fullscreen photo up to the largest size that fits the
  window (aspect ratio preserved).
- Trackpad **pinch / scroll to zoom** toward the cursor, drag to pan, double-click or `0`
  to reset.

### Videos (`avi` `mpg` `mpeg` `mkv`, plus optional `mp4` `mov` `m4v` `webm` `wmv` `flv` `3gp`)
- Thumbnail grid where each tile is an animated **stop-motion** — one frame sampled every
  60 s of video (fast ffmpeg keyframe seek), each shown for 1 s, looping.
- Click / `Enter` plays the video in the system default player.

### Browsing & keyboard
- Sort by **name** or **date modified**, ascending/descending.
- **Subfolders** toggle (recursive scan) and a **Types** menu to include/exclude extensions.
- Trackpad **pinch (Ctrl+scroll)** to resize grid tiles.
- Keys: `←/→` navigate · `Enter` fullscreen/play · `Esc` back · `X` trash (OS bin) ·
  `R` rename · `G` open photo in GIMP · `S` open video in Shotcut · `0` reset zoom.
- All preferences (sort, subfolders, maximize, enabled types, tile size) persist between launches.

### Packaging
- macOS `.dmg` and Linux `.AppImage` + `.deb` via electron-builder.
- Bundled `ffmpeg` (ffmpeg-static); OS trash via the `trash` package.

[1.2.0]: https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.2.0
[1.1.0]: https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.1.0
[1.0.1]: https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.0.1
[1.0.0]: https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.0.0
