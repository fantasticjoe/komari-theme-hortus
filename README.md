# Komari Theme Hortus

Hortus is a warm, editorial Komari Monitor theme inspired by FantasticJoe's blog and portfolio visual system.

## Features

- Komari-compatible `komari-theme.json` and `dist/index.html`
- Live node metrics via `/api/nodes` and `/api/clients`
- Grid and table views with group filtering
- Light, dark, and system appearance support
- Blog-style Bing daily image background with readability masks
- Sans UI metrics with serif headings

## Build

```bash
npm test
npm run build
zip -r hortus-komari-theme.zip komari-theme.json dist
```

Upload `hortus-komari-theme.zip` in the Komari admin theme manager.
