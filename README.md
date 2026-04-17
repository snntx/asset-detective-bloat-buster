# Asset Detective — Website Bloat Buster

**Detect unused CSS and JavaScript on any website.** AJAX-aware scanning waits for dynamic content before measuring coverage, so results reflect what your page actually needs.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-22c55e.svg)](manifest.json)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-f59e0b.svg)](#)

---

## Features

- **AJAX-aware** — monitors XHR/Fetch and MutationObserver before measuring, so lazy-loaded content is included
- **DOM-impact scoring** — JavaScript files are classified by how much they interact with the DOM, not just by raw coverage %
- **CSS unused rule preview** — see the actual unused CSS rules for any irrelevant stylesheet
- **Path filter** — filter results by subfolder (e.g. `wp-content/plugins/contact-form-7`)
- **Scan history** — keeps your last 50 scans; one-click Rescan opens the URL and re-runs automatically
- **Export** — full JSON report of every asset with usage bytes and category
- **Open file in new tab** — inspect any asset's raw source directly

## How it works

The extension attaches Chrome DevTools Protocol to the active tab and enables:

- `CSS.startRuleUsageTracking` — records which CSS rules match at least one element
- `Profiler.startPreciseCoverage` — records which JavaScript bytes were executed

While coverage is running, a content script:

1. Patches `XMLHttpRequest` and `window.fetch` to track in-flight requests
2. Runs `MutationObserver` on the document to detect DOM changes
3. Auto-scrolls to trigger lazy-loaded content
4. Fires synthetic `mouseover` events on nav/button elements

Coverage is snapshotted only after all network activity quiets down for the configured delay.

## Classification

| Category | CSS rule | JS file |
|----------|----------|---------|
| **Relevant** | Any usage > 0% | DOM-impact score ≥ 2 |
| **Partially Used** | — | Score 0–1 (executed but unclear DOM impact) |
| **Irrelevant** | 0% — no rules matched | 0% — never executed |

## Installation

### Chrome Web Store
*(link will be added after first submission)*

### From source
```bash
git clone https://github.com/snntx/asset-detective-bloat-buster.git
```
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `bloat-buster` folder

## Usage

1. Navigate to any page you want to analyse
2. Click the **Asset Detective** icon in the toolbar
3. Adjust the AJAX settle delay if needed (default: 3 000 ms)
4. Click **Start Scan**
5. When the scan finishes, click **Results** for the full breakdown
6. Use **Export JSON** to save the report

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `debugger` | Attach Chrome DevTools Protocol to measure CSS/JS coverage — the only API capable of doing this |
| `activeTab` | Access the tab you're scanning |
| `storage` | Save results and settings locally on your device |
| `scripting` | Inject the AJAX monitor / DOM observer content script |
| `tabs` | Open the results page after a scan |
| `<all_urls>` | Content script must run on any page the user chooses to scan |

All data stays on your device. Nothing is transmitted to any server.

## Privacy

See [privacy-policy.html](privacy-policy.html) — hosted at  
`https://madewithgpt.com/privacy-policy/asset-detective/`

**Summary:** No data collection. No analytics. No external requests. Scan results are stored only in `chrome.storage.local` on your device.

## File structure

```
bloat-buster/
├── manifest.json          MV3 manifest
├── LICENSE                MIT
├── privacy-policy.html    Privacy policy (Chrome Web Store requirement)
├── icons/                 16 · 48 · 128 px PNGs
├── popup/                 Browser action popup
├── results/               Full-page results view
├── scripts/
│   ├── background.js      Service worker — CDP orchestration
│   └── content.js         Page script — AJAX monitor + DOM tracking
├── utils/
│   ├── storage.js         chrome.storage helpers
│   └── export.js          JSON export
└── assets/
    └── styles.css         Shared design tokens
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) — © 2025 Asset Detective Contributors
