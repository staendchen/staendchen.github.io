import {
  IDLE_MS, PALETTE, NOTATIONS, STATUS_LABELS, KINDS, EditorError, GitHubError,
  fetchVault, unlock, reopen, remembered, loadLibrary, editorAccess, fetchSealed, binderSecrets, songSecrets, applyOps, Draft, problemsOf,
  changesSubmission, fileSubmission, fileProblem, newSubmissionId, github, submit, commitFiles, submittedFolders, readBlobJson,
  describeSubmission, keepSubmitted, qualityOf, partTable, formatDate, titleFromFile, cleanText, LIMITS, previewParts,
} from './editor-core.mjs';
import { qrMatrix, qrSvg } from './qr.mjs';
import { shareBinder, shareText } from './share.mjs';
import { openStore } from './store.mjs';
import { loadPiece, parseInstruments } from './client.mjs';
import { cardFile } from './card.mjs';
import { engrave } from './engrave.mjs';
import { selectParts } from '../lib/rewrite.mjs';
import { BEAT_WORDS, BPM, tempoProblem, tempoText, tempoFromMusicXml } from '../lib/tempo.mjs';
import { syncAdminBinders, browserLogin, adminLogout, adminExclusive } from './admin.mjs';

const DRAFT_KEY = 'staendchen-editor-draft';
const SUBMITTED_KEY = 'staendchen-editor-submitted';
const TABS = [['library', 'Bibliothek'], ['collections', 'Sammlungen'], ['binders', 'Mappen']];
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  library: [['path', { d: 'M5 4h3v16H5zM10 4h3v16h-3zM15.5 4.5l2.9-.8 3.6 15.5-2.9.8z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linejoin': 'round' }]],
  collections: [[3, 3], [13, 3], [3, 13], [13, 13]].map(([x, y]) => ['rect', { x, y, width: 8, height: 8, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9' }]),
  binders: [['rect', { x: 4, y: 4, width: 16, height: 17, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9' }], ['path', { d: 'M8 2.5v3M16 2.5v3M8 11h8M8 15h5', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round' }]],
  grip: [[6, 4], [12, 4], [6, 9], [12, 9], [6, 14], [12, 14]].map(([cx, cy]) => ['circle', { cx, cy, r: 1.6, fill: 'currentColor' }]),
  chevron: [['path', { d: 'M3 5l4 4 4-4', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
};

const ROOT = new URL('../', document.baseURI);
const siteFetch = (name, options) => window.fetch(new URL(name, ROOT), options);
const $ = id => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'color') node.style.setProperty('--c', value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(child => child !== undefined && child !== null && child !== false));
  return node;
}

function icon(name, box = 24) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${box} ${box}`);
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}

const S = {
  vault: null, master: null, token: null, rememberedLogin: false, library: null, base: null, view: null, draft: new Draft(), submitted: [],
  tab: 'library', sel: null, query: '', filters: {}, collectionOccasion: null, upload: null, subs: null, subsLoading: false,
  secrets: new Map(), lastActivity: Date.now(),
};

let toastTimer;
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

const loadLogin = () => browserLogin.load();
const saveLogin = value => browserLogin.save(value);

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function recompute() {
  S.base = applyOps(S.library, S.submitted.flatMap(entry => entry.ops));
  S.view = applyOps(S.base, S.draft.ops());
  writeLocal(DRAFT_KEY, S.draft.count ? S.draft.entries : null);
  writeLocal(SUBMITTED_KEY, S.submitted.length ? S.submitted : null);
}

function show(screen) {
  $('login').hidden = screen !== 'login';
  $('loading').hidden = screen !== 'loading';
  $('app').hidden = screen !== 'app';
  $('publish').hidden = screen !== 'app' || S.draft.count === 0;
}

function loading(text, { actions = false } = {}) {
  $('loading-text').textContent = text;
  $('loading-actions').hidden = !actions;
  show('loading');
}

$('loading-retry').addEventListener('click', () => location.reload());
$('loading-logout').addEventListener('click', () => logout());

async function boot() {
  loading('Einen Moment …');
  try {
    S.vault = await fetchVault(siteFetch);
  } catch (error) {
    loading(error.message, { actions: true });
    return;
  }
  const saved = await loadLogin();
  S.expires = saved?.expires ?? null;
  const content = saved ? await reopen(S.vault, saved) : null;
  if (saved && !content) await adminLogout({ store: await openStore().catch(() => null) });
  if (content) {
    await start(content, true);
    return;
  }
  show('login');
  try {
    if (sessionStorage.getItem('staendchen-editor-idle')) {
      sessionStorage.removeItem('staendchen-editor-idle');
      $('login-hint').textContent = 'Nach 30 Minuten ohne Eingabe abgemeldet. Nicht veröffentlichte Änderungen bleiben auf diesem Gerät.';
    }
  } catch {
    $('login-hint').textContent = '';
  }
  $('login-password').focus();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('login-password');
  const button = $('login-button');
  $('login-hint').textContent = '';
  button.disabled = true;
  button.textContent = 'Wird geprüft …';
  try {
    const { key, content } = await unlock(S.vault, input.value);
    input.value = '';
    const login = remembered(S.vault, key);
    S.expires = login.expires;
    await saveLogin(login);
    await start(content, true);
  } catch (error) {
    $('login-hint').textContent = error instanceof EditorError ? error.message : 'Anmelden ging nicht.';
  } finally {
    button.disabled = false;
    button.textContent = 'Anmelden';
  }
});

async function start(content, rememberedLogin) {
  S.master = content.master;
  S.token = content.token;
  S.rememberedLogin = rememberedLogin;
  S.lastActivity = Date.now();
  S.draft = new Draft(readLocal(DRAFT_KEY) ?? []);
  const submitted = readLocal(SUBMITTED_KEY);
  S.submitted = Array.isArray(submitted) ? submitted.filter(e => e && typeof e.id === 'string' && Number.isFinite(e.time) && Array.isArray(e.ops)) : [];
  await reload();
}

async function reload() {
  loading('Bibliothek wird geladen …');
  try {
    S.library = await loadLibrary(siteFetch, S.master);
  } catch (error) {
    loading(error instanceof EditorError ? error.message : 'Die Bibliothek lässt sich nicht laden.', { actions: true });
    return;
  }
  recompute();
  show('app');
  const jump = new URLSearchParams(location.hash.slice(1)).get('binder');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (jump && S.view.binders.has(jump)) {
    S.tab = 'binders';
    select({ type: 'binder', id: jump });
  } else render();
  refreshSubmissions();
  syncDevice();
}

let syncing = null;
function syncDevice() {
  if (syncing || !S.master || !S.library || !S.rememberedLogin) return syncing;
  const binders = [...S.library.binders.values()];
  syncing = (async () => {
    try {
      const store = await openStore();
      if (!store.persistent) return;
      const result = await adminExclusive(() => syncAdminBinders({ store, binders, keyFor: async binder => (await secretsFor(binder)).key, fetcher: siteFetch }));
      if (result.added || result.removed) toast(`Meine Mappen auf diesem Gerät: ${result.added} dazu, ${result.removed} entfernt`);
    } catch {
      toast('Meine Mappen auf diesem Gerät ließen sich nicht abgleichen');
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

function logout() {
  const leave = async () => {
    S.master = null;
    S.token = null;
    S.library = null;
    S.secrets.clear();
    S.draft = new Draft();
    S.submitted = [];
    writeLocal(DRAFT_KEY, null);
    writeLocal(SUBMITTED_KEY, null);
    await syncing?.catch(() => {});
    await adminLogout({ store: await openStore().catch(() => null) });
    location.href = ROOT.href;
  };
  if (!S.draft.count) {
    leave();
    return;
  }
  dialog('Abmelden?', [h('p', { text: `${S.draft.count} nicht veröffentlichte ${S.draft.count === 1 ? 'Änderung geht' : 'Änderungen gehen'} verloren.` })], [
    ['Abbrechen'], ['Abmelden', 'danger', leave],
  ]);
}

function toMusicians() {
  S.leaving = true;
  location.href = ROOT.href;
}

function idleCheck() {
  if (!S.master || S.rememberedLogin || Date.now() - S.lastActivity <= IDLE_MS) return false;
  S.master = null;
  S.token = null;
  S.library = null;
  S.base = null;
  S.view = null;
  S.leaving = true;
  S.secrets.clear();
  document.body.replaceChildren();
  try {
    sessionStorage.setItem('staendchen-editor-idle', '1');
  } catch {
    location.reload();
    return true;
  }
  location.reload();
  return true;
}
for (const type of ['pointerdown', 'keydown', 'input']) {
  document.addEventListener(type, event => {
    if (idleCheck()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    S.lastActivity = Date.now();
  }, { capture: true });
}
document.addEventListener('visibilitychange', idleCheck);
setInterval(idleCheck, 30000);
window.addEventListener('beforeunload', event => {
  if (S.draft.count && !S.leaving) event.preventDefault();
});

const pieceOf = id => S.view.pieces.get(id);
const collectionOf = id => S.view.collections.find(c => c.id === id);
const sortedPieces = list => [...list].sort((a, b) => a.title.localeCompare(b.title, 'de'));
const pendingOf = id => S.submitted.some(e => e.ops.some(op => op.id === id)) || S.draft.entries.some(op => op.id === id);

function dots(piece) {
  return h('span', { class: 'dots' }, piece.collections.map(collectionOf).filter(Boolean).map(c => h('i', { color: c.color })));
}
function qualityTag(piece) {
  return piece.kind === 'melody' ? h('span', { class: 'tag mel', text: 'Melodie' }) : h('span', { class: 'tag par', text: 'Partitur' });
}
function statusTag(piece) {
  return piece.status === 'draft' ? h('span', { class: 'tag work', text: 'in Arbeit' }) : null;
}
function pieceItem(piece, { selected = false, onclick } = {}) {
  return h('button', { class: `item${selected ? ' on' : ''}`, onclick },
    h('span', { class: 't' }, h('b', { text: piece.title }), h('small', {}, dots(piece), piece.occasions.join(', '))),
    piece.kind === 'melody' ? qualityTag(piece) : null, ' ', statusTag(piece));
}

function titleButton(label) {
  return h('button', { class: 'tt', onclick: event => openMenu(event.currentTarget) }, label, icon('chevron', 14));
}

function openMenu(anchor) {
  const menu = $('menu');
  fill(menu,
    h('div', { class: 'dim', text: S.expires ? `Redaktion, angemeldet bis ${formatDate(new Date(S.expires).toISOString(), false)}` : 'Redaktion, angemeldet' }),
    h('button', { text: 'Aktualisieren', onclick: () => { closeMenu(); reload(); } }),
    h('button', { text: 'Redaktion beenden', onclick: () => { closeMenu(); toMusicians(); } }),
    h('div', { class: 'sep' }),
    h('button', { text: 'Abmelden', onclick: () => { closeMenu(); logout(); } }),
  );
  const box = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 250))}px`;
  menu.style.top = `${box.bottom + 6}px`;
  menu.classList.add('open');
  setTimeout(() => document.addEventListener('click', function close(event) {
    if (!event.target.closest('#menu') || event.target.closest('button')) {
      closeMenu();
      document.removeEventListener('click', close, true);
    }
  }, true), 0);
}
const closeMenu = () => $('menu').classList.remove('open');

let dialogBusy = false;
function dialog(title, body, actions, onopen) {
  const box = h('div', { class: 'box' }, h('h3', { text: title }), body,
    h('div', { class: 'acts' }, actions.map(([label, style, run]) => h('button', { class: `btn${style ? ` ${style}` : ''}`, text: label, type: 'button', onclick: async event => {
      if (dialogBusy) return;
      if (!run) return closeDialog();
      const buttons = [...box.querySelectorAll('.acts button')];
      dialogBusy = true;
      for (const button of buttons) button.disabled = true;
      try {
        if (await run() !== false) closeDialog();
      } finally {
        dialogBusy = false;
        for (const button of buttons) button.disabled = false;
      }
    } }))));
  const node = $('dialog');
  fill(node, box);
  node.classList.add('open');
  node.onclick = event => { if (event.target === node && !dialogBusy) closeDialog(); };
  setTimeout(() => node.querySelector('input')?.focus(), 50);
  onopen?.(box);
  return box;
}
const closeDialog = () => $('dialog').classList.remove('open');

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  closeMenu();
  if (!dialogBusy) closeDialog();
});

