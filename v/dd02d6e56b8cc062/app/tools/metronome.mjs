import { h, createToast, whileWaiting, unitGlyph, segments } from "./dom.mjs";
import * as audio from "./audio.mjs";
import { ClickScheduler, meterBeats, meterParts, parseMeter, pickMeter, hasBackbeat, tapTempo, clampTempo, clickLevel, unitOf, PITCHES, MIN_TEMPO, MAX_TEMPO } from "./rhythm.mjs";
import { settings, update } from "./settings.mjs";

const TEXT = {
  noSound: "Ton startet nicht", start: "Start", stop: "Stopp", tempo: "Tempo", tapTempo: "Tempo tippen", slower: "langsamer", faster: "schneller",
  meter: "Taktart", meterCount: "Anzahl", meterUnit: "Notenwert", accent: "Betonung auf 1", on: "An", off: "Aus",
  clickOn: "Klick auf", everyBeat: "Jeden Schlag", backbeat: "2 und 4", subdivision: "Unterteilung",
  subNone: "Keine", subEighths: "Achtel", subTriplets: "Triolen", subSixteenths: "16tel", volume: "Lautstärke",
};

function click(c, time, type) {
  const level = clickLevel(type, settings().mVolume);
  if (level < 0.0005) return;
  const osc = c.createOscillator(), gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.value = PITCHES[type];
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(level, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
  osc.connect(gain).connect(c.destination);
  osc.start(time);
  osc.stop(time + 0.05);
}

export function mountMetronome(container) {
  const abort = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: abort.signal });
  let metro = null, starting = false, generation = 0, taps = [], hold = null, frame = 0, shownUnit = null, shownDen = null, wasConnected = false;
  const token = {};

  const unit = h("span", { class: "tl-metro-unit" });
  const bpm = h("input", { class: "tl-metro-bpm", type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: 3, autocomplete: "off", "aria-label": TEXT.tempo });
  const beats = h("div", { class: "tl-beats tl-metro-beats", "aria-hidden": "true" });
  const down = h("button", { type: "button", class: "tl-btn tl-hold tl-metro-down", "aria-label": TEXT.slower, text: "−" });
  const slider = h("input", { type: "range", class: "tl-metro-slider", min: MIN_TEMPO, max: MAX_TEMPO, step: 1, "aria-label": TEXT.tempo });
  const up = h("button", { type: "button", class: "tl-btn tl-hold tl-metro-up", "aria-label": TEXT.faster, text: "+" });
  const tap = h("button", { type: "button", class: "tl-btn tl-metro-tap", text: TEXT.tapTempo });
  const start = h("button", { type: "button", class: "tl-btn tl-primary tl-metro-start" });
  const main = h("section", { class: "tl-card tl-metro" },
    h("div", { class: "tl-metro-tempo" }, unit, " = ", bpm),
    beats,
    h("div", { class: "tl-metro-row" }, down, slider, up),
    tap, start);

  const meterNow = h("output", { class: "tl-meter-now" });
  const count = h("input", { type: "range", min: 0, step: 1, "aria-label": TEXT.meterCount });
  const den = h("input", { type: "range", min: 0, step: 1, "aria-label": TEXT.meterUnit });
  const countLabel = h("b", { class: "tl-meter-count" });
  const denLabel = h("b", { class: "tl-meter-unit" });
  const meterBox = h("div", { class: "tl-meter-sliders" }, meterNow,
    h("label", {}, h("span", { text: TEXT.meterCount }), count, countLabel),
    h("label", {}, h("span", { text: TEXT.meterUnit }), den, denLabel));
  const accent = segments("mAccent", [[true, TEXT.on], [false, TEXT.off]], change, on);
  const backbeat = segments("mBackbeat", [[false, TEXT.everyBeat], [true, TEXT.backbeat]], change, on);
  const sub = segments("mSub", [["none", TEXT.subNone], ["eighths", TEXT.subEighths], ["triplets", TEXT.subTriplets], ["sixteenths", TEXT.subSixteenths]], change, on);
  const backbeatField = h("div", { class: "tl-field tl-gap tl-backbeat-field" }, h("span", { text: TEXT.clickOn }), backbeat);
  const volume = h("input", { type: "range", class: "tl-metro-volume", min: 0, max: 1, step: 0.05 });
  const options = h("section", { class: "tl-card" },
    h("div", { class: "tl-field" }, h("span", { text: TEXT.meter }), meterBox),
    h("div", { class: "tl-field tl-gap" }, h("span", { text: TEXT.accent }), accent),
    backbeatField,
    h("div", { class: "tl-field tl-gap" }, h("span", { text: TEXT.subdivision }), sub),
    h("label", { class: "tl-field tl-gap" }, h("span", { text: TEXT.volume }), volume));

  const root = h("div", { class: "tools tools-metronome" }, main, options);
  const toast = createToast(root, abort.signal);
  container.append(root);

  function sizeBpm() {
    bpm.dataset.len = String(Math.max(2, Math.min(3, bpm.value.length)));
  }

  function render() {
    const s = settings(), { beats: n, unit: u } = meterBeats(s.mMeter), [num, d] = parseMeter(s.mMeter);
    if (shownUnit !== u) {
      unit.replaceChildren(unitGlyph(u));
      shownUnit = u;
    }
    if (document.activeElement !== bpm) bpm.value = String(s.mTempo);
    sizeBpm();
    slider.value = String(s.mTempo);
    volume.value = String(s.mVolume);
    backbeatField.hidden = !hasBackbeat(s.mMeter);
    if (beats.childElementCount !== n) beats.replaceChildren(...Array.from({ length: n }, () => h("i")));
    start.textContent = metro ? TEXT.stop : TEXT.start;
    start.classList.toggle("tl-primary", !metro);
    start.classList.toggle("tl-on", Boolean(metro));
    const { dens, nums } = meterParts(d);
    count.max = String(nums.length - 1);
    count.value = String(nums.indexOf(num));
    count.disabled = nums.length < 2;
    den.max = String(dens.length - 1);
    den.value = String(dens.indexOf(d));
    den.disabled = dens.length < 2;
    count.setAttribute("aria-valuetext", String(num));
    den.setAttribute("aria-valuetext", String(d));
    meterNow.textContent = s.mMeter;
    countLabel.textContent = String(num);
    if (shownDen !== d) {
      denLabel.replaceChildren(unitGlyph(unitOf(d)));
      shownDen = d;
    }
    accent.render(s.mAccent);
    backbeat.render(s.mBackbeat);
    sub.render(s.mSub);
  }

  function change(diff) {
    update(diff);
    if (!abort.signal.aborted) render();
  }

  function schedule() {
    if (!metro) return;
    if (metro.c !== audio.current() || metro.c.state === "closed") return stop();
    for (const { time, type } of metro.scheduler.advance(metro.c.currentTime, settings())) click(metro.c, time, type);
  }

  function show() {
    frame = 0;
    if (!metro || abort.signal.aborted) return;
    const lit = metro.scheduler.litBeat(audio.audibleTime(metro.c), settings().mTempo);
    [...beats.children].forEach((dot, i) => dot.classList.toggle("tl-lit", i === lit));
    frame = requestAnimationFrame(show);
  }

  async function begin() {
    if (metro || starting || abort.signal.aborted) return;
    starting = true;
    audio.hold(token, "metronome");
    const mine = ++generation;
    let c, ok = false;
    try {
      c = audio.context();
      ok = await whileWaiting(start, audio.running(c));
    } catch {
      ok = false;
    } finally {
      starting = false;
    }
    if (mine !== generation || abort.signal.aborted || c !== audio.current()) return audio.release(token);
    if (!ok) {
      audio.release(token);
      return toast(TEXT.noSound);
    }
    metro = { c, scheduler: new ClickScheduler(c.currentTime + 0.1), timer: setInterval(schedule, 25) };
    schedule();
    render();
    if (!frame) frame = requestAnimationFrame(show);
  }

  function stop() {
    generation++;
    if (!metro) return;
    clearInterval(metro.timer);
    metro = null;
    cancelAnimationFrame(frame);
    frame = 0;
    for (const dot of beats.children) dot.classList.remove("tl-lit");
    audio.release(token);
    if (!abort.signal.aborted) render();
  }

  function releaseHold() {
    clearTimeout(hold);
    clearInterval(hold);
    hold = null;
  }

  on(start, "click", () => metro ? stop() : begin());
  on(tap, "click", () => {
    const result = tapTempo(taps, performance.now());
    taps = result.taps;
    if (result.tempo) change({ mTempo: result.tempo });
  });
  on(slider, "input", () => change({ mTempo: Number(slider.value) }));
  on(bpm, "focus", () => bpm.select());
  on(bpm, "input", () => {
    bpm.value = bpm.value.replace(/\D/g, "").slice(0, 3);
    sizeBpm();
  });
  on(bpm, "keydown", e => { if (e.key === "Enter") bpm.blur(); });
  on(bpm, "blur", () => {
    const n = parseInt(bpm.value, 10);
    if (n) change({ mTempo: clampTempo(n) });
    bpm.value = String(settings().mTempo);
    render();
  });
  on(volume, "input", () => change({ mVolume: Number(volume.value) }));
  for (const [button, step] of [[down, -1], [up, 1]]) {
    const bump = () => change({ mTempo: clampTempo(settings().mTempo + step) });
    on(button, "pointerdown", e => {
      if (e.button > 0) return;
      releaseHold();
      bump();
      hold = setTimeout(() => { hold = setInterval(bump, 70); }, 400);
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) on(button, type, releaseHold);
    on(button, "click", e => { if (e.detail === 0) bump(); });
  }
  for (const [input, part] of [[count, 0], [den, 1]]) {
    on(input, "input", () => change({ mMeter: pickMeter(settings().mMeter, part, Number(input.value)) }));
  }

  function pause() {
    releaseHold();
    stop();
  }
  on(document, "visibilitychange", () => { if (document.visibilityState === "hidden") pause(); });
  on(globalThis, "pagehide", pause);

  function destroy() {
    if (abort.signal.aborted) return;
    abort.abort();
    clearInterval(watch);
    pause();
    audio.release(token);
    root.remove();
  }

  const watch = setInterval(() => {
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) destroy();
  }, 1000);

  render();

  return { destroy };
}
