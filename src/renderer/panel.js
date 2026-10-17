'use strict';
(() => {
  const { buildSections, flatten, moveSelection, selectionAfterDelete, commandForKey } = window.HistoryView;
  const $ = (id) => document.getElementById(id);
  const queryEl = $('query'), listEl = $('list');

  const ICONS = {
    text: '<path d="M2 3h12M2 6.5h12M2 10h8" />',
    richText: '<path d="M3 3h10M8 3v10M6 13h4" />',
    url: '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />',
    image: '<rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="6" cy="7" r="1" /><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />',
    code: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />',
    snippet: '<path d="M9 1.8L3.5 9h4l-1 5.2L12.5 7h-4z" />',
  };
  const icon = (kind) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind] ?? ICONS.text}</svg>`;

  let flat = [];
  let selectedId = null;
  let seq = 0;
  let data = null;
  let observer = null;
  let mode = 'history';
  const iconCache = new Map();

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function refresh({ resetSelection = false } = {}) {
    const mine = ++seq;
    const result = await window.macclip.list(queryEl.value, mode);
    if (mine !== seq) return; // a newer request superseded this one
    data = result;
    const sections = mode === 'snippets'
      ? (result.items.length ? [{ title: 'Snippets', items: result.items }] : [])
      : buildSections(result.items);
    flat = flatten(sections);
    if (resetSelection || !flat.some((i) => i.id === selectedId)) selectedId = flat[0]?.id ?? null;
    render(sections);
  }

  function render(sections) {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        loadThumb(entry.target);
      }
    }, { root: listEl, rootMargin: '120px' });

    listEl.replaceChildren();
    renderBanner();
    if (!flat.length) {
      const empty = el('div', 'empty');
      const snippets = mode === 'snippets';
      empty.append(el('b', '', queryEl.value ? 'No matches' : snippets ? 'No snippets yet' : 'Nothing copied yet'),
        document.createTextNode(queryEl.value ? `Nothing matches “${queryEl.value}”.`
          : snippets ? 'Press ⌘S on a history item to save it, or add snippets in Settings.' : 'Things you copy will show up here.'));
      listEl.append(empty);
    }
    let position = 0;
    for (const section of sections) {
      listEl.append(el('div', 'section', section.title));
      for (const item of section.items) listEl.append(renderRow(item, ++position));
    }
    const noun = mode === 'snippets' ? 'snippet' : 'item';
    $('count').textContent = data.matched > data.items.length ? `${data.items.length} of ${data.matched}` : `${data.total} ${noun}${data.total === 1 ? '' : 's'}`;
    $('clear').hidden = mode === 'snippets';
    $('clear').disabled = data.unpinned === 0;
    $('hints').innerHTML = mode === 'snippets'
      ? '<kbd>↩</kbd> paste <kbd>⇥</kbd> history <kbd>⌘⌫</kbd> delete'
      : '<kbd>↩</kbd> paste <kbd>⇧↩</kbd> plain <kbd>⌘S</kbd> snippet <kbd>⇥</kbd> snippets';
    scrollToSelected();
  }

  function renderBanner() {
    const banner = $('banner');
    const message = data.paused ? 'Monitoring is paused. New copies are not being saved.'
      : data.loadIssue || data.storageWarning || '';
    banner.hidden = !message;
    banner.textContent = message;
  }

  function renderRow(item, position) {
    const row = el('div', `row${item.id === selectedId ? ' selected' : ''}`);
    row.dataset.id = item.id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(item.id === selectedId));
    row.setAttribute('aria-label', `${item.kind === 'snippet' ? `Snippet ${item.title}` : item.kind === 'image' ? 'Image' : item.sensitive ? 'Sensitive item' : item.preview}${item.isPinned ? ', pinned' : ''}`);

    const tile = el('div', 'tile');
    if (item.kind === 'image') { tile.dataset.thumb = item.id; tile.innerHTML = icon('image'); observer.observe(tile); }
    else tile.innerHTML = icon(item.kind);
    const wrap = el('div', 'tilewrap');
    wrap.append(tile);
    if (item.sourceBundleId) {
      const badge = el('img', 'badge');
      badge.alt = '';
      badge.hidden = true;
      wrap.append(badge);
      loadAppIcon(item.sourceBundleId).then((url) => { if (url) { badge.src = url; badge.hidden = false; } });
    }

    const body = el('div', 'body');
    if (item.kind === 'snippet') {
      body.append(el('div', 'title snippet', item.title), el('div', 'sub', item.preview));
    } else if (item.sensitive) {
      body.append(el('div', 'title sensitive', item.preview));
    } else if (item.kind === 'url') {
      body.append(el('div', 'title link', item.urlHost || item.preview), el('div', 'sub', (item.urlPath || '') || item.preview));
    } else if (item.kind === 'image') {
      body.append(el('div', 'title', item.preview), el('div', 'sub', item.sourceAppName || 'Image'));
    } else {
      body.append(el('div', `title${item.kind === 'code' ? ' code' : ''}`, item.preview));
    }

    const meta = el('div', 'meta');
    if (item.isPinned) meta.append(Object.assign(el('span', 'pin-mark'), { textContent: '●', title: 'Pinned' }));
    if (position <= 9) meta.append(el('span', 'num', `⌘${position}`));
    const actions = el('div', 'actions');
    const pin = Object.assign(el('button', 'pin'), { title: item.isPinned ? 'Unpin' : 'Pin' });
    pin.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="${item.isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M6 2h4l-.5 4 2 2.5H4.5L6.5 6 6 2zM8 8.5V14"/></svg>`;
    pin.setAttribute('aria-label', item.isPinned ? 'Unpin' : 'Pin');
    const del = el('button', 'del');
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete');
    del.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/></svg>';
    if (mode === 'snippets') actions.append(del); else actions.append(pin, del);
    meta.append(actions);

    row.append(wrap, body, meta);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.pin')) return window.macclip.togglePin(item.id);
      if (e.target.closest('.del')) return removeItem(item.id);
      activate(item.id, e.shiftKey);
    });
    row.addEventListener('mousemove', () => { if (selectedId !== item.id) select(item.id, false); });
    return row;
  }

  async function loadThumb(tile) {
    const url = await window.macclip.thumbnail(tile.dataset.thumb);
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.src = url;
    tile.replaceChildren(img);
  }

  function select(id, scroll = true) {
    selectedId = id;
    for (const row of listEl.querySelectorAll('.row')) {
      const on = row.dataset.id === id;
      row.classList.toggle('selected', on);
      row.setAttribute('aria-selected', String(on));
    }
    if (scroll) scrollToSelected();
  }

  function scrollToSelected() {
    listEl.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function activate(id, plain = false) { if (id) window.macclip.select(id, { plain, snippet: mode === 'snippets' }); }

  function loadAppIcon(bundleId) {
    if (!iconCache.has(bundleId)) iconCache.set(bundleId, window.macclip.appIcon(bundleId));
    return iconCache.get(bundleId);
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    for (const [id, m] of [['tab-history', 'history'], ['tab-snippets', 'snippets']]) $(id).setAttribute('aria-selected', String(mode === m));
    queryEl.value = '';
    refresh({ resetSelection: true });
  }

  async function removeItem(id) {
    const next = selectionAfterDelete(flat, id);
    selectedId = next;
    await (mode === 'snippets' ? window.macclip.deleteSnippet(id) : window.macclip.remove(id));
    await refresh();
  }

  document.addEventListener('keydown', (e) => {
    const command = commandForKey(e, { searchEmpty: queryEl.value === '' });
    if (!command) return;
    e.preventDefault();
    switch (command.type) {
      case 'move': select(moveSelection(flat, selectedId, command.delta)); break;
      case 'activate': activate(selectedId, command.plain); break;
      case 'switchMode': setMode(mode === 'history' ? 'snippets' : 'history'); break;
      case 'saveSnippet': if (mode === 'history' && selectedId) window.macclip.saveAsSnippet(selectedId); break;
      case 'close': window.macclip.hide(); break;
      case 'togglePin': if (selectedId && mode === 'history') window.macclip.togglePin(selectedId); break;
      case 'delete': if (selectedId) removeItem(selectedId); break;
      case 'quick': activate(flat[command.position - 1]?.id); break;
    }
  });

  queryEl.addEventListener('input', () => refresh({ resetSelection: true }));
  $('tab-history').addEventListener('click', () => setMode('history'));
  $('tab-snippets').addEventListener('click', () => setMode('snippets'));
  $('clear').addEventListener('click', () => window.macclip.clearUnpinned());
  $('settings').addEventListener('click', () => window.macclip.openSettings());
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  window.macclip.onShown(() => {
    mode = 'history';
    $('tab-history').setAttribute('aria-selected', 'true');
    $('tab-snippets').setAttribute('aria-selected', 'false');
    queryEl.value = '';
    listEl.scrollTop = 0;
    refresh({ resetSelection: true });
    queryEl.focus();
  });
  window.macclip.onChanged(() => refresh());
  refresh({ resetSelection: true });
  queryEl.focus();
})();
