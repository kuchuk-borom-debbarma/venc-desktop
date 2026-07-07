# VENC Desktop

A native desktop version of the VENC video encryptor — Windows, macOS, and Linux.

Same AES-256-GCM / PBKDF2 (250k iterations) format as the web version, so `.venc`
files are fully interchangeable between the two.

**Why a native app fixes the playback problem:** instead of trying to decode video
in a browser (which can't play HEVC `.mov` and needs a slow WASM transcode as a
workaround), this app decrypts to a temp file and hands it to your OS's default
video player (QuickTime, Movies & TV, VLC, whatever you have set) — so it always
plays, instantly, at full quality, using your system's native codecs.

## 1. Install dependencies

You need [Node.js](https://nodejs.org) (18+) installed. Then, in this folder:

```bash
npm install
```

## 2. Run it locally (no build needed)

```bash
npm start
```

## 3. Build installers

Build for the platform you're currently on:

```bash
npm run dist
```

Or target a specific platform explicitly:

```bash
npm run dist:mac     # .dmg  (must be run ON macOS)
npm run dist:win     # .exe installer (NSIS)
npm run dist:linux   # .AppImage + .deb
```

Output lands in `release/`.

### Cross-compiling notes

- **Windows & Linux builds can be made from any host** (Mac, Windows, or Linux) —
  electron-builder handles this automatically.
- **macOS builds must be made on a real Mac.** Apple doesn't allow building
  signed `.dmg`/`.app` bundles anywhere else. If you don't have a Mac, you can
  use a CI service like GitHub Actions with a `macos-latest` runner, or ask a
  friend with a Mac to run `npm run dist:mac`.
- Builds here are **unsigned**. On first launch:
  - **macOS** will say the app is from an "unidentified developer" — right-click
    the app → Open, to bypass Gatekeeper once.
  - **Windows** SmartScreen may warn similarly — click "More info" → "Run anyway".
  - This is normal for unsigned indie apps and doesn't affect functionality.

## Project structure

```
venc-desktop/
├── main.js           # Electron main process: file dialogs, streaming crypto, opens system player
├── preload.js         # Safe bridge exposing window.api to the renderer
├── renderer/
│   ├── index.html     # UI
│   ├── style.css       # Same look as the web version
│   └── renderer.js     # UI logic, calls window.api
└── package.json        # electron-builder config for win/mac/linux targets
```

## Notes

- Encryption/decryption is streamed to disk, so it comfortably handles
  multi-gigabyte video files without loading them fully into memory.
- "Decrypt & Play" decrypts to your OS temp folder and opens it in your default
  video app immediately. Use "Save Copy As…" to keep a permanent copy elsewhere,
  since OS temp folders get cleaned up periodically.
