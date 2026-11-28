export const BEATS = { whole: 4, 'dotted-half': 3, half: 2, 'dotted-quarter': 1.5, quarter: 1, 'dotted-eighth': 0.75, eighth: 0.5 };
export const BEAT_WORDS = { whole: 'Ganze', 'dotted-half': 'punktierte Halbe', half: 'Halbe', 'dotted-quarter': 'punktierte Viertel', quarter: 'Viertel', 'dotted-eighth': 'punktierte Achtel', eighth: 'Achtel' };
export const BPM = { min: 20, max: 300 };
const QUARTERS = { min: 10, max: 600 };
const SYMBOLS = { whole: 'metNoteWhole', half: 'metNoteHalfUp', quarter: 'metNoteQuarterUp', eighth: 'metNote8thUp' };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function tempoProblem(value) {
  if (!isObject(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'beat') || !Object.hasOwn(value, 'bpm')) return 'Tempo braucht genau beat und bpm';
  if (typeof value.beat !== 'string' || !Object.hasOwn(BEATS, value.beat)) return `Tempo: Notenwert muss einer von ${Object.keys(BEATS).join(', ')} sein`;
  if (!Number.isSafeInteger(value.bpm) || value.bpm < BPM.min || value.bpm > BPM.max) return `Tempo: Schläge pro Minute müssen eine ganze Zahl von ${BPM.min} bis ${BPM.max} sein`;
  const quarters = value.bpm * BEATS[value.beat];
  if (quarters < QUARTERS.min || quarters > QUARTERS.max) return 'Tempo ist zu langsam oder zu schnell';
  return null;
}

export const validTempo = value => tempoProblem(value) === null;

export function tempoText(tempo) {
  return `${BEAT_WORDS[tempo.beat]} = ${tempo.bpm}`;
}

export function quarterBpm(tempo) {
  return tempo.bpm * BEATS[tempo.beat];
}

function mark(tempo) {
  const dotted = tempo.beat.startsWith('dotted-');
  const base = dotted ? tempo.beat.slice(7) : tempo.beat;
  return `<sym>${SYMBOLS[base]}</sym>${dotted ? '<sym>metAugmentationDot</sym>' : ''} = ${tempo.bpm}`;
}

function element(tempo, indent) {
  const perSecond = (quarterBpm(tempo) / 60).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  const inner = `${indent}  `;
  return `<Tempo>\n${inner}<tempo>${perSecond}</tempo>\n${inner}<followText>1</followText>\n${inner}<text>${mark(tempo)}</text>\n${inner}</Tempo>`;
}

export function setMscxTempo(mscx, tempo) {
  const problem = tempoProblem(tempo);
  if (problem) throw new Error(problem);
  const start = mscx.indexOf('<Measure');
  if (start < 0) throw new Error('score has no measure');
  const end = mscx.indexOf('</Measure>', start);
  if (end < 0) throw new Error('score has an open measure');
  const measure = mscx.slice(start, end);
  const existing = /<Tempo>[\s\S]*?<\/Tempo>/.exec(measure);
  if (existing) {
    const lineStart = mscx.lastIndexOf('\n', start + existing.index) + 1;
    const indent = /^[ \t]*/.exec(mscx.slice(lineStart))[0];
    return mscx.slice(0, start + existing.index) + element(tempo, indent) + mscx.slice(start + existing.index + existing[0].length);
  }
  const first = /<(?:Chord|Rest|MeasureRepeat)[\s>]/.exec(measure);
  if (!first) throw new Error('the first measure has no notes or rests');
  const at = start + first.index;
  const lineStart = mscx.lastIndexOf('\n', at) + 1;
  const indent = /^[ \t]*/.exec(mscx.slice(lineStart))[0];
  return `${mscx.slice(0, at)}${element(tempo, indent)}\n${indent}${mscx.slice(at)}`;
}

const UNIT = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth' };

export function tempoFromMusicXml(xml) {
  if (typeof xml !== 'string') return null;
  const metronome = /<metronome\b[^>]*>([\s\S]*?)<\/metronome>/.exec(xml);
  if (metronome) {
    const unit = /<beat-unit>\s*([a-z]+)\s*<\/beat-unit>/.exec(metronome[1]);
    const dotted = /<beat-unit-dot\s*\/>/.test(metronome[1]);
    const minute = /<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>/.exec(metronome[1]);
    if (unit && minute && Object.hasOwn(UNIT, unit[1])) {
      const tempo = { beat: dotted ? `dotted-${unit[1]}` : unit[1], bpm: Math.round(Number(minute[1])) };
      if (validTempo(tempo)) return tempo;
    }
  }
  const sound = /<sound\b[^>]*\btempo="([0-9]+(?:\.[0-9]+)?)"/.exec(xml);
  if (sound) {
    const tempo = { beat: 'quarter', bpm: Math.round(Number(sound[1])) };
    if (validTempo(tempo)) return tempo;
  }
  return null;
}
