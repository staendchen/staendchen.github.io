import { checkTiming, readTimemap, position, seekTime, baseTempo, tempoRange, sounding, displayTempo, beatSign } from './follow.mjs';
import { loadTiming, loadAudio, OfflineError } from './client.mjs';

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>',
};
const PREFIX = 'vrv-';

export function createPlayer({ pult, bar, area, header, toast, fetcher }) {
  const audio = new Audio();
  audio.preload = 'auto';
  const s = {
    on: false,
    piece: null,
    entry: null,
    list: null,
    url: null,
    audioLoading: null,
    timing: null,
    timingFor: null,
    follow: null,
    base: 120,
    bpm: 120,
    marked: [],
    measure: -1,
    token: 0,
    looping: false,
  };

  function setRate() {
    const rate = s.bpm / s.base;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    audio.webkitPreservesPitch = true;
  }

  function unmark() {
    for (const el of s.marked) el.classList.remove('now');
    s.marked = [];
  }

  function mark(ids) {
    const els = ids.map(id => document.getElementById(PREFIX + id)).filter(Boolean);
    if (els.length === s.marked.length && els.every((el, i) => el === s.marked[i])) return;
    unmark();
    for (const el of els) el.classList.add('now');
    s.marked = els;
  }

  function scrollTo(measure) {
    const g = s.follow?.measures[measure];
    if (!g) return;
    const system = g.closest('g.system') || g;
    const box = system.getBoundingClientRect();
    const upper = header.getBoundingClientRect().bottom;
    const lower = bar.getBoundingClientRect().top || innerHeight;
    if (box.top >= upper + 8 && box.bottom <= lower - 8) return;
    const offset = box.height > (lower - upper) * 0.8 ? 8 : (lower - upper) * 0.15;
    area.scrollBy({ top: box.top - upper - offset, behavior: 'smooth' });
  }

  function show(scroll) {
    if (!s.follow || !s.timing) return;
    const ms = audio.currentTime * 1000;
    if (audio.paused && audio.currentTime === 0) {
      unmark();
      s.measure = -1;
      return;
    }
    const at = position(s.timing, s.follow.lengths, ms);
    if (!at || at.q === null) {
      unmark();
      return;
    }
    mark(sounding(s.follow.notes, at.measure, at.q));
    if (at.measure !== s.measure) {
      s.measure = at.measure;
      if (scroll) scrollTo(at.measure);
    }
  }

  function loop() {
    show(true);
    if (!audio.paused) requestAnimationFrame(loop);
    else s.looping = false;
  }

  function drawBar() {
    if (!s.on) return;
    const ready = Boolean(s.url);
    const { min, max } = tempoRange(s.base);
    const changed = s.bpm !== s.base;
    const sign = beatSign(s.beat);
    bar.innerHTML = `<button class="play" id="vplay" ${ready ? '' : 'disabled'} aria-label="${audio.paused ? 'Abspielen' : 'Anhalten'}">${audio.paused ? ICON.play : ICON.pause}</button>
    ${ready ? `<span class="bpm${changed ? ' changed' : ''}" id="vbpm" aria-label="${sign.words} = ${s.bpm}"><span class="beat" aria-hidden="true">${sign.glyphs}</span> = <span id="vnum">${s.bpm}</span></span>
    <input type="range" id="vrange" min="${min}" max="${max}" step="1" value="${s.bpm}" aria-label="Tempo, ${sign.words} pro Minute">
    <button class="reset${changed ? '' : ' hide'}" id="vreset" aria-label="Tempo zurück auf ${s.base}">↺</button>` : `<span class="vwait" id="vwait">${s.audioLoading ? 'Aufnahme lädt …' : 'Aufnahme fehlt'}</span>`}
    <button class="reset" id="vclose" aria-label="Vorspielen beenden">✕</button>`;
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'vplay') {
      if (audio.paused) play();
      else audio.pause();
    } else if (b.id === 'vreset') {
      s.bpm = s.base;
      s.touched = false;
      setRate();
      drawBar();
    } else if (b.id === 'vclose') stop();
  });

  bar.addEventListener('input', e => {
    if (e.target.id !== 'vrange') return;
    const value = Number(e.target.value);
    const { min, max } = tempoRange(s.base);
    if (!Number.isFinite(value)) return;
    s.bpm = Math.max(min, Math.min(max, Math.round(value)));
    s.touched = true;
    setRate();
    const label = bar.querySelector('#vbpm');
    if (label) {
      const num = label.querySelector('#vnum');
      if (num) num.textContent = String(s.bpm);
      label.setAttribute('aria-label', `${beatSign(s.beat).words} = ${s.bpm}`);
      label.classList.toggle('changed', s.bpm !== s.base);
    }
    bar.querySelector('#vreset')?.classList.toggle('hide', s.bpm === s.base);
  });

  function play() {
    if (!s.url) return;
    setRate();
    audio.play().catch(() => toast('Die Aufnahme lässt sich nicht abspielen'));
  }

  audio.addEventListener('play', () => {
    if (!s.looping) {
      s.looping = true;
      requestAnimationFrame(loop);
    }
    drawBar();
  });
  audio.addEventListener('pause', () => drawBar());
  audio.addEventListener('timeupdate', () => show(!audio.paused));
  audio.addEventListener('seeked', () => show(false));
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    unmark();
    s.measure = -1;
    drawBar();
  });

  function release() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = null;
    s.audioLoading = null;
  }

  async function ensureTiming(token) {
    if (s.timing && s.timingFor === s.piece) return s.timing;
    try {
      const timing = checkTiming(await loadTiming(fetcher, s.entry, s.list));
      if (token !== s.token) return null;
      s.timing = timing;
      s.timingFor = s.piece;
      return timing;
    } catch {
      return null;
    }
  }

  async function ensureAudio(token) {
    if (s.url || s.audioLoading) return;
    s.audioLoading = (async () => {
      try {
        const bytes = await loadAudio(fetcher, s.entry, s.list);
        if (token !== s.token) return;
        s.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        audio.src = s.url;
        setRate();
      } catch (error) {
        if (token !== s.token) return;
        toast(error instanceof OfflineError ? 'Die Aufnahme braucht beim ersten Mal Netz' : 'Die Aufnahme lässt sich nicht laden');
      } finally {
        if (token === s.token) {
          s.audioLoading = null;
          drawBar();
        }
      }
    })();
    drawBar();
  }

  function buildFollow(measured) {
    s.follow = null;
    if (!s.timing || !measured?.timemap) return;
    const measures = [...area.querySelectorAll('g.measure')];
    if (measures.length !== s.timing.measures) return;
    try {
      const ids = measures.map(g => g.id.startsWith(PREFIX) ? g.id.slice(PREFIX.length) : g.id);
      const { lengths, notes } = readTimemap(measured.timemap, ids);
      s.follow = { measures, lengths, notes };
    } catch {
      s.follow = null;
    }
  }

  async function prepare(measured) {
    const token = s.token;
    ensureAudio(token);
    const timing = await ensureTiming(token);
    if (token !== s.token) return;
    if (!timing) {
      toast('Mitlesen geht bei diesem Stück nicht');
      return;
    }
    buildFollow(measured);
    if (!s.follow) {
      toast('Mitlesen geht bei diesem Stück nicht');
      return;
    }
    Object.assign(s, displayTempo(s.tempo, baseTempo(timing, s.follow.lengths)));
    if (!s.touched) s.bpm = s.base;
    setRate();
    s.measure = -1;
    show(false);
    drawBar();
  }

  function setPiece(entry, list, measured, tempo = null) {
    s.last = measured;
    if (entry.list !== s.piece) {
      s.token++;
      release();
      s.piece = entry.list;
      s.entry = entry;
      s.list = list;
      s.timing = null;
      s.timingFor = null;
      s.touched = false;
      s.tempo = tempo;
      Object.assign(s, displayTempo(tempo, null));
      s.bpm = s.base;
    }
    unmark();
    s.follow = null;
    s.measure = -1;
    if (s.on) {
      drawBar();
      prepare(measured);
    }
  }

  function start() {
    if (!s.entry) return;
    s.on = true;
    pult.classList.add('vorspiel');
    drawBar();
    prepare(s.last);
  }

  function stop() {
    s.on = false;
    audio.pause();
    unmark();
    pult.classList.remove('vorspiel');
    bar.replaceChildren();
  }

  function close() {
    stop();
    s.token++;
    release();
    s.piece = null;
    s.entry = null;
    s.list = null;
    s.timing = null;
    s.follow = null;
    s.last = null;
  }

  function measureAt(x, y) {
    if (!s.follow) return -1;
    let best = -1;
    let bestDistance = Infinity;
    s.follow.measures.forEach((g, i) => {
      const r = g.getBoundingClientRect();
      if (y < r.top || y > r.bottom) return;
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return bestDistance < 40 ? best : -1;
  }

  function tap(event) {
    if (!s.follow || !s.timing || !s.url) return;
    let measure = -1;
    let q = 0;
    const note = event.target.closest?.('g.note');
    if (note) {
      const id = note.id.slice(PREFIX.length);
      s.follow.notes.some((list, m) => {
        const found = list.find(n => n.id === id);
        if (found) {
          measure = m;
          q = found.on;
        }
        return Boolean(found);
      });
    }
    if (measure < 0) measure = measureAt(event.clientX, event.clientY);
    if (measure < 0) return;
    const ms = seekTime(s.timing, s.follow.lengths, measure, q, audio.currentTime * 1000);
    if (ms === null) return;
    audio.currentTime = ms / 1000 + 0.001;
    s.measure = measure;
    show(false);
    if (audio.paused) play();
  }

  addEventListener('pagehide', () => audio.pause());

  return {
    get on() {
      return s.on;
    },
    start,
    stop,
    close,
    setPiece,
    tap,
    toggle: () => (s.on ? stop() : start()),
  };
}
