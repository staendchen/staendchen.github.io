import { h, svg, createToast, whileWaiting } from "./dom.mjs";
import * as audio from "./audio.mjs";
import { PitchDetector, LevelGate, readTuning, noteName, pitchName, midiToHz, droneMidi, signed, decimal, TOLERANCE } from "./pitch.mjs";
import { settings, update } from "./settings.mjs";

const TEXT = {
  concertPitch: "Kammerton", a4Down: "Kammerton tiefer", a4Up: "Kammerton höher",
  centsUnit: "Cent", majorThird: "Dur-Terz", minorThird: "Moll-Terz",
  droneNote: "Drone auf dem Ton", drone: "Drone", droneVolume: "Lautstärke Drone", headphones: "Mit Kopfhörern hörst du den Drone am besten.",
  micOn: "Mikro an", micOff: "Mikro aus",
  needHttps: "Das Mikrofon geht nur über eine sichere Verbindung (https). Bitte die Adresse prüfen.",
  micDenied: "Mikrofon nicht erlaubt. In Safari unter „aA“ › Website-Einstellungen freigeben.",
  noMic: "Kein Mikrofon gefunden", micFailed: "Mikrofon startet nicht",
};
const ERROR_NAMES = new Set(["NotFoundError", "NotReadableError", "OverconstrainedError", "AbortError", "SecurityError", "TypeError", "InvalidStateError", "NotSupportedError"]);
const GAUGE = { x: 150, y: 196, r: 150, spread: 60 };
const MARKERS = [[-13.7, "majorThird"], [15.6, "minorThird"]];
const DRONE_VOICES = [[1, "sawtooth", 0.3, -4], [1, "sawtooth", 0.3, 4], [1.5, "sawtooth", 0.2, 0], [2, "triangle", 0.15, 0], [0.5, "sine", 0.15, 0]];
const workletReady = new WeakSet();

const centsAngle = cents => Math.max(-50, Math.min(50, cents)) / 50 * GAUGE.spread;
const polar = (r, angle) => [GAUGE.x + r * Math.sin(angle * Math.PI / 180), GAUGE.y - r * Math.cos(angle * Math.PI / 180)].map(v => +v.toFixed(2));
const transpose = () => settings().tuneKey === "C" ? 0 : 2;
const tuneA4 = () => settings().a4 / 2 ** (transpose() / 12);
const tuneDroneMidi = () => droneMidi(settings().droneNote - transpose());
const droneLevel = () => 0.3 * settings().droneVolume;

function buildGauge(gauge) {
  const { r } = GAUGE, inner = r - 18, tol = centsAngle(TOLERANCE);
  const [a, b, c, d] = [polar(r, -tol), polar(r, tol), polar(inner, tol), polar(inner, -tol)];
  svg("path", { class: "tl-zone", d: `M${a}A${r} ${r} 0 0 1 ${b}L${c}A${inner} ${inner} 0 0 0 ${d}Z` }, gauge);
  for (let cents = -50; cents <= 50; cents += 2) {
    const long = cents % 10 === 0, [x1, y1] = polar(r, centsAngle(cents)), [x2, y2] = polar(r - (long ? 16 : 8), centsAngle(cents));
    svg("line", { class: long ? "tl-tick tl-long" : "tl-tick", x1, y1, x2, y2 }, gauge);
  }
  for (const cents of [-50, 0, 50]) {
    const [x, y] = polar(r + 12, centsAngle(cents));
    svg("text", { class: "tl-label", x, y: y + 4 }, gauge).textContent = cents ? signed(cents) : "0";
  }
  const [ux, uy] = polar(r - 34, centsAngle(42));
  svg("text", { class: "tl-label", x: ux, y: uy }, gauge).textContent = TEXT.centsUnit;
  for (const [cents, label] of MARKERS) {
    const marker = svg("g", { class: "tl-marker", transform: `rotate(${centsAngle(cents)} ${GAUGE.x} ${GAUGE.y})` }, gauge);
    svg("path", { d: `M${GAUGE.x} ${GAUGE.y - r - 3}l-4.5 -8h9z` }, marker);
    const [x, y] = polar(r + 22, centsAngle(cents));
    svg("text", { class: "tl-marker-label", x, y }, gauge).textContent = TEXT[label];
  }
  const needle = svg("g", { class: "tl-needle-g", transform: `rotate(0 ${GAUGE.x} ${GAUGE.y})` }, gauge);
  svg("line", { class: "tl-needle", x1: GAUGE.x, y1: GAUGE.y, x2: GAUGE.x, y2: GAUGE.y - r + 4 }, needle);
  svg("circle", { class: "tl-pivot", cx: GAUGE.x, cy: GAUGE.y, r: 7 }, gauge);
  return needle;
}

