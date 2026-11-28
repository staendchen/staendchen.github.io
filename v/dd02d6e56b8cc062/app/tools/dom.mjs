const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "hidden") el.hidden = true;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.filter(child => child !== null && child !== undefined));
  return el;
}

export function svg(name, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (parent) parent.append(el);
  return el;
}

function halfNote() {
  const root = svg("svg", { class: "tl-half-note", viewBox: "0 0 10 22", "aria-hidden": "true" });
  svg("ellipse", { cx: 4.4, cy: 17.6, rx: 3.7, ry: 2.7, transform: "rotate(-20 4.4 17.6)", fill: "none", stroke: "currentColor", "stroke-width": 1.6 }, root);
  svg("path", { d: "M7.7 17V1.5", stroke: "currentColor", "stroke-width": 1.4 }, root);
  return root;
}

export function unitGlyph(unit) {
  if (unit === "half") return halfNote();
  return document.createTextNode({ quarter: "♩", eighth: "♪", dotted: "♩." }[unit] ?? "♩");
}

export function createToast(parent, signal) {
  const box = h("div", { class: "tl-toast", role: "status", "aria-live": "polite" });
  parent.append(box);
  let timer = null;
  signal.addEventListener("abort", () => clearTimeout(timer));
  return text => {
    if (signal.aborted) return;
    box.textContent = text;
    box.classList.add("tl-show");
    clearTimeout(timer);
    timer = setTimeout(() => box.classList.remove("tl-show"), 3500);
  };
}

export function whileWaiting(button, promise) {
  const timer = setTimeout(() => button.classList.add("tl-loading"), 150);
  return Promise.resolve(promise).finally(() => {
    clearTimeout(timer);
    button.classList.remove("tl-loading");
  });
}

export function segments(field, options, onPick, on) {
  const group = h("div", { class: "tl-segments", role: "group" },
    ...options.map(([value, label]) => h("button", { type: "button", "data-value": String(value), "aria-pressed": "false", text: label })));
  on(group, "click", e => {
    const button = e.target.closest("button");
    if (!button || !group.contains(button)) return;
    const option = options.find(([value]) => String(value) === button.dataset.value);
    if (option) onPick({ [field]: option[0] });
  });
  group.render = current => {
    for (const button of group.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.value === String(current)));
  };
  return group;
}
