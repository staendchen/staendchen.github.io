import { binderKey, binderLink, keyFromLink, toBase64Url, decodeKey } from '../lib/crypto.mjs';
import { preparePart, choosePart, selectParts } from '../lib/rewrite.mjs';
import {
  LockedError, OfflineError, FormatError, NUMBERS, checkRecord, loadBinder, binderAccess, newRecord, mergeBinder, pieceMark, markSeen, countMarks,
  loadPiece, loadPieceList, keepFiles, fetchSealed, LIMITS, autoOctave, validOctave, validSemitones, boundedMap, validRange, defaultRange, stepRange, octaveLabel, noteLabel, parseInstruments, instrumentsFor, validChoice, numberLabel, validTime,
  uniquePieces, missingFiles, recordsChanged, updateMessage,
} from './client.mjs';
import { SIZES, MAX_SIZE, SPACINGS, formatFor, spacingFor, stepSpacing, stepSize, validSize, shownWidth, zoomFor, turn, zoneAt, fitSize } from './layout.mjs';
import { openStore } from './store.mjs';
import { engrave, space, loadVerovio, safeSvg } from './engrave.mjs';
import { qrSvg } from './qr.mjs';
import { shareText, shareBinder } from './share.mjs';
import { cardSvg, cardMusic, cardPng, textMeasure, fitExcerpt } from './card.mjs';
import { checkGlyphs } from './pdf.mjs';
import { binderPdf, composerOf } from './book.mjs';
import { createPlayer } from './player.mjs';
import { tempoFromMusicXml } from '../lib/tempo.mjs';
import { PRESETS, scoreParts, presetParts, chosenParts, matchingPreset } from './score.mjs';
import { mountTuner } from './tools/tuner.mjs';
import { mountMetronome } from './tools/metronome.mjs';
import { tryAdminLogin, adminStart, adminLogout, adminPassword, readAdminMap, ADMIN_KEY } from './admin.mjs';

