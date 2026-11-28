import { METERS, SUBDIVISIONS } from "./rhythm.mjs";

export const STORAGE_KEY = "staendchen.tools";

export const DEFAULTS = Object.freeze({
  a4: 443, tuneKey: "C", droneNote: 9, droneVolume: 0.8,
  mTempo: 80, mMeter: "4/4", mAccent: true, mBackbeat: false, mSub: "none", mVolume: 0.7,
});

const isUnit = v => typeof v === "number" && v >= 0 && v <= 1;

const VALID = {
  a4: v => Number.isInteger(v) && v >= 430 && v <= 450,
  tuneKey: v => v === "C" || v === "Bb",
  droneNote: v => Number.isInteger(v) && v >= 0 && v <= 11,
  droneVolume: isUnit,
  mTempo: v => Number.isInteger(v) && v >= 30 && v <= 240,
  mMeter: v => METERS.includes(v),
  mAccent: v => typeof v === "boolean",
  mBackbeat: v => typeof v === "boolean",
  mSub: v => typeof v === "string" && Object.hasOwn(SUBDIVISIONS, v),
  mVolume: isUnit,
};

export function valid(key, value) {
  return Object.hasOwn(VALID, key) && VALID[key](value);
}

export function parseSettings(text) {
  const settings = { ...DEFAULTS };
  if (typeof text !== "string" || text.length > 4096) return settings;
  let stored;
  try { stored = JSON.parse(text); } catch { return settings; }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return settings;
  for (const key of Object.keys(DEFAULTS)) if (Object.hasOwn(stored, key) && valid(key, stored[key])) settings[key] = stored[key];
  return settings;
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

let current = null;

export function settings() {
  if (!current) {
    let text = null;
    try { text = storage()?.getItem(STORAGE_KEY) ?? null; } catch {}
    current = parseSettings(text);
  }
  return current;
}

export function update(diff) {
  const s = settings();
  const applied = {};
  for (const [key, value] of Object.entries(diff)) {
    if (valid(key, value)) applied[key] = s[key] = value;
  }
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  return applied;
}
