# Subtitle Translator

Chrome extension — translates JW Player subtitles to Russian in real time.

## Features

- **Always-visible translation bar** directly below the video player
- **Hover original subtitle word** → tooltip shows Russian translation
- **Hover bar word** → tooltip shows English back-translation
- **Idiom detection** — if a multi-word expression exists, it appears on the right side of the tooltip
- **Multi-video support** — tracks the last played video on pages with multiple players
- **Smooth positioning** — the bar follows the player via `requestAnimationFrame`

## Installation (Chrome)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder

## How it works

| File | Role |
|---|---|
| `manifest.json` | MV3 config — no special permissions needed |
| `background.js` | Service worker — proxies Google Translate requests (bypasses CORS) |
| `content.js` | Injected into every page — detects JW Player, watches subtitle DOM, renders translation bar |
| `content.css` | Styles for the bar, word spans and word tooltip |

## Translation

Uses the unofficial Google Translate endpoint (`translate.googleapis.com`) — no API key required.

| Direction | Parameters |
|---|---|
| Subtitle → Russian (bar) | `sl=auto&tl=ru&dt=t` |
| Original subtitle word hover → Russian | `sl=<detected>&tl=ru&dt=t&dt=bd` |
| Bar word hover → English | `sl=ru&tl=en&dt=t&dt=bd` |

`dt=bd` enables idiom/phrase lookup on hover.

## Supported subtitle selectors

```
.jw-captions
.jw-captions-window
.jw-text-track-cue
.jw-caption-frame
.jw-captions-text
```

If your JW Player uses different classes, add them to `CAPTION_SELS` in `content.js`.
