'use strict';

/**
 * Where to place the panel: top-left near the cursor, clamped inside the work area of the display
 * under the cursor. `displays` are work areas { x, y, width, height }.
 */
function panelPosition({ width, height }, cursor, displays, margin = 8) {
  const area = displays.find((d) => cursor.x >= d.x && cursor.x < d.x + d.width && cursor.y >= d.y && cursor.y < d.y + d.height) ?? displays[0];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: Math.round(clamp(cursor.x - 16, area.x + margin, area.x + area.width - width - margin)),
    y: Math.round(clamp(cursor.y + 8, area.y + margin, area.y + area.height - height - margin)),
  };
}

module.exports = { panelPosition };
