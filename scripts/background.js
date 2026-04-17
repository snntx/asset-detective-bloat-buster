// background.js — Service worker. Orchestrates scan using Chrome DevTools Protocol.

'use strict';

// ── Message dispatcher ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_SCAN') {
    runScan(msg.tabId, msg.settings).catch(err => {
      broadcast(msg.tabId, { type: 'SCAN_ERROR', tabId: msg.tabId, error: err.message });
    });
  }

  if (msg.type === 'RESCAN_URL') {
    rescanUrl(msg.url);
  }
});

// ── Rescan: open URL in new tab, wait for load, auto-scan, then open results ──
async function rescanUrl(url) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const scanSettings = {
    ajaxDelay:           settings.ajaxDelay           ?? 3000,
    autoScroll:          settings.autoScroll           ?? true,
    triggerInteractions: settings.triggerInteractions  ?? true,
  };

  const tab = await chrome.tabs.create({ url, active: true });

  // Wait for the tab to finish loading
  await new Promise(resolve => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 15000); // safety fallback
  });

  // Give content script a moment to initialise
  await sleep(800);

  // Show a badge so the user knows a scan is in progress on the new tab
  chrome.action.setBadgeText({ text: '…', tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: tab.id });

  try {
    await runScan(tab.id, scanSettings);
    chrome.action.setBadgeText({ text: '', tabId: tab.id });

    // Open results page in a new tab beside the scanned tab
    const resultsUrl = chrome.runtime.getURL('results/results.html') + `?tabId=${tab.id}`;
    await chrome.tabs.create({ url: resultsUrl, active: true, index: tab.index + 1 });
  } catch (err) {
    chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
    broadcast(tab.id, { type: 'SCAN_ERROR', tabId: tab.id, error: err.message });
  }
}

// ── Main scan orchestrator ────────────────────────────────────────────────────
async function runScan(tabId, settings) {
  progress(tabId, 'Attaching debugger…');

  let debuggerAttached = false;

  // styleSheetId → sourceURL, built from CSS.styleSheetAdded events
  const styleSheetMap = {};
  // scriptId → url, built from Debugger.scriptParsed events
  const scriptIdMap = {};

  const onDebuggerEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (method === 'CSS.styleSheetAdded' && params?.header) {
      const h = params.header;
      styleSheetMap[h.styleSheetId] = { url: h.sourceURL || h.url || '', length: h.length || 0 };
    }
    if (method === 'Debugger.scriptParsed' && params?.url) {
      scriptIdMap[params.scriptId] = params.url;
    }
  };

  chrome.debugger.onEvent.addListener(onDebuggerEvent);

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached = true;

    progress(tabId, 'Enabling coverage tracking…');

    await cdp(tabId, 'DOM.enable');
    await cdp(tabId, 'Debugger.enable');
    await cdp(tabId, 'CSS.enable');
    await cdp(tabId, 'CSS.startRuleUsageTracking');
    await cdp(tabId, 'Profiler.enable');
    await cdp(tabId, 'Profiler.startPreciseCoverage', { callCount: false, detailed: true });

    progress(tabId, 'Waiting for page activity to settle…');

    // Wait for AJAX + DOM to settle; collect DOM snapshot
    let domData = { domSnapshot: { classes: [], ids: [] }, mutationCount: 0, mutationClasses: [], mutationIds: [] };
    try {
      const resp = await sendToContent(tabId, { type: 'WAIT_FOR_AJAX', tabId, settings });
      if (resp?.domSnapshot) domData = resp;
    } catch {
      progress(tabId, `Waiting ${settings.ajaxDelay}ms…`);
      await sleep(settings.ajaxDelay);
      // Try to get DOM snapshot even if AJAX monitor failed
      try {
        const snap = await sendToContent(tabId, { type: 'GET_DOM_SNAPSHOT' });
        if (snap) domData = { domSnapshot: snap, mutationCount: snap.mutationCount || 0, mutationClasses: snap.mutationClasses || [], mutationIds: snap.mutationIds || [] };
      } catch { /* best effort */ }
    }

    progress(tabId, 'Collecting coverage data…');

    const [cssResult, jsResult] = await Promise.all([
      cdp(tabId, 'CSS.takeCoverageDelta'),
      cdp(tabId, 'Profiler.takePreciseCoverage'),
    ]);

    await cdp(tabId, 'CSS.stopRuleUsageTracking');
    await cdp(tabId, 'Profiler.stopPreciseCoverage');

    progress(tabId, 'Fetching unused CSS snippets…');

    // Group coverage rules by stylesheet for processing + snippet extraction
    const rulesBySheet = groupRulesBySheet(cssResult.coverage);
    const cssAssets    = await buildCSSAssets(tabId, rulesBySheet, styleSheetMap);

    progress(tabId, 'Analysing JS impact…');

    const jsAssets = buildJSAssets(jsResult.result, domData);

    const all        = [...cssAssets, ...jsAssets].filter(a => a.url && !isInlineOrData(a.url));
    const categorised = categorise(all);
    const summary     = buildSummary(categorised);

    const results = {
      scanDate: new Date().toISOString(),
      url:      await getTabUrl(tabId),
      settings,
      ...categorised,
      summary,
    };

    await chrome.storage.local.set({ [`scan_${tabId}`]: results });
    await appendHistory(results);

    broadcast(tabId, { type: 'SCAN_COMPLETE', tabId, results });

  } finally {
    chrome.debugger.onEvent.removeListener(onDebuggerEvent);
    if (debuggerAttached) {
      try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
    }
  }
}