function droneIcon() {
  const icon = svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" });
  svg("path", { d: "M5 1.5v5.5a3 3 0 0 0 6 0V1.5M8 10v4.5", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round" }, icon);
  return icon;
}

export function mountTuner(container) {
  const abort = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: abort.signal });
  let generation = 0, mic = null, starting = false, detector = null, gate = null, frames = [];
  let drone = null, droneSettle = 0, angle = 0, target = 0, last = 0, frame = 0, wasConnected = false;
  const tokens = { mic: {}, micStarting: {}, drone: {} };

  const key = h("button", { type: "button", class: "tl-key" });
  const name = h("div", { class: "tl-name", text: "–" });
  const hz = h("span", { class: "tl-hz" });
  const cents = h("span", { class: "tl-cents" });
  const gauge = svg("svg", { class: "tl-gauge", viewBox: "0 0 300 210", "aria-hidden": "true" });
  const needle = buildGauge(gauge);
  const flat = h("span", { class: "tl-light tl-flat", "aria-hidden": "true", text: "♭" });
  const sharp = h("span", { class: "tl-light tl-sharp", "aria-hidden": "true", text: "♯" });
  const a4Label = h("span", { class: "tl-a4" });
  const inTune = h("button", { type: "button", class: "tl-light tl-in", "aria-expanded": "false" }, a4Label);
  const a4Down = h("button", { type: "button", class: "tl-btn tl-a4-down", "aria-label": TEXT.a4Down, text: "−" });
  const a4Up = h("button", { type: "button", class: "tl-btn tl-a4-up", "aria-label": TEXT.a4Up, text: "+" });
  const pop = h("div", { class: "tl-a4-pop", hidden: true }, a4Down, a4Up);
  const pick = h("div", { class: "tl-a4-pick" }, inTune, pop);
  const card = h("section", { class: "tl-card tl-tune tl-idle" },
    key, name, h("div", { class: "tl-readout" }, hz, cents), gauge,
    h("div", { class: "tl-lights" }, flat, pick, sharp));

  const droneNote = h("select", { class: "tl-drone-note", "aria-label": TEXT.droneNote },
    ...Array.from({ length: 12 }, (_, pc) => h("option", { value: String(pc), text: pitchName(pc) })));
  const droneButton = h("button", { type: "button", class: "tl-btn tl-drone", "aria-pressed": "false" }, droneIcon(), h("span", { text: TEXT.drone }));
  const droneVolume = h("input", { type: "range", class: "tl-drone-volume", min: 0, max: 1, step: 0.05 });
  const hint = h("p", { class: "tl-note tl-drone-hint", hidden: true, text: TEXT.headphones });
  const micButton = h("button", { type: "button", class: "tl-btn tl-primary tl-mic" });
  const controls = h("section", { class: "tl-card" },
    h("div", { class: "tl-field" }, h("span", { text: TEXT.droneNote }), h("div", { class: "tl-pair" }, droneNote, droneButton)),
    h("label", { class: "tl-field tl-gap" }, h("span", { text: TEXT.droneVolume }), droneVolume),
    hint,
    h("div", { class: "tl-buttons tl-gap" }, micButton));

  const root = h("div", { class: "tools tools-tuner" }, card, controls);
  const toast = createToast(root, abort.signal);
  container.append(root);

  function setCard(state) {
    for (const s of ["tl-idle", "tl-good", "tl-off"]) card.classList.toggle(s, s === state);
  }

  function lights(state) {
    flat.classList.toggle("tl-red", state === "flat");
    inTune.classList.toggle("tl-green", state === "in");
    sharp.classList.toggle("tl-red", state === "sharp");
  }

  function idle() {
    setCard("tl-idle");
    name.textContent = "–";
    hz.textContent = "";
    cents.textContent = "";
    lights(null);
    target = 0;
  }

  function drawNeedle() {
    needle.setAttribute("transform", `rotate(${angle.toFixed(2)} ${GAUGE.x} ${GAUGE.y})`);
  }

  function render() {
    const s = settings(), keyName = pitchName(s.tuneKey === "C" ? 0 : 10);
    droneButton.classList.toggle("tl-on", Boolean(drone));
    droneButton.setAttribute("aria-pressed", String(Boolean(drone)));
    droneNote.value = String(s.droneNote);
    droneVolume.value = String(s.droneVolume);
    hint.hidden = !mic;
    a4Label.textContent = `${s.a4} Hz`;
    inTune.setAttribute("aria-label", `${TEXT.concertPitch} ${s.a4} Hz`);
    key.textContent = `in ${keyName}`;
    key.setAttribute("aria-label", `Stimmung in ${keyName}`);
    micButton.textContent = mic ? TEXT.micOff : TEXT.micOn;
    micButton.classList.toggle("tl-primary", !mic);
  }

  function show() {
    const reading = readTuning(frames, { a4: tuneA4(), threshold: gate.threshold() - 6 });
    const now = performance.now();
    if (reading) {
      last = now;
      target = centsAngle(reading.offset);
      setCard(Math.abs(reading.cents) <= TOLERANCE ? "tl-good" : "tl-off");
      name.textContent = noteName(reading.tone);
      hz.textContent = `${decimal(reading.hz, 1)} Hz`;
      cents.textContent = `${signed(reading.cents)} Cent`;
      lights(reading.state);
    } else if (now - last > 400) idle();
    angle += (target - angle) * 0.25;
    drawNeedle();
  }

  function loop() {
    frame = 0;
    if (!mic || abort.signal.aborted) return;
    show();
    frame = requestAnimationFrame(loop);
  }

  function samples(values) {
    if (!detector || !(values instanceof Float32Array) || values.length > 16384) return;
    const settling = drone && performance.now() < droneSettle;
    for (const f of detector.process(values)) {
      if (settling) {
        gate.settle(f.level);
        continue;
      }
      gate.observe(f.level);
      frames.push(f);
      if (frames.length > 8) frames.shift();
    }
  }

  function stopTracks(stream) {
    for (const track of stream.getTracks()) track.stop();
  }

  async function grabber(c) {
    if (c.audioWorklet && globalThis.AudioWorkletNode) {
      try {
        if (!workletReady.has(c)) {
          await c.audioWorklet.addModule(new URL("./grabber.worklet.mjs", import.meta.url));
          workletReady.add(c);
        }
        const node = new AudioWorkletNode(c, "staendchen-grabber");
        node.port.onmessage = e => samples(e.data);
        return node;
      } catch (e) {
        if (!c.createScriptProcessor) throw e;
      }
    }
    const node = c.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = e => samples(new Float32Array(e.inputBuffer.getChannelData(0)));
    return node;
  }

  async function startMic(mine) {
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast(TEXT.needHttps);
      return;
    }
    if (navigator.audioSession?.type === "playback") audio.renewSoon();
    const c = audio.context(true);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      if (mine === generation) toast(e?.name === "NotAllowedError" ? TEXT.micDenied : e?.name === "NotFoundError" ? TEXT.noMic : TEXT.micFailed);
      return;
    }
    const stale = () => mine !== generation || c !== audio.current() || c.state === "closed";
    if (stale()) return stopTracks(stream);
    let source, node, mute, nextDetector;
    try {
      nextDetector = new PitchDetector(c.sampleRate);
      source = c.createMediaStreamSource(stream);
      node = await grabber(c);
      if (stale()) {
        stopTracks(stream);
        source.disconnect();
        node.port?.postMessage("stop");
        return;
      }
      mute = c.createGain();
      mute.gain.value = 0;
      source.connect(node).connect(mute).connect(c.destination);
    } catch (e) {
      stopTracks(stream);
      source?.disconnect();
      node?.disconnect();
      node?.port?.postMessage("stop");
      mute?.disconnect();
      if (mine === generation) toast(ERROR_NAMES.has(e?.name) ? `${TEXT.micFailed} (${e.name})` : TEXT.micFailed);
      return;
    }
    detector = nextDetector;
    gate = new LevelGate();
    frames = [];
    const closed = () => { if (c.state === "closed" && mic?.c === c) micOff(); };
    mic = { stream, source, node, mute, c, closed };
    on(c, "statechange", closed);
    audio.hold(tokens.mic, "mic");
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", micOff, { signal: abort.signal });
    render();
    if (!frame) frame = requestAnimationFrame(loop);
  }

  async function micOn() {
    if (mic || starting || abort.signal.aborted) return;
    starting = true;
    audio.hold(tokens.micStarting, "micStarting");
    const mine = ++generation;
    try {
      await whileWaiting(micButton, startMic(mine));
    } finally {
      starting = false;
      audio.release(tokens.micStarting);
    }
  }

  function micOff() {
    generation++;
    if (!mic) return;
    const { stream, source, node, mute, c, closed } = mic;
    c.removeEventListener("statechange", closed);
    stopTracks(stream);
    source.disconnect();
    node.disconnect();
    mute.disconnect();
    if (node.port) {
      node.port.postMessage("stop");
      node.port.onmessage = null;
    } else node.onaudioprocess = null;
    mic = null;
    detector = null;
    frames = [];
    cancelAnimationFrame(frame);
    frame = 0;
    audio.renewSoon();
    audio.release(tokens.mic);
    if (!abort.signal.aborted) {
      idle();
      angle = 0;
      drawNeedle();
      render();
      if (drone) audio.context();
    }
  }

  function droneOn(midi) {
    if (drone) droneOff(false);
    const c = audio.context(), now = c.currentTime, freq = midiToHz(midi, settings().a4);
    const out = c.createGain(), filter = c.createBiquadFilter(), limiter = c.createDynamicsCompressor();
    filter.type = "lowpass";
    filter.frequency.value = Math.min(5000, freq * 12);
    filter.Q.value = 0.3;
    limiter.threshold.value = -18;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    out.gain.setValueAtTime(0, now);
    out.gain.setTargetAtTime(droneLevel(), now, 0.35);
    filter.connect(out).connect(limiter).connect(c.destination);
    const oscs = DRONE_VOICES.map(([ratio, type, level, detune]) => {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq * ratio;
      osc.detune.value = detune;
      gain.gain.value = level;
      osc.connect(gain).connect(filter);
      osc.start(now);
      return osc;
    });
    drone = { midi, out, oscs, c };
    droneSettle = performance.now() + 1500;
    audio.hold(tokens.drone, "drone");
    render();
  }

  function droneOff(releaseAudio = true) {
    if (!drone) return;
    const { out, oscs, c } = drone;
    if (c.state !== "closed") {
      const now = c.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.25);
      for (const osc of oscs) osc.stop(now + 1.5);
    }
    drone = null;
    if (releaseAudio) audio.release(tokens.drone);
    if (!abort.signal.aborted) render();
  }

  const unsubscribe = audio.onReplace(c => {
    const midi = drone?.midi;
    drone = null;
    if (mic && mic.c !== c) micOff();
    if (midi !== undefined && !drone) droneOn(midi);
  });

  function change(diff) {
    const applied = update(diff);
    render();
    if (drone && ("a4" in applied || "droneNote" in applied || "tuneKey" in applied)) droneOn("a4" in applied && !("droneNote" in applied || "tuneKey" in applied) ? drone.midi : tuneDroneMidi());
    if (drone && "droneVolume" in applied) {
      drone.out.gain.setTargetAtTime(droneLevel(), drone.c.currentTime, 0.05);
      droneSettle = performance.now() + 1500;
    }
  }

  const closePop = () => {
    pop.hidden = true;
    inTune.setAttribute("aria-expanded", "false");
  };
  on(inTune, "click", () => {
    pop.hidden = !pop.hidden;
    inTune.setAttribute("aria-expanded", String(!pop.hidden));
  });
  on(document, "click", e => { if (!(e.target instanceof Node) || !pick.contains(e.target)) closePop(); });
  on(document, "keydown", e => { if (e.key === "Escape") closePop(); });
  on(a4Down, "click", () => change({ a4: Math.max(430, settings().a4 - 1) }));
  on(a4Up, "click", () => change({ a4: Math.min(450, settings().a4 + 1) }));
  on(key, "click", () => change({ tuneKey: settings().tuneKey === "C" ? "Bb" : "C" }));
  on(droneButton, "click", () => drone ? droneOff() : droneOn(tuneDroneMidi()));
  on(droneNote, "change", () => change({ droneNote: Number(droneNote.value) }));
  on(droneVolume, "input", () => change({ droneVolume: Number(droneVolume.value) }));
  on(micButton, "click", () => mic || starting ? micOff() : micOn());

  function pause() {
    micOff();
    droneOff();
  }
  on(document, "visibilitychange", () => { if (document.visibilityState === "hidden") pause(); });
  on(globalThis, "pagehide", pause);

  function destroy() {
    if (abort.signal.aborted) return;
    abort.abort();
    clearInterval(watch);
    unsubscribe();
    micOff();
    droneOff();
    audio.release(tokens.micStarting);
    root.remove();
  }

  const watch = setInterval(() => {
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) destroy();
  }, 1000);

  idle();
  render();

  return { destroy };
}
