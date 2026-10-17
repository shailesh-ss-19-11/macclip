'use strict';
// Detects content that very likely is a credential. Deliberately pattern-based (no entropy guessing)
// so ordinary text, URLs, hashes and code are not flagged. Best effort, not a guarantee.

const PATTERNS = [
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Stripe key', /\b[sr]k_live_[A-Za-z0-9]{16,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['API key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i],
  ['Credential assignment', /(?<![A-Za-z])(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"'()]{8,}/i],
];

function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Returns a short label such as "GitHub token", or null. */
function detectSecret(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 200_000) return null;
  const trimmed = text.trim();
  if (/^[\d -]{13,23}$/.test(trimmed)) {
    const digits = trimmed.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'Card number';
  }
  for (const [label, re] of PATTERNS) if (re.test(text)) return label;
  return null;
}

module.exports = { detectSecret, luhn };
