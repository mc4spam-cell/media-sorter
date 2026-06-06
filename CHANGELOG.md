# Changelog

All notable changes to **Media Sorter** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

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

[1.0.1]: https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.0.1
[1.0.0]: https://github.com/mc4spam-cell/media-sorter/releases/tag/v1.0.0
