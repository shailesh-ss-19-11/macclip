'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { capture, parseWebUrl, looksLikeCode } = require('../src/main/capture');
const { textSnap, imageSnap, clip } = require('./helpers');

test('plain text is captured with metadata', () => {
  const { item } = clip(textSnap('hello world'), { bundleId: 'com.apple.Safari', name: 'Safari' });
  assert.equal(item.kind, 'text');
  assert.equal(item.text, 'hello world');
  assert.equal(item.sourceAppName, 'Safari');
  assert.ok(item.createdAt > 0);
  assert.match(item.searchText, /safari/);
});

test('URLs are classified and trimmed', () => {
  const { item } = clip(textSnap('  https://example.com/a?b=1\n'));
  assert.equal(item.kind, 'url');
  assert.equal(item.text, 'https://example.com/a?b=1');
});

test('text containing spaces with a URL is plain text', () => {
  assert.equal(clip(textSnap('see https://example.com now')).item.kind, 'text');
});

test('non-web schemes are not links', () => {
  assert.equal(parseWebUrl('javascript:alert(1)'), null);
  assert.equal(parseWebUrl('file:///etc/passwd'), null);
});

test('multi-line source is classified as code', () => {
  const code = 'function add(a, b) {\n  return a + b;\n}\n';
  assert.equal(clip(textSnap(code)).item.kind, 'code');
  assert.equal(looksLikeCode('just a sentence of prose\nand another line here', null), false);
});

test('a single code-ish line from an editor is code', () => {
  assert.equal(clip(textSnap('const x = foo(1);'), { bundleId: 'com.microsoft.VSCode', name: 'Code' }).item.kind, 'code');
  assert.equal(clip(textSnap('const x = foo(1);'), { bundleId: 'com.apple.Notes', name: 'Notes' }).item.kind, 'text');
});

test('rich text keeps RTF as base64', () => {
  const { item } = clip(textSnap('bold', { rtf: Buffer.from('{\\rtf1 bold}') }));
  assert.equal(item.kind, 'richText');
  assert.equal(Buffer.from(item.rtf, 'base64').toString(), '{\\rtf1 bold}');
});

test('images are captured with PNG and thumbnail', () => {
  const result = clip(imageSnap(1, [640, 480]));
  assert.equal(result.item.kind, 'image');
  assert.equal(result.item.imageWidth, 640);
  assert.ok(result.image.png.length && result.image.thumb.length);
});

test('image wins when the text is only the image URL, but not when there is real text', () => {
  const withUrl = { ...imageSnap(), text: 'https://example.com/pic.png' };
  assert.equal(clip(withUrl).item.kind, 'image');
  const withText = { ...imageSnap(), text: 'a caption' };
  assert.equal(clip(withText).item.kind, 'text');
});

test('identical content hashes equal; different content differs', () => {
  assert.equal(clip(textSnap('a')).item.contentHash, clip(textSnap('a')).item.contentHash);
  assert.notEqual(clip(textSnap('a')).item.contentHash, clip(textSnap('b')).item.contentHash);
  assert.notEqual(clip(imageSnap(1)).item.contentHash, clip(imageSnap(2)).item.contentHash);
});

test('empty, whitespace-only and file copies are skipped', () => {
  assert.equal(clip(textSnap('')).skipped, 'empty');
  assert.equal(clip(textSnap('  \n\t')).skipped, 'empty');
  assert.equal(clip(textSnap('a.pdf', { hasFileUrl: true })).skipped, 'file-copy');
});

test('oversized text and images are skipped', () => {
  const limits = { maxTextBytes: 10, maxRichBytes: 10, maxImageBytes: 5 };
  assert.equal(clip(textSnap('x'.repeat(11)), null, { limits }).skipped, 'too-large');
  assert.equal(clip(imageSnap(), null, { limits }).skipped, 'too-large');
});

test('oversized RTF falls back to plain text', () => {
  const limits = { maxTextBytes: 1000, maxRichBytes: 4, maxImageBytes: 1000 };
  assert.equal(clip(textSnap('hello', { rtf: Buffer.alloc(50) }), null, { limits }).item.kind, 'text');
});
