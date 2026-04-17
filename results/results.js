// results.js — Results page controller (ES module)
import { getScanResult, getScanHistory, clearScanHistory } from '../utils/storage.js';
import { exportJSON, copyAssetList } from '../utils/export.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ── Entry point ───────────────────────────────────────────────────────────────
async function init() {
  setupNav();

  const view = params.get('view');
  if (view === 'history') {
    switchView('history');
    return;
  }

  const tabId = parseInt(params.get('tabId'));
  if (tabId) {
    const results = await getScanResult(tabId);
    if (results) renderResults(results);
    else showEmpty();
  } else {
    showEmpty();
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  $('clearHistoryBtn').addEventListener('click', async () => {
    await clearScanHistory();
    renderHistory([]);
  });
}

function switchView(view) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('viewResults').style.display  = view === 'results' ? '' : 'none';
  $('viewHistory').style.display  = view === 'history' ? '' : 'none';

  if (view === 'history') loadHistory();
}

// ── Results rendering ─────────────────────────────────────────────────────────
function renderResults(results) {
  const { relevant = [], partiallyUsed = [], irrelevant = [], summary = {}, scanDate, url, pageInfo = {} } = results;

  // Toolbar & banner
  $('toolbar').style.display = 'flex';
  $('scanMeta').textContent  = `Scanned ${fmtDate(scanDate)}`;

  $('pageInfoBanner').style.display = 'flex';
  $('bannerUrl').textContent = url || '—';

  const tags = [
    pageInfo.isWordPress ? `WordPress ${pageInfo.wpVersion !== 'unknown' ? pageInfo.wpVersion : ''}`.trim() : null,
    pageInfo.postType && pageInfo.postType !== 'unknown' ? `Post type: ${pageInfo.postType}` : null,
    pageInfo.template  && pageInfo.template  !== 'unknown' ? `Template: ${pageInfo.template}`  : null,
    pageInfo.pageType  ? `Page: ${pageInfo.pageType}` : null,
  ].filter(Boolean);

  $('bannerTags').innerHTML = tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');

  // Sidebar stats
  $('sidebarStats').style.display = '';
  $('statTotal').textContent     = summary.totalFiles ?? 0;
  $('statRelevant').textContent  = relevant.length;
  $('statPartial').textContent   = partiallyUsed.length;
  $('statIrrelevant').textContent= irrelevant.length;
  $('statBloat').textContent     = fmtBytes(summary.totalBloatBytes ?? 0);
  $('statSavings').textContent   = (summary.potentialSavingsPercent ?? 0) + '% unused';

  // Build sections — SVG icons, no emoji
  const sections = [
    { key: 'relevant',      label: 'Relevant',      icon: iconCheck(),   colorClass: 'color-relevant',   assets: relevant },
    { key: 'partiallyUsed', label: 'Partially Used', icon: iconWarning(), colorClass: 'color-partial',    assets: partiallyUsed },
    { key: 'irrelevant',    label: 'Irrelevant',     icon: iconX(),       colorClass: 'color-irrelevant',  assets: irrelevant },
  ];

  const container = $('assetSections');
  container.innerHTML = '';

  sections.forEach(({ key, label, icon, colorClass, assets }) => {
    if (!assets.length) return;
    const section = buildSection(key, label, icon, colorClass, assets);
    container.appendChild(section);
  });

  $('emptyState').style.display = 'none';

  // Export button
  $('exportBtn').addEventListener('click', () => exportJSON(results));

  // Filter + search
  setupFilters(results);
}