const TITLE_ARROW = '<svg viewBox="0 0 14 14"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 11H5.5A1.5 1.5 0 004 12.5v7A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5v-7a1.5 1.5 0 00-1.5-1.5H17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 9 15"><path d="M1.5 1.5l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 12 20"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mappen: '<svg viewBox="0 0 26 26"><rect x="4" y="5" width="18" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3v4M18 3v4M8 12h10M8 16h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  suche: '<svg viewBox="0 0 26 26"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16.5 16.5L23 23" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  werkzeuge: '<svg viewBox="0 0 26 26"><path d="M4.5 19a10 10 0 0117 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M13 19l4.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="13" cy="19" r="2" fill="currentColor"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const TEXT = {
  locked: 'Dieser Link gilt nicht mehr, frag nach dem neuen.',
  wrongPassword: 'Das Passwort stimmt nicht.',
  offline: 'Keine Verbindung. Versuch es nochmal, wenn du Netz hast.',
  broken: 'Diese Mappe lässt sich nicht öffnen.',
};
const REFRESH_EVERY = 10 * 60 * 1000;
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const main = $('main');
const timeout = ms => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);
const fetcher = (url, options = {}) => fetch(url, { credentials: 'omit', redirect: 'error', signal: timeout(options.cache === 'no-store' || options.cache === 'no-cache' ? 15000 : 120000), ...options });
const framed = window.top !== window.self;
const PAGE_VERSION = (import.meta.url.match(/\/v\/([0-9a-f]{16})\//) || [])[1] ?? null;
let controlled = Boolean(navigator.serviceWorker?.controller);
let updateReady = false;
let updating = false;
let importing = 0;
let booted = false;
let menuPage = null;
const reloadedFor = new Set();
const initialHash = location.hash;
if (initialHash.length > 1) history.replaceState(null, '', location.pathname + location.search);

const app = {
  store: null,
  exportChoice: { kind: 'part', range: 'piece' },
  records: [],
  instruments: [],
  choice: null,
  settings: { size: 100, spacing: {}, format: 'auto', helpSeen: false, homeHint: false, score: false, preset: 'all' },
  view: { name: 'home' },
  from: null,
  tab: 'mappen',
  lists: new Map(),
  cur: null,
  drawNr: 0,
  measured: [],
  lastRefresh: 0,
  wakeLock: null,
  busy: false,
  parts: [],
  custom: new Map(),
  admin: false,
  all: null,
};
const tablet = () => Math.min(screen.width, screen.height) >= 600;
const scoreOn = () => tablet() && app.settings.score === true;

const ALL_ID = 'alle';

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const player = createPlayer({ pult: $('pult'), bar: $('vbar'), area: $('pa'), header: $('ph'), toast, fetcher });

async function saveSettings() {
  await app.store.set('settings', app.settings).catch(() => {});
}

async function saveRecord(record, { create = false } = {}) {
  if (record.virtual) return;
  const i = app.records.findIndex(r => r.id === record.id);
  if (!create && i < 0) return;
  let kept = true;
  try {
    if (create) await app.store.putBinder(record);
    else kept = await app.store.updateBinder(record);
  } catch {
    toast('Speichern auf dem Gerät klappt nicht');
  }
  const at = app.records.findIndex(r => r.id === record.id);
  if (!kept) {
    if (at >= 0) app.records.splice(at, 1);
  } else if (at >= 0) app.records[at] = record;
  else if (create) app.records.push(record);
}

function allRecord() {
  if (!app.admin || !app.all) return null;
  return { id: ALL_ID, key: '', list: app.all, seen: Object.fromEntries(app.all.pieces.map(p => [p.id, p.mark])), added: -1, locked: false, virtual: true };
}

const shown = () => [allRecord(), ...app.records].filter(Boolean);
const record = id => shown().find(r => r.id === id);
const formatDate = value => new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const choiceLabel = () => (app.choice ? `${app.choice.instrument.name}, ${app.choice.number === 'Bass' ? 'Bass' : `${app.choice.number} Stimme`}` : '');

function go(view) {
  closeTitleMenu();
  app.view = view;
  render();
  main.scrollTop = 0;
}

function renderTabs() {
  const tabs = [['mappen', 'Mappen'], ['suche', 'Suche'], ['werkzeuge', 'Werkzeuge']];
  $('tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${app.tab === k ? 'on' : ''}">${ICON[k]}${l}</button>`).join('');
}

let tool = null;
function unmountTool() {
  tool?.destroy();
  tool = null;
}

function toolsView() {
  const kind = app.settings.tool === 'metronome' ? 'metronome' : 'tuner';
  main.innerHTML = `<div class="head">${titleButton('Werkzeuge')}</div><div class="toolseg">${[['tuner', 'Stimmgerät'], ['metronome', 'Metronom']].map(([k, l]) => `<button data-tool="${k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="toolroot"></div>`;
  tool = kind === 'metronome' ? mountMetronome($('toolroot')) : mountTuner($('toolroot'));
}

function render() {
  unmountTool();
  const welcome = !shown().length;
  document.body.classList.toggle('welcome', welcome);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', welcome ? '#2f3632' : '#ffffff');
  if (welcome) {
    main.innerHTML = welcomeView();
    return;
  }
  renderTabs();
  const v = app.view;
  if (v.name === 'binder' && record(v.id)) main.innerHTML = binderView(record(v.id));
  else if (v.name === 'part') main.innerHTML = partView(v);
  else if (v.name === 'tools') toolsView();
  else if (v.name === 'search') {
    main.innerHTML = searchView(v.q || '');
    $('q').value = v.q || '';
  } else {
    app.view = { name: 'home' };
    main.innerHTML = homeView();
  }
}

function passwordInput(id, label, cls) {
  return `<span class="pwwrap"><input id="${id}"${cls ? ` class="${cls}"` : ''} type="password" placeholder="Passwort oder Link" aria-label="${esc(label)}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"><button type="button" class="eye" data-eye="${id}" aria-label="Passwort zeigen" aria-pressed="false">${EYE}</button></span>`;
}

document.addEventListener('click', e => {
  const button = e.target.closest('[data-eye]');
  if (!button) return;
  const input = $(button.dataset.eye);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort zeigen');
  input.focus();
});

function welcomeView() {
  return `<div class="wl"><img src="icons/logo-mark.svg" alt="">
  <h1 class="wl-name">Paul's Ständchenmappe</h1><p class="wl-say">Deine Stimme für jeden Auftritt</p>
  <form id="wlform">${passwordInput('wlpw', 'Passwort oder Link', '')}<button type="submit">Öffnen</button></form>
  <p class="wl-hint" id="wlhint" role="status"></p><p class="wl-ask">Noch keinen Zugang? Frag deinen Kapellmeister.</p></div>`;
}

function titleButton(text) {
  return `<h1><button class="tt" data-act="tmenu" aria-haspopup="menu" aria-expanded="false">${esc(text)}${TITLE_ARROW}</button></h1>`;
}

function closeTitleMenu() {
  const menu = $('tmenu');
  if (!menu) return;
  menu.classList.remove('open');
  menu.replaceChildren();
  main.querySelector('[data-act="tmenu"]')?.setAttribute('aria-expanded', 'false');
}

function titleMenu(button) {
  let menu = $('tmenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'tmenu';
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    menu.addEventListener('click', e => {
      const item = e.target.closest('[data-menu]');
      if (!item) return;
      closeTitleMenu();
      const what = item.dataset.menu;
      const inBinder = app.view.name === 'binder';
      if (what === 'add') passwordSheet();
      else if (what === 'update') updateAll();
      else if (what === 'logout' && app.admin) logout();
      else if (what === 'share' && inBinder) shareSheet(app.view.id);
      else if (what === 'remove' && inBinder) confirmRemove(app.view.id);
      else if ((what === 'pdf-part' || what === 'pdf-score') && inBinder) makePdf(app.view.id, what === 'pdf-score');
      else if (what === 'editor' && inBinder && app.admin) openInEditor(app.view.id);
    });
    document.addEventListener('click', e => {
      if (menu.classList.contains('open') && !e.target.closest('#tmenu') && !e.target.closest('[data-act="tmenu"]')) closeTitleMenu();
    }, true);
  }
  if (menu.classList.contains('open')) {
    closeTitleMenu();
    return;
  }
  const current = app.view.name === 'binder' ? record(app.view.id) : null;
  menu.innerHTML = current ? binderMenu(current) : appMenu();
  const box = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 250))}px`;
  menu.style.top = `${box.bottom + 6}px`;
  menu.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
}

function appMenu() {
  return '<button role="menuitem" data-menu="add">Mappe hinzufügen</button><button role="menuitem" data-menu="update">Aktualisieren</button>'
    + (app.admin ? '<div class="sep"></div><a role="menuitem" href="app/editor.html">Redaktion öffnen</a><button role="menuitem" data-menu="logout">Redaktion abmelden</button>' : '');
}

function binderMenu(r) {
  const top = (shareable(r) ? '<button role="menuitem" data-menu="share">Mappe teilen</button>' : '')
    + (r.list.pieces.length ? '<button role="menuitem" data-menu="pdf-part">PDF in meiner Stimme</button><button role="menuitem" data-menu="pdf-score">PDF der Partituren</button>' : '');
  return `${top ? `${top}<div class="sep"></div>` : ''}<button role="menuitem" class="danger" data-menu="remove">Von diesem Gerät entfernen</button>`
    + (app.admin ? '<div class="sep"></div><button role="menuitem" data-menu="editor">In der Redaktion öffnen</button>' : '');
}

async function openInEditor(recordId) {
  const map = readAdminMap(await app.store.get(ADMIN_KEY).catch(() => null));
  const binderId = Object.keys(map).find(id => map[id]?.record === recordId);
  location.href = `app/editor.html${binderId ? `#binder=${encodeURIComponent(binderId)}` : ''}`;
}

function badges(counts) {
  return (counts.neu ? `<span class="badge neu">${counts.neu} neu</span> ` : '') + (counts.geändert ? `<span class="badge geändert">${counts.geändert} geändert</span>` : '');
}

function homeView() {
  const cards = shown().map(r => {
    const b = badges(countMarks(r));
    const card = `<button class="card" data-open="${esc(r.id)}"><div class="grow"><div class="t">${esc(r.list.name)}</div><div class="m">${r.list.pieces.length} Stücke · Stand ${esc(formatDate(r.list.published))}</div>${r.locked ? `<div class="locked">${esc(TEXT.locked)}</div>` : ''}${b ? `<div class="badges">${b}</div>` : ''}</div>${ICON.chev}</button>`;
    return shareable(r) ? `<div class="cardrow">${card}<button class="share" data-share="${esc(r.id)}" aria-label="${esc(r.list.name)} teilen">${SHARE}</button></div>` : card;
  }).join('');
  return `<div class="head">${titleButton('Meine Mappen')}</div>${cards}<button class="link-row" data-act="add">+ Mappe hinzufügen</button>
  <p class="offline"><span id="offline" role="status">${esc(offlineText())}</span><button class="linkbtn" data-act="update">Aktualisieren</button></p>`;
}

function pieceRow(r, piece, i, highlight, attr) {
  const mark = pieceMark(r, piece);
  return `<button class="row${i === highlight ? ' hl' : ''}" ${attr}="${i}" id="r${i}"><span class="n">${i + 1}</span><span class="t">${esc(piece.title)}</span>${mark ? `<span class="badge ${mark}">${mark}</span>` : ''}</button>`;
}

function binderView(r) {
  const highlight = app.cur && app.cur.id === r.id ? app.cur.index : -1;
  const rows = r.list.pieces.map((piece, i) => pieceRow(r, piece, i, highlight, 'data-piece')).join('');
  const search = r.virtual ? '<input id="aq" class="search spaced-bottom" type="search" placeholder="Titel" aria-label="Titel suchen" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">' : '';
  return `<div class="head"><div class="topbar"><button class="back" data-act="home">${ICON.back} Meine Mappen</button></div>
  ${r.virtual ? `<h1>${esc(r.list.name)}</h1>` : titleButton(r.list.name)}${search}</div>
  ${r.locked ? `<div class="notice"><span>${esc(TEXT.locked)}</span><button data-act="remove">Entfernen</button></div>` : ''}
  <button class="stimme-chip" data-act="part">${esc(choiceLabel() || 'Stimme wählen')} <span>wechseln</span></button>
  <div class="list">${rows || '<div class="empty">Noch keine Stücke in dieser Mappe.</div>'}</div>`;
}

function numberList(current) {
  return NUMBERS.filter(n => instrumentsFor(app.instruments, n).length)
    .map(n => `<button class="inst${current === n ? ' on' : ''}" data-num="${esc(n)}"><span class="t big">${esc(numberLabel(n))}</span>${ICON.chev}</button>`).join('');
}

function instrumentList(number) {
  return instrumentsFor(app.instruments, number).map(i => {
    const on = app.choice && app.choice.instrument.id === i.id && app.choice.number === number;
    return `<button class="inst${on ? ' on' : ''}" data-inst="${esc(i.id)}"><span class="t">${esc(i.name)}<small>liest ${esc(i.notations.join(', '))}</small></span>${ICON.chev}</button>`;
  }).join('');
}

function partView(v) {
  if (v.step === 2) {
    return `<div class="topbar"><button class="back" data-act="step1">${ICON.back} Stimme</button></div>
    <h1>Welches Instrument?</h1><p class="sub">${esc(numberLabel(v.number))}</p>
    <div class="list">${instrumentList(v.number)}</div>`;
  }
  return `<div class="topbar"><button class="back" data-act="back-from">${ICON.back} ${esc(viewName(v.from))}</button></div><h1>Welche Stimme spielst du?</h1>
  <p class="sub">Gilt für alle Mappen auf diesem Gerät.</p>
  <div class="list spaced">${numberList(app.choice?.number)}</div>`;
}

function viewName(view) {
  if (view?.name === 'search') return 'Suche';
  if (view?.name === 'binder' && record(view.id)) return record(view.id).list.name;
  return 'Meine Mappen';
}

function goBack(view) {
  const known = view?.name === 'search' || (view?.name === 'binder' && record(view.id));
  app.tab = view?.name === 'search' ? 'suche' : 'mappen';
  go(known ? view : { name: 'home' });
}

const octaveMap = value => boundedMap(value, entry => validOctave(entry) !== null);
const semitoneMap = value => boundedMap(value, entry => validSemitones(entry) !== null);
const pieceScoped = pieceId => Boolean(pieceId) && (Object.hasOwn(octaveMap(app.settings.pieceOctaves), pieceId) || Object.hasOwn(semitoneMap(app.settings.pieceSemitones), pieceId));

function partOptions(xml, choice, piece) {
  const pieceId = piece?.id;
  let auto = 0;
  try {
    const chosen = choosePart(xml, choice.instrument, choice.number);
    auto = autoOctave(choice.instrument.id, chosen.source, chosen.original);
  } catch {
    auto = 0;
  }
  const editor = piece?.octaves && Object.hasOwn(piece.octaves, choice.instrument.id) ? validOctave(piece.octaves[choice.instrument.id]) : null;
  if (editor !== null) auto = editor;
  if (pieceId && app.choice) autos.set(`${pieceId}|${choice.instrument.id}|${choice.number}`, auto);
  const own = octaveMap(app.settings.pieceOctaves)[pieceId];
  return { octave: own ?? validOctave(app.settings.octave) ?? auto, range: validRange(app.settings.range), semitones: semitones(pieceId) };
}

function semitones(pieceId = null) {
  const own = pieceId ? semitoneMap(app.settings.pieceSemitones)[pieceId] : undefined;
  return own ?? validSemitones(app.settings.semitones) ?? 0;
}

function scopeControls(pieceId) {
  if (!pieceId) return '';
  const scoped = pieceScoped(pieceId);
  return `<div class="mf"><span>Gilt für</span><div class="seg"><button data-sound="scope-all" class="${scoped ? '' : 'on'}">Alle Stücke</button><button data-sound="scope-piece" class="${scoped ? 'on' : ''}">Nur dieses Stück</button></div>${scoped ? '<p class="keynote">Dieses Stück hat eigene Werte.</p>' : ''}</div>`;
}

function shifted() {
  return validOctave(app.settings.octave) !== null || Boolean(validSemitones(app.settings.semitones))
    || [app.settings.pieceOctaves, app.settings.pieceSemitones, app.settings.scoreOctaves].some(map => Object.keys(boundedMap(map, () => true)).length > 0);
}

function resetControls() {
  return shifted() ? '<div class="mf sep"><div class="sz"><button class="fit" data-sound="reset-all">Alle Lagen zurücksetzen</button></div></div>' : '';
}

function confirmReset(done) {
  const sh = $('sheet');
  sh.innerHTML = `<div class="box"><h3>Alle Lagen zurücksetzen?</h3><p>Oktave und Halbtöne kommen für alle Stücke zurück auf die Originaltonart und die vorgegebene Oktave, auch die eigenen Werte einzelner Stücke und die Oktaven der Partitur-Stimmen.</p>
  <button class="primary danger" data-reset>Zurücksetzen</button><button class="ghost" data-close>Abbrechen</button></div>`;
  sh.classList.add('open');
  sh.onclick = e => {
    if (e.target === sh || e.target.closest('[data-close]')) {
      closeSheet();
      return;
    }
    if (!e.target.closest('[data-reset]')) return;
    closeSheet();
    app.settings.octave = null;
    app.settings.semitones = 0;
    app.settings.pieceOctaves = {};
    app.settings.pieceSemitones = {};
    app.settings.scoreOctaves = {};
    saveSettings();
    toast('Alle Lagen zurückgesetzt');
    done();
  };
}

function keyControls(pieceId = null) {
  const n = semitones(pieceId);
  const label = n ? `${Math.abs(n)} ${Math.abs(n) === 1 ? 'Halbton' : 'Halbtöne'} ${n > 0 ? 'höher' : 'tiefer'}` : 'Original';
  return `<div class="mf"><span>Halbtöne</span><div class="sz"><button data-sound="semi-" ${n <= -6 ? 'disabled' : ''} aria-label="Einen Halbton tiefer">−</button><output class="wide">${esc(label)}</output><button data-sound="semi+" ${n >= 6 ? 'disabled' : ''} aria-label="Einen Halbton höher">+</button></div>
  ${n ? '<div class="sz"><button class="fit" data-sound="semi-0">Original</button></div><p class="keynote">Vorspielen bleibt in der Originaltonart.</p>' : ''}</div>`;
}

function soundControls(auto, pieceId = null) {
  const scoped = pieceScoped(pieceId);
  const own = scoped ? octaveMap(app.settings.pieceOctaves)[pieceId] : undefined;
  const set = validOctave(app.settings.octave);
  const octave = own ?? set ?? auto ?? 0;
  const label = own !== undefined ? octaveLabel(own) : set === null ? (auto === null ? 'automatisch' : `${octaveLabel(octave)} (auto)`) : octaveLabel(octave);
  const range = validRange(app.settings.range);
  const step = (end, dir, text, disabled) => `<button data-sound="${end}${dir > 0 ? '+' : '-'}" ${disabled ? 'disabled' : ''} aria-label="${text}">${dir > 0 ? '+' : '−'}</button>`;
  const rangeRow = range
    ? `<div class="sz">${step('low', -1, 'Tiefster Ton tiefer')}<output>ab ${esc(noteLabel(range.low))}</output>${step('low', 1, 'Tiefster Ton höher', range.high - range.low <= 11)}</div>
      <div class="sz">${step('high', -1, 'Höchster Ton tiefer', range.high - range.low <= 11)}<output>bis ${esc(noteLabel(range.high))}</output>${step('high', 1, 'Höchster Ton höher')}</div>
      <div class="sz"><button class="fit" data-sound="range-off">Aus</button></div>`
    : '<div class="sz"><button class="fit" data-sound="range-on">Festlegen</button></div>';
  const reset = (scoped ? own !== undefined && own !== (auto ?? 0) : set !== null) ? '<div class="sz"><button class="fit" data-sound="oct-auto">Automatisch</button></div>' : '';
  return `${scopeControls(pieceId)}${keyControls(pieceId)}<div class="mf"><span>Oktave</span><div class="sz"><button data-sound="oct-" ${octave <= -2 ? 'disabled' : ''} aria-label="Eine Oktave tiefer">−</button><output class="wide">${esc(label)}</output><button data-sound="oct+" ${octave >= 2 ? 'disabled' : ''} aria-label="Eine Oktave höher">+</button></div>${reset}</div>
  <div class="mf sep"><span>Tonumfang, gilt für alle Stücke</span>${rangeRow}</div>${resetControls()}`;
}

function keyValue(pieceId, score) {
  const parts = [];
  if (!score) {
    const own = pieceScoped(pieceId) ? octaveMap(app.settings.pieceOctaves)[pieceId] : undefined;
    const octave = own ?? validOctave(app.settings.octave);
    if (octave) parts.push(`${octave > 0 ? '+' : '−'}${Math.abs(octave)} Okt.`);
  }
  const n = semitones(pieceId);
  if (n) parts.push(`${Math.abs(n)} HT ${n > 0 ? 'höher' : 'tiefer'}`);
  return parts.join(', ') || 'Original';
}

const clamp6 = n => Math.max(-6, Math.min(6, n));
const autos = new Map();
const autoKey = pieceId => (pieceId && app.choice ? `${pieceId}|${app.choice.instrument.id}|${app.choice.number}` : null);
const autoFor = pieceId => (autoKey(pieceId) && autos.has(autoKey(pieceId)) ? autos.get(autoKey(pieceId)) : null);

async function ensureAuto(pieceId) {
  if (!pieceId) return 0;
  const known = autoFor(pieceId);
  if (known !== null) return known;
  const r = app.cur && record(app.cur.id);
  const piece = r?.list.pieces.find(p => p.id === pieceId);
  if (!piece || !app.choice) return 0;
  try {
    const loaded = await loadChecked(piece);
    partOptions(loaded.xml, app.choice, piece);
  } catch {
    return 0;
  }
  return autoFor(pieceId) ?? 0;
}

function changeSound(action, pieceId = null, auto = 0) {
  const octaves = octaveMap(app.settings.pieceOctaves);
  const shifts = semitoneMap(app.settings.pieceSemitones);
  const scoped = pieceScoped(pieceId);
  const octave = (scoped ? octaves[pieceId] : undefined) ?? validOctave(app.settings.octave) ?? auto;
  const semis = semitones(scoped ? pieceId : null);
  const clamp = n => Math.max(-2, Math.min(2, n));
  const setOctave = value => {
    if (scoped) app.settings.pieceOctaves = { ...octaves, [pieceId]: value };
    else app.settings.octave = value;
  };
  const setSemis = value => {
    if (scoped) app.settings.pieceSemitones = { ...shifts, [pieceId]: value };
    else app.settings.semitones = value;
  };
  if (action === 'oct+' || action === 'oct-') setOctave(clamp(octave + (action === 'oct+' ? 1 : -1)));
  else if (action === 'oct-auto') {
    if (scoped) setOctave(auto);
    else app.settings.octave = null;
  } else if (action === 'semi+' || action === 'semi-') setSemis(clamp6(semis + (action === 'semi+' ? 1 : -1)));
  else if (action === 'semi-0') setSemis(0);
  else if (action === 'scope-piece' && pieceId) {
    if (scoped) return false;
    app.settings.pieceOctaves = { ...octaves, [pieceId]: octave };
    app.settings.pieceSemitones = { ...shifts, [pieceId]: semis };
  } else if (action === 'scope-all' && pieceId) {
    delete octaves[pieceId];
    delete shifts[pieceId];
    app.settings.pieceOctaves = octaves;
    app.settings.pieceSemitones = shifts;
  } else if (action === 'range-on') app.settings.range = defaultRange(app.choice?.instrument.notations[0] === 'C Bass');
  else if (action === 'range-off') app.settings.range = null;
  else {
    const range = validRange(app.settings.range);
    const match = action.match(/^(low|high)([+-])$/);
    if (!range || !match) return false;
    app.settings.range = stepRange(range, match[1], match[2] === '+' ? 1 : -1);
  }
  saveSettings();
  return true;
}

function searchView(q) {
  const query = q.trim().toLocaleLowerCase('de');
  let results = '';
  if (query) {
    for (const r of app.records) {
      r.list.pieces.forEach((piece, i) => {
        if (piece.title.toLocaleLowerCase('de').includes(query)) {
          results += `<button class="row" data-hit="${esc(r.id)}" data-index="${i}"><span class="n">${i + 1}</span><span class="t">${esc(piece.title)}<small>${esc(r.list.name)}</small></span></button>`;
        }
      });
    }
    results = results ? `<div class="list">${results}</div>` : '<div class="empty">Nichts gefunden</div>';
  }
  return `<div class="head">${titleButton('Suche')}<input id="q" class="search" type="search" placeholder="Titel" aria-label="Titel suchen" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></div><div id="res" class="spaced">${results}</div>`;
}

function openBinder(id) {
  app.tab = 'mappen';
  if (!app.choice) go({ name: 'part', step: 1, then: id, from: { name: 'home' } });
  else go({ name: 'binder', id });
}

async function addBinder(key, how) {
  let access;
  try {
    access = await binderAccess(key);
  } catch {
    return TEXT.broken;
  }
  if (record(access.name)) {
    toast('Die Mappe ist schon da');
    openBinder(access.name);
    return null;
  }
  let loaded;
  try {
    loaded = await loadBinder(fetcher, key);
  } catch (error) {
    if (error instanceof LockedError) return how === 'password' ? TEXT.wrongPassword : TEXT.locked;
    if (error instanceof OfflineError) return TEXT.offline;
    return TEXT.broken;
  }
  const rec = newRecord(loaded.id, toBase64Url(key), loaded.list);
  await saveRecord(rec, { create: true });
  navigator.storage?.persist?.().catch(() => {});
  toast(`Mappe geöffnet: ${loaded.list.name}`);
  openBinder(rec.id);
  preload();
  homeHint();
  return null;
}

async function importFromHash(hash) {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (!hash || hash.length < 2) return;
  importing++;
  try {
    await importLink(hash);
  } finally {
    importing--;
    setTimeout(maybeReload, 0);
  }
}

async function importLink(hash) {
  const key = keyFromLink(hash);
  if (!key) {
    toast('Dieser Link ist unvollständig');
    return;
  }
  const problem = await addBinder(key, 'link');
  if (problem) toast(problem);
}

async function openWithPassword(password, show) {
  if (app.busy) return;
  if (!password.trim()) {
    show('Bitte das Passwort eingeben.');
    return;
  }
  const text = password.trim();
  const linked = text.includes('#') ? keyFromLink(text.slice(text.indexOf('#'))) : null;
  if (text.includes('#') && !linked) {
    show('Dieser Link ist unvollständig.');
    return;
  }
  app.busy = true;
  show('Einen Moment …');
  try {
    if (linked) {
      const problem = await addBinder(linked, 'link');
      show(problem || '');
      if (!problem) closeSheet();
      return;
    }
    let key;
    try {
      key = await binderKey(password);
    } catch {
      show(TEXT.wrongPassword);
      return;
    }
    const problem = await addBinder(key, 'password');
    if (problem === TEXT.wrongPassword && await adminLogin(password)) {
      show('');
      closeSheet();
      return;
    }
    show(problem || '');
    if (!problem) closeSheet();
  } finally {
    app.busy = false;
  }
}

async function adminLogin(password) {
  let ok = false;
  try {
    ok = await tryAdminLogin(password, { fetcher });
  } catch {
    ok = false;
  }
  if (!ok) return false;
  toast('Als Redaktion angemeldet');
  await startAdmin();
  app.tab = 'mappen';
  go({ name: 'home' });
  return true;
}

async function reloadRecords() {
  app.records = (await app.store.binders().catch(() => [])).map(checkRecord).filter(Boolean);
}

async function startAdmin() {
  let result = null;
  try {
    result = await adminStart({ store: app.store, fetcher });
  } catch {
    toast('Die Mappen der Redaktion lassen sich gerade nicht laden');
  }
  const before = JSON.stringify([app.admin, app.all?.published ?? null, app.records.map(r => [r.id, r.list.published])]);
  app.admin = Boolean(result);
  app.all = result?.all ?? null;
  await reloadRecords();
  const after = JSON.stringify([app.admin, app.all?.published ?? null, app.records.map(r => [r.id, r.list.published])]);
  if (before !== after) renderSoon();
  if (app.admin) preload();
}

function renderSoon() {
  if ($('pult').classList.contains('open')) return;
  const field = document.activeElement;
  if (field?.tagName === 'INPUT' && main.contains(field)) {
    field.addEventListener('blur', () => setTimeout(() => {
      if (!$('pult').classList.contains('open')) render();
    }, 0), { once: true });
    return;
  }
  render();
}

async function logout() {
  try {
    await adminLogout({ store: app.store });
  } catch {
    toast('Abmelden hat nicht geklappt');
    return;
  }
  app.admin = false;
  app.all = null;
  await reloadRecords();
  if (app.cur && !record(app.cur.id)) app.cur = null;
  toast('Abgemeldet');
  app.tab = 'mappen';
  go({ name: 'home' });
  cleanup();
}

function passwordSheet() {
  const sh = $('sheet');
  sh.innerHTML = `<div class="box"><h3>Mappe hinzufügen</h3><form id="pwform">${passwordInput('pw', 'Passwort oder Link der Mappe', 'search')}
  <div class="err" id="pwerr" role="status"></div>
  <button class="primary tight" type="submit">Öffnen</button></form><button class="ghost" data-close>Abbrechen</button></div>`;
  sh.classList.add('open');
  setTimeout(() => $('pw')?.focus(), 50);
  sh.onclick = e => {
    if (e.target === sh || e.target.closest('[data-close]')) closeSheet();
  };
  $('pwform').onsubmit = e => {
    e.preventDefault();
    openWithPassword($('pw').value, message => {
      const err = $('pwerr');
      if (err) err.textContent = message;
    });
  };
}

function closeSheet() {
  setTimeout(maybeReload, 0);
  const sh = $('sheet');
  sh.classList.remove('open');
  sh.onclick = null;
  sh.onchange = null;
  sh.replaceChildren();
}

function shareable(r) {
  return Boolean(r && !r.virtual && !r.locked && r.key);
}

async function shareData(r) {
  const link = binderLink(decodeKey(r.key));
  let password = null;
  if (app.admin) {
    try {
      password = await adminPassword(r.id, { store: app.store, fetcher });
    } catch {
      password = null;
    }
  }
  return { name: r.list.name, link, password, text: shareText({ name: r.list.name, link, password }) };
}

function cardOctave(xml, instrument, piece) {
  const editor = piece?.octaves && Object.hasOwn(piece.octaves, instrument.id) ? validOctave(piece.octaves[instrument.id]) : null;
  if (editor !== null) return editor;
  try {
    const chosen = choosePart(xml, instrument, '1.');
    return autoOctave(instrument.id, chosen.source, chosen.original);
  } catch {
    return 0;
  }
}

const CARD_TRIES = 6;

async function cardExcerpt(piece, instrument) {
  const loaded = await loadChecked(piece);
  const octave = cardOctave(loaded.xml, instrument, piece);
  const part = preparePart(loaded.xml, { instrument, number: '1.', octave });
  const fit = fitExcerpt(part.xml);
  if (!fit) return null;
  if (!fit.shift) return { xml: part.xml, measures: fit.measures };
  const moved = octave + fit.shift;
  if (moved < -2 || moved > 2) return null;
  return { xml: preparePart(loaded.xml, { instrument, number: '1.', octave: moved }).xml, measures: fit.measures };
}

async function cardFile(r, link) {
  let music = null;
  const instrument = app.instruments.find(i => i.notations[0] === 'C Bass' && i.numbers.includes('1.'));
  if (instrument) {
    const work = document.createElement('div');
    work.className = 'cardwork';
    work.setAttribute('aria-hidden', 'true');
    document.body.append(work);
    try {
      for (const piece of (r.list.pieces ?? []).slice(0, CARD_TRIES)) {
        const excerpt = await cardExcerpt(piece, instrument).catch(() => null);
        if (!excerpt) continue;
        music = await cardMusic(excerpt.xml, work, { measures: excerpt.measures }).catch(() => null);
        if (music) break;
      }
    } finally {
      work.remove();
    }
  }
  const blob = await cardPng(cardSvg({ title: r.list.name, link, music, measure: textMeasure() }));
  return new File([blob], `${fileSafe(r.list.name)}.png`, { type: 'image/png' });
}

async function shareSheet(id) {
  const r = record(id);
  if (!shareable(r)) return;
  const sh = $('sheet');
  sh.innerHTML = `<div class="box share-box"><div class="shead"><h3>${esc(r.list.name)}</h3><button data-close>Fertig</button></div>
  <div class="qr" id="shareqr"></div>
  <p class="share-hint">Zum Abscannen zeigen oder den Link schicken.</p>
  <p class="share-pw" id="sharepw" hidden></p>
  <button class="primary" data-do="share">Link teilen</button><button class="ghost" data-do="copy">Link kopieren</button></div>`;
  sh.classList.add('open');
  let data;
  try {
    data = await shareData(r);
  } catch {
    closeSheet();
    toast('Teilen klappt gerade nicht');
    return;
  }
  if (!sh.classList.contains('open')) return;
  const svg = safeSvg(qrSvg(data.link));
  if (svg) $('shareqr')?.replaceChildren(svg);
  cardFile(r, data.link).then(file => {
    data.file = file;
  }, () => {});
  if (data.password) {
    const line = $('sharepw');
    line.textContent = `Passwort: ${data.password}`;
    line.hidden = false;
    sh.querySelector('[data-do="copy"]').textContent = 'Link und Passwort kopieren';
  }
  if (!navigator.share) {
    sh.querySelector('[data-do="share"]')?.remove();
    sh.querySelector('[data-do="copy"]').className = 'primary';
  }
  sh.onclick = async e => {
    if (e.target === sh || e.target.closest('[data-close]')) {
      closeSheet();
      return;
    }
    const b = e.target.closest('[data-do]');
    if (!b) return;
    if (b.dataset.do === 'share') {
      const result = await shareBinder(data).catch(() => 'failed');
      if (result === 'copied') toast(data.password ? 'Link und Passwort kopiert' : 'Link kopiert');
      if (result === 'failed') toast('Teilen ging nicht');
      return;
    }
    try {
      await navigator.clipboard.writeText(data.text);
      toast(data.password ? 'Link und Passwort kopiert' : 'Link kopiert');
    } catch {
      toast('Kopieren ging nicht');
    }
  };
}

function confirmRemove(id) {
  const r = record(id);
  if (!r) return;
  const sh = $('sheet');
  sh.innerHTML = `<div class="box"><h3>Mappe entfernen?</h3><p>„${esc(r.list.name)}“ verschwindet von diesem Gerät. Mit dem Link oder Passwort kannst du sie wieder öffnen, solange sie gilt.</p>
  <button class="primary danger" data-remove>Entfernen</button><button class="ghost" data-close>Abbrechen</button></div>`;
  sh.classList.add('open');
  sh.onclick = async e => {
    if (e.target === sh || e.target.closest('[data-close]')) {
      closeSheet();
      return;
    }
    if (!e.target.closest('[data-remove]')) return;
    closeSheet();
    app.records = app.records.filter(x => x.id !== id);
    await app.store.deleteBinder(id).catch(() => {});
    if (app.cur?.id === id) app.cur = null;
    toast('Mappe entfernt');
    go({ name: 'home' });
    cleanup();
  };
}

async function choose(number, instrumentId) {
  const choice = validChoice(app.instruments, { number, instrument: instrumentId });
  if (!choice) return;
  app.choice = choice;
  await app.store.set('choice', { number, instrument: instrumentId }).catch(() => {});
  toast(`Stimme: ${choiceLabel()}`);
}

main.addEventListener('submit', e => {
  if (e.target.id !== 'wlform') return;
  e.preventDefault();
  $('wlpw').blur();
  openWithPassword($('wlpw').value, message => {
    const hint = $('wlhint');
    if (hint) hint.textContent = message;
  });
});

main.addEventListener('input', e => {
  if (e.target.id === 'aq') {
    const query = e.target.value.trim().toLocaleLowerCase('de');
    for (const row of main.querySelectorAll('[data-piece]')) row.hidden = Boolean(query) && !row.textContent.toLocaleLowerCase('de').includes(query);
    return;
  }
  if (e.target.id !== 'q') return;
  app.view.q = e.target.value;
  const holder = document.createElement('div');
  holder.innerHTML = searchView(e.target.value);
  $('res').replaceChildren(...holder.querySelector('#res').childNodes);
});

main.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  const v = app.view;
  if (d.tool) {
    app.settings.tool = d.tool === 'metronome' ? 'metronome' : 'tuner';
    saveSettings();
    render();
    return;
  }
  if (d.open) openBinder(d.open);
  else if (d.piece !== undefined) {
    app.from = null;
    openPult(v.id, Number(d.piece));
  } else if (d.hit) {
    app.from = { name: 'search', q: v.q || '' };
    openPult(d.hit, Number(d.index));
  } else if (d.num) go({ ...v, step: 2, number: d.num });
  else if (d.inst) {
    await choose(v.number, d.inst);
    app.tab = 'mappen';
    if (v.then && record(v.then)) {
      go({ name: 'binder', id: v.then });
      if (v.index !== undefined) {
        app.from = v.from?.name === 'search' ? v.from : null;
        openPult(v.then, v.index);
      }
    } else go({ name: 'home' });
  } else if (d.act === 'step1') go({ ...v, step: 1 });
  else if (d.act === 'home') {
    app.tab = 'mappen';
    go({ name: 'home' });
  } else if (d.act === 'back-from') goBack(v.from);
  else if (d.act === 'part') partSheet(1);
  else if (d.act === 'tmenu') titleMenu(b);
  else if (d.act === 'remove') confirmRemove(v.id);
  else if (d.act === 'add') passwordSheet();
  else if (d.act === 'update') updateAll();
  else if (d.share) shareSheet(d.share);
});

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  app.tab = b.dataset.tab;
  go(app.tab === 'suche' ? { name: 'search', q: '' } : app.tab === 'werkzeuge' ? { name: 'tools' } : { name: 'home' });
});

function header(r, index, part) {
  const piece = r.list.pieces[index];
  $('ph').innerHTML = `<button class="btn" id="pback" aria-label="${app.from?.name === 'search' ? 'Zurück zur Suche' : 'Zurück zur Mappe'}">${ICON.back}</button><button class="pick" id="ppick" aria-label="Stückliste"><span class="num">${index + 1}</span><span class="title">${esc(piece.title)}</span></button><button class="voice" id="pvoice" aria-label="Stimme wechseln">${esc(part || choiceLabel())}</button><button class="btn mn" id="pmn" aria-label="Menü">${ICON.menu}</button>`;
  $('pback').onclick = closePult;
  const first = action => () => {
    $('pmenu').classList.remove('open');
    action();
  };
  $('pvoice').onclick = first(() => (scoreOn() ? scoreSheet() : partSheet(1)));
  $('ppick').onclick = first(pieceSheet);
  $('pmn').onclick = () => {
    menuPage = null;
    if ($('pmenu').classList.toggle('open')) drawMenu();
  };
}

async function openPult(id, index, atEnd = false) {
  const r = record(id);
  if (!r || !r.list.pieces[index]) return;
  if (!app.choice) {
    go({ name: 'part', step: 1, then: id, index, from: app.from ?? { name: 'binder', id } });
    return;
  }
  const piece = r.list.pieces[index];
  app.cur = { id, index, piece: piece.id };
  if (pieceMark(r, piece)) await saveRecord(markSeen(r, piece));
  $('pult').classList.add('open');
  $('pult').classList.toggle('zones-help', !app.settings.helpSeen);
  $('pmenu').classList.remove('open');
  keepAwake();
  drawPult(atEnd ? 1 : 0);
}

function message(text) {
  const box = document.createElement('div');
  box.className = 'msg';
  box.textContent = text;
  $('music').replaceChildren(box);
  app.measured = [];
}

function musicWidth() {
  const pa = $('pa');
  const style = getComputedStyle(pa);
  return Math.max(200, pa.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
}

async function drawPult(fraction) {
  const nr = ++app.drawNr;
  const { id } = app.cur;
  const r = record(id);
  const found = r ? r.list.pieces.findIndex(p => p.id === app.cur.piece) : -1;
  if (found >= 0) app.cur.index = found;
  const index = app.cur.index;
  const piece = found >= 0 ? r.list.pieces[found] : null;
  if (!piece) {
    closePult();
    return;
  }
  const pa = $('pa');
  const music = $('music');
  header(r, index);
  music.style.maxWidth = `${shownWidth(app.settings.size)}%`;
  if (!music.querySelector('svg')) message('Noten werden gesetzt …');
  let loaded;
  try {
    loaded = await loadChecked(piece);
  } catch (error) {
    if (nr !== app.drawNr) return;
    if (error instanceof OfflineError) message('Dieses Stück ist noch nicht auf dem Gerät. Mit Netz lädt es von selbst.');
    else if (error instanceof LockedError) message('Dieses Stück gibt es so nicht mehr.');
    else message('Dieses Stück lässt sich nicht öffnen.');
    return;
  }
  if (nr !== app.drawNr) return;
  app.lists.set(piece.list, loaded.list);
  let part;
  try {
    if (scoreOn()) {
      app.parts = scoreParts(loaded.xml);
      const names = chosenParts(app.parts, app.settings.preset, app.custom.get(piece.id));
      part = { xml: selectParts(loaded.xml, names, { octaves: octaveMap(app.settings.scoreOctaves), semitones: semitones(piece.id) }), name: names.length === app.parts.length ? 'Partitur' : `Partitur ${names.length}/${app.parts.length}` };
    } else {
      part = preparePart(loaded.xml, { instrument: app.choice.instrument, number: app.choice.number, ...partOptions(loaded.xml, app.choice, piece) });
      if ($('pmenu').classList.contains('open')) drawMenu();
    }
  } catch {
    message('Diese Stimme lässt sich für dieses Stück nicht darstellen.');
    return;
  }
  header(r, index, part.name);
  const format = formatFor(app.settings.format, innerWidth);
  try {
    const measured = await engrave(music, part.xml, { width: musicWidth(), format, zoom: zoomFor(app.settings.size) });
    if (nr !== app.drawNr) return;
    app.measured = measured;
    space(measured, spacingFor(app.settings.spacing, format));
    player.setPiece(piece, loaded.list, measured, tempoFromMusicXml(loaded.xml));
  } catch {
    if (nr !== app.drawNr) return;
    message('Die Noten lassen sich gerade nicht setzen. Lade die App neu.');
    const state = navigator.onLine ? await currentState() : null;
    if (await checkVersion(state) && !reloadedFor.has(state.app) && !sessionStorageHas(state.app)) {
      reloadedFor.add(state.app);
      sessionStorageAdd(state.app);
      location.reload();
    }
    return;
  }
  pa.scrollTop = fraction * (pa.scrollHeight - pa.clientHeight);
}

function closePult() {
  player.close();
  setTimeout(maybeReload, 0);
  $('pmenu').classList.remove('open');
  $('pult').classList.remove('open');
  releaseAwake();
  app.drawNr++;
  $('music').replaceChildren();
  app.measured = [];
  const back = app.from;
  app.from = null;
  if (back?.name === 'search') goBack(back);
  else if (app.cur && record(app.cur.id)) {
    app.tab = 'mappen';
    app.view = { name: 'binder', id: app.cur.id };
    render();
    $(`r${app.cur.index}`)?.scrollIntoView({ block: 'center' });
  } else go({ name: 'home' });
}

function openSheet(html, onPick) {
  const sh = $('sheet');
  sh.innerHTML = `<div class="box tall">${html}</div>`;
  sh.classList.add('open');
  sh.onclick = e => {
    if (e.target === sh || e.target.closest('[data-close]')) {
      closeSheet();
      return;
    }
    const b = e.target.closest('button');
    if (b) onPick(b);
  };
  return sh;
}

function pieceSheet() {
  const { id, index } = app.cur;
  const r = record(id);
  const rows = r.list.pieces.map((piece, i) => pieceRow(r, piece, i, index, 'data-pick')).join('');
  const sh = openSheet(`<div class="shead"><h3>${esc(r.list.name)}</h3><button data-close>Fertig</button></div><div class="list">${rows}</div>`, b => {
    if (b.dataset.pick === undefined) return;
    closeSheet();
    openPult(id, Number(b.dataset.pick));
  });
  sh.querySelector('.row.hl')?.scrollIntoView({ block: 'center' });
}

function partSheet(step, number) {
  if (step === 1) {
    openSheet(`<div class="shead"><h3>Welche Stimme?</h3><button data-close>Fertig</button></div><div class="list">${numberList(app.choice?.number)}</div>`, b => {
      if (b.dataset.num) partSheet(2, b.dataset.num);
    });
    return;
  }
  openSheet(`<div class="shead"><button class="sback" data-back>${ICON.back} Stimme</button><h3>Welches Instrument?</h3><button data-close>Fertig</button></div>
  <p class="sub sheet-sub">${esc(numberLabel(number))}</p><div class="list">${instrumentList(number)}</div>`, async b => {
    if (b.hasAttribute('data-back')) {
      partSheet(1);
      return;
    }
    if (!b.dataset.inst) return;
    closeSheet();
    await choose(number, b.dataset.inst);
    if ($('pult').classList.contains('open')) drawPult(0);
    else render();
  });
}

function scoreSheet() {
  if (!app.cur || !app.parts.length) return;
  const pieceId = app.cur.piece;
  const names = chosenParts(app.parts, app.settings.preset, app.custom.get(pieceId));
  const preset = matchingPreset(app.parts, names);
  const presets = PRESETS.map(([value, label]) => `<button data-preset="${value}" class="${preset === value ? 'on' : ''}" ${presetParts(app.parts, value) ? '' : 'disabled'}>${esc(label)}</button>`).join('');
  const octaves = octaveMap(app.settings.scoreOctaves);
  const shift = n => (n ? `${n > 0 ? '+' : '−'}${Math.abs(n)} Okt.` : '±0');
  const rows = app.parts.map((p, i) => `<div class="check-row"><label class="check"><input type="checkbox" data-i="${i}" ${names.includes(p.name) ? 'checked' : ''}><span>${esc(p.name)}</span></label><span class="octs"><button data-oct="${i}" data-d="-1" ${(octaves[p.name] ?? 0) <= -2 ? 'disabled' : ''} aria-label="${esc(p.name)} eine Oktave tiefer">−</button><output>${shift(octaves[p.name] ?? 0)}</output><button data-oct="${i}" data-d="1" ${(octaves[p.name] ?? 0) >= 2 ? 'disabled' : ''} aria-label="${esc(p.name)} eine Oktave höher">+</button></span></div>`).join('');
  const sh = openSheet(`<div class="shead"><h3>Stimmen der Partitur</h3><button data-close>Fertig</button></div><div class="seg presets">${presets}</div><div class="list checks">${rows}</div>`, b => {
    if (b.dataset.oct !== undefined) {
      const name = app.parts[Number(b.dataset.oct)]?.name;
      if (!name) return;
      const all = octaveMap(app.settings.scoreOctaves);
      const next = Math.max(-2, Math.min(2, (all[name] ?? 0) + Number(b.dataset.d)));
      if (next) all[name] = next;
      else delete all[name];
      app.settings.scoreOctaves = all;
      saveSettings();
      const top = sh.querySelector('.box')?.scrollTop ?? 0;
      drawPult(0);
      scoreSheet();
      const box = $('sheet').querySelector('.box');
      if (box) box.scrollTop = top;
      return;
    }
    if (!b.dataset.preset) return;
    app.settings.preset = b.dataset.preset;
    app.custom.delete(pieceId);
    saveSettings();
    const top = sh.querySelector('.box')?.scrollTop ?? 0;
    drawPult(0);
    scoreSheet();
    const box = $('sheet').querySelector('.box');
    if (box) box.scrollTop = top;
  });
  sh.onchange = () => {
    const picked = [...sh.querySelectorAll('input[data-i]')].filter(box => box.checked).map(box => app.parts[Number(box.dataset.i)]?.name).filter(Boolean);
    if (!picked.length) {
      toast('Mindestens eine Stimme');
      scoreSheet();
      return;
    }
    const match = matchingPreset(app.parts, picked);
    if (match) {
      app.settings.preset = match;
      app.custom.delete(pieceId);
      saveSettings();
    } else app.custom.set(pieceId, picked);
    sh.querySelectorAll('[data-preset]').forEach(button => button.classList.toggle('on', button.dataset.preset === match));
    drawPult(0);
  };
}

let glyphs = null;
async function loadGlyphs() {
  glyphs ||= fetcher(new URL('leipzig-glyphs.json', import.meta.url).href).then(async response => {
    if (!response.ok) throw new Error('glyphs missing');
    return checkGlyphs(await response.json());
  }).catch(error => {
    glyphs = null;
    throw error;
  });
  return glyphs;
}

const measureCanvas = document.createElement('canvas').getContext('2d');
function textWidth(value, size, font = 'regular') {
  if (!measureCanvas) return value.length * size * 0.5;
  const sans = font === 'sans' || font === 'sansBold';
  const bold = font === 'bold' || font === 'sansBold';
  measureCanvas.font = `${bold ? 'bold ' : ''}${size}px ${sans ? 'Helvetica, Arial, sans-serif' : '"Times New Roman", Times, serif'}`;
  return measureCanvas.measureText(value).width;
}

const fileSafe = value => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Mappe';

function pdfReason(error) {
  if (error instanceof OfflineError) return 'noch nicht auf dem Gerät, braucht Netz';
  if (error instanceof LockedError) return 'gibt es so nicht mehr';
  if (error instanceof FormatError) return 'Datei beschädigt';
  if (error?.name === 'MusicXmlError' || error?.name === 'TypeError') return 'diese Stimme lässt sich nicht darstellen';
  return 'lässt sich nicht setzen';
}

function pdfResult(text, failed, link) {
  const sh = $('sheet');
  const rows = failed.map(f => `<li>${f.number}. ${esc(f.title)}: ${esc(f.reason)}</li>`).join('');
  sh.innerHTML = `<div class="box"><h3>${esc(text)}</h3>${rows ? `<p>Fehlt im PDF:</p><ul class="pdf-missing">${rows}</ul>` : ''}<div id="pdflink"></div><button class="ghost" data-close>Fertig</button></div>`;
  if (link) $('pdflink').append(link);
  sh.classList.add('open');
  sh.onclick = e => {
    if (e.target === sh || e.target.closest('[data-close]')) {
      if (link) setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      closeSheet();
    }
  };
}

async function makePdf(id, scores, only = null) {
  const r = record(id);
  if (!r || r.virtual || app.pdfBusy) return;
  const pieces = only === null ? r.list.pieces : r.list.pieces.slice(only, only + 1);
  if (!pieces.length) return;
  const name = only === null ? r.list.name : pieces[0].title;
  if (!app.choice && !scores) {
    toast('Erst die Stimme wählen');
    return;
  }
  app.pdfBusy = true;
  let cancelled = false;
  const sh = $('sheet');
  sh.innerHTML = '<div class="box"><h3>PDF wird erstellt</h3><p class="progress" id="pdfstate">Noten werden gesetzt …</p><button class="ghost" data-cancel>Abbrechen</button></div>';
  sh.classList.add('open');
  sh.onclick = e => {
    if (e.target.closest('[data-cancel]')) cancelled = true;
  };
  const work = document.createElement('div');
  work.className = 'pdfwork';
  work.setAttribute('aria-hidden', 'true');
  document.body.append(work);
  const choice = app.choice;
  const label = scores ? 'Partituren' : `${numberLabel(choice.number)} in ${choice.instrument.notations[0]}`;
  let done = false;
  try {
    let table = null;
    try {
      table = await loadGlyphs();
    } catch {
      table = null;
    }
    await document.fonts.ready;
    const result = await binderPdf({
      kind: scores ? 'score' : 'part',
      name,
      label,
      pieces,
      first: only === null ? 1 : only + 1,
      contents: only === null,
      glyphs: table,
      textWidth,
      work,
      reason: pdfReason,
      cancelled: () => cancelled,
      progress: (index, piece) => {
        const state = $('pdfstate');
        if (state) state.textContent = pieces.length > 1 ? `${index + 1} von ${pieces.length}: ${piece.title}` : piece.title;
      },
      piecePart: async index => {
        const loaded = await loadChecked(pieces[index]);
        const tempo = tempoFromMusicXml(loaded.xml);
        const composer = composerOf(loaded.xml);
        if (scores) {
          const octaves = octaveMap(app.settings.scoreOctaves);
          const shift = semitones(pieces[index].id);
          const xml = Object.keys(octaves).length || shift ? selectParts(loaded.xml, scoreParts(loaded.xml).map(p => p.name), { octaves, semitones: shift }) : loaded.xml;
          return { xml, label: 'Partitur', parts: (loaded.xml.match(/<score-part\b/g) || []).length, tempo, composer };
        }
        const part = preparePart(loaded.xml, { instrument: choice.instrument, number: choice.number, ...partOptions(loaded.xml, choice, pieces[index]) });
        return { xml: part.xml, label: `${numberLabel(part.number)} in ${part.notation}`, parts: 1, tempo, composer };
      },
    });
    if (!result) return;
    done = true;
    if (!result.blob) {
      pdfResult('Kein Stück ließ sich setzen', result.failed, null);
      return;
    }
    const link = document.createElement('a');
    link.className = 'primary';
    link.href = URL.createObjectURL(result.blob);
    link.download = `${fileSafe(`${name} ${scores ? (only === null ? 'Partituren' : 'Partitur') : choiceLabel()}`)}.pdf`;
    link.textContent = 'PDF sichern';
    const notes = table ? '' : ' (ohne Dynamik und Akkordzeichen)';
    pdfResult(`PDF fertig, ${result.pages} ${result.pages === 1 ? 'Seite' : 'Seiten'}${notes}`, result.failed, link);
  } catch (error) {
    done = true;
    pdfResult(`Das PDF lässt sich nicht erstellen (${error?.name === 'ReferenceError' ? 'Browser zu alt' : 'Fehler beim Speichern'})`, [], null);
  } finally {
    work.remove();
    app.pdfBusy = false;
    if (!done) closeSheet();
  }
}

function drawMenu() {
  const format = formatFor(app.settings.format, innerWidth);
  const spacing = spacingFor(app.settings.spacing, format);
  const size = validSize(app.settings.size);
  const last = SPACINGS[SPACINGS.length - 1];
  const score = scoreOn();
  const head = title => `<button class="mhead" data-m="home">${ICON.back}<span>${title}</span></button>`;
  if (menuPage === 'view') {
    $('pmenu').innerHTML = `${head('Ansicht')}
  <div class="mf"><span>Größe</span><div class="sz"><button data-m="smaller" ${size <= SIZES[0] ? 'disabled' : ''} aria-label="Kleiner">−</button><output>${size} %</output><button data-m="bigger" ${size >= MAX_SIZE ? 'disabled' : ''} aria-label="Größer">+</button><button class="fit" data-m="fit">Ganzes Stück</button></div></div>
  <div class="mf"><span>Zeilenabstand</span><div class="sz"><button data-m="closer" ${spacing <= SPACINGS[0] ? 'disabled' : ''} aria-label="Zeilen enger">−</button><output>${spacing <= SPACINGS[0] ? 'eng' : spacing}</output><button data-m="wider" ${spacing >= last ? 'disabled' : ''} aria-label="Zeilen weiter">+</button></div></div>
  <div class="mf"><span>Format</span><div class="seg">${[['auto', 'Automatisch'], ['wide', 'Buch'], ['narrow', 'Handy']].map(([value, label]) => `<button data-m="format" data-v="${value}" class="${app.settings.format === value ? 'on' : ''}">${label}</button>`).join('')}</div></div>`;
    return;
  }
  if (menuPage === 'export') {
    const exportSeg = (key, options) => `<div class="seg">${options.map(([value, text]) => `<button data-m="export-${key}" data-v="${value}" class="${app.exportChoice[key] === value ? 'on' : ''}">${text}</button>`).join('')}</div>`;
    $('pmenu').innerHTML = `${head('Exportieren')}
  <div class="mf"><span>Was</span>${exportSeg('kind', [['part', 'Meine Stimme'], ['score', 'Partitur']])}</div>
  <div class="mf"><span>Umfang</span>${exportSeg('range', [['piece', 'Dieses Stück'], ['binder', 'Ganze Mappe']])}</div>
  <button class="spk" data-m="export">PDF erstellen</button>`;
    return;
  }
  if (menuPage === 'key') {
    $('pmenu').innerHTML = `${head('Transponieren')}
  ${score ? `${scopeControls(app.cur?.piece ?? null)}${keyControls(app.cur?.piece ?? null)}${resetControls()}` : soundControls(autoFor(app.cur?.piece ?? null), app.cur?.piece ?? null)}`;
    return;
  }
  const pieceId = app.cur?.piece ?? null;
  const chosen = score && app.parts.length ? chosenParts(app.parts, app.settings.preset, app.custom.get(pieceId)).length : 0;
  const voice = score
    ? `<button class="sub" data-m="parts"><span>Stimmen der Partitur</span><small>${chosen && chosen < app.parts.length ? `${chosen}/${app.parts.length}` : 'alle'}</small>${ICON.chev}</button>`
    : `<button class="sub" data-m="part"><span>Stimme wechseln</span><small>${esc(app.choice ? numberLabel(app.choice.number) : '')}</small>${ICON.chev}</button>`;
  $('pmenu').innerHTML = `<button class="spk" data-m="play">${ICON.speaker}${player.on ? 'Vorspielen beenden' : 'Vorspielen und mitlesen'}</button>
  ${tablet() ? `<div class="mf"><div class="seg"><button data-m="view" data-v="part" class="${score ? '' : 'on'}">Meine Stimme</button><button data-m="view" data-v="score" class="${score ? 'on' : ''}">Partitur</button></div></div>` : ''}
  ${voice}
  <button class="sub" data-m="page" data-v="view"><span>Ansicht</span><small>${size} %</small>${ICON.chev}</button>
  <button class="sub" data-m="page" data-v="key"><span>Transponieren</span><small>${esc(keyValue(pieceId, score))}</small>${ICON.chev}</button>
  ${record(app.cur?.id)?.virtual ? '' : '<button class="sub" data-m="page" data-v="export"><span>Exportieren</span><small>PDF</small>' + ICON.chev + '</button>'}`;
}

$('pmenu').addEventListener('click', async e => {
  const sound = e.target.closest('button[data-sound]');
  if (sound) {
    if (sound.dataset.sound === 'reset-all') {
      $('pmenu').classList.remove('open');
      confirmReset(() => {
        const pa = $('pa');
        const max = pa.scrollHeight - pa.clientHeight;
        drawPult(max > 0 ? pa.scrollTop / max : 0);
      });
      return;
    }
    const pieceId = app.cur?.piece ?? null;
    const auto = await ensureAuto(pieceId);
    if (pieceId !== (app.cur?.piece ?? null)) return;
    if (changeSound(sound.dataset.sound, pieceId, auto)) {
      const pa = $('pa');
      const max = pa.scrollHeight - pa.clientHeight;
      drawPult(max > 0 ? pa.scrollTop / max : 0);
      drawMenu();
    }
    return;
  }
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  const m = b.dataset.m;
  const pa = $('pa');
  const music = $('music');
  const format = formatFor(app.settings.format, innerWidth);
  if (m === 'page' || m === 'home') {
    menuPage = m === 'page' ? b.dataset.v : null;
    if (menuPage === 'export') app.exportChoice.kind = scoreOn() ? 'score' : 'part';
    drawMenu();
    return;
  }
  if (m === 'export-kind' || m === 'export-range') {
    app.exportChoice[m.slice(7)] = b.dataset.v;
    drawMenu();
    return;
  }
  if (m === 'part' || m === 'parts' || m === 'play' || m === 'export') {
    $('pmenu').classList.remove('open');
    if (m === 'part') partSheet(1);
    else if (m === 'parts') scoreSheet();
    else if (m === 'play') player.toggle();
    else makePdf(app.cur.id, app.exportChoice.kind === 'score', app.exportChoice.range === 'piece' ? app.cur.index : null);
    return;
  }
  if (m === 'view') {
    const want = b.dataset.v === 'score';
    if (want !== app.settings.score) {
      app.settings.score = want;
      drawPult(0);
    }
  } else if (m === 'smaller' || m === 'bigger') {
    const before = validSize(app.settings.size);
    app.settings.size = stepSize(before, m === 'bigger' ? 1 : -1);
    music.style.maxWidth = `${shownWidth(app.settings.size)}%`;
    if (before > 100 || app.settings.size > 100) {
      const max = pa.scrollHeight - pa.clientHeight;
      drawPult(max > 0 ? pa.scrollTop / max : 0);
    }
  } else if (m === 'fit') {
    if (validSize(app.settings.size) > 100) {
      app.settings.size = 100;
      await drawPult(0);
    }
    const ratios = [...music.querySelectorAll('.page svg')].map(svg => {
      const box = svg.viewBox.baseVal;
      return box && box.width ? box.height / box.width : 0;
    });
    app.settings.size = fitSize(ratios, pa.clientWidth - 12, pa.clientHeight - 20);
    music.style.maxWidth = `${shownWidth(app.settings.size)}%`;
    pa.scrollTop = 0;
  } else if (m === 'closer' || m === 'wider') {
    const next = stepSpacing(spacingFor(app.settings.spacing, format), m === 'wider' ? 1 : -1);
    app.settings.spacing = { ...app.settings.spacing, [format]: next };
    space(app.measured, next);
  } else if (m === 'format') {
    app.settings.format = ['auto', 'wide', 'narrow'].includes(b.dataset.v) ? b.dataset.v : 'auto';
    if (formatFor(app.settings.format, innerWidth) !== format) {
      const max = pa.scrollHeight - pa.clientHeight;
      drawPult(max > 0 ? pa.scrollTop / max : 0);
    }
  }
  saveSettings();
  drawMenu();
});

function systemBoxes() {
  const pa = $('pa');
  const top0 = pa.getBoundingClientRect().top - pa.scrollTop;
  return [...pa.querySelectorAll('g.system')].map(g => {
    const box = g.getBoundingClientRect();
    return [box.top - top0, box.bottom - top0];
  });
}

$('pa').addEventListener('click', e => {
  if ($('pmenu').classList.contains('open')) {
    $('pmenu').classList.remove('open');
    return;
  }
  if (!app.cur) return;
  if (player.on) {
    player.tap(e);
    return;
  }
  const pa = $('pa');
  const box = pa.getBoundingClientRect();
  const direction = zoneAt((e.clientX - box.left) / box.width);
  if (direction && !app.settings.helpSeen) {
    app.settings.helpSeen = true;
    saveSettings();
    $('pult').classList.remove('zones-help');
  }
  if (!direction) return;
  const zone = document.querySelector(direction < 0 ? '.fz.l' : '.fz.r');
  zone.classList.remove('flash');
  void zone.offsetWidth;
  zone.classList.add('flash');
  const r = record(app.cur.id);
  const result = turn({ top: pa.scrollTop, height: pa.clientHeight, max: pa.scrollHeight - pa.clientHeight, systems: systemBoxes() }, direction);
  if (result.piece) {
    const next = app.cur.index + result.piece;
    if (next >= 0 && next < r.list.pieces.length) openPult(r.id, next, result.piece < 0);
    else toast(result.piece > 0 ? 'Ende der Mappe' : 'Anfang der Mappe');
    return;
  }
  pa.scrollTo({ top: result.scroll, behavior: 'smooth' });
});

const press = { timer: 0, x: 0, y: 0, held: false };
const swallowClick = e => {
  e.stopPropagation();
  e.preventDefault();
};
function endPress() {
  clearTimeout(press.timer);
  press.timer = 0;
  if (!press.held) return;
  press.held = false;
  setTimeout(() => document.removeEventListener('click', swallowClick, true), 400);
}
$('pa').addEventListener('pointerdown', e => {
  endPress();
  if (!app.cur || player.on || e.button > 0 || $('pmenu').classList.contains('open')) return;
  const box = $('pa').getBoundingClientRect();
  if (zoneAt((e.clientX - box.left) / box.width)) return;
  press.x = e.clientX;
  press.y = e.clientY;
  press.timer = setTimeout(() => {
    press.timer = 0;
    press.held = true;
    document.addEventListener('click', swallowClick, true);
    pieceSheet();
  }, 500);
});
$('pa').addEventListener('pointermove', e => {
  if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress();
});
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, endPress);
$('pa').addEventListener('contextmenu', e => e.preventDefault());

let lastWidth = innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$('pult').classList.contains('open') || innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    const pa = $('pa');
    const max = pa.scrollHeight - pa.clientHeight;
    drawPult(max > 0 ? pa.scrollTop / max : 0);
  }, 150);
});

async function keepAwake() {
  if (document.visibilityState !== 'visible' || app.wakeLock || !$('pult').classList.contains('open')) return;
  try {
    app.wakeLock = await navigator.wakeLock?.request('screen');
    app.wakeLock?.addEventListener('release', () => {
      app.wakeLock = null;
    });
  } catch {
    app.wakeLock = null;
  }
}

function releaseAwake() {
  app.wakeLock?.release().catch(() => {});
  app.wakeLock = null;
}

let refreshing = null;
function refresh() {
  refreshing ||= refreshNow().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function sessionStorageHas(version) {
  try {
    return sessionStorage.getItem('reloadedFor') === version;
  } catch {
    return false;
  }
}

function sessionStorageAdd(version) {
  try {
    sessionStorage.setItem('reloadedFor', version);
  } catch {
    return;
  }
}

function safeToReload() {
  return booted && !updating && !importing && !$('pult').classList.contains('open') && !$('sheet').classList.contains('open') && !app.busy && document.activeElement?.tagName !== 'INPUT';
}

function maybeReload() {
  if (updateReady && safeToReload()) location.reload();
}

async function checkVersion(state) {
  if (!PAGE_VERSION || typeof state?.app !== 'string' || !/^[0-9a-f]{16}$/.test(state.app) || state.app === PAGE_VERSION) return false;
  await navigator.serviceWorker?.getRegistration().then(registration => registration?.update()).catch(() => {});
  return true;
}

async function fetchState() {
  try {
    const response = await fetcher('state.json', { cache: 'no-cache' });
    return { state: response.ok ? await response.json().catch(() => null) : null, offline: false };
  } catch {
    return { state: null, offline: true };
  }
}

async function currentState() {
  return (await fetchState()).state;
}

async function refreshNow({ force = false } = {}) {
  const result = { offline: false, failed: false, changed: false };
  if (!navigator.onLine) return { ...result, offline: true };
  const { state, offline } = await fetchState();
  if (offline) return { ...result, offline: true };
  if (!force) checkVersion(state);
  if (!app.records.length) return result;
  const published = validTime(state?.published) ? state.published : null;
  const seen = await app.store.get('state').catch(() => null);
  if (!force && published && seen === published && app.lastRefresh) return result;
  let current = true;
  let reached = false;
  for (const r of [...app.records]) {
    let loaded;
    try {
      loaded = await loadBinder(fetcher, decodeKey(r.key));
    } catch (error) {
      current = false;
      if (error instanceof OfflineError) result.failed = true;
      else reached = true;
      const now = record(r.id);
      if (error instanceof LockedError && now && !now.locked) {
        await saveRecord({ ...now, locked: true });
        result.changed = true;
      }
      continue;
    }
    reached = true;
    const now = record(r.id);
    if (!now) continue;
    const merged = mergeBinder(now, loaded.list);
    if (merged.rejected || loaded.list.published !== published) current = false;
    if (JSON.stringify(merged.record) !== JSON.stringify(now)) {
      await saveRecord(merged.record);
      result.changed = true;
      if (app.cur?.id === r.id) {
        const index = merged.record.list.pieces.findIndex(p => p.id === app.cur.piece);
        if (index >= 0) app.cur.index = index;
      }
    }
  }
  if (!reached) result.offline = true;
  app.lastRefresh = Date.now();
  if (published && current) await app.store.set('state', published).catch(() => {});
  if (result.changed && !$('pult').classList.contains('open')) render();
  if (result.changed) preload();
  return result;
}

function within(promise, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ late: true, value: null }), ms);
    promise.then(value => resolve({ late: false, value }), () => resolve({ late: false, value: null })).finally(() => clearTimeout(timer));
  });
}

function activated(worker, ms) {
  if (worker.state === 'activated') return Promise.resolve(true);
  if (worker.state === 'redundant') return Promise.resolve(false);
  return new Promise(resolve => {
    const done = value => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', check);
      resolve(value);
    };
    const check = () => {
      if (worker.state === 'activated') done(true);
      else if (worker.state === 'redundant') done(false);
    };
    const timer = setTimeout(() => done(false), ms);
    worker.addEventListener('statechange', check);
  });
}

async function updateShell() {
  const container = navigator.serviceWorker;
  if (!container?.controller) return false;
  if (updateReady) return true;
  const registration = await container.getRegistration().catch(() => null);
  if (!registration) return false;
  let found = null;
  const listen = () => {
    found = registration.installing;
  };
  registration.addEventListener('updatefound', listen);
  try {
    await registration.update();
  } catch {
    return updateReady;
  } finally {
    registration.removeEventListener('updatefound', listen);
  }
  const worker = found || registration.installing || registration.waiting;
  if (!worker) return updateReady;
  return activated(worker, 90000);
}

function noticeAfterReload(text) {
  try {
    sessionStorage.setItem('notice', text);
  } catch {
    return;
  }
}

function takeNotice() {
  try {
    const text = sessionStorage.getItem('notice');
    sessionStorage.removeItem('notice');
    return typeof text === 'string' && text.length <= 200 ? text : null;
  } catch {
    return null;
  }
}

function reloadWith(message) {
  noticeAfterReload(message);
  location.reload();
}

async function updateAll() {
  if (updating) {
    toast('Aktualisieren läuft schon');
    return;
  }
  if (!navigator.onLine) {
    toast(updateMessage({ offline: true }));
    return;
  }
  updating = true;
  toast('Suche nach Neuem …');
  try {
    const shell = updateShell();
    if (refreshing) await refreshing.catch(() => {});
    const before = shown();
    refreshing = refreshNow({ force: true }).finally(() => {
      refreshing = null;
    });
    const result = await refreshing;
    if (result.offline) {
      if ((await within(shell, 20000)).value === true) reloadWith(updateMessage({ version: true }));
      else toast(updateMessage({ offline: true }));
      return;
    }
    await startAdmin();
    const changed = recordsChanged(before, shown());
    downloaded.clear();
    const notes = notesLoaded();
    preload();
    const loaded = await within(notes, 45000);
    const version = (await within(shell, 60000)).value === true;
    const message = updateMessage({
      version, loaded: downloaded.size, changed, pending: loaded.late, failed: result.failed || Boolean(loaded.value?.failed),
    });
    if (version) reloadWith(message);
    else toast(message);
  } catch {
    toast(updateMessage({ failed: true }));
  } finally {
    updating = false;
    setTimeout(maybeReload, 2500);
  }
}

const retried = new Set();
async function loadChecked(piece) {
  try {
    return await loadPiece(fetcher, piece);
  } catch (error) {
    if (!(error instanceof FormatError) || !globalThis.caches || retried.has(piece.list)) throw error;
    retried.add(piece.list);
    const names = [piece.list];
    try {
      names.push((await loadPieceList(fetcher, piece)).list.files.musicxml);
    } catch {
      names.push(app.lists.get(piece.list)?.files.musicxml);
    }
    const cache = await caches.open('data');
    for (const name of names.filter(Boolean)) await cache.delete(new URL(name, location.href).href);
    return loadPiece(fetcher, piece);
  }
}

let preloading = null;
let preloadAgain = false;
let notesWaiters = [];
const downloaded = new Set();

function notesLoaded() {
  return new Promise(resolve => notesWaiters.push(resolve));
}

function notesDone(value) {
  const waiters = notesWaiters;
  notesWaiters = [];
  for (const resolve of waiters) resolve(value);
}

async function cachedNames() {
  if (!globalThis.caches || !navigator.serviceWorker?.controller) return null;
  const base = new URL('.', location.href).href;
  try {
    const keys = await (await caches.open('data')).keys();
    return new Set(keys.map(request => request.url).filter(url => url.startsWith(base)).map(url => url.slice(base.length)));
  } catch {
    return null;
  }
}

async function cached(name) {
  try {
    return Boolean(await caches.match(new URL(name, location.href).href));
  } catch {
    return false;
  }
}

async function warm(piece, file, have) {
  if (have.has(file.name)) return true;
  try {
    await fetchSealed(fetcher, file.name, LIMITS[file.kind]);
  } catch {
    return false;
  }
  downloaded.add(piece.list);
  if (!(await cached(file.name))) return false;
  have.add(file.name);
  return true;
}

async function warmAll(piece, files, have) {
  for (const file of files) if (!(await warm(piece, file, have))) return false;
  return true;
}

async function pieceList(piece, have) {
  if (app.lists.has(piece.list)) return app.lists.get(piece.list);
  try {
    const { list } = await loadPieceList(fetcher, piece);
    app.lists.set(piece.list, list);
    if (!have.has(piece.list)) {
      downloaded.add(piece.list);
      have.add(piece.list);
    }
    return list;
  } catch {
    return null;
  }
}

function showOffline() {
  const line = $('offline');
  if (line) line.textContent = offlineText();
}

function offlineText() {
  const o = app.offline;
  if (!o || !o.total) return '';
  if (o.done >= o.total) return 'Alles offline verfügbar';
  return `Offline: ${o.done} von ${o.total} Stücken${o.running ? '' : ', der Rest lädt mit Netz'}`;
}

async function preloadRound() {
  const have = await cachedNames();
  if (!have) {
    app.offline = null;
    return;
  }
  const pieces = uniquePieces(app.records);
  const state = new Map(pieces.map(piece => [piece.list, { notes: false, audio: false }]));
  const extra = app.admin && app.all ? uniquePieces([{ list: app.all }]).filter(piece => !state.has(piece.list)) : [];
  app.offline = { done: 0, total: pieces.length, running: true };
  const count = () => {
    app.offline.done = [...state.values()].filter(s => s.notes && s.audio).length;
    showOffline();
  };
  count();
  for (const piece of pieces) {
    if (preloadAgain) return;
    const list = await pieceList(piece, have);
    if (!list) continue;
    state.get(piece.list).notes = await warmAll(piece, missingFiles(list, ['musicxml', 'timing'], have), have);
    count();
  }
  for (const piece of extra) {
    if (preloadAgain) return;
    const list = await pieceList(piece, have);
    if (list) await warmAll(piece, missingFiles(list, ['musicxml', 'timing'], have), have);
  }
  if (preloadAgain) return;
  notesDone({ failed: [...state.values()].filter(s => !s.notes).length });
  for (const piece of pieces) {
    if (preloadAgain) return;
    const list = app.lists.get(piece.list);
    if (!list) continue;
    state.get(piece.list).audio = await warmAll(piece, missingFiles(list, ['audio'], have), have);
    count();
  }
  app.offline.running = false;
  count();
}

function preload() {
  if (preloading) {
    preloadAgain = true;
    return preloading;
  }
  preloading = (async () => {
    do {
      preloadAgain = false;
      await preloadRound();
    } while (preloadAgain);
    await cleanup();
  })().catch(() => {}).finally(() => {
    preloading = null;
    notesDone(null);
    if (app.offline) app.offline.running = false;
    showOffline();
  });
  return preloading;
}

async function cleanup() {
  if (!app.store.persistent || !navigator.serviceWorker?.controller) return;
  const stored = await app.store.binders().catch(() => null);
  if (!stored) return;
  const records = stored.map(checkRecord);
  if (records.some(r => !r)) return;
  const all = allRecord();
  const files = keepFiles(all ? [...records, all] : records, app.lists);
  if (files) navigator.serviceWorker.controller.postMessage({ type: 'keep', files });
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function homeHint() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (app.settings.homeHint || standalone || !isIos() || !app.records.length) return;
  app.settings.homeHint = true;
  saveSettings();
  const sh = $('sheet');
  sh.innerHTML = `<div class="box"><h3>Zum Home-Bildschirm</h3><p>Leg Paul's Ständchenmappe auf deinen Home-Bildschirm. Sonst löscht das iPhone deine Mappen, wenn du die App ein paar Tage nicht öffnest.</p>
  <ol class="hint-steps"><li>Unten auf „Teilen“ tippen</li><li>„Zum Home-Bildschirm“ wählen</li><li>Ständchen dann immer über das Symbol öffnen</li></ol>
  <button class="primary" data-close>Verstanden</button></div>`;
  sh.classList.add('open');
  sh.onclick = e => {
    if (e.target === sh || e.target.closest('[data-close]')) closeSheet();
  };
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (framed) return;
  if (!controlled) {
    controlled = true;
    if (app.store) preload();
    return;
  }
  updateReady = true;
  maybeReload();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeTitleMenu();
  $('pmenu').classList.remove('open');
  const sh = $('sheet');
  if (sh.classList.contains('open')) sh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

document.addEventListener('visibilitychange', () => {
  if (framed || !app.store || document.visibilityState !== 'visible') return;
  maybeReload();
  keepAwake();
  if (Date.now() - app.lastRefresh > REFRESH_EVERY) refresh();
});
window.addEventListener('hashchange', () => {
  if (framed) return;
  const hash = location.hash;
  if (hash) history.replaceState(null, '', location.pathname + location.search);
  started.then(() => importFromHash(hash));
});

async function start() {
  if (framed) {
    document.body.replaceChildren();
    return;
  }
  if (isSecureContext && navigator.serviceWorker) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  app.store = await openStore();
  try {
    const response = await fetcher(new URL('../instruments.json', import.meta.url).href);
    app.instruments = parseInstruments(await response.json());
  } catch {
    app.instruments = [];
  }
  app.records = (await app.store.binders().catch(() => [])).map(checkRecord).filter(Boolean);
  const settings = await app.store.get('settings').catch(() => null);
  if (settings && typeof settings === 'object') Object.assign(app.settings, settings);
  app.choice = validChoice(app.instruments, await app.store.get('choice').catch(() => null));
  render();
  const notice = takeNotice();
  if (notice) toast(notice);
  if (!app.instruments.length) toast('Die Instrumente lassen sich nicht laden');
  await importFromHash(initialHash);
  startAdmin().then(() => {
    if (app.admin) loadVerovio().catch(() => {});
  });
  if (app.records.length) {
    navigator.storage?.persist?.().catch(() => {});
    homeHint();
    refresh().finally(preload);
    loadVerovio().catch(() => {});
  }
}

const started = start().catch(() => {}).finally(() => {
  booted = true;
  setTimeout(maybeReload, 0);
});
