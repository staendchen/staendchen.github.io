'use strict';

const VERSION = "dd02d6e56b8cc062";
const HASHES = {"index.html":"608cef5f1de2bada9c6d38491df4c524dde4ae7a58aa917116b6a6bf621d82ee","manifest.webmanifest":"b7f0a5c5e9a2924d9458cdac2706633ed89be3d94bc0d6c52579db5113dcf2e1","v/dd02d6e56b8cc062/instruments.json":"c9b4553864a9b79bd0a79a92d2e21ae70fcfbcb86d35630324dce0f7e342e0dd","v/dd02d6e56b8cc062/app/app.css":"e14ee969b9e48743aea527dbaac67bfabc61b586313db669b4d063b2c819196f","v/dd02d6e56b8cc062/app/main.mjs":"bae8e753f2977f7bf49a5be46e4a647a73fe6293d2904b09314bfb7516a86575","v/dd02d6e56b8cc062/app/client.mjs":"24b27b12bed4662693a0b66d9484f18637e3da59a2ca8262e77dab7746d08353","v/dd02d6e56b8cc062/app/layout.mjs":"f172e499eb1d98d92ef626ab2d392853c8f5c460f04843477a31830120375925","v/dd02d6e56b8cc062/app/store.mjs":"35beae583d273df899ed14e319cad7ae860b9194c7b7a5c46962969456d055d9","v/dd02d6e56b8cc062/app/engrave.mjs":"cdee25d5b23191948a761f1ebb157339528ed618df019bbe1c42264f562b4d32","v/dd02d6e56b8cc062/app/sections.mjs":"03a7ee873b0a018df9fec5a6cc15c48b605ce099ac2f2dcd2854e3c9b2d5a613","v/dd02d6e56b8cc062/app/follow.mjs":"0b342c035cd9b0e3283a590e4f27f25249279893836298490f9d5d3c62549c50","v/dd02d6e56b8cc062/app/player.mjs":"41ebcf5de40554fa5276fc55796b9059514098837646032ebea2dfd6954641a9","v/dd02d6e56b8cc062/app/score.mjs":"00395fadae201284fb5a9516cc77180cc380cd782e2395eaf7648b182a4cf578","v/dd02d6e56b8cc062/app/pdf.mjs":"214597f5e2f56d7540767b2bf327fa4156d51b51d8c2dacfd84e51bd38d287f3","v/dd02d6e56b8cc062/app/book.mjs":"b5a3476105d1b9d936f94d452d24f37c5e009b29807d75caf5e0aa7c758317fd","v/dd02d6e56b8cc062/app/tools/tuner.mjs":"8469484b804f8dd773a620f76797b801de5f11485934dd043af0f915d2bb9b0b","v/dd02d6e56b8cc062/app/tools/metronome.mjs":"c60e5200193e8bfc812d57ee0ea8dcae11bea1d1fd0f5f9acb39e1e6bd43a48d","v/dd02d6e56b8cc062/app/tools/audio.mjs":"d31fc5bfa1dd9b8a896184d6ff9f9bf803b6d2e8ee68f6b899ed3fe6b8edf500","v/dd02d6e56b8cc062/app/tools/dom.mjs":"dd4ce14b43474caa19217434df108b607fc9f54b15f7202f303568ba23a1c4aa","v/dd02d6e56b8cc062/app/tools/pitch.mjs":"3994067afd5367981809a1fefeb94327eafd0aa3b57144a2bc48804fd7c775c8","v/dd02d6e56b8cc062/app/tools/rhythm.mjs":"196b7b743e441f00e3f5464c29e44423c2e6167edce4413df5b769d7ff1fff43","v/dd02d6e56b8cc062/app/tools/settings.mjs":"8e3f6cc93724cf212f6b81e7cfecaab02c083e0eaaaeac806c66d7fef32b9a34","v/dd02d6e56b8cc062/app/tools/grabber.worklet.mjs":"63426d3d39d3e34b87fe4c4b88badd0d595682938f656131db35f9655f2ed99b","v/dd02d6e56b8cc062/app/tools/tools.css":"8ecbebcacc6af0a651b10973f4436fb3c0ff64261ae055137a4b73df86ccc9f3","app/editor.html":"e9f839a1eebdf0507942252b60c8c51f5364d4450f8eaba5c4d918da6dd0fcbd","v/dd02d6e56b8cc062/app/editor.css":"4b1d6623d1b73f02013805661f1ed5550966c94ce6f2e55d967be7473cfebd24","v/dd02d6e56b8cc062/app/editor.mjs":"0646c6d0c482b67dcfc87e6aa6be341d4ae30f3d2ef0bdee8c78a0d08e5ef179","v/dd02d6e56b8cc062/app/editor-core.mjs":"45d7385f7dd18ec71c3fd20aaf38c7ef38ee378a9d48d27cec1e324a715a771d","v/dd02d6e56b8cc062/app/qr.mjs":"4418d852d907a626422d59aa11afd1b0b04989e675a86c535cb3239d7ab1d2a8","v/dd02d6e56b8cc062/app/admin.mjs":"e6142ba1ffe6f83bda16bae4f556d3ee56a22a0609edaa5083fb174da2317347","v/dd02d6e56b8cc062/app/share.mjs":"a4573b3dcfbea3532872ec4ce968ffa39148ce360f86f409894162b5716f990f","v/dd02d6e56b8cc062/app/card.mjs":"2d15bd5ce3f51a326c62d59c391e0b58daf5f304a2d386565845c048f02620b7","v/dd02d6e56b8cc062/app/verovio-toolkit-wasm.js":"682b0917fa3b1a4977ed69cc19615816c21a95a71334be261e64d0aa5fa8a584","v/dd02d6e56b8cc062/app/leipzig.woff2":"f3cf12eac5664a00191fb33a7ef63dc26eb130a894358f69913250cbedabe144","v/dd02d6e56b8cc062/app/leipzig-glyphs.json":"cd846c144f899dd48bdfbdad609968403047ee970114153415231cc44ccc94af","v/dd02d6e56b8cc062/app/verovio-notice.txt":"67fdf2718fa81c46c103d7b0ef48399d008be0ae79aa3eeb67dc106a14debd83","v/dd02d6e56b8cc062/lib/crypto.mjs":"96db7dd82f765d6060584bb58dd07ee6c37176718bdc71c4b32c25f3d032b930","v/dd02d6e56b8cc062/lib/tempo.mjs":"c6b2d725933ca8b9d17662b439706a5fba0a88afef5b9a2171e3256e1fd215b4","v/dd02d6e56b8cc062/lib/rewrite.mjs":"e8223569c8f7354e0ec641b9a5b77c72eebf96abe1dd84f2238429f56fa3ee18","v/dd02d6e56b8cc062/lib/musicxml.mjs":"6a822eb54a7d9cffce3d2feccbac29f04f8b16434ab6c15d8fc31ba6399b9220","icons/favicon.svg":"b512bcb2613a46bd161f94c28f6f1126be1dddc79544e8678ec6e59e2b3bb35f","icons/favicon-32.png":"4a862c06e114b9d706f534c336359e419e995d2649a5702237efd270d29273a0","icons/apple-touch-icon.png":"22dbf8001c021f19fb736fc7d3caffc665bbe976b7b6946bd7e0733b815e247e","icons/icon-192.png":"f2c70b162e6dfddf58c04a6a59864179fbc581815d1dbb1e56d2b35cc08edaaf","icons/icon-512.png":"6eb9e807714ad778c651fd225f02281819f667821ee815b646cd7bbae4f8cfab","icons/logo-mark.svg":"67f45d56d31dd7daffa1ad307d528cf044c5a5b46ee1ee0f115bfec18cf057ef"};
const SHELL = Object.keys(HASHES);
const PAGES = ['index.html', 'app/editor.html'];
const SHELL_CACHE = `shell-${VERSION}`;
const META_CACHE = 'meta';
const DATA_CACHE = 'data';
const DATA = /^x\/[A-Za-z0-9_-]{22}\.bin$/;
const VERSIONED = /^v\/[0-9a-f]{16}\//;
const scope = () => self.registration.scope;
const relative = url => (url.startsWith(scope()) ? url.slice(scope().length) : null);
const shellCaches = async () => (await caches.keys()).filter(name => name.startsWith('shell-'));