function render() {
  if (!S.view) return;
  $('publish').hidden = S.draft.count === 0;
  $('publish').textContent = `${S.draft.count} ${S.draft.count === 1 ? 'Änderung' : 'Änderungen'} · Veröffentlichen`;
  fill($('side'),
    h('button', { class: 'brand tt', onclick: event => openMenu(event.currentTarget) }, 'Ständchen', icon('chevron', 14)),
    h('div', { class: 'who', text: 'Redaktion' }),
    TABS.map(([key, label]) => h('button', { class: `nav${S.tab === key ? ' on' : ''}`, onclick: () => selectTab(key) }, icon(key), label)),
    h('div', { class: 'grow' }),
    h('button', { class: 'small strong', text: 'Redaktion beenden', onclick: toMusicians }),
    h('button', { class: 'small', text: 'Abmelden', onclick: logout }),
  );
  fill($('tabs'), TABS.map(([key, label]) => h('button', { class: S.tab === key ? 'on' : '', onclick: () => selectTab(key) }, icon(key), label)));
  renderList();
  renderDetail();
}

function renderList() {
  const list = S.tab === 'library' ? libraryList() : S.tab === 'collections' ? collectionList() : binderList();
  fill($('list'), list);
}

function selectTab(tab) {
  S.tab = tab;
  S.sel = null;
  document.body.classList.remove('push');
  render();
  $('list').scrollTop = 0;
}

function select(sel) {
  S.sel = sel;
  render();
  document.body.classList.add('push');
  $('detail').scrollTop = 0;
}

function selName(sel) {
  if (sel?.type === 'piece') return pieceOf(sel.id)?.title;
  if (sel?.type === 'collection') return collectionOf(sel.id)?.name;
  if (sel?.type === 'binder') return S.view.binders.get(sel.id)?.name;
  return null;
}

function jump(tab, sel) {
  const name = selName(S.sel);
  const from = name ? { tab: S.tab, sel: { type: S.sel.type, id: S.sel.id }, name } : null;
  S.tab = tab;
  select({ ...sel, from });
}

function libraryList() {
  const f = S.filters;
  const query = S.query.trim().toLowerCase();
  const all = [...S.view.pieces.values()];
  const shown = sortedPieces(all.filter(p => (!query || p.title.toLowerCase().includes(query)) && (!f.status || p.status === f.status)
    && (!f.kind || p.kind === f.kind) && (!f.collection || p.collections.includes(f.collection))));
  const seg = (key, options) => h('div', { class: 'seg fseg' }, [['', 'Alle'], ...options].map(([value, label]) =>
    h('button', { class: (f[key] ?? '') === value ? 'on' : '', text: label, onclick: () => { S.filters = { ...f, [key]: value || null }; renderList(); } })));
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Titel suchen', value: S.query, oninput: event => {
    S.query = event.target.value;
    const position = event.target.selectionStart;
    renderList();
    const again = $('list').querySelector('.search');
    again.focus();
    again.setSelectionRange(position, position);
  } });
  const active = f.status || f.kind || f.collection || query;
  return [
    h('div', { class: 'lhead' }, h('h1', {}, titleButton('Bibliothek')), h('button', { class: 'btn accent', text: '↑ Neues Stück', onclick: () => { S.upload = null; select({ type: 'upload' }); } })),
    search,
    h('div', { class: 'filters' },
      h('div', { class: 'frow' }, h('span', { text: 'Status' }), seg('status', [['draft', 'in Arbeit'], ['checked', 'geprüft']])),
      h('div', { class: 'frow' }, h('span', { text: 'Güte' }), seg('kind', [['melody', 'Melodie'], ['score', 'Partitur']])),
      h('div', { class: 'frow top' }, h('span', { text: 'Sammlung' }), h('div', { class: 'wrap' },
        h('button', { class: `chip${!f.collection ? ' on' : ''}`, text: 'Alle', onclick: () => { S.filters = { ...f, collection: null }; renderList(); } }),
        S.view.collections.map(c => h('button', { class: `chip${f.collection === c.id ? ' on' : ''}`, onclick: () => { S.filters = { ...f, collection: c.id }; renderList(); } }, h('span', { class: 'dot', color: c.color }), c.name))))),
    h('div', { class: 'fcount' }, h('span', { text: `${shown.length} von ${all.length} Stücken` }),
      active ? h('button', { text: 'Filter zurücksetzen', onclick: () => { S.filters = {}; S.query = ''; renderList(); } }) : null),
    shown.length ? shown.map(p => pieceItem(p, { selected: S.sel?.type === 'piece' && S.sel.id === p.id, onclick: () => select({ type: 'piece', id: p.id }) }))
      : h('div', { class: 'empty', text: 'Kein Stück passt' }),
  ];
}

