// popup.js — Asset Detective popup controller

const $ = id => document.getElementById(id);

let currentTabId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  currentTabId = tab.id;

  // Show URL strip
  try {
    const u = new URL(tab.url);
    $('urlLabel').textContent = u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    $('urlLabel').textContent = tab.url?.slice(0, 60) ?? '—';
  }

  // Check for existing results
  const stored = await chrome.storage.local.get(`scan_${tab.id}`);
  if (stored[`scan_${tab.id}`]) {
    showQuickSummary(stored[`scan_${tab.id}`]);
    $('viewResultsBtn').style.display = '';
  }

  // Load saved settings
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    $('ajaxDelay').value            = settings.ajaxDelay ?? 3000;
    $('autoScroll').checked         = settings.autoScroll ?? true;
    $('triggerInteractions').checked = settings.triggerInteractions ?? true;
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  $('scanBtn').addEventListener('click', startScan);
  $('viewResultsBtn').addEventListener('click', openResults);
  $('historyBtn').addEventListener('click', openHistory);
});

// ── Scan ──────────────────────────────────────────────────────────────────────
async function startScan() {
  const settings = {
    ajaxDelay:           parseInt($('ajaxDelay').value) || 3000,
    autoScroll:          $('autoScroll').checked,
    triggerInteractions: $('triggerInteractions').checked,
  };

  await chrome.storage.local.set({ settings });

  $('scanBtn').disabled = true;
  $('viewResultsBtn').style.display = 'none';
  $('quickSummary').style.display   = 'none';
  $('statusBar').style.display      = 'flex';
  setStatus('Attaching debugger…');

  chrome.runtime.sendMessage({ type: 'START_SCAN', tabId: currentTabId, settings });
}

// ── Message handler ───────────────────────────────────────────────────────────
function handleMessage(msg) {
  if (msg.tabId && msg.tabId !== currentTabId) return;

  switch (msg.type) {
    case 'SCAN_PROGRESS':
      setStatus(msg.message);
      break;

    case 'SCAN_COMPLETE':
      $('statusBar').style.display = 'none';
      $('scanBtn').disabled        = false;
      $('viewResultsBtn').style.display = '';
      showQuickSummary(msg.results);
      break;

    case 'SCAN_ERROR':
      setStatus('Error: ' + msg.error);
      $('scanBtn').disabled = false;
      break;
  }
}

function setStatus(msg) {
  $('statusText').textContent = msg;
}

// ── Quick summary ─────────────────────────────────────────────────────────────
function showQuickSummary(results) {
  const { relevant = [], partiallyUsed = [], irrelevant = [], summary = {} } = results;
  $('qsRelevant').textContent   = relevant.length;
  $('qsPartial').textContent    = partiallyUsed.length;
  $('qsIrrelevant').textContent = irrelevant.length;
  $('qsBloat').textContent      = formatBytes(summary.totalBloatBytes ?? 0);
  $('quickSummary').style.display = 'grid';
}

function formatBytes(bytes) {
  if (bytes < 1024)        return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

// ── Navigation ────────────────────────────────────────────────────────────────
function openResults() {
  chrome.tabs.create({ url: chrome.runtime.getURL('results/results.html') + `?tabId=${currentTabId}` });
}

function openHistory() {
  chrome.tabs.create({ url: chrome.runtime.getURL('results/results.html') + `?view=history` });
}
