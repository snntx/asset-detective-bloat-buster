// storage.js — Wrapper around chrome.storage.local

export async function getScanResult(tabId) {
  const key = `scan_${tabId}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

export async function getScanHistory() {
  const { scanHistory = [] } = await chrome.storage.local.get('scanHistory');
  return scanHistory;
}

export async function clearScanHistory() {
  await chrome.storage.local.remove('scanHistory');
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return {
    ajaxDelay: 3000,
    autoScroll: true,
    triggerInteractions: true,
    ...settings,
  };
}