async function hex(body) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), b => b.toString(16).padStart(2, '0')).join('');
}

async function reuse(file, older) {
  const logical = file.replace(VERSIONED, '');
  for (const name of older) {
    const cache = await caches.open(name);
    for (const candidate of [`v/${name.slice(6)}/${logical}`, logical]) {
      const cached = await cache.match(new URL(candidate, scope()).href);
      if (!cached) continue;
      const body = await cached.arrayBuffer();
      if (await hex(body) === HASHES[file]) return { body, type: cached.headers.get('Content-Type') };
    }
  }
  return null;
}

async function download(file) {
  const response = await fetch(new URL(file, scope()).href, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (response.status !== 200) throw new Error('shell file missing');
  const body = await response.arrayBuffer();
  if (await hex(body) !== HASHES[file]) throw new Error('shell file has the wrong version');
  return { body, type: response.headers.get('Content-Type') };
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const older = (await shellCaches()).filter(name => name !== SHELL_CACHE);
    const fetched = await Promise.all(SHELL.map(async file => [file, (await reuse(file, older)) || (await download(file))]));
    const cache = await caches.open(SHELL_CACHE);
    for (const [file, { body, type }] of fetched) {
      await cache.put(new URL(file, scope()).href, new Response(body, { headers: { 'Content-Type': type || 'application/octet-stream' } }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const meta = await caches.open(META_CACHE);
    const stored = await meta.match('current');
    const previous = stored ? await stored.text() : null;
    if (previous && previous !== VERSION) {
      const keep = new Set([SHELL_CACHE, `shell-${previous}`]);
      for (const name of await shellCaches()) if (!keep.has(name)) await caches.delete(name);
    }
    if (previous !== VERSION) await meta.put('current', new Response(VERSION));
    await self.clients.claim();
  })());
});