// ── CDP helper ────────────────────────────────────────────────────────────────
function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// ── CSS processing ────────────────────────────────────────────────────────────
function groupRulesBySheet(coverage) {
  const map = {};
  for (const rule of coverage) {
    const id = rule.styleSheetId;
    if (!map[id]) map[id] = [];
    map[id].push(rule);
  }
  return map;
}

async function buildCSSAssets(tabId, rulesBySheet, styleSheetMap) {
  const assets = [];

  // Sheets that appear in coverage data
  for (const [sheetId, rules] of Object.entries(rulesBySheet)) {
    const sheetInfo = styleSheetMap[sheetId] || {};
    const url       = sheetInfo.url || '';
    if (!url || isInlineOrData(url)) continue;

    let totalBytes = 0, usedBytes = 0;
    for (const r of rules) {
      const len = r.endOffset - r.startOffset;
      totalBytes += len;
      if (r.used) usedBytes += len;
    }

    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    let unusedSnippets = [];
    if (usagePercent < 80) {
      unusedSnippets = await extractCSSSnippets(tabId, sheetId, usagePercent, rules);
    }

    assets.push({ url, type: 'css', usedBytes, totalBytes, usagePercent, unusedSnippets, loadMethod: 'unknown' });
  }

  // Sheets tracked by the CSS domain but with zero coverage data (truly 0%)
  for (const [sheetId, sheetInfo] of Object.entries(styleSheetMap)) {
    if (rulesBySheet[sheetId]) continue;                      // already handled above
    const url = sheetInfo.url || '';
    if (!url || isInlineOrData(url)) continue;

    const unusedSnippets = await extractCSSSnippets(tabId, sheetId, 0, []);
    assets.push({ url, type: 'css', usedBytes: 0, totalBytes: sheetInfo.length || 0, usagePercent: 0, unusedSnippets, loadMethod: 'unknown' });
  }

  return assets;
}

// Get the stylesheet text and extract readable rule snippets.
// For files with coverage ranges we prefer those; for truly-0% files we
// parse the raw text to find rule blocks.
async function extractCSSSnippets(tabId, styleSheetId, usagePercent, rules) {
  let text = '';
  try {
    const result = await cdp(tabId, 'CSS.getStyleSheetText', { styleSheetId });
    text = result?.text || '';
  } catch {
    return [];
  }
  if (!text.trim()) return [];

  // If we have coverage ranges with unused segments, prefer those
  const unusedRanges = rules
    .filter(r => !r.used && (r.endOffset - r.startOffset) > 10)
    .sort((a, b) => a.startOffset - b.startOffset);

  let searchText = text;
  if (unusedRanges.length > 0) {
    // Build a string of just the unused byte ranges
    searchText = unusedRanges
      .map(r => text.slice(r.startOffset, r.endOffset))
      .join('\n\n');
  }

  return parseCSSRules(searchText, 8);
}