function collectionList() {
  return [
    h('div', { class: 'lhead' }, h('h1', {}, titleButton('Sammlungen')), h('button', { class: 'btn accent', text: '+ Neue Sammlung', onclick: newCollection })),
    h('div', { class: 'grid' },
      S.view.collections.map(c => {
        const count = [...S.view.pieces.values()].filter(p => p.collections.includes(c.id)).length;
        return h('button', { class: `tile${S.sel?.type === 'collection' && S.sel.id === c.id ? ' on' : ''}`, color: c.color, onclick: () => select({ type: 'collection', id: c.id }) },
          h('b', { text: c.name }), h('small', { text: `${count} Stücke` }));
      })),
    h('p', { class: 'meta', text: 'Nur die Redaktion sieht Sammlungen. Ein Stück kann in mehreren Sammlungen sein.' }),
  ];
}

function binderList() {
  const binders = [...S.view.binders.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return [
    h('div', { class: 'lhead' }, h('h1', {}, titleButton('Mappen')), h('button', { class: 'btn accent', text: '+ Neue Mappe', onclick: newBinder })),
    binders.length ? binders.map(b => h('button', { class: `item${S.sel?.type === 'binder' && S.sel.id === b.id ? ' on' : ''}`, onclick: () => select({ type: 'binder', id: b.id }) },
      h('span', { class: 't' }, h('b', { text: b.name }), h('small', { text: `${b.pieces.length} Stücke · ${b.keyCreated ? `Passwort vom ${formatDate(b.keyCreated, false)}` : 'neues Passwort, noch nicht veröffentlicht'}` })),
      b.pieces.some(id => pieceOf(id)?.status === 'draft') ? h('span', { class: 'tag work', text: 'in Arbeit' }) : null))
      : h('div', { class: 'empty', text: 'Noch keine Mappe' }),
  ];
}

function renderDetail() {
  const detail = $('detail');
  const tabLabel = TABS.find(([key]) => key === S.tab)[1];
  const back = (label, run) => h('div', { class: 'backbar' }, h('button', { text: `‹ ${label}`, onclick: run }));
  const pop = () => { document.body.classList.remove('push'); };
  const sel = S.sel;
  let content = null;
  const from = sel?.from && selName(sel.from.sel) ? sel.from : null;
  const home = from ? back(selName(from.sel), () => { S.tab = from.tab; select(from.sel); }) : back(tabLabel, pop);
  if (sel?.type === 'piece' && pieceOf(sel.id)) content = [home, pieceDetail(pieceOf(sel.id))];
  else if (sel?.type === 'upload') {
    const piece = S.upload?.piece ? pieceOf(S.upload.piece) : null;
    content = [back(piece ? piece.title : tabLabel, piece ? () => { S.upload = null; select({ type: 'piece', id: piece.id }); } : pop), uploadView()];
  } else if (sel?.type === 'collection' && collectionOf(sel.id)) content = [home, collectionDetail(collectionOf(sel.id))];
  else if (sel?.type === 'binder' && S.view.binders.get(sel.id)) content = [home, binderDetail(S.view.binders.get(sel.id))];
  if (!content) {
    S.sel = null;
    document.body.classList.remove('push');
    fill(detail, h('div', { class: 'empty', text: S.tab === 'library' ? 'Stück auswählen' : S.tab === 'collections' ? 'Sammlung auswählen' : 'Mappe auswählen' }));
    return;
  }
  fill(detail, content.flat());
}

function change(run) {
  run();
  recompute();
  render();
}

function textEdit(value, max, what, apply, extra = {}) {
  return h('input', { class: 'title-in', value, maxlength: max, ...extra, onchange: event => {
    const text = event.target.value.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!cleanText(text, max)) {
      event.target.value = value;
      toast(`${what} braucht 1 bis ${max} Zeichen`);
      return;
    }
    change(() => apply(text));
  } });
}

function pieceDetail(piece) {
  const inBinders = [...S.view.binders.values()].map(b => [b, b.pieces.indexOf(piece.id)]).filter(([, i]) => i >= 0);
  const known = [...new Set([...S.view.pieces.values()].flatMap(p => p.occasions))].filter(o => !piece.occasions.includes(o)).sort((a, b) => a.localeCompare(b, 'de'));
  const setPiece = (key, value) => change(() => S.draft.setPiece(S.base, piece.id, key, value));
  const table = partTable(piece.parts);
  const occasionInput = h('input', { list: 'occasion-list', placeholder: '+ Anlass', maxlength: 60, onchange: event => {
    const text = event.target.value.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!cleanText(text, 60)) return toast('Ein Anlass hat 1 bis 60 Zeichen');
    if (!piece.occasions.includes(text)) setPiece('occasions', [...piece.occasions, text]);
  }, onkeydown: event => { if (event.key === 'Enter') event.target.blur(); } });
  return [
    h('div', { class: 'dhead' }, h('div', { class: 'grow' },
      textEdit(piece.title, 200, 'Der Titel', text => S.draft.setPiece(S.base, piece.id, 'title', text)),
      h('div', { class: 'meta' }, 'Kennung ', h('code', { text: piece.id }), ', ändert sich nie')), h('div', {}, qualityTag(piece))),
    h('div', { class: 'sec' }, h('h2', { text: 'Status' }), h('div', { class: 'seg' }, Object.entries(STATUS_LABELS).map(([value, label]) =>
      h('button', { class: piece.status === value ? 'on' : '', text: label, onclick: () => setPiece('status', value) })))),
    h('div', { class: 'sec' }, h('h2', { text: 'Sammlungen' }), S.view.collections.map(c => h('button', {
      class: `colchip${piece.collections.includes(c.id) ? ' on' : ''}`, color: c.color, text: c.name,
      onclick: () => setPiece('collections', piece.collections.includes(c.id) ? piece.collections.filter(x => x !== c.id) : [...piece.collections, c.id]),
    }))),
    h('div', { class: 'sec' }, h('h2', { text: 'Anlass' }),
      piece.occasions.map(o => h('span', { class: 'occ' }, o, h('button', { 'aria-label': `${o} entfernen`, text: '✕', onclick: () => setPiece('occasions', piece.occasions.filter(x => x !== o)) }))),
      h('span', { class: 'occ-add' }, occasionInput, h('datalist', { id: 'occasion-list' }, known.map(o => h('option', { value: o }))))),
    h('div', { class: 'sec' }, h('div', { class: 'list-head' }, h('h2', { text: 'In Mappen' }), h('button', { class: 'linkbtn', text: '+ Zu Mappe hinzufügen', onclick: () => addToBinder(piece) })), inBinders.length
      ? inBinders.map(([b, i]) => h('div', { class: 'meta' }, h('button', { class: 'linkbtn', text: b.name, onclick: () => jump('binders', { type: 'binder', id: b.id }) }), `, Nr. ${i + 1}`))
      : h('div', { class: 'meta', text: 'In keiner Mappe' })),
    songShare(piece),
    h('div', { class: 'sec' }, h('h2', { text: 'Stimmen' }), table.length ? [
      h('table', { class: 'vt' }, h('tr', {}, h('th'), NOTATIONS.map(n => h('th', { text: n }))),
        table.map(row => h('tr', {}, h('td', { text: row.number }), row.notations.map(o => h('td', { class: o ? 'o' : 'u', text: o ? '●' : '○' }))))),
      h('div', { class: 'legend', text: '● original in der .mscz, ○ von der App umgeschrieben (Ersatzregel)' }),
    ] : h('div', { class: 'meta', text: 'Noch keine Stimmen bekannt' })),
    h('div', { class: 'sec' }, h('h2', { text: 'Partitur in C' }), preview(S.library.pieces.get(piece.id))),
    tempoSection(piece),
    octaveSection(piece),
    h('div', { class: 'sec' }, h('h2', { text: 'Noten ändern' }),
      h('div', { class: 'step', text: '1. Herunterladen, in MuseScore öffnen und ändern' }),
      h('div', { class: 'brow' }, h('button', { class: 'btn', text: piece.kind === 'melody' ? '↓ Melodie' : '↓ Partitur', disabled: !piece.mscz, onclick: () => download(piece) })),
      piece.mscz ? null : h('div', { class: 'meta', text: 'Die Datei kommt mit der nächsten Veröffentlichung.' }),
      h('div', { class: 'step', text: '2. Die geänderte Datei zurückschicken' }),
      h('div', { class: 'brow' }, piece.kind === 'melody'
        ? [h('button', { class: 'btn up', text: '↑ Melodie hochladen', onclick: () => startUpload('melody', piece.id) }), h('button', { class: 'btn up', text: '↑ Als fertige Partitur hochladen', onclick: () => startUpload('score', piece.id) })]
        : h('button', { class: 'btn up', text: '↑ Partitur hochladen', onclick: () => startUpload('score', piece.id) }))),
  ];
}

