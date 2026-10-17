'use strict';

/** Light-weight projection of a history item for the renderer (no blobs, truncated text). */
function toListItem(item) {
  const out = {
    id: item.id, kind: item.kind, createdAt: item.createdAt, isPinned: item.isPinned,
    sourceAppName: item.sourceAppName, sourceBundleId: item.sourceBundleId ?? null, sensitive: !!item.sensitive, hasImage: item.hasImage,
    imageWidth: item.imageWidth, imageHeight: item.imageHeight, preview: preview(item),
  };
  if (item.kind === 'url' && !item.sensitive) {
    try {
      const u = new URL(item.text);
      out.urlHost = u.hostname.replace(/^www\./, '');
      out.urlPath = (u.pathname === '/' ? '' : u.pathname) + u.search;
    } catch { /* leave undefined */ }
  }
  return out;
}

function preview(item, maxChars = 300, maxCodeLines = 4) {
  if (item.sensitive) return `•••••••• ${item.secretLabel ?? 'Sensitive'} (hidden, removed soon)`;
  if (item.kind === 'image') return `Image ${item.imageWidth} × ${item.imageHeight}`;
  const head = (item.text ?? '').slice(0, maxChars * 2);
  if (item.kind === 'code') return head.split('\n').slice(0, maxCodeLines).join('\n').slice(0, maxChars);
  return head.split(/\s+/).filter(Boolean).join(' ').slice(0, maxChars);
}

module.exports = { toListItem, preview };
