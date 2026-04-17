// export.js — Export helpers

export function exportJSON(results) {
  const { scanDate, url, pageInfo, settings, relevant, partiallyUsed, irrelevant, summary } = results;

  const payload = {
    scan_date: scanDate,
    url,
    site_info: pageInfo,
    settings,
    assets: {
      relevant:       (relevant || []).map(assetToExport),
      partially_used: (partiallyUsed || []).map(assetToExport),
      irrelevant:     (irrelevant || []).map(assetToExport),
    },
    summary: {
      total_files:               summary.totalFiles,
      total_bytes:               summary.totalBytes,
      used_bytes:                summary.usedBytes,
      bloat_bytes:               summary.totalBloatBytes,
      potential_savings_percent: summary.potentialSavingsPercent,
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `asset-detective-${slugify(url)}-${dateSlug(scanDate)}.json`;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

export function copyAssetList(results, category) {
  const list = results[category] || [];
  const text = list.map(a => `${a.usagePercent}%\t${a.type.toUpperCase()}\t${a.url}`).join('\n');
  navigator.clipboard.writeText(text);
}

function assetToExport(a) {
  return {
    url:           a.url,
    type:          a.type,
    usage_percent: a.usagePercent,
    used_bytes:    a.usedBytes,
    total_bytes:   a.totalBytes,
    load_method:   a.loadMethod,
    recommendation: a.recommendation,
  };
}

function slugify(url) {
  try {
    return new URL(url).hostname.replace(/\W+/g, '-');
  } catch { return 'unknown'; }
}

function dateSlug(iso) {
  return (iso || '').slice(0, 10);
}
