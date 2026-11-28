export const MIN_TEMPO = 30;
export const MAX_TEMPO = 240;
export const LOOKAHEAD = 0.1;
export const METERS = [2, 4, 8].flatMap(d => Array.from({ length: 11 }, (_, i) => `${i + 2}/${d}`));
export const SUBDIVISIONS = { none: 1, eighths: 2, triplets: 3, sixteenths: 4 };
const UNITS = { 2: "half", 4: "quarter", 8: "eighth" };
const LEVELS = { accent: 1, beat: 0.7, sub: 0.3 };
export const PITCHES = { accent: 2000, beat: 1500, sub: 1100 };

export function clampTempo(n) {
  return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(n)));
}

export function parseMeter(meter) {
  return meter.split("/").map(Number);
}

export function unitOf(denominator) {
  return UNITS[denominator];
}

export function meterBeats(meter) {
  const [n, d] = parseMeter(meter);
  if (d === 8 && n % 3 === 0 && n > 3) return { beats: n / 3, unit: "dotted" };
  return { beats: n, unit: unitOf(d) };
}

export function subdivision(meter, sub) {
  if (meterBeats(meter).unit === "dotted" && sub === "eighths") return 3;
  return SUBDIVISIONS[sub] ?? 1;
}

export function hasBackbeat(meter) {
  return meter === "2/4" || meter === "4/4";
}

export function meterParts(denominator) {
  const parsed = METERS.map(parseMeter);
  return {
    dens: [...new Set(parsed.map(([, d]) => d))].sort((a, b) => a - b),
    nums: parsed.filter(([, d]) => d === denominator).map(([n]) => n).sort((a, b) => a - b),
  };
}

export function pickMeter(meter, part, index) {
  const [n, d] = parseMeter(meter);
  const den = part === 1 ? meterParts(d).dens[index] ?? d : d;
  const { nums } = meterParts(den);
  const num = part === 0 ? nums[index] ?? n : nums.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
  return `${num}/${den}`;
}

export function tapTempo(taps, now) {
  const kept = taps.length && now - taps.at(-1) > 2000 ? [] : taps.slice(-4);
  kept.push(now);
  if (kept.length < 2) return { taps: kept, tempo: null };
  const gap = (kept.at(-1) - kept[0]) / (kept.length - 1);
  return { taps: kept, tempo: gap > 0 ? clampTempo(60000 / gap) : null };
}

export function clickLevel(type, volume) {
  return 0.5 * volume ** 2 * LEVELS[type];
}

export class ClickScheduler {
  constructor(start) {
    this.next = start;
    this.beat = 0;
    this.inBeat = 0;
    this.sub = 1;
    this.beats = 1;
    this.tickLen = 1;
    this.ticks = [];
  }

  advance(now, settings, lookahead = LOOKAHEAD) {
    const clicks = [];
    if (this.next < now - lookahead) {
      this.next = now + 0.05;
      this.inBeat = 0;
    }
    while (this.next < now + lookahead && clicks.length < 64) {
      if (this.inBeat === 0) {
        this.sub = subdivision(settings.mMeter, settings.mSub);
        this.beats = meterBeats(settings.mMeter).beats;
        this.tickLen = 60 / settings.mTempo / this.sub;
        if (this.beat >= this.beats) this.beat = 0;
        this.ticks.push({ time: this.next, beat: this.beat });
        if (this.ticks.length > 16) this.ticks.shift();
      }
      const silent = !this.inBeat && this.beat % 2 === 0 && settings.mBackbeat && hasBackbeat(settings.mMeter);
      if (!silent) clicks.push({ time: this.next, type: this.inBeat ? "sub" : this.beat === 0 && settings.mAccent ? "accent" : "beat" });
      this.next += this.tickLen;
      if (++this.inBeat >= this.sub) {
        this.inBeat = 0;
        this.beat = (this.beat + 1) % this.beats;
      }
    }
    return clicks;
  }

  litBeat(now, tempo) {
    const heard = this.ticks.filter(tick => tick.time <= now).at(-1);
    return heard && now - heard.time < 30 / tempo ? heard.beat : -1;
  }
}