function songSecretsFor(piece) {
  const cacheKey = `song|${piece.id}|${piece.shareVersion ?? 0}`;
  if (!S.secrets.has(cacheKey)) {
    S.secrets.set(cacheKey, songSecrets(S.master, piece).catch(error => {
      S.secrets.delete(cacheKey);
      throw error;
    }));
  }
  return S.secrets.get(cacheKey);
}

let instrumentsLoad = null;
function cardInstruments() {
  instrumentsLoad ??= window.fetch(new URL('../instruments.json', import.meta.url), { cache: 'no-cache' })
    .then(response => (response.ok ? response.json() : Promise.reject(new Error('instruments missing'))))
    .then(parseInstruments)
    .catch(() => {
      instrumentsLoad = null;
      return [];
    });
  return instrumentsLoad;
}

const songCards = new Map();
function songCard(published, link) {
  const cacheKey = `${link}|${published.mark}|${published.title}`;
  if (!songCards.has(cacheKey)) {
    songCards.set(cacheKey, cardInstruments().then(instruments => cardFile({ title: published.title, link, pieces: [published], instruments, load: pieceXml })).catch(error => {
      songCards.delete(cacheKey);
      throw error;
    }));
  }
  return songCards.get(cacheKey);
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function shareSongCard(published, secrets) {
  toast('Karte wird erstellt …');
  let file;
  try {
    file = await songCard(published, secrets.link);
  } catch {
    toast('Die Karte ließ sich nicht erstellen');
    return;
  }
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], text: shareText({ name: published.title, link: secrets.link, song: true }) }).catch(() => {});
    return;
  }
  saveFile(file);
  toast('Karte als Bild gespeichert');
}

async function shareSongLink(published, secrets) {
  try {
    if (await shareBinder({ name: published.title, link: secrets.link, song: true }) === 'copied') toast('Text mit Link kopiert');
  } catch {
    toast('Teilen ging nicht');
  }
}