function buildSection(key, label, icon, colorClass, assets) {
  const wrap = document.createElement('div');
  wrap.className = 'asset-section';
  wrap.dataset.section = key;

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <div class="section-header-title ${colorClass}">
      <span class="section-icon">${icon}</span>
      <span>${esc(label)}</span>
    </div>
    <span class="section-count">${assets.length} file${assets.length !== 1 ? 's' : ''}</span>
    <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  `;

  const list = document.createElement('div');
  list.className = 'asset-list';
  assets.forEach(asset => list.appendChild(buildAssetCard(asset)));

  header.addEventListener('click', () => {
    const collapsed = list.style.display === 'none';
    list.style.display = collapsed ? '' : 'none';
    header.querySelector('.section-chevron').classList.toggle('collapsed', !collapsed);
  });

  wrap.appendChild(header);
  wrap.appendChild(list);
  return wrap;
}

function buildAssetCard(asset) {
  const { url, type, usagePercent, usedBytes, totalBytes, recommendation,
          unusedSnippets = [], domImpactLabel } = asset;
  const name          = assetName(url);
  const category      = asset.category || categoryFromPct(usagePercent);
  const catKey        = category === 'partiallyUsed' ? 'partial' : category;
  const colorClass    = `color-${catKey}`;
  const badgeClass    = `badge-${catKey}`;
  const progressClass = `progress-${catKey}`;

  const card = document.createElement('div');
  card.className = 'asset-card';
  card.dataset.type = type;
  card.dataset.url  = (url || '').toLowerCase();

  // JS gets a DOM impact label instead of byte-wasted line
  const metaRight = type === 'js' && domImpactLabel
    ? `<span class="dom-impact-label">${esc(domImpactLabel)}</span>`
    : `<span style="color:var(--color-irrelevant)">${fmtBytes(Math.max(0,(totalBytes||0)-(usedBytes||0)))} wasted</span>`;

  card.innerHTML = `
    <div class="asset-card-header">
      <span class="asset-icon">${type === 'css' ? cssIcon() : jsIcon()}</span>
      <div class="asset-meta">
        <div class="asset-name" title="${esc(url)}">${esc(name)}</div>
        <div class="asset-url">${esc(shortUrl(url))}</div>
      </div>
      <div class="asset-badge-row">
        <span class="tag">${esc(type.toUpperCase())}</span>
        <span class="badge ${badgeClass}">${esc(category === 'partiallyUsed' ? 'Partial' : capitalize(category))}</span>
        ${url ? `<a class="open-tab-btn" href="${esc(url)}" target="_blank" rel="noopener" title="Open file in new tab">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>` : ''}
      </div>
    </div>
    <div class="asset-card-body">
      <span class="usage-pct ${colorClass}">${usagePercent}%</span>
      <div class="asset-progress">
        <div class="progress-bar">
          <div class="progress-bar-fill ${progressClass}" style="width:${usagePercent}%"></div>
        </div>
      </div>
      <div class="asset-sizes">
        ${fmtBytes(usedBytes)} / ${fmtBytes(totalBytes)}<br/>
        ${metaRight}
      </div>
    </div>
    ${recommendation ? `<div class="asset-recommendation">${esc(recommendation)}</div>` : ''}
    ${type === 'css' && unusedSnippets.length ? buildCSSSnippetPanel(unusedSnippets) : ''}
  `;

  // Wire snippet toggle
  if (type === 'css' && unusedSnippets.length) {
    const toggle  = card.querySelector('.snippet-toggle');
    const panel   = card.querySelector('.snippet-panel');
    toggle?.addEventListener('click', e => {
      e.stopPropagation();
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : '';
      toggle.textContent  = open ? `Show ${unusedSnippets.length} unused rule${unusedSnippets.length > 1 ? 's' : ''}` : 'Hide unused rules';
    });
  }

  return card;
}

function buildCSSSnippetPanel(snippets) {
  const items = snippets.map(s =>
    `<div class="snippet-item"><pre class="snippet-pre">${esc(s)}</pre></div>`
  ).join('');

  return `
    <div class="snippet-section">
      <button class="snippet-toggle">Show ${snippets.length} unused rule${snippets.length > 1 ? 's' : ''}</button>
      <div class="snippet-panel" style="display:none">
        <div class="snippet-header">Unused CSS rules (sampled)</div>
        ${items}
      </div>
    </div>
  `;
}

// ── Filters & search ──────────────────────────────────────────────────────────
function setupFilters(results) {
  let activeType  = 'all';
  let searchQuery = '';
  let activePath  = '';   // path chip filter

  function applyFilter() {
    let anyVisible = false;
    document.querySelectorAll('.asset-card').forEach(card => {
      const url         = card.dataset.url || '';
      const matchType   = activeType === 'all' || card.dataset.type === activeType;
      const matchSearch = !searchQuery || url.includes(searchQuery);
      const matchPath   = !activePath  || url.includes(activePath);
      const show = matchType && matchSearch && matchPath;
      card.style.display = show ? '' : 'none';
      if (show) anyVisible = true;
    });

    // Show/hide empty-section placeholders
    document.querySelectorAll('.asset-section').forEach(sec => {
      const hasVisible = [...sec.querySelectorAll('.asset-card')]
        .some(c => c.style.display !== 'none');
      sec.style.display = hasVisible ? '' : 'none';
    });
  }

  // Type tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeType = tab.dataset.filter;
      applyFilter();
    });
  });

  // Search
  $('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
    applyFilter();
  });

  // Path chips — built from all asset URLs
  buildPathChips(results, path => {
    activePath = path;
    applyFilter();
  });
}

// ── Path chips ────────────────────────────────────────────────────────────────
function buildPathChips(results, onChange) {
  const all = [
    ...(results.relevant      || []),
    ...(results.partiallyUsed || []),
    ...(results.irrelevant    || []),
  ];

  // Extract meaningful path segments from every asset URL
  const segmentCount = {};
  for (const asset of all) {
    const segs = urlPathSegments(asset.url);
    for (const seg of segs) {
      segmentCount[seg] = (segmentCount[seg] || 0) + 1;
    }
  }

  // Only show segments that cover >1 file and look like directories (no extension)
  const chips = Object.entries(segmentCount)
    .filter(([seg, cnt]) => cnt > 1 && !seg.match(/\.\w{1,5}$/))
    .sort((a, b) => {
      // Sort by depth (more slashes = deeper = show later), then count desc
      const depthDiff = (a[0].match(/\//g) || []).length - (b[0].match(/\//g) || []).length;
      return depthDiff !== 0 ? depthDiff : b[1] - a[1];
    })
    .slice(0, 20);   // cap at 20 chips

  if (!chips.length) return;

  const wrap     = $('pathFilterWrap');
  const chipList = $('pathChipList');
  const allChip  = $('pathChipAll');
  wrap.style.display = '';

  function setActive(path) {
    allChip.classList.toggle('path-chip-active', path === '');
    chipList.querySelectorAll('.path-chip').forEach(c => {
      c.classList.toggle('path-chip-active', c.dataset.path === path);
    });
    onChange(path);
  }

  allChip.addEventListener('click', () => setActive(''));

  for (const [seg, cnt] of chips) {
    const btn = document.createElement('button');
    btn.className = 'path-chip';
    btn.dataset.path = seg;
    btn.title = seg;
    // Show just the last two segments for readability
    const label = seg.split('/').slice(-2).join('/');
    btn.innerHTML = `<span class="path-chip-label">${esc(label)}</span><span class="path-chip-count">${cnt}</span>`;
    btn.addEventListener('click', () => setActive(seg));
    chipList.appendChild(btn);
  }
}

// Extract progressive path prefixes from a URL (e.g. wp-content/plugins/foo)
function urlPathSegments(url) {
  if (!url) return [];
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { pathname = url; }

  const parts  = pathname.replace(/^\//, '').split('/');
  const segs   = [];
  let built    = '';
  for (let i = 0; i < parts.length - 1; i++) {   // skip filename (last part)
    built = built ? built + '/' + parts[i] : parts[i];
    if (built) segs.push(built);
  }
  return segs;
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  const history = await getScanHistory();
  renderHistory(history);
}

function renderHistory(history) {
  const list = $('historyList');
  list.innerHTML = '';

  if (!history.length) {
    $('historyEmpty').style.display = 'flex';
    return;
  }

  $('historyEmpty').style.display = 'none';

  history.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const { url, scanDate, summary = {} } = entry;

    card.innerHTML = `
      <div class="history-info">
        <div class="history-url" title="${esc(url)}">${esc(shortUrl(url, 55))}</div>
        <div class="history-date">${fmtDate(scanDate)}</div>
      </div>
      <div class="history-stats">
        <span class="history-stat color-relevant">${(entry.relevant||[]).length ?? 0} ok</span>
        <span class="history-stat color-partial">${(entry.partiallyUsed||[]).length ?? 0} partial</span>
        <span class="history-stat color-irrelevant">${(entry.irrelevant||[]).length ?? 0} bad</span>
      </div>
      ${url ? `<button class="rescan-btn" data-url="${esc(url)}" title="Open page in new tab and auto-scan">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Rescan
      </button>` : ''}
    `;

    // Rescan button
    card.querySelector('.rescan-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const target = e.currentTarget.dataset.url;
      if (!target) return;
      chrome.runtime.sendMessage({ type: 'RESCAN_URL', url: target });
    });

    list.appendChild(card);
  });
}

function showEmpty() {
  $('emptyState').style.display = 'flex';
  $('toolbar').style.display = 'none';
  $('pageInfoBanner').style.display = 'none';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

function assetName(url) {
  if (!url) return 'unknown';
  try { return new URL(url).pathname.split('/').pop() || url; } catch { return url.split('/').pop() || url; }
}

function shortUrl(url, max = 70) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const s = u.hostname + u.pathname;
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch { return url.slice(0, max); }
}

function categoryFromPct(pct) {
  if (pct >= 20) return 'relevant';
  if (pct >= 5)  return 'partiallyUsed';
  return 'irrelevant';
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Asset type icons ──────────────────────────────────────────────────────────
function cssIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#6366f1">
    <path d="M4 3h16l-1.5 14L12 20l-6.5-3L4 3z"/>
  </svg>`;
}

function jsIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#f59e0b">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M8 17c0 1 .5 2 2 2s2-1 2-2v-6M15 11h2a2 2 0 000-4h-2v8"/>
  </svg>`;
}

// ── Section status icons ──────────────────────────────────────────────────────
function iconCheck() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="9 12 11.5 14.5 16 9.5"/>
  </svg>`;
}

function iconWarning() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`;
}

function iconX() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>`;
}

init();
