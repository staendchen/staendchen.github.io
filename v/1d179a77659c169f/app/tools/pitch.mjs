const NAMES_DE = ["c", "des", "d", "es", "e", "f", "fis", "g", "as", "a", "b", "h"];

export const TOLERANCE = 15;
export const CLARITY = 0.85;

export const pitchClass = m => ((m % 12) + 12) % 12;

export function hzToMidi(hz, a4 = 440) {
  return 69 + 12 * Math.log2(hz / a4);
}

export function midiToHz(midi, a4 = 440) {
  return a4 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi) {
  const m = Math.round(midi), octave = Math.floor(m / 12) - 1;
  const name = NAMES_DE[pitchClass(m)];
  if (octave >= 3) return name + (["", "′", "″", "‴"][octave - 3] ?? "");
  return name[0].toUpperCase() + name.slice(1) + (["₂", "₁", ""][octave] ?? "");
}

export function pitchName(pc) {
  const name = NAMES_DE[pitchClass(pc)];
  return name[0].toUpperCase() + name.slice(1);
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function signed(n) {
  return (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);
}

export function decimal(x, digits) {
  return x.toFixed(digits).replace(".", ",");
}

export class PitchDetector {
  constructor(sampleRate, { lowest = 50, highest = 1000, hop = 0.01 } = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 1536000) throw new RangeError("sampleRate");
    this.stages = [];
    let rate = sampleRate;
    while (rate >= 32000) {
      this.stages.push({ z0: 0, z1: 0, z2: 0, odd: false });
      rate /= 2;
    }
    this.decimation = 2 ** this.stages.length;
    this.rate = rate;
    this.tauMax = Math.ceil(this.rate / lowest);
    this.tauMin = Math.max(2, Math.floor(this.rate / highest));
    this.windowSize = this.tauMax + 32;
    this.hop = Math.round(this.rate * hop);
    this.levelSize = Math.round(this.rate * 0.02);
    this.size = Math.max(this.windowSize + this.tauMax + 1, this.levelSize);
    this.offset = this.size - (this.windowSize + this.tauMax + 1);
    this.buffer = new Float32Array(this.size);
    this.pending = new Float32Array(this.hop);
    this.pendingCount = 0;
    this.total = 0;
    this.diff = new Float64Array(this.tauMax + 2);
    this.norm = new Float64Array(this.tauMax + 2);
  }

  decimate(value) {
    for (const stage of this.stages) {
      stage.z2 = stage.z1; stage.z1 = stage.z0; stage.z0 = value;
      stage.odd = !stage.odd;
      if (stage.odd) return null;
      value = 0.25 * stage.z2 + 0.5 * stage.z1 + 0.25 * stage.z0;
    }
    return value;
  }

  process(input) {
    const frames = [];
    for (let i = 0; i < input.length; i++) {
      const raw = input[i];
      const value = this.decimate(Number.isFinite(raw) ? raw : 0);
      if (value === null) continue;
      this.pending[this.pendingCount++] = value;
      this.total++;
      if (this.pendingCount === this.hop) {
        this.buffer.copyWithin(0, this.hop);
        this.buffer.set(this.pending, this.size - this.hop);
        this.pendingCount = 0;
        frames.push(this.frame());
      }
    }
    return frames;
  }

  frame() {
    const d = this.buffer;
    let sum = 0;
    for (let i = this.size - this.levelSize; i < this.size; i++) sum += d[i] * d[i];
    const level = 10 * Math.log10(sum / this.levelSize + 1e-12) + 3.01;
    const pitch = level > -80 ? this.yin() : null;
    return { t: this.total / this.rate, level, hz: pitch ? pitch.hz : 0, clarity: pitch ? pitch.clarity : 0 };
  }

  yin() {
    const x = this.buffer, o = this.offset, W = this.windowSize, tauMax = this.tauMax, diff = this.diff, norm = this.norm;
    let running = 0;
    norm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = o; j < o + W; j++) { const u = x[j] - x[j + tau]; s += u * u; }
      diff[tau] = s;
      running += s;
      norm[tau] = running > 0 ? s * tau / running : 1;
    }
    let best = -1;
    for (let tau = this.tauMin; tau <= tauMax; tau++) {
      if (norm[tau] < 0.15) {
        while (tau < tauMax && norm[tau + 1] < norm[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let min = Infinity;
      for (let tau = this.tauMin; tau <= tauMax; tau++) if (norm[tau] < min) { min = norm[tau]; best = tau; }
      if (min > 0.35) return null;
    }
    let period = best;
    if (best > 1 && best < tauMax) {
      const a = diff[best - 1], b = diff[best], c = diff[best + 1], denominator = a - 2 * b + c;
      if (denominator > 0) period = best + Math.max(-1, Math.min(1, 0.5 * (a - c) / denominator));
    }
    return { hz: this.rate / period, clarity: 1 - norm[best] };
  }
}

export class LevelGate {
  constructor() {
    this.floor = null;
  }

  threshold() {
    return Math.max(-50, (this.floor ?? -90) + 14);
  }

  settle(level) {
    this.floor = this.floor === null ? level : this.floor + (level - this.floor) * 0.2;
  }

  observe(level) {
    if (level >= this.threshold()) return;
    if (this.floor === null) this.floor = level;
    else this.floor += (level - this.floor) * (level < this.floor ? 0.2 : 0.01);
  }
}

export function readTuning(frames, { a4, threshold, tolerance = TOLERANCE }) {
  const clear = frames.filter(f => f.hz > 0 && f.clarity >= CLARITY && f.level >= threshold).slice(-5);
  if (clear.length < 3) return null;
  const midi = median(clear.map(f => hzToMidi(f.hz, a4)));
  const tone = Math.round(midi), offset = (midi - tone) * 100, cents = Math.round(offset);
  const state = cents < -tolerance ? "flat" : cents > tolerance ? "sharp" : "in";
  return { tone, cents, offset, hz: midiToHz(midi, a4), state };
}

export function droneMidi(concert, lowest = 43) {
  const base = Math.max(48, lowest);
  return base + pitchClass(concert - base);
}
