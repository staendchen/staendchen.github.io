let ctx = null;
let renew = false;
let idleTimer = null;
const users = new Map();
const replaceHandlers = new Set();

const holding = kind => [...users.values()].includes(kind);
const micActive = () => holding("mic") || holding("micStarting");

function setSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {}
}

export function current() {
  return ctx;
}

export function hold(token, kind) {
  users.set(token, kind);
  clearTimeout(idleTimer);
}

export function release(token) {
  if (!users.delete(token)) return;
  closeWhenIdle();
}

export function renewSoon() {
  renew = true;
}

export function onReplace(handler) {
  replaceHandlers.add(handler);
  return () => replaceHandlers.delete(handler);
}

export function context(forMic = false) {
  if (ctx && (ctx.state === "closed" || (renew && !holding("mic")))) {
    ctx.close().catch(() => {});
    ctx = null;
  }
  renew = false;
  clearTimeout(idleTimer);
  setSession(forMic || micActive() ? "auto" : "playback");
  if (!ctx) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    ctx = new Context();
    for (const handler of [...replaceHandlers]) handler(ctx);
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}

export async function running(c) {
  const before = c.currentTime;
  for (let i = 0; i < 25; i++) {
    await new Promise(resolve => setTimeout(resolve, 40));
    if (c.state === "running" && c.currentTime > before) return true;
    if (c.state === "closed") break;
    c.resume().catch(() => {});
  }
  renew = true;
  return false;
}

export function closeWhenIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!ctx || users.size) return;
    ctx.close().catch(() => {});
    ctx = null;
    renew = false;
    setSession("auto");
  }, 2000);
}

export function audibleTime(c, ms = performance.now()) {
  const stamp = c.getOutputTimestamp?.();
  if (stamp && stamp.performanceTime > 0) return stamp.contextTime + (ms - stamp.performanceTime) / 1000;
  return c.currentTime - (c.outputLatency || c.baseLatency || 0) - (performance.now() - ms) / 1000;
}