function songShare(piece) {
  const published = S.library.pieces.get(piece.id);
  const head = h('h2', { text: 'Lied teilen' });
  if (!published?.key || !published.list) return h('div', { class: 'sec' }, head, h('div', { class: 'meta', text: 'Teilen geht, sobald das Stück veröffentlicht ist.' }));
  const unpublished = (piece.shareVersion ?? 0) !== (published.shareVersion ?? 0);
  const qr = h('button', { class: 'qr', 'aria-label': 'QR-Code groß zeigen' });
  const link = h('input', { class: 'linkf', readonly: true, value: '' });
  const ready = songSecretsFor(piece);
  ready.then(secrets => {
    link.value = secrets.link;
    fill(qr, qrImage(secrets.link));
  }, () => { link.value = 'Link ließ sich nicht berechnen'; });
  const withLink = run => () => ready.then(run, () => toast('Link ließ sich nicht berechnen'));
  qr.addEventListener('click', withLink(secrets => dialog(published.title, [
    h('p', { text: 'Mit der Kamera scannen, dann öffnet sich dieses Lied.' }), h('div', { class: 'qrbig' }, qrImage(secrets.link)),
  ], [['Karte teilen', '', () => { shareSongCard(published, secrets); return false; }], ['Fertig', 'primary']])));
  return h('div', { class: 'sec' }, head, h('div', { class: 'share' },
    h('div', { class: 'qrrow' }, qr, h('div', { class: 'qrside' },
      h('small', { text: 'QR-Code mit dem Link zu diesem einen Lied. Antippen zeigt ihn groß. Die Karte zeigt Titel, die ersten Takte und den QR-Code.' }),
      h('button', { class: 'btn', text: 'Karte teilen', onclick: withLink(secrets => shareSongCard(published, secrets)) }))),
    h('div', { class: 'row' }, link, h('button', { class: 'btn primary', text: 'Link teilen', onclick: withLink(secrets => shareSongLink(published, secrets)) })),
    h('small', { text: 'Der Link öffnet nur dieses Lied, mit allen Stimmen, Partitur und Aufnahme. Korrekturen kommen über denselben Link an.' }),
    unpublished ? h('small', { text: 'Dieser Link gilt erst, wenn die Änderungen veröffentlicht sind.' }) : null,
    h('div', { class: 'row' }, h('span', { class: 'grow' }, h('small', { text: 'Link erneuern sperrt den bisherigen Lied-Link. Mappen mit diesem Lied bleiben, wie sie sind.' })),
      h('button', { class: 'btn danger', text: 'Link erneuern', disabled: unpublished, onclick: () => renewSong(piece) })),
    h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Als Musiker ansehen', disabled: unpublished, onclick: withLink(secrets => window.open(secrets.link, '_blank', 'noopener,noreferrer')) }))));
}

function renewSong(piece) {
  dialog(`Link für ${piece.title} erneuern?`, [
    h('p', { text: 'Das Lied bekommt einen neuen Link. Der bisherige Lied-Link geht nach dem Veröffentlichen nicht mehr, auch korrigierte Fassungen kommen dort nicht mehr an. Wer weiter spielen soll, braucht den neuen Link. Mappen mit diesem Lied bleiben, wie sie sind.' }),
  ], [['Abbrechen'], ['Erneuern', 'danger', () => {
    change(() => S.draft.renewSong(S.base, piece.id));
    toast('Neuer Link erzeugt, gilt nach dem Veröffentlichen');
    return true;
  }]]);
}

function addToBinder(piece) {
  const binders = [...S.view.binders.values()].filter(b => !b.pieces.includes(piece.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!binders.length) {
    toast('Das Stück ist schon in allen Mappen');
    return;
  }
  dialog(`${piece.title} zu Mappe hinzufügen`, [
    h('div', { class: 'pick' }, binders.map(b => h('button', { class: 'item', onclick: () => {
      closeDialog();
      change(() => S.draft.setBinder(S.base, b.id, 'pieces', [...S.view.binders.get(b.id).pieces, piece.id]));
      toast(`In „${b.name}“ als Nr. ${S.view.binders.get(b.id).pieces.length}`);
    } }, h('span', { class: 't' }, h('b', { text: b.name }), h('small', { text: `${b.pieces.length} Stücke` }))))),
  ], [['Abbrechen']]);
}

const xmls = new Map();
function pieceXml(piece) {
  const cacheKey = `${piece.id}|${piece.mark}`;
  if (!xmls.has(cacheKey)) {
    xmls.set(cacheKey, loadPiece(siteFetch, piece).then(result => result.xml).catch(error => {
      xmls.delete(cacheKey);
      throw error;
    }));
  }
  return xmls.get(cacheKey);
}

const shiftLabel = octave => (octave > 0 ? `+${octave}` : octave < 0 ? `−${-octave}` : '±0');
const octaveWords = octave => (!octave ? 'ohne Oktave' : `${Math.abs(octave) === 1 ? 'eine Oktave' : 'zwei Oktaven'} ${octave > 0 ? 'höher' : 'tiefer'}`);
const instrumentName = id => S.view.instruments.find(item => item.id === id)?.name ?? id;

function octavePicker(start, onPick, { apply } = {}) {
  const instruments = S.view.instruments;
  const select = h('select', { class: 'field small', 'aria-label': 'Instrument' }, instruments.map(item => h('option', { value: item.id, text: item.name })));
  select.value = start?.instrument ?? instruments[0]?.id ?? '';
  let octave = start?.octave ?? 0;
  const out = h('output', { class: 'oct', text: shiftLabel(octave) });
  const step = delta => {
    S.octaveInstrument = select.value;
    octave = Math.max(-2, Math.min(2, octave + delta));
    out.textContent = shiftLabel(octave);
    if (!apply) onPick(select.value, octave);
  };
  select.addEventListener('change', () => {
    S.octaveInstrument = select.value;
    octave = start?.current?.(select.value) ?? 0;
    out.textContent = shiftLabel(octave);
  });
  return h('div', { class: 'brow tempo' }, select,
    h('button', { class: 'btn', text: '−', 'aria-label': 'Eine Oktave tiefer', onclick: () => step(-1) }), out,
    h('button', { class: 'btn', text: '+', 'aria-label': 'Eine Oktave höher', onclick: () => step(1) }),
    apply ? h('button', { class: 'btn', text: apply, onclick: () => onPick(select.value, octave) }) : null);
}

function octaveSection(piece) {
  const current = id => piece.octaves?.[id] ?? 0;
  const set = (instrument, octave) => {
    const octaves = { ...(piece.octaves ?? {}) };
    if (octave) octaves[instrument] = octave;
    else delete octaves[instrument];
    change(() => S.draft.setPiece(S.base, piece.id, 'octaves', Object.keys(octaves).length ? octaves : null));
  };
  const first = S.octaveInstrument && S.view.instruments.some(item => item.id === S.octaveInstrument) ? S.octaveInstrument : Object.keys(piece.octaves ?? {})[0];
  const list = Object.entries(piece.octaves ?? {}).map(([id, octave]) => `${instrumentName(id)} ${shiftLabel(octave)}`);
  return h('div', { class: 'sec' }, h('h2', { text: 'Oktave je Instrument' }),
    octavePicker({ instrument: first, octave: first ? current(first) : 0, current }, set),
    h('div', { class: 'meta', text: list.length ? `Eingestellt: ${list.join(', ')}. Gilt bei den Musikern als „automatisch“, eigene Einstellungen gehen vor.` : 'Keine Oktave eingestellt, jedes Instrument spielt die Stimme, wie sie ist.' }));
}

function tempoSection(piece) {
  const published = S.library.pieces.get(piece.id);
  const start = piece.tempo ?? published?.tempo ?? null;
  const beat = h('select', { class: 'field small', 'aria-label': 'Notenwert' }, Object.entries(BEAT_WORDS).map(([value, label]) => h('option', { value, text: label })));
  beat.value = start?.beat ?? 'quarter';
  const bpm = h('input', { class: 'field small', type: 'number', inputmode: 'numeric', min: BPM.min, max: BPM.max, step: 1, 'aria-label': 'Schläge pro Minute', value: start ? String(start.bpm) : '' });
  const score = h('div', { class: 'meta', text: 'Tempo in der Partitur wird gelesen …' });
  if (published?.key && published.list) {
    pieceXml(published).then(xml => {
      const found = tempoFromMusicXml(xml);
      score.textContent = found ? `Veröffentlicht: ${tempoText(found)}` : 'In den Noten steht kein Tempo, MuseScore spielt Viertel = 120.';
      if (!start && found) {
        beat.value = found.beat;
        bpm.value = String(found.bpm);
      }
    }, () => { score.textContent = 'Das Tempo der Noten ließ sich nicht lesen.'; });
  } else {
    score.textContent = 'Die Noten kommen mit der nächsten Veröffentlichung.';
  }
  const apply = () => {
    const tempo = { beat: beat.value, bpm: Number(bpm.value) };
    const problem = tempoProblem(tempo);
    if (problem) return toast(problem.replace(/^Tempo: /, ''));
    change(() => S.draft.setPiece(S.base, piece.id, 'tempo', tempo));
    toast(`Tempo ${tempoText(tempo)}, gilt nach dem Veröffentlichen`);
  };
  bpm.addEventListener('keydown', event => { if (event.key === 'Enter') apply(); });
  return h('div', { class: 'sec' }, h('h2', { text: 'Tempo' }),
    h('div', { class: 'brow tempo' }, beat, h('span', { text: '=' }), bpm, h('button', { class: 'btn', text: 'Setzen', onclick: apply }),
      piece.tempo ? h('button', { class: 'btn', text: 'Tempo der Partitur nehmen', onclick: () => change(() => S.draft.setPiece(S.base, piece.id, 'tempo', null)) }) : null),
    h('div', { class: 'meta', text: piece.tempo ? `Eingestellt: ${tempoText(piece.tempo)}. Aufnahme und Mitlesen folgen nach dem Veröffentlichen.` : 'Kein eigenes Tempo eingestellt, es gilt das Tempo der Noten.' }),
    score);
}

const previews = new Map();
function preview(piece) {
  if (!piece?.key || !piece.list) return h('div', { class: 'meta', text: 'Die Noten kommen mit der nächsten Veröffentlichung.' });
  const cacheKey = `${piece.id}|${piece.mark}`;
  if (previews.has(cacheKey)) return previews.get(cacheKey);
  const box = h('div', { class: 'preview' }, h('div', { class: 'meta', text: 'Noten werden gesetzt …' }));
  previews.set(cacheKey, box);
  (async () => {
    try {
      const xml = await pieceXml(piece);
      const reduced = selectParts(xml, previewParts(piece.parts));
      const width = Math.max(320, Math.min(1100, ($('detail').clientWidth || 800) - 48));
      await engrave(box, reduced, { width, format: 'wide' });
    } catch {
      previews.delete(cacheKey);
      fill(box, h('div', { class: 'meta', text: 'Die Partitur ließ sich nicht setzen.' }));
    }
  })();
  return box;
}

async function download(piece) {
  try {
    const access = await editorAccess(S.master);
    const bytes = await fetchSealed(siteFetch, access.keys, 'mscz', piece.mscz, LIMITS.mscz);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = h('a', { href: url, download: `${piece.id}.mscz` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) {
    toast(error instanceof EditorError ? error.message : 'Herunterladen ging nicht');
  }
}

function startUpload(kind, pieceId = null) {
  S.upload = { kind, piece: pieceId, collections: [], title: '', bytes: null, message: '' };
  select({ type: 'upload' });
}

function uploadView() {
  const up = S.upload;
  if (up?.kind) {
    const info = KINDS[up.kind];
    const piece = up.piece ? pieceOf(up.piece) : null;
    const title = h('input', { class: 'field', placeholder: 'wird aus der Datei vorgeschlagen', value: up.title, maxlength: 200, oninput: event => { up.title = event.target.value; } });
    const message = h('div', { class: 'hint', text: up.message });
    const send = h('button', { class: 'btn primary', text: 'Einsenden', disabled: !up.bytes, onclick: () => sendUpload(send, message) });
    const file = h('input', { class: 'field file', type: 'file', accept: '.mscz', onchange: async event => {
      const chosen = event.target.files[0];
      up.bytes = null;
      send.disabled = true;
      if (!chosen) return;
      const bytes = chosen.size <= 16 * 1024 * 1024 + 1 ? new Uint8Array(await chosen.arrayBuffer()) : new Uint8Array(16 * 1024 * 1024 + 1);
      const problem = /\.mscz$/i.test(chosen.name) ? fileProblem(bytes) : 'Das ist keine MuseScore-Datei (.mscz).';
      message.textContent = problem ?? '';
      if (problem) {
        event.target.value = '';
        return;
      }
      up.bytes = bytes;
      if (info.isNew && !title.value.trim()) {
        up.title = titleFromFile(chosen.name);
        title.value = up.title;
      }
      send.disabled = false;
    } });
    return [
      h('div', { class: 'dhead' }, h('div', { class: 'grow' }, h('div', { class: 'title-static', text: piece ? `${info.button}: ${piece.title}` : info.button }))),
      h('p', { class: 'lead', text: info.text }),
      info.isNew ? [h('label', { class: 'lab' }, 'Titel', title), h('div', { class: 'lab', text: 'Sammlungen' }), h('div', {}, S.base.collections.map(c => h('button', {
        class: `colchip${up.collections.includes(c.id) ? ' on' : ''}`, color: c.color, text: c.name, onclick: event => {
          up.collections = up.collections.includes(c.id) ? up.collections.filter(x => x !== c.id) : [...up.collections, c.id];
          event.currentTarget.classList.toggle('on');
        },
      })))] : null,
      h('label', { class: 'lab' }, `${info.file} (.mscz aus MuseScore)`, file),
      message,
      h('div', { class: 'brow' }, h('button', { class: 'btn', text: 'Abbrechen', onclick: () => { const back = up.piece; S.upload = null; if (back) select({ type: 'piece', id: back }); else renderDetail(); } }), send),
    ];
  }
  return [
    h('div', { class: 'dhead' }, h('div', { class: 'grow' }, h('div', { class: 'title-static', text: 'Neues Stück' }))),
    h('details', { class: 'guide', open: true }, h('summary', { text: "So geht's" }), h('ol', {},
      h('li', { text: 'Das Stück in MuseScore anlegen oder eine vorhandene .mscz nehmen. Die Stimmen heißen Nummer plus Notenbild, etwa „1. B“ oder „3. C Bass“, eine Melodie „Melodie B“.' }),
      h('li', { text: 'Hier hochladen, als Melodie oder als fertige Partitur.' }),
      h('li', { text: 'Die Action prüft die Stimmen. Unter „Eingereicht“ steht nach ein paar Minuten, ob es geklappt hat. Das Stück ist dann in der Bibliothek, Status „in Arbeit“.' }))),
    h('div', { class: 'brow' }, h('button', { class: 'btn up', text: '↑ Aus einer Melodie', onclick: () => startUpload('new-melody') }), h('button', { class: 'btn up', text: '↑ Als fertige Partitur', onclick: () => startUpload('new-score') })),
    submissionsSection(),
  ];
}

async function sendUpload(button, message) {
  const up = S.upload;
  message.textContent = '';
  button.disabled = true;
  try {
    const title = up.title.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (KINDS[up.kind].isNew && [...S.base.pieces.values()].some(p => p.title.toLowerCase() === title.toLowerCase())) throw new EditorError('Ein Stück mit diesem Titel gibt es schon.');
    const submission = fileSubmission({ id: newSubmissionId(), kind: up.kind, title, collections: up.collections, piece: up.piece ? S.library.pieces.get(up.piece) : null });
    const problem = fileProblem(up.bytes);
    if (problem) throw new EditorError(problem);
    await submit(github(S.token), submission, up.bytes);
    S.upload = null;
    toast('Eingesandt, wird geprüft');
    select({ type: 'upload' });
    refreshSubmissions();
  } catch (error) {
    message.textContent = error instanceof EditorError || error instanceof GitHubError ? error.message : 'Einsenden ging nicht.';
    button.disabled = false;
  }
}

function submissionsSection() {
  const subs = S.subs;
  return h('div', { class: 'sec' },
    h('div', { class: 'list-head' }, h('h2', { text: 'Eingereicht' }), h('button', { class: 'linkbtn', text: '↻ Neu laden', disabled: S.subsLoading, onclick: refreshSubmissions })),
    !subs ? h('p', { class: 'meta', text: S.subsLoading ? 'Wird geladen …' : 'Noch nicht geladen' })
      : subs.error ? h('p', { class: 'meta', text: subs.error })
        : subs.items.length ? h('ul', { class: 'subs' }, subs.items.map(item => h('li', {},
          h('strong', { text: item.what }), h('small', { text: item.time ? formatDate(new Date(item.time).toISOString()) : '' }),
          h('p', { class: `state ${item.status}`, text: item.label }),
          item.note ? h('p', { class: 'note', text: item.note }) : null,
          h('div', { class: 'acts' },
            item.piece && S.view.pieces.has(item.piece) ? h('button', { class: 'linkbtn', text: 'Zum Stück', onclick: () => jump('library', { type: 'piece', id: item.piece }) }) : null,
            item.finished ? h('button', { class: 'linkbtn', text: 'Aus der Liste entfernen', onclick: event => {
              const button = event.currentTarget;
              dialog('Aus der Liste entfernen?', [h('p', { text: `„${item.what}“ verschwindet sofort aus „Eingereicht“. Am Stück ändert sich nichts.` })],
                [['Abbrechen'], ['Entfernen', 'danger', () => { removeSubmission(item, button); return true; }]]);
            } }) : null))))
          : h('p', { class: 'meta', text: 'Zurzeit ist nichts eingereicht.' }));
}

async function refreshSubmissions() {
  if (!S.token) {
    S.subs = { error: 'Im Tresor fehlt der Zugang zum Eingang.', items: [] };
    return;
  }
  S.subsLoading = true;
  if (S.sel?.type === 'upload') renderDetail();
  try {
    const gh = github(S.token);
    const ref = await gh('GET', '/git/ref/heads/main');
    const tree = (await gh('GET', `/git/trees/${ref.object.sha}?recursive=1`)).tree;
    const items = [];
    const statuses = new Map();
    for (const folder of submittedFolders(tree)) {
      const raw = await readBlobJson(gh, folder.files['submission.json']).catch(() => null);
      const status = await readBlobJson(gh, folder.files['status.json']).catch(() => null);
      const item = { ...describeSubmission(raw, status, S.view), id: folder.id, folder };
      items.push(item);
      statuses.set(folder.id, item);
    }
    S.subs = { items };
    const kept = keepSubmitted(S.submitted, statuses, S.library.published);
    const dropped = S.submitted.filter(entry => !kept.includes(entry) && ['rejected', 'error'].includes(statuses.get(entry.id)?.status));
    if (kept.length !== S.submitted.length) {
      S.submitted = kept;
      recompute();
      render();
    }
    if (dropped.length) toast('Eine Veröffentlichung wurde abgelehnt, Grund unter „Eingereicht“');
  } catch (error) {
    S.subs = { error: error instanceof GitHubError || error instanceof EditorError ? error.message : 'Die Liste lässt sich nicht laden.', items: [] };
  } finally {
    S.subsLoading = false;
    if (S.sel?.type === 'upload') renderDetail();
  }
}

async function removeSubmission(item, button) {
  button.disabled = true;
  try {
    const files = Object.values(item.folder.files).map(file => ({ path: file.path, remove: true }));
    await commitFiles(github(S.token), files, `Remove submission ${item.id}`);
    S.subs.items = S.subs.items.filter(x => x !== item);
    renderDetail();
  } catch (error) {
    toast(error instanceof GitHubError || error instanceof EditorError ? error.message : 'Entfernen ging nicht');
    button.disabled = false;
  }
}

function collectionDetail(collection) {
  const pieces = [...S.view.pieces.values()].filter(p => p.collections.includes(collection.id));
  const occasions = [...new Set(pieces.flatMap(p => p.occasions))].sort((a, b) => a.localeCompare(b, 'de'));
  const filter = occasions.includes(S.collectionOccasion) ? S.collectionOccasion : null;
  const shown = sortedPieces(pieces.filter(p => !filter || p.occasions.includes(filter)));
  return [
    h('div', { class: 'dhead' }, h('div', { class: 'grow' },
      textEdit(collection.name, 40, 'Der Name', text => S.draft.setCollection(S.base, collection.id, 'name', text), { color: collection.color }),
      h('div', { class: 'meta', text: `${pieces.length} Stücke` })),
      h('button', { class: 'btn', text: 'Stücke auswählen', onclick: () => picker(`Stücke für ${collection.name}`, p => p.collections.includes(collection.id), p => {
        const next = p.collections.includes(collection.id) ? p.collections.filter(x => x !== collection.id) : [...p.collections, collection.id];
        S.draft.setPiece(S.base, p.id, 'collections', next);
      }) })),
    h('div', { class: 'sec' }, h('h2', { text: 'Farbe' }), h('div', { class: 'swatches' }, PALETTE.map(color => h('button', {
      class: `sw${collection.color === color ? ' on' : ''}`, color, 'aria-label': 'Farbe', onclick: () => change(() => S.draft.setCollection(S.base, collection.id, 'color', color)),
    })))),
    h('div', { class: 'sec' }, h('h2', { text: 'Oktave für alle Stücke' }),
      octavePicker({ octave: 0 }, (instrument, octave) => {
        change(() => S.draft.setCollectionOctave(collection.id, instrument, octave));
        toast(`${collection.name}: ${instrumentName(instrument)} ${octaveWords(octave)} für ${pieces.length} Stücke, gilt nach dem Veröffentlichen`);
      }, { apply: `Für alle ${pieces.length} Stücke setzen` }),
      h('div', { class: 'meta', text: '±0 nimmt die Oktave dieses Instruments bei allen Stücken der Sammlung wieder heraus.' })),
    h('div', { class: 'sec' }, h('h2', { text: 'Anlass' }), h('div', { class: 'chips' }, occasions.length
      ? occasions.map(o => h('button', { class: `chip${filter === o ? ' on' : ''}`, text: o, onclick: () => { S.collectionOccasion = filter === o ? null : o; renderDetail(); } }))
      : h('span', { class: 'meta', text: 'Die Stücke tragen noch keine Anlässe' }))),
    h('div', { class: 'sec' }, h('h2', { text: 'Stücke' }), shown.length ? shown.map(p => pieceItem(p, { onclick: () => jump('library', { type: 'piece', id: p.id }) }))
      : h('div', { class: 'meta', text: 'Keine Stücke' })),
    pieces.length ? null : h('div', { class: 'sec' }, h('button', { class: 'btn danger', text: 'Sammlung löschen', onclick: () => dialog('Sammlung löschen?', [
      h('p', { text: `„${collection.name}“ verschwindet nach dem Veröffentlichen. Sie enthält keine Stücke.` }),
    ], [['Abbrechen'], ['Löschen', 'danger', () => { change(() => { S.draft.deleteCollection(collection.id); S.sel = null; }); return true; }]]) })),
  ];
}

function newCollection() {
  let color = PALETTE.find(c => !S.view.collections.some(x => x.color === c)) ?? PALETTE[0];
  const name = h('input', { class: 'field', placeholder: 'zum Beispiel Fronleichnam', maxlength: 40 });
  const hint = h('div', { class: 'hint' });
  const swatches = h('div', { class: 'swatches' }, PALETTE.map(c => h('button', { class: `sw${c === color ? ' on' : ''}`, color: c, 'data-color': c, onclick: event => {
    color = c;
    for (const node of swatches.children) node.classList.toggle('on', node === event.currentTarget);
  } })));
  swatches.style.marginTop = '12px';
  dialog('Neue Sammlung', [h('p', { text: 'Name und Farbe. Die Farbe erscheint nur als Akzent in Listen.' }), name, swatches, hint], [
    ['Abbrechen'],
    ['Anlegen', 'primary', () => {
      const text = name.value.normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!cleanText(text, 40)) { hint.textContent = 'Bitte einen Namen mit 1 bis 40 Zeichen eingeben.'; return false; }
      if (S.view.collections.some(c => c.name === text)) { hint.textContent = 'Diese Sammlung gibt es schon.'; return false; }
      let id;
      change(() => { id = S.draft.createCollection(S.base, text, color); });
      S.tab = 'collections';
      select({ type: 'collection', id });
      return true;
    }],
  ]);
}

function newBinder() {
  const name = h('input', { class: 'field', placeholder: 'zum Beispiel Fronleichnam 2027', maxlength: 100 });
  const hint = h('div', { class: 'hint' });
  dialog('Neue Mappe', [h('p', { text: 'Zum Beispiel ein Auftritt. Stücke fügst du danach hinzu.' }), name, hint], [
    ['Abbrechen'],
    ['Anlegen', 'primary', () => {
      const text = name.value.normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!cleanText(text, 100)) { hint.textContent = 'Bitte einen Namen mit 1 bis 100 Zeichen eingeben.'; return false; }
      if ([...S.view.binders.values()].some(b => b.name === text)) { hint.textContent = 'Eine Mappe mit diesem Namen gibt es schon.'; return false; }
      let id;
      change(() => { id = S.draft.createBinder(S.base, text); });
      S.tab = 'binders';
      select({ type: 'binder', id });
      toast('Mappe angelegt, Passwort und Link sind fertig');
      return true;
    }],
  ]);
}

function picker(title, isIn, toggle) {
  let query = '';
  let filter = null;
  const list = h('div', { class: 'pick' });
  const chips = h('div', { class: 'chips' }, S.view.collections.map(c => h('button', { class: 'chip', 'data-id': c.id, onclick: () => { filter = filter === c.id ? null : c.id; draw(); } }, h('span', { class: 'dot', color: c.color }), c.name)));
  const draw = () => {
    const pieces = sortedPieces([...S.view.pieces.values()].filter(p => (!query || p.title.toLowerCase().includes(query)) && (!filter || p.collections.includes(filter))));
    fill(list, pieces.map(p => h('button', { class: `item${isIn(p) ? ' in' : ''}`, onclick: () => { toggle(p); recompute(); render(); draw(); } },
      h('span', { class: 'mark', text: isIn(p) ? '✓' : '' }), h('span', { class: 't' }, h('b', { text: p.title }), h('small', {}, dots(p), p.occasions.join(', '))), p.kind === 'melody' ? qualityTag(p) : null)));
    for (const chip of chips.children) chip.classList.toggle('on', chip.dataset.id === filter);
  };
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Titel suchen', oninput: event => { query = event.target.value.trim().toLowerCase(); draw(); } });
  dialog(title, [search, chips, list], [['Fertig', 'primary']]);
  draw();
}

function secretsFor(binder) {
  const cacheKey = `${binder.id}|${binder.keyVersion}`;
  if (!S.secrets.has(cacheKey)) {
    S.secrets.set(cacheKey, binderSecrets(S.master, binder).catch(error => {
      S.secrets.delete(cacheKey);
      throw error;
    }));
  }
  return S.secrets.get(cacheKey);
}

function binderDetail(binder) {
  const rows = binder.pieces.map((id, i) => {
    const piece = pieceOf(id);
    if (!piece) return null;
    return h('div', { class: 'mrow', 'data-id': id },
      h('span', { class: 'grip', 'aria-label': 'Ziehen zum Umsortieren' }, icon('grip', 18)),
      h('span', { class: 'n', text: String(i + 1) }),
      h('button', { class: 't', onclick: () => jump('library', { type: 'piece', id }) }, h('b', { text: piece.title }), ' ', dots(piece)),
      piece.kind === 'melody' ? qualityTag(piece) : null, ' ', statusTag(piece), h('span', { class: 'go', 'aria-hidden': 'true', text: '›' }),
      h('button', { class: 'rm', 'aria-label': 'Aus Mappe nehmen', text: '✕', onclick: () => {
        change(() => S.draft.setBinder(S.base, binder.id, 'pieces', binder.pieces.filter(x => x !== id)));
        toast('Aus der Mappe genommen, Nummern rücken nach');
      } }));
  });
  const list = h('div', { id: 'binder-rows' }, rows.some(Boolean) ? rows : h('div', { class: 'meta', text: 'Noch leer. Füge Stücke aus der Bibliothek hinzu.' }));
  bindDrag(list, binder);
  const published = S.library.binders.get(binder.id);
  const unpublished = !published || published.keyVersion !== binder.keyVersion;
  const password = h('span', { class: 'pwbig', text: 'wird berechnet …' });
  const qr = h('button', { class: 'qr', 'aria-label': 'QR-Code groß zeigen' });
  const link = h('input', { class: 'linkf', readonly: true, value: '' });
  const ready = secretsFor(binder);
  ready.then(secrets => {
    password.textContent = secrets.password;
    link.value = secrets.link;
    fill(qr, qrImage(secrets.link));
  }, () => { password.textContent = 'Passwort ließ sich nicht berechnen'; });
  const withSecrets = run => () => ready.then(run, () => toast('Passwort ließ sich nicht berechnen'));
  qr.addEventListener('click', withSecrets(secrets => dialog(binder.name, [
    h('p', { text: 'Mit der Kamera scannen, dann öffnet sich die Mappe.' }), h('div', { class: 'qrbig' }, qrImage(secrets.link)),
    h('p', {}, 'Passwort ', h('b', { text: secrets.password })),
  ], [['QR-Code teilen', '', () => { shareQr(binder, secrets); return false; }], ['Fertig', 'primary']])));
  const created = binder.keyCreated ? `vom ${formatDate(binder.keyCreated)}` : 'neu, gilt nach dem Veröffentlichen';
  return [
    h('div', { class: 'dhead' }, h('div', { class: 'grow' },
      textEdit(binder.name, 100, 'Der Name', text => S.draft.setBinder(S.base, binder.id, 'name', text)),
      h('div', { class: 'meta', text: `${binder.pieces.length} Stücke` })),
      h('button', { class: 'btn', text: 'Stücke auswählen', onclick: () => picker(`Stücke für ${binder.name}`, p => S.view.binders.get(binder.id)?.pieces.includes(p.id), p => {
        const current = S.view.binders.get(binder.id).pieces;
        S.draft.setBinder(S.base, binder.id, 'pieces', current.includes(p.id) ? current.filter(x => x !== p.id) : [...current, p.id]);
      }) })),
    list,
    h('div', { class: 'sec' }, h('h2', { text: 'Teilen' }), h('div', { class: 'share' },
      h('div', { class: 'row' }, password, h('button', { class: 'btn', text: 'Passwort kopieren', onclick: withSecrets(s => copy(s.password, 'Passwort kopiert')) })),
      h('div', { class: 'qrrow' }, qr, h('div', { class: 'qrside' },
        h('small', { text: 'QR-Code mit dem Link. Antippen zeigt ihn groß, etwa zum Abfotografieren in der Probe.' }),
        h('button', { class: 'btn', text: 'QR-Code teilen', onclick: withSecrets(s => shareQr(binder, s)) }))),
      h('div', { class: 'row' }, link, h('button', { class: 'btn primary', text: 'Link teilen', onclick: withSecrets(s => shareLink(binder, s)) })),
      h('small', { text: 'Link und Passwort öffnen beide diese Mappe, mit allen Stimmen. Der Link ist aus dem Passwort gemacht, wer den Link hat, muss nichts eintippen.' }),
      unpublished ? h('small', { text: 'Dieses Passwort gilt erst, wenn die Änderungen veröffentlicht sind.' }) : null,
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Passwort und Link ', h('b', { text: created }), h('br'),
        h('small', { text: 'Passwort erneuern macht auch einen neuen Link und sperrt das bisherige Passwort und den bisherigen Link.' })),
      h('button', { class: 'btn danger', text: 'Passwort erneuern', disabled: unpublished, onclick: () => renewBinder(binder) })),
      h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Als Musiker ansehen', disabled: unpublished, onclick: withSecrets(s => window.open(s.link, '_blank', 'noopener,noreferrer')) })))),
    h('div', { class: 'sec' }, h('button', { class: 'btn danger', text: 'Mappe löschen', onclick: () => dialog('Mappe löschen?', [
      h('p', { text: `„${binder.name}“ verschwindet nach dem Veröffentlichen, der Link geht dann nicht mehr. Die Stücke bleiben in der Bibliothek.` }),
    ], [['Abbrechen'], ['Löschen', 'danger', () => { change(() => { S.draft.deleteBinder(binder.id); S.sel = null; }); return true; }]]) })),
  ];
}

function renewBinder(binder) {
  dialog(`Passwort für ${binder.name} erneuern?`, [
    h('p', { text: 'Die Mappe bekommt ein neues Passwort und daraus einen neuen Link. Das bisherige Passwort und der bisherige Link gehen nach dem Veröffentlichen nicht mehr, auch korrigierte Fassungen kommen dort nicht mehr an. Wer weiter spielen soll, braucht das neue Passwort oder den neuen Link. Andere Mappen bleiben, wie sie sind.' }),
  ], [['Abbrechen'], ['Erneuern', 'danger', () => {
    change(() => S.draft.renewBinder(S.base, binder.id));
    toast('Neues Passwort erzeugt, gilt nach dem Veröffentlichen');
    return true;
  }]]);
}

function qrImage(text) {
  return h('img', { alt: 'QR-Code', src: `data:image/svg+xml,${encodeURIComponent(qrSvg(text))}` });
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Kopieren ging nicht');
  }
}

async function shareLink(binder, secrets) {
  try {
    if (await shareBinder({ name: binder.name, link: secrets.link, password: secrets.password }) === 'copied') toast('Text mit Link und Passwort kopiert');
  } catch {
    toast('Teilen ging nicht');
  }
}

async function shareQr(binder, secrets) {
  const { size, dark } = qrMatrix(secrets.link);
  const cell = Math.floor(560 / (size + 4));
  const side = cell * (size + 4);
  const pad = 40;
  const canvas = document.createElement('canvas');
  canvas.width = side + 2 * pad;
  canvas.height = side + 2 * pad + 110;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (dark[y * size + x]) g.fillRect(pad + (x + 2) * cell, pad + (y + 2) * cell, cell, cell);
  g.textAlign = 'center';
  g.font = 'bold 34px -apple-system, Helvetica, sans-serif';
  g.fillText(binder.name, canvas.width / 2, side + pad + 46, canvas.width - 40);
  g.font = '26px -apple-system, Helvetica, sans-serif';
  g.fillStyle = '#555';
  g.fillText(`Passwort: ${secrets.password}`, canvas.width / 2, side + pad + 88, canvas.width - 40);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], `${binder.name.replace(/[^\p{L}\p{N} ._-]/gu, '')} QR.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: binder.name }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('QR-Code als Bild gespeichert');
}

function bindDrag(list, binder) {
  list.addEventListener('pointerdown', event => {
    const grip = event.target.closest('.grip');
    if (!grip) return;
    event.preventDefault();
    const row = grip.closest('.mrow');
    row.classList.add('dragging');
    const move = ev => {
      const rows = [...list.querySelectorAll('.mrow')];
      const over = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
      if (over && over !== row) {
        const b = over.getBoundingClientRect();
        list.insertBefore(row, ev.clientY < b.top + b.height / 2 ? over : over.nextSibling);
      }
      const box = $('detail').getBoundingClientRect();
      if (ev.clientY < box.top + 40) $('detail').scrollBy(0, -12);
      else if (ev.clientY > box.bottom - 40) $('detail').scrollBy(0, 12);
      [...list.querySelectorAll('.mrow')].forEach((r, i) => { r.querySelector('.n').textContent = String(i + 1); });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      const order = [...list.querySelectorAll('.mrow')].map(r => r.dataset.id);
      change(() => S.draft.setBinder(S.base, binder.id, 'pieces', order));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

$('publish').addEventListener('click', () => {
  const ops = S.draft.ops();
  const problems = problemsOf(S.view);
  const describe = op => {
    const piece = S.view.pieces.get(op.id) ?? S.base.pieces.get(op.id);
    const binder = S.view.binders.get(op.id) ?? S.base.binders.get(op.id);
    const collection = S.view.collections.find(c => c.id === op.id) ?? S.base.collections.find(c => c.id === op.id);
    switch (op.op) {
      case 'piece': return `„${piece?.title ?? op.id}“ geändert`;
      case 'song-renew': return `Link des Lieds „${piece?.title ?? op.id}“ erneuert`;
      case 'collection-create': return `Sammlung „${op.name}“ angelegt`;
      case 'collection': return `Sammlung „${collection?.name ?? op.id}“ geändert`;
      case 'collection-octave': return `Sammlung „${collection?.name ?? op.id}“: ${instrumentName(op.instrument)} ${octaveWords(op.octave)}`;
      case 'collection-delete': return `Sammlung „${collection?.name ?? op.id}“ gelöscht`;
      case 'binder-create': return `Mappe „${op.name}“ angelegt`;
      case 'binder': return `Mappe „${binder?.name ?? op.id}“ geändert`;
      case 'binder-renew': return `Passwort der Mappe „${binder?.name ?? op.id}“ erneuert`;
      case 'binder-delete': return `Mappe „${S.base.binders.get(op.id)?.name ?? op.id}“ gelöscht`;
      default: return op.op;
    }
  };
  const hint = h('div', { class: 'hint', text: problems.join('. ') });
  dialog(`${ops.length} ${ops.length === 1 ? 'Änderung' : 'Änderungen'} veröffentlichen?`, [
    h('ul', {}, ops.slice(0, 30).map(op => h('li', { text: describe(op) })), ops.length > 30 ? h('li', { text: `und ${ops.length - 30} weitere` }) : null),
    hint,
    h('button', { class: 'linkbtn danger discard', type: 'button', text: 'Alle Änderungen verwerfen …', onclick: () => dialog(`${ops.length} ${ops.length === 1 ? 'Änderung' : 'Änderungen'} verwerfen?`, [
      h('p', { text: 'Die Entwürfe auf diesem Gerät gehen verloren. Veröffentlichtes bleibt, wie es ist.' }),
    ], [['Abbrechen'], ['Verwerfen', 'danger', () => { change(() => S.draft.clear()); toast('Änderungen verworfen'); return true; }]]) }),
  ], [
    ['Abbrechen'],
    ['Veröffentlichen', 'primary', async () => {
      if (problems.length) return false;
      try {
        const id = newSubmissionId();
        await submit(github(S.token), changesSubmission(id, ops));
        S.submitted.push({ id, time: Date.now(), ops });
        change(() => S.draft.removeSent(ops));
        toast('Eingesandt');
        refreshSubmissions();
        return true;
      } catch (error) {
        hint.textContent = error instanceof EditorError || error instanceof GitHubError ? error.message : 'Veröffentlichen ging nicht.';
        return false;
      }
    }],
  ]);
});

boot();
