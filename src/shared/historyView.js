// Pure view-model helpers shared by the panel renderer and the unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HistoryView = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

  /** "Pinned" first, then Today / Yesterday / dated sections; order inside each is preserved (newest first). */
  function buildSections(items, now = Date.now(), locale) {
    const sections = [];
    const pinned = items.filter((i) => i.isPinned);
    if (pinned.length) sections.push({ title: 'Pinned', items: pinned });
    const today = startOfDay(now);
    const yesterday = startOfDay(today - 1);
    let lastDay = null;
    for (const item of items) {
      if (item.isPinned) continue;
      const day = startOfDay(item.createdAt);
      if (day === lastDay) { sections[sections.length - 1].items.push(item); continue; }
      lastDay = day;
      let title;
      if (day === today) title = 'Today';
      else if (day === yesterday) title = 'Yesterday';
      else {
        const sameYear = new Date(day).getFullYear() === new Date(now).getFullYear();
        title = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(day);
      }
      sections.push({ title, items: [item] });
    }
    return sections;
  }

  const flatten = (sections) => sections.flatMap((s) => s.items);

  /** Moves the selection by delta, clamped to the list. Returns the new id (or null when empty). */
  function moveSelection(flat, selectedId, delta) {
    if (!flat.length) return null;
    const current = flat.findIndex((i) => i.id === selectedId);
    const next = Math.min(Math.max((current === -1 ? -1 : current) + delta, 0), flat.length - 1);
    return flat[next].id;
  }

  /** After deleting `id`, which item should be selected? Prefers the next, then the previous. */
  function selectionAfterDelete(flat, id) {
    const i = flat.findIndex((x) => x.id === id);
    if (i === -1) return flat[0]?.id ?? null;
    return (flat[i + 1] ?? flat[i - 1])?.id ?? null;
  }

  /** Maps a keydown to a panel command, or null. `searchEmpty` gates item deletion. */
  function commandForKey({ key, metaKey, ctrlKey, altKey, shiftKey }, { searchEmpty = true } = {}) {
    if (!metaKey && !ctrlKey && !altKey) {
      if (key === 'ArrowDown') return { type: 'move', delta: 1 };
      if (key === 'ArrowUp') return { type: 'move', delta: -1 };
      if (key === 'Enter') return { type: 'activate', plain: !!shiftKey };
      if (key === 'Tab' && !shiftKey) return { type: 'switchMode' };
      if (key === 'Escape') return { type: 'close' };
      if (key === 'PageDown') return { type: 'move', delta: 8 };
      if (key === 'PageUp') return { type: 'move', delta: -8 };
    }
    if (metaKey && !ctrlKey && !altKey && !shiftKey) {
      if (key.toLowerCase() === 'p') return { type: 'togglePin' };
      if (key.toLowerCase() === 's') return { type: 'saveSnippet' };
      if (key === 'Backspace' && searchEmpty) return { type: 'delete' };
      if (/^[1-9]$/.test(key)) return { type: 'quick', position: Number(key) };
    }
    if (ctrlKey && !metaKey && !altKey) {
      if (key.toLowerCase() === 'n') return { type: 'move', delta: 1 };
      if (key.toLowerCase() === 'p') return { type: 'move', delta: -1 };
    }
    return null;
  }

  return { buildSections, flatten, moveSelection, selectionAfterDelete, commandForKey };
});
