'use strict';
// Pure transformation: clipboard snapshot -> history item. No Electron, no I/O.
const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({
  maxTextBytes: 1_000_000,
  maxRichBytes: 1_000_000,
  maxImageBytes: 30_000_000,
});

const EDITOR_PREFIXES = [
  'com.apple.dt.Xcode', 'com.microsoft.VSCode', 'com.todesktop', 'com.jetbrains.',
  'com.sublimetext.', 'com.panic.Nova', 'dev.zed.', 'com.github.atom',
];

const sha256 = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

function parseWebUrl(str) {
  if (!str || /\s/.test(str)) return null;
  try {
    const url = new URL(str);
    if (!['http:', 'https:', 'ftp:', 'ftps:'].includes(url.protocol) || !url.hostname) return null;
    return url;
  } catch { return null; }
}

function looksLikeCode(text, sourceBundleId) {
  const fromEditor = !!sourceBundleId && EDITOR_PREFIXES.some((p) => sourceBundleId.startsWith(p));
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return fromEditor && /[(){};=<>]/.test(text);
  const keywords = ['func ', 'def ', 'class ', 'import ', '#include', 'return ', 'const ', 'let ', 'var ',
    '=> ', '-> ', '</', 'if (', 'for (', 'SELECT ', 'public ', 'private ', 'function '];
  let codeLines = 0;
  for (const line of lines) {
    const s = line.trim();
    const indented = /^(\t|  )/.test(line);
    const endsLikeCode = /[{};,]$/.test(s) || s.endsWith('):');
    if (endsLikeCode || keywords.some((k) => s.includes(k)) || (indented && /[(){}[\]=<>]/.test(s))) codeLines++;
  }
  return codeLines >= 2 && codeLines / lines.length >= (fromEditor ? 0.25 : 0.4);
}

function makeSearchText(text, sourceAppName, kindLabel) {
  return [text ? text.slice(0, 5000) : '', sourceAppName || '', kindLabel].join(' ').toLowerCase();
}

const KIND_LABEL = { text: 'Text', richText: 'Rich Text', url: 'Link', image: 'Image', code: 'Code' };

/**
 * snapshot: { text, rtf: Buffer|null, html: string|null, hasFileUrl, getImage(): {png, thumb, width, height}|null,
 *             imageByteLength }
 * source:   { bundleId, name } | null
 * Returns { skipped: reason } or { item, image: {png, thumb}|null }.
 */
function capture(snapshot, source, { limits = DEFAULT_LIMITS, now = Date.now(), id = crypto.randomUUID() } = {}) {
  if (snapshot.hasFileUrl) return { skipped: 'file-copy' };

  const text = typeof snapshot.text === 'string' ? snapshot.text : '';
  const trimmed = text.trim();
  const hasText = trimmed.length > 0;
  const isUrl = hasText && parseWebUrl(trimmed) !== null;
  const base = {
    id, createdAt: now, isPinned: false,
    sourceBundleId: source?.bundleId ?? null, sourceAppName: source?.name ?? null,
  };

  // An image wins when there is no real text, or the text is merely the image's URL.
  if (snapshot.imageByteLength > 0 && (!hasText || isUrl)) {
    if (snapshot.imageByteLength > limits.maxImageBytes) return { skipped: 'too-large' };
    const img = snapshot.getImage();
    if (img) {
      const item = {
        ...base, kind: 'image', text: null, rtf: null, html: null,
        hasImage: true, imageWidth: img.width, imageHeight: img.height,
        contentHash: sha256('img:', img.png), byteCount: img.png.length,
        searchText: makeSearchText(`image ${img.width}x${img.height}`, source?.name, KIND_LABEL.image),
      };
      return { item, image: { png: img.png, thumb: img.thumb } };
    }
    if (!hasText) return { skipped: 'empty' };
  }

  if (!hasText) return { skipped: 'empty' };
  if (Buffer.byteLength(text) > limits.maxTextBytes) return { skipped: 'too-large' };

  let kind;
  let rtf = null;
  let html = null;
  if (snapshot.rtf && snapshot.rtf.length <= limits.maxRichBytes) {
    kind = 'richText';
    rtf = snapshot.rtf;
    if (snapshot.html && Buffer.byteLength(snapshot.html) <= limits.maxRichBytes) html = snapshot.html;
  } else if (isUrl) {
    kind = 'url';
  } else if (looksLikeCode(text, source?.bundleId)) {
    kind = 'code';
  } else {
    kind = 'text';
  }

  const stored = kind === 'url' ? trimmed : text;
  const item = {
    ...base, kind, text: stored, rtf: rtf ? rtf.toString('base64') : null, html,
    hasImage: false, imageWidth: null, imageHeight: null,
    contentHash: sha256('txt:', stored), byteCount: Buffer.byteLength(stored) + (rtf?.length ?? 0),
    searchText: makeSearchText(stored, source?.name, KIND_LABEL[kind]),
  };
  return { item, image: null };
}

module.exports = { capture, parseWebUrl, looksLikeCode, DEFAULT_LIMITS, KIND_LABEL };