// Parse complete CSS rule blocks from raw text
function parseCSSRules(text, maxRules) {
  const snippets = [];
  // Match: optional @-rule prefix, selector(s), then a { ... } block
  const rulePattern = /(?:@[\w-]+[^{]*\{[^{}]*\{[^{}]*\}[^{}]*\}|[^@{}][^{}]*\{[^{}]{4,}\})/g;
  let match;
  while ((match = rulePattern.exec(text)) !== null) {
    const rule = match[0].trim();
    if (rule.length < 8) continue;
    snippets.push(truncate(rule, 450));
    if (snippets.length >= maxRules) break;
  }

  // Fallback: if regex found nothing, just chunk the raw text into lines
  if (snippets.length === 0 && text.trim().length > 0) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    const chunk = lines.slice(0, 30).join('\n');
    if (chunk) snippets.push(truncate(chunk, 800));
  }

  return snippets;
}

// ── JS processing ─────────────────────────────────────────────────────────────
//
// Strategy:
//   1. 0% executed  → IRRELEVANT  (code provably never ran)
//   2. >0% executed → run DOM-impact scoring:
//        - Function names contain DOM-interaction keywords → +score
//        - File URL matches known-interactive patterns    → +score
//        - Page had DOM mutations AND script executed     → +score
//        - High coverage %                               → +score
//      score ≥ 2  → RELEVANT
//      score = 1  → PARTIAL
//      score = 0  → PARTIAL (executed but low confidence of impact)
//
function buildJSAssets(coverage, domData) {
  const { mutationCount = 0, mutationClasses = [], mutationIds = [] } = domData;
  const domTokens = new Set([
    ...(domData.domSnapshot?.classes || []),
    ...(domData.domSnapshot?.ids     || []),
    ...mutationClasses,
    ...mutationIds,
  ]);

  return coverage.map(entry => {
    const url        = entry.url || '';
    const totalBytes = estimateTotalBytes(entry);
    const usedBytes  = entry.functions.reduce((sum, fn) => {
      return sum + fn.ranges
        .filter(r => r.count > 0)
        .reduce((s, r) => s + (r.endOffset - r.startOffset), 0);
    }, 0);

    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    // Collect executed function names
    const executedFnNames = entry.functions
      .filter(fn => fn.ranges.some(r => r.count > 0))
      .map(fn => fn.functionName)
      .filter(Boolean);

    const domImpactScore = scoreDOMImpact({
      url,
      usagePercent,
      executedFnNames,
      mutationCount,
      domTokens,
      totalBytes,
    });

    return {
      url,
      type: 'js',
      usedBytes,
      totalBytes,
      usagePercent,
      domImpactScore,
      executedFunctions: executedFnNames.length,
      loadMethod: 'unknown',
    };
  });
}

function scoreDOMImpact({ url, usagePercent, executedFnNames, mutationCount, domTokens, totalBytes }) {
  if (usagePercent === 0) return 0; // Never ran — handled separately

  let score = 0;

  // 1. Function names contain DOM-interaction keywords
  const domKeywords = /\b(querySelector|getElementById|getElementsBy|classList|setAttribute|innerHTML|appendChild|insertBefore|removeChild|addEventListener|dispatchEvent|toggle|show|hide|open|close|init|ready|setup|bind|render|update|animate|scroll|resize|load|click|submit|focus|blur|change|hover|on|off)\b/i;
  const hasDOMFns = executedFnNames.some(n => domKeywords.test(n));
  if (hasDOMFns) score++;

  // 2. URL pattern suggests interactive library
  const interactivePattern = /\b(jquery|react|vue|angular|alpine|stimulus|htmx|swiper|slick|modal|slider|carousel|accordion|tabs|dropdown|tooltip|menu|nav|lightbox|gallery|form|validate|recaptcha|map|chart|player|video|audio|gsap|anime|lottie|bootstrap|foundation|bulma|tailwind)\b/i;
  if (interactivePattern.test(url)) score++;

  // 3. Page had DOM mutations AND this script executed → likely a contributor
  if (mutationCount > 5 && usagePercent > 0) score++;

  // 4. High coverage fraction — a large portion of the file ran
  if (usagePercent >= 40) score++;
  else if (usagePercent >= 15) score += 0.5;

  // 5. Tiny file that fully ran is almost certainly relevant (polyfill, config, etc.)
  if (totalBytes < 2048 && usagePercent > 80) score++;

  return score;
}