async function page(request, path) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(new URL(path, scope()).href);
  return cached || fetch(request);
}

async function shellFile(request, path) {
  const current = await caches.open(SHELL_CACHE);
  const hit = await current.match(request.url);
  if (hit) return hit;
  for (const name of await shellCaches()) {
    if (name === SHELL_CACHE) continue;
    const older = await (await caches.open(name)).match(request.url);
    if (older) return older;
  }
  if (!Object.hasOwn(HASHES, path)) return fetch(request);
  const response = await fetch(request.url, { cache: 'no-cache', credentials: 'omit', redirect: 'error' });
  if (response.status !== 200) return response;
  const body = await response.arrayBuffer();
  const repaired = new Response(body, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' } });
  if (await hex(body) !== HASHES[path]) return new Response('shell file has the wrong version', { status: 502 });
  await current.put(request.url, repaired.clone());
  return repaired;
}

async function data(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request.url, { cache: 'no-cache', credentials: 'omit', redirect: 'error' });
  if (response.status === 200) await cache.put(request.url, response.clone());
  return response;
}

async function keep(files) {
  const wanted = new Set(files.filter(file => typeof file === 'string' && DATA.test(file)).map(file => new URL(file, scope()).href));
  const cache = await caches.open(DATA_CACHE);
  for (const request of await cache.keys()) if (!wanted.has(request.url)) await cache.delete(request);
}

self.addEventListener('message', event => {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data?.type === 'keep' && Array.isArray(event.data.files) && event.data.files.length <= 100000) event.waitUntil(keep(event.data.files));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = relative(url.origin + url.pathname);
  if (path === null) return;
  if (request.mode === 'navigate') {
    const target = path === '' ? 'index.html' : path;
    if (PAGES.includes(target)) event.respondWith(page(request, target));
    return;
  }
  if (url.search) return;
  if (DATA.test(path)) {
    event.respondWith(data(request));
    return;
  }
  if (path === 'sw.js' || path === 'state.json' || path === 'vault.json') return;
  event.respondWith(shellFile(request, path));
});
