export const SPACINGS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14];
export const DEFAULT_SPACING = { narrow: 3, wide: 8 };
export const SIZES = [30, 40, 50, 60, 70, 80, 90, 100, 115, 130, 150, 175, 200];
export const MAX_SIZE = SIZES[SIZES.length - 1];
export const FORMATS = ['auto', 'wide', 'narrow'];
export const NARROW_BELOW = 600;

export function formatFor(setting, width) {
  if (setting === 'wide' || setting === 'narrow') return setting;
  return width < NARROW_BELOW ? 'narrow' : 'wide';
}

export function spacingFor(spacing, format) {
  const value = spacing?.[format];
  return SPACINGS.includes(value) ? value : DEFAULT_SPACING[format];
}

export function stepSpacing(value, direction) {
  const i = SPACINGS.indexOf(value);
  const at = i < 0 ? 0 : i;
  return SPACINGS[Math.max(0, Math.min(SPACINGS.length - 1, at + direction))];
}

export function stepSize(size, direction) {
  if (direction > 0) return SIZES.find(s => s > size + 0.5) ?? MAX_SIZE;
  return [...SIZES].reverse().find(s => s < size - 0.5) ?? SIZES[0];
}

export function validSize(size) {
  return Number.isFinite(size) && size >= SIZES[0] && size <= MAX_SIZE ? size : 100;
}

export function shownWidth(size) {
  return Math.min(100, validSize(size));
}

export function zoomFor(size) {
  return Math.max(100, validSize(size)) / 100;
}

export function engraveScale(width, format) {
  return Math.max(10, Math.round(format === 'narrow' ? 35 * width / 375 : 48 * width / 900));
}

export function systemShifts(systems, spatium, spacing) {
  const extra = spacing - SPACINGS[0];
  const staffGap = (3 + extra) * spatium;
  const inkGap = (0.5 + extra) * spatium;
  const shifts = [];
  let prev = null;
  let inkBottom = 0;
  for (const system of systems) {
    let d = 0;
    if (prev) {
      d = prev.staffBottom + staffGap - system.staffTop;
      const n = Math.min(prev.bottom.length, system.top.length);
      for (let b = 0; b < n; b++) {
        if (prev.bottom[b] > -Infinity && system.top[b] < Infinity) d = Math.max(d, prev.bottom[b] + inkGap - system.top[b]);
      }
    }
    shifts.push(d);
    prev = { bottom: system.bottom.map(v => v + d), staffBottom: system.staffBottom + d };
    inkBottom = system.inkBottom + d;
  }
  return { shifts, height: inkBottom + 2 * spatium };
}

export function turn({ top, height, max, systems }, direction) {
  if (direction > 0) {
    if (top >= max - 2) return { piece: 1 };
    const cut = systems.find(([, bottom]) => bottom > top + height + 1);
    let target = cut ? cut[0] - 8 : top + height;
    if (target <= top + 4) target = top + height * 0.85;
    return { scroll: Math.min(target, max) };
  }
  if (top <= 2) return { piece: -1 };
  const first = systems.find(([t]) => t >= top - height);
  let target = first ? first[0] - 8 : top - height;
  if (target >= top - 4) target = top - height * 0.85;
  return { scroll: Math.max(0, target) };
}

export function zoneAt(fraction) {
  return fraction < 0.25 ? -1 : fraction > 0.75 ? 1 : 0;
}

export function fitSize(ratios, width, height) {
  const sum = ratios.reduce((a, b) => a + b, 0);
  if (!sum || width <= 0 || height <= 0) return 100;
  return Math.max(SIZES[0], Math.min(100, Math.floor(height / sum / width * 100)));
}