function estimateTotalBytes(entry) {
  let max = 0;
  for (const fn of entry.functions) {
    for (const r of fn.ranges) {
      if (r.endOffset > max) max = r.endOffset;
    }
  }
  return max;
}

// ── Categorisation ────────────────────────────────────────────────────────────
function categorise(assets) {
  const relevant      = [];
  const partiallyUsed = [];
  const irrelevant    = [];

  for (const asset of assets) {
    if (asset.type === 'css') {
      categorisingCSS(asset, relevant, partiallyUsed, irrelevant);
    } else {
      categoriseJS(asset, relevant, partiallyUsed, irrelevant);
    }
  }

  return { relevant, partiallyUsed, irrelevant };
}

function categorisingCSS(asset, relevant, partiallyUsed, irrelevant) {
  // Any CSS file with at least one active rule is relevant to this page's DOM.
  // Only files with zero measured usage are irrelevant.
  if (asset.usagePercent > 0) {
    relevant.push({ ...asset, category: 'relevant' });
  } else {
    irrelevant.push({ ...asset, category: 'irrelevant', recommendation: 'No rules matched on this page — safe to defer or disable' });
  }
}

function categoriseJS(asset, relevant, partiallyUsed, irrelevant) {
  // 0% coverage = never ran at all
  if (asset.usagePercent === 0) {
    irrelevant.push({
      ...asset,
      category: 'irrelevant',
      recommendation: 'Never executed on this page',
      domImpactLabel: 'No execution',
    });
    return;
  }

  const score = asset.domImpactScore ?? 0;

  if (score >= 2) {
    relevant.push({
      ...asset,
      category: 'relevant',
      domImpactLabel: 'DOM-interactive',
    });
  } else if (score >= 1) {
    partiallyUsed.push({
      ...asset,
      category: 'partiallyUsed',
      recommendation: 'Executes code with some DOM signals — verify manually',
      domImpactLabel: 'Low DOM signal',
    });
  } else {
    partiallyUsed.push({
      ...asset,
      category: 'partiallyUsed',
      recommendation: 'Executes code but DOM impact is unclear — may be analytics or utility',
      domImpactLabel: 'Unclear impact',
    });
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
function buildSummary({ relevant, partiallyUsed, irrelevant }) {
  const all             = [...relevant, ...partiallyUsed, ...irrelevant];
  const totalBytes      = all.reduce((s, a) => s + (a.totalBytes || 0), 0);
  const usedBytes       = all.reduce((s, a) => s + (a.usedBytes  || 0), 0);
  const totalBloatBytes = totalBytes - usedBytes;

  return {
    totalFiles: all.length,
    totalBytes,
    usedBytes,
    totalBloatBytes,
    potentialSavingsPercent: totalBytes > 0 ? Math.round((totalBloatBytes / totalBytes) * 100) : 0,
  };
}

// ── Scan history ──────────────────────────────────────────────────────────────
async function appendHistory(results) {
  const { scanHistory = [] } = await chrome.storage.local.get('scanHistory');
  scanHistory.unshift({
    scanDate:      results.scanDate,
    url:           results.url,
    summary:       results.summary,
    relevant:      results.relevant,
    partiallyUsed: results.partiallyUsed,
    irrelevant:    results.irrelevant,
  });
  if (scanHistory.length > 50) scanHistory.length = 50;
  await chrome.storage.local.set({ scanHistory });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function progress(tabId, message) {
  broadcast(tabId, { type: 'SCAN_PROGRESS', tabId, message });
}

function broadcast(tabId, msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function sendToContent(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, resp => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

async function getTabUrl(tabId) {
  try { const tab = await chrome.tabs.get(tabId); return tab.url; }
  catch { return ''; }
}

function isInlineOrData(url) {
  return !url || url.startsWith('data:') || url === 'about:blank' || url.startsWith('chrome-extension://');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
