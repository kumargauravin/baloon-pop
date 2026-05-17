# 🎈 Balloon Pop

A fully offline, installable (PWA) balloon-popping game for kids — no Expo, no framework, no internet needed after first load.

## Features

| | |
|---|---|
| **4 game modes** | Letters, Numbers, Colors, Free Play |
| **Progressive difficulty** | Speed & spawn rate increase every 8+ pops |
| **Particle burst** | Canvas-based confetti on each pop |
| **Web Audio** | Synthesised pop sounds — no audio files |
| **PWA / installable** | Add to home screen on Android & iOS |
| **100% offline** | Service Worker caches all assets |
| **High scores** | Persisted per mode via localStorage |

## Run locally

```bash
# any static server works, e.g.:
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

> ⚠️ Must be served over HTTP(S) — opening `index.html` directly as a `file://` URL disables the Service Worker (but the game itself still works).

## Files

```
index.html         — game shell
style.css          — all styling
app.js             — game logic (vanilla JS)
service-worker.js  — offline caching
manifest.json      — PWA manifest
icons/             — app icons
```

## No build step required. Zero dependencies.