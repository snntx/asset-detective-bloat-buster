# Contributing to Asset Detective

Thank you for taking the time to contribute! This project is MIT-licensed and welcomes
pull requests, bug reports, and feature ideas.

## Getting started

```bash
git clone https://github.com/snntx/asset-detective-bloat-buster.git
cd bloat-buster
# No build step needed — it's plain JS
```

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the repo folder
4. Make changes to the source files
5. Click the reload icon on `chrome://extensions/` to pick up changes

## Project layout

```
popup/        Browser action popup (HTML + CSS + JS)
results/      Full-page results view
scripts/      background.js (service worker) + content.js (injected)
utils/        Storage and export helpers
assets/       Shared CSS design tokens
icons/        Extension icons (PNG)
```

## Submitting a pull request

- Keep PRs focused — one feature or fix per PR
- Describe *what* changed and *why* in the PR body
- Test on at least one real website before submitting
- Do not minify or bundle source files — the extension ships as readable source

## Reporting bugs

Open a GitHub Issue with:
- Chrome version
- URL of the page that triggered the bug (or a description if private)
- What you expected vs what happened
- Console errors from `chrome://extensions → Asset Detective → Service worker`

## Code style

- ES6+ — no transpilation, no bundler
- `'use strict'` at the top of every script
- Prefer `async/await` over chained `.then()`
- Descriptive variable names over abbreviations

## License

By contributing you agree that your changes will be released under the
[MIT License](LICENSE).
