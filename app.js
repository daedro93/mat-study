'use strict';
/* Mat Study: a private BJJ instructional player that streams from your own OneDrive.
   No server. Your files stay in OneDrive; bookmarks/notes live in this browser
   and in a private app folder in your OneDrive. */
(function () {
  // Refuse to run inside someone else's page (clickjacking protection).
  if (window.top !== window.self) { document.documentElement.innerHTML = ''; return; }

  const CFG = window.BJJ_CONFIG || {};
  const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const DEMO = IS_LOCAL && new URLSearchParams(location.search).has('demo');
  const AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  // Read-only access to files + one private app folder for your bookmarks/notes.
  const SCOPES = 'openid profile offline_access Files.Read Files.ReadWrite.AppFolder';
  const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, '');
  const DATA_PATH = '/me/drive/special/approot:/bjj-data.json';
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

  // ---------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $('#app');
  const enc = encodeURIComponent;
  const now = () => Date.now();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);
  const readJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sha256 = str => crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const cleanName = n => n.replace(/\.(mp4|m4v|mov|webm)$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const isVideo = it => !!it.file && (/\.(mp4|m4v|mov|webm)$/i.test(it.name) || (it.file.mimeType || '').startsWith('video/'));
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function ago(ts) {
    if (!ts) return 'never';
    const m = Math.round((now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  function decodeJwt(t) {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), c => c.charCodeAt(0))));
  }
  // Inline style attributes are blocked by our security policy, so sizes are set from JS.
  function applySizes(root = app) {
    $$('[data-w]', root).forEach(e => { e.style.width = e.dataset.w + '%'; });
    $$('[data-l]', root).forEach(e => { e.style.left = e.dataset.l + '%'; });
  }
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button>${esc(action.label)}</button>` : '');
    if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.fn(); };
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
  }
  function ask({ title, value = '', placeholder = '', check, okLabel = 'Save' }) {
    return new Promise(resolve => {
      const d = $('#dlg');
      d.innerHTML = `<h3>${esc(title)}</h3>
        <input id="dlgIn" maxlength="200" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}">
        ${check ? `<label class="chk"><input type="checkbox" id="dlgChk"> ${esc(check)}</label>` : ''}
        <div class="dlg-btns"><button class="btn ghost" id="dlgNo">Cancel</button><button class="btn primary" id="dlgOk">${esc(okLabel)}</button></div>`;
      let finished = false;
      const done = ok => {
        if (finished) return; finished = true;
        const out = ok ? { text: $('#dlgIn').value.trim(), checked: !!($('#dlgChk') && $('#dlgChk').checked) } : null;
        d.close(); resolve(out);
      };
      $('#dlgOk').onclick = () => done(true);
      $('#dlgNo').onclick = () => done(false);
      $('#dlgIn').onkeydown = e => { if (e.key === 'Enter') done(true); };
      d.oncancel = e => { e.preventDefault(); done(false); };
      d.showModal();
      setTimeout(() => $('#dlgIn').focus(), 60);
    });
  }
  // Placeholder when a thumbnail fails to load.
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.failed) { t.dataset.failed = '1'; t.replaceWith(Object.assign(document.createElement('div'), { className: 'ph', textContent: '🥋' })); }
  }, true);

  // ---------- sign-in (Microsoft, PKCE; no secrets in this code)
  class NeedLogin extends Error {}
  const Auth = {
    get tokens() { return readJSON('bjj.tokens', null); },
    set tokens(v) { v ? writeJSON('bjj.tokens', v) : localStorage.removeItem('bjj.tokens'); },
    async login(selectAccount) {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
      sessionStorage.setItem('bjj.pkce', JSON.stringify({ verifier, state, back: location.hash }));
      const p = new URLSearchParams({
        client_id: CFG.CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES,
        code_challenge: b64url(await sha256(verifier)), code_challenge_method: 'S256', state, response_mode: 'query',
      });
      if (selectAccount) p.set('prompt', 'select_account');
      location.assign(AUTH_BASE + '/authorize?' + p);
    },
    async handleRedirect() {
      const q = new URLSearchParams(location.search);
      if (!q.has('code') && !q.has('error')) return;
      const saved = JSON.parse(sessionStorage.getItem('bjj.pkce') || 'null');
      sessionStorage.removeItem('bjj.pkce');
      history.replaceState(null, '', REDIRECT_URI + ((saved && saved.back) || ''));
      if (q.has('error')) throw new Error(q.get('error_description') || q.get('error'));
      if (!saved || saved.state !== q.get('state')) throw new Error('Sign-in check failed. Please try again.');
      await this.tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT_URI, code_verifier: saved.verifier });
    },
    async tokenRequest(params) {
      const r = await fetch(AUTH_BASE + '/token', { method: 'POST', body: new URLSearchParams({ client_id: CFG.CLIENT_ID, scope: SCOPES, ...params }) });
      const j = await r.json();
      if (!r.ok) { const e = new Error(j.error_description || j.error); e.code = j.error || 'error'; throw e; }
      const old = this.tokens || {};
      const t = { access: j.access_token, exp: now() + j.expires_in * 1000, refresh: j.refresh_token || old.refresh, oid: old.oid, name: old.name };
      if (j.id_token) { const c = decodeJwt(j.id_token); t.oid = c.oid || c.sub; t.name = c.name || c.preferred_username || ''; }
      this.tokens = t;
    },
    async token() {
      const t = this.tokens;
      if (!t || !t.oid) throw new NeedLogin();
      if (t.access && t.exp - 60000 > now()) return t.access;
      if (!t.refresh) throw new NeedLogin();
      try { await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }); }
      catch (e) { if (e.code) { this.tokens = { ...t, access: null, refresh: null }; throw new NeedLogin(); } throw e; }
      return this.tokens.access;
    },
    signOut() {
      this.tokens = null;
      location.assign(AUTH_BASE + '/logout?post_logout_redirect_uri=' + enc(REDIRECT_URI));
    },
  };
  const ownerCode = async oid => hex(await sha256('mat-study|' + oid)).slice(0, 32);

  // ---------- OneDrive (Microsoft Graph)
  async function graph(path, opts = {}, retry = true) {
    const url = path.startsWith('https://') ? path : GRAPH + path;
    if (!url.startsWith(GRAPH + '/')) throw new Error('Blocked request to unexpected address'); // never send the token elsewhere
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + await Auth.token(), ...(opts.headers || {}) } });
    if (r.status === 401 && retry) { const t = Auth.tokens; if (t) Auth.tokens = { ...t, exp: 0 }; return graph(path, opts, false); }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('OneDrive error ' + r.status);
    return r.status === 204 ? null : r.json();
  }
  async function listChildren(id) {
    const out = [];
    let url = `/me/drive/items/${enc(id)}/children?$top=200&$expand=thumbnails`;
    while (url) { const j = await graph(url); if (!j) break; out.push(...j.value); url = j['@odata.nextLink']; }
    return out;
  }
  async function videoUrl(id) {
    if (DEMO) return 'demo/sample.mp4';
    const it = await graph(`/me/drive/items/${enc(id)}`);
    const u = it && it['@microsoft.graph.downloadUrl'];
    if (!u) throw new Error('Could not open this video in OneDrive.');
    return u;
  }

  // ---------- your data (progress, bookmarks, notes, drills)
  const blank = () => ({ progress: {}, notes: {}, bookmarks: {}, drills: {}, favs: {}, roadmap: { steps: [], updated: 0 }, settings: { updated: 0 } });
  const Store = {
    d: Object.assign(blank(), readJSON('bjj.data.v1', {})),
    save() { writeJSON('bjj.data.v1', this.d); Sync.schedule(); },
    bookmarks() { return Object.values(this.d.bookmarks).filter(b => !b.deleted); },
    drills() { return Object.values(this.d.drills).filter(b => !b.deleted); },
    note(id) { const n = this.d.notes[id]; return n && !n.deleted ? n.text : ''; },
  };
  function mergeMap(a = {}, b = {}) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) if (!out[k] || (v.updated || 0) > (out[k].updated || 0)) out[k] = v;
    return out;
  }
  function merge(a, b) {
    return {
      progress: mergeMap(a.progress, b.progress), notes: mergeMap(a.notes, b.notes),
      bookmarks: mergeMap(a.bookmarks, b.bookmarks), drills: mergeMap(a.drills, b.drills), favs: mergeMap(a.favs, b.favs),
      roadmap: ((b.roadmap || {}).updated || 0) > ((a.roadmap || {}).updated || 0) ? b.roadmap : (a.roadmap || { steps: [], updated: 0 }),
      settings: ((b.settings || {}).updated || 0) > ((a.settings || {}).updated || 0) ? b.settings : a.settings,
    };
  }
  // Backs up your data to a private app folder in your OneDrive, so it follows you between devices.
  const Sync = {
    timer: null, busy: false, dirty: false, last: readJSON('bjj.lastSync', 0), failed: false,
    schedule(delay = 20000) {
      if (DEMO) return;
      this.dirty = true;
      if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.run(); }, delay);
    },
    async run() {
      if (DEMO || this.busy || !Auth.tokens || !navigator.onLine) return false;
      this.busy = true;
      const before = JSON.stringify(Store.d);
      try {
        const meta = await graph(DATA_PATH);
        if (meta && meta['@microsoft.graph.downloadUrl']) {
          const remote = await (await fetch(meta['@microsoft.graph.downloadUrl'])).json();
          Store.d = Object.assign(blank(), merge(Store.d, remote));
          writeJSON('bjj.data.v1', Store.d);
        }
        if (this.dirty || !meta) {
          this.dirty = false;
          await graph(DATA_PATH + ':/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Store.d) });
        }
        this.last = now(); writeJSON('bjj.lastSync', this.last); this.failed = false;
      } catch (e) {
        console.warn('sync', e); this.dirty = true; this.failed = true;
        if (e instanceof NeedLogin) { this.busy = false; return false; }
      } finally { this.busy = false; }
      if (this.dirty) this.schedule(60000);
      return JSON.stringify(Store.d) !== before;
    },
  };

  // ---------- library (folders + videos, cached on the phone)
  const Library = {
    data: readJSON('bjj.library', null),
    index: new Map(),
    byId: new Map(),
    scanning: false,
    set(d) { this.data = d; writeJSON('bjj.library', d); this.reindex(); },
    reindex() {
      this.index.clear(); this.byId.clear();
      for (const s of (this.data && this.data.series) || []) { this.byId.set(s.id, s); s.videos.forEach((v, i) => this.index.set(v.id, { v, s, i })); }
    },
    get(id) { return this.index.get(id); },
    series(id) { return this.byId.get(id); },
    async scan(onStep) {
      const st = Store.d.settings;
      if (!st.rootId || this.scanning) return;
      this.scanning = true;
      try {
        if (DEMO) { this.set(demoLibrary()); return; }
        const mapVid = (k, sub) => ({
          id: k.id, name: cleanName(k.name), sub, size: k.size,
          thumb: (k.thumbnails && k.thumbnails[0] && k.thumbnails[0].medium && k.thumbnails[0].medium.url) || '',
        });
        const collect = async (folderId, out, depth, prefix) => {
          for (const k of (await listChildren(folderId)).sort(natural)) {
            if (k.folder && depth < 4) await collect(k.id, out, depth + 1, prefix ? prefix + ' / ' + k.name : k.name);
            else if (isVideo(k)) out.push(mapVid(k, prefix));
          }
        };
        const series = [], loose = [];
        let n = 0;
        for (const it of (await listChildren(st.rootId)).sort(natural)) {
          if (it.folder) {
            const vids = [];
            await collect(it.id, vids, 0, '');
            if (vids.length) series.push({ id: it.id, name: it.name, videos: vids });
            if (onStep) onStep(++n);
          } else if (isVideo(it)) loose.push(mapVid(it, ''));
        }
        if (loose.length) series.unshift({ id: st.rootId, name: st.rootName || 'Videos', videos: loose });
        this.set({ rootId: st.rootId, scannedAt: now(), series });
      } finally { this.scanning = false; }
    },
  };
  Library.reindex();

  function demoLibrary() {
    const mk = (sid, names) => names.map((n, i) => ({ id: sid + '-' + i, name: n, sub: '', size: 0, thumb: '' }));
    return {
      rootId: 'demo', scannedAt: now(), series: [
        { id: 'g', name: 'Guard Retention System', videos: mk('g', ['Vol 1 - Frames and Distance', 'Vol 2 - Hip Escapes', 'Vol 3 - Inversions', 'Vol 4 - Recovering Guard']) },
        { id: 'l', name: 'Leg Lock Foundations', videos: mk('l', ['Part 1 - Ashi Garami', 'Part 2 - Heel Hook Mechanics', 'Part 3 - Escapes']) },
        { id: 'k', name: 'Kimura Trap', videos: mk('k', ['Chapter 1 - The Grip', 'Chapter 2 - From Closed Guard']) },
      ],
    };
  }

  // ---------- progress
  const prog = id => Store.d.progress[id];
  const pct = id => { const p = prog(id); return p && p.d ? (p.done ? 100 : Math.min(100, (p.t / p.d) * 100)) : 0; };
  const isDone = id => !!(prog(id) && prog(id).done);
  function setDone(id, done) {
    const p = prog(id) || { t: 0, d: 0 };
    Store.d.progress[id] = { ...p, done, t: done ? p.t : 0, updated: now() };
    Store.save();
  }
  const doneCount = s => s.videos.filter(v => isDone(v.id)).length;
  const seriesDone = s => s.videos.length > 0 && doneCount(s) === s.videos.length;

  // ---------- favorites (videos and instructionals share one list)
  const isFav = id => !!(Store.d.favs[id] && Store.d.favs[id].on);
  function toggleFav(id) { Store.d.favs[id] = { on: !isFav(id), updated: now() }; Store.save(); return isFav(id); }
  const favLabel = id => isFav(id) ? '⭐ Favorite' : '☆ Favorite';

  // ---------- roadmap (your study order of instructionals)
  const rmIds = () => Store.d.roadmap.steps || [];
  function setRoadmap(steps) { Store.d.roadmap = { steps, updated: now() }; Store.save(); }
  const rmSteps = () => rmIds().map(id => Library.series(id)).filter(Boolean);
  function roadmapNext() {
    const steps = rmSteps();
    const i = steps.findIndex(s => !seriesDone(s));
    if (i < 0) return null;
    const s = steps[i];
    return { s, v: s.videos.find(v => !isDone(v.id)), step: i + 1, total: steps.length };
  }

  function continueList() {
    const recent = Object.entries(Store.d.progress)
      .filter(([id]) => Library.get(id))
      .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));
    const out = [], seen = new Set();
    for (const [id, p] of recent) {
      if (out.length >= 10) break;
      if (!p.done && p.t > 5) { if (!seen.has(id)) { out.push(id); seen.add(id); } }
      else if (p.done) { // suggest the next video in that series
        const e = Library.get(id), nx = e.s.videos[e.i + 1];
        if (nx && !isDone(nx.id) && !seen.has(nx.id) && !prog(nx.id)) { out.push(nx.id); seen.add(nx.id); }
      }
    }
    return out.map(id => Library.get(id).v);
  }

  // ---------- page chrome
  let cleanup = null;      // stops the video when leaving the watch page
  let refresh = null;      // re-draws the current page after a change
  let seekHere = null;     // jump inside the open video
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });

  function teardown() { if (cleanup) { const c = cleanup; cleanup = null; c(); } seekHere = null; }
  function showTabs(on) { $('#tabbar').hidden = !on; document.body.classList.toggle('has-tabs', on); }
  function setTab(name) { $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === name)); }
  function updateNet() { $('#netstate').hidden = navigator.onLine; }
  window.addEventListener('online', () => { updateNet(); Sync.run(); });
  window.addEventListener('offline', updateNet);
  function applyTheme() { document.documentElement.dataset.theme = localStorage.getItem('bjj.theme') || 'dark'; }

  const thumb = v => v.thumb ? `<img loading="lazy" src="${esc(v.thumb)}" alt="">` : '<div class="ph">🥋</div>';
  const bar = id => `<div class="bar"><i data-w="${pct(id).toFixed(1)}"></i></div>`;
  function card(v) {
    return `<a class="card" href="#/watch/${enc(v.id)}">
      <div class="thumb">${thumb(v)}${isDone(v.id) ? '<span class="badge">✓</span>' : ''}${bar(v.id)}</div>
      <div class="ct">${esc(v.name)}</div></a>`;
  }
  function emptyState(title, text, href, label) {
    return `<div class="empty"><div class="big-emoji">🥋</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${href ? `<a class="btn primary" href="${href}">${esc(label)}</a>` : ''}</div>`;
  }
  function fail(e) {
    if (e instanceof NeedLogin) return screenSignIn('Your sign-in expired (for safety it only lasts about a day). Tap below to sign in again.');
    console.error(e);
    app.innerHTML = emptyState('Something went wrong', navigator.onLine ? String(e.message || e) : 'You are offline. Videos need internet.', '#/', 'Back to library');
  }

  // ---------- router
  function route() {
    teardown();
    refresh = route;
    const [path, qs] = location.hash.slice(1).split('?');
    const parts = (path || '/').split('/').filter(Boolean).map(decodeURIComponent);
    const q = new URLSearchParams(qs || '');
    setTab(['study', 'settings', 'roadmap'].includes(parts[0]) ? parts[0] : 'home');
    window.scrollTo(0, 0);
    const page = { series: () => SeriesPage(parts[1]), watch: () => Watch(parts[1], q.has('t') ? +q.get('t') : null), roadmap: Roadmap,
      study: () => Study(q.get('tab') || 'bookmarks'), settings: Settings, pick: () => Picker(parts[1] || 'root') }[parts[0]] || Home;
    Promise.resolve().then(page).catch(fail);
  }

  // ---------- pages
  function Home() {
    const lib = Library.data;
    if (!Store.d.settings.rootId) { app.innerHTML = emptyState('Pick your BJJ folder', 'Choose the OneDrive folder where your instructionals are. You only do this once.', '#/pick/root', 'Choose folder'); return; }
    if (!lib || lib.rootId !== Store.d.settings.rootId) { return scanScreen(); }
    if (!lib.series.length) { app.innerHTML = emptyState('No videos found', `There are no MP4 videos in "${Store.d.settings.rootName}".`, '#/pick/root', 'Choose another folder'); return; }
    app.innerHTML = `<input id="vq" class="search" type="search" placeholder="🔍 Search all videos…" value="${esc(sessionStorage.getItem('bjj.vq') || '')}"><div id="homeBody"></div>`;
    const draw = () => {
      const q = $('#vq').value.trim().toLowerCase();
      sessionStorage.setItem('bjj.vq', $('#vq').value);
      $('#homeBody').innerHTML = q ? searchResults(q) : homeRows(lib);
      applySizes();
    };
    $('#vq').addEventListener('input', draw);
    refresh = draw;
    draw();
  }

  function homeRows(lib) {
    let html = '';
    const nx = roadmapNext();
    if (nx) html += `<a class="next-card" href="#/watch/${enc(nx.v.id)}">
        <div class="thumb">${thumb(nx.v)}${bar(nx.v.id)}</div>
        <div class="ntxt"><small>🗺️ Roadmap · step ${nx.step} of ${nx.total}</small><b>${esc(nx.s.name)}</b><span>Next: ${esc(nx.v.name)}</span></div></a>`;
    const cont = continueList();
    if (cont.length) html += `<section><h2 class="row-h">▶ Continue watching</h2><div class="row">${cont.map(card).join('')}</div></section>`;
    const favV = Object.keys(Store.d.favs).filter(id => isFav(id) && Library.get(id)).map(id => Library.get(id).v);
    if (favV.length) html += `<section><h2 class="row-h">⭐ Favorite videos</h2><div class="row">${favV.map(card).join('')}</div></section>`;
    const series = [...lib.series].sort((a, b) => isFav(b.id) - isFav(a.id)); // favorite instructionals first
    for (const s of series) {
      html += `<section><a class="row-title" href="#/series/${enc(s.id)}"><h2>${isFav(s.id) ? '⭐ ' : ''}${esc(s.name)}</h2><span>${doneCount(s)}/${s.videos.length} ✓ ›</span></a>
        <div class="row">${s.videos.map(card).join('')}</div></section>`;
    }
    return html;
  }

  function videoRow(v, extra) {
    const p = prog(v.id);
    return `<li class="vrow ${isDone(v.id) ? 'done' : ''}">
      <a class="vlink" href="#/watch/${enc(v.id)}"><div class="thumb sm">${thumb(v)}${bar(v.id)}</div>
        <div class="vtxt"><b>${isFav(v.id) ? '⭐ ' : ''}${esc(v.name)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}<small>${p && p.d ? fmt(p.t) + ' / ' + fmt(p.d) : 'Not started'}</small></div></a>
      <button class="check ${isDone(v.id) ? 'on' : ''}" data-act="toggleDone" data-id="${esc(v.id)}" aria-label="Mark done">✓</button>
    </li>`;
  }

  // Search every video by its name, sub-folder or instructional name. All words must match.
  function searchResults(q) {
    const words = q.split(/\s+/).filter(Boolean), hits = [];
    for (const s of Library.data.series) for (const v of s.videos) {
      const hay = (v.name + ' ' + v.sub + ' ' + s.name).toLowerCase();
      if (words.every(w => hay.includes(w))) hits.push({ v, s });
    }
    if (!hits.length) return emptyState('No videos found', 'Try a different word, like "guard" or "heel hook".');
    return `<p class="muted small">${hits.length} video${hits.length === 1 ? '' : 's'}${hits.length > 150 ? ' (showing first 150)' : ''}</p>
      <ul class="list">${hits.slice(0, 150).map(({ v, s }) => videoRow(v, s.name + (v.sub ? ' · ' + v.sub : ''))).join('')}</ul>`;
  }

  async function scanScreen() {
    app.innerHTML = `<div class="empty"><div class="spinner"></div><h2>Finding your videos…</h2><p id="scanMsg">Looking in "${esc(Store.d.settings.rootName)}"</p></div>`;
    await Library.scan(n => { const m = $('#scanMsg'); if (m) m.textContent = `Checked ${n} folder${n === 1 ? '' : 's'}…`; });
    if (location.hash === '' || location.hash === '#/') route();
  }

  function SeriesPage(id) {
    const s = ((Library.data && Library.data.series) || []).find(x => x.id === id);
    if (!s) { app.innerHTML = emptyState('Not found', 'This folder is not in your library.', '#/', 'Back'); return; }
    const d = doneCount(s);
    const step = rmIds().indexOf(s.id);
    app.innerHTML = `<a class="back" href="#/">‹ Library</a>
      <h1>${esc(s.name)}</h1>
      <div class="progress-line"><div class="bar wide"><i data-w="${(d / s.videos.length * 100).toFixed(1)}"></i></div><span>${d} of ${s.videos.length} done</span></div>
      <div class="actions">
        <button class="btn ${isFav(s.id) ? 'primary' : 'ghost'}" data-act="toggleFav" data-id="${esc(s.id)}">${favLabel(s.id)}</button>
        ${step >= 0 ? `<a class="btn ghost" href="#/roadmap">🗺️ Roadmap step ${step + 1}</a>` : `<button class="btn ghost" data-act="rmAdd" data-id="${esc(s.id)}">🗺️ Add to roadmap</button>`}
        ${d < s.videos.length ? `<button class="btn ghost" data-act="allDone" data-id="${esc(s.id)}">✓ Mark all done</button>` : ''}
      </div>
      <ul class="list">${s.videos.map(v => videoRow(v, v.sub)).join('')}</ul>`;
    applySizes();
  }

  function Roadmap() {
    const steps = rmSteps();
    const cur = steps.findIndex(s => !seriesDone(s));
    let html = `<h1>🗺️ My roadmap</h1><p class="muted small">Your study order. Finish one instructional, then the next one is up.</p>`;
    if (steps.length) {
      html += `<ol class="road">${steps.map((s, i) => {
        const d = doneCount(s), state = seriesDone(s) ? 'done' : i === cur ? 'cur' : 'todo';
        const nextV = s.videos.find(v => !isDone(v.id));
        return `<li class="step ${state}">
          <div class="dot">${state === 'done' ? '✓' : i + 1}</div>
          <div class="sbody">
            <a href="#/series/${enc(s.id)}"><b>${esc(s.name)}</b>
              <small>${state === 'cur' ? '▶ Studying now · ' : state === 'done' ? 'Finished · ' : ''}${d}/${s.videos.length} videos</small></a>
            <div class="bar wide"><i data-w="${(d / s.videos.length * 100).toFixed(1)}"></i></div>
            ${state === 'cur' && nextV ? `<a class="btn primary sm cont" href="#/watch/${enc(nextV.id)}">▶ Continue: ${esc(nextV.name)}</a>` : ''}
          </div>
          <div class="sbtns">
            <button class="ibtn" data-act="rmUp" data-id="${esc(s.id)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="ibtn" data-act="rmDown" data-id="${esc(s.id)}" aria-label="Move down" ${i === steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="ibtn" data-act="rmDel" data-id="${esc(s.id)}" aria-label="Remove">✕</button>
          </div></li>`;
      }).join('')}</ol>`;
      if (cur < 0) html += `<p class="center-text">🏆 You finished your whole roadmap! Add the next instructional below.</p>`;
    } else {
      html += emptyState('No roadmap yet', 'Pick instructionals below in the order you want to study them. Step 1 first.');
    }
    const notIn = ((Library.data && Library.data.series) || []).filter(s => !rmIds().includes(s.id));
    if (notIn.length) html += `<h3>➕ Add an instructional</h3>
      <input id="rq" class="search" type="search" placeholder="Search instructionals…"><ul class="list" id="rlist"></ul>`;
    app.innerHTML = html;
    applySizes();
    if (!notIn.length) return;
    const draw = () => {
      const q = $('#rq').value.trim().toLowerCase();
      const list = notIn.filter(s => !q || s.name.toLowerCase().includes(q)).sort((a, b) => isFav(b.id) - isFav(a.id));
      $('#rlist').innerHTML = list.map(s => `<li class="srow"><span class="dtxt"><b>${isFav(s.id) ? '⭐ ' : ''}${esc(s.name)}</b><small>${s.videos.length} videos · ${doneCount(s)} done</small></span>
        <button class="btn ghost sm" data-act="rmAdd" data-id="${esc(s.id)}">+ Add</button></li>`).join('') || '<li class="muted small">No matches.</li>';
    };
    $('#rq').addEventListener('input', draw);
    draw();
  }

  async function Watch(id, tParam) {
    const entry = Library.get(id);
    if (!entry) { app.innerHTML = emptyState('Video not found', 'Try "Rescan library" in Settings.', '#/settings', 'Settings'); return; }
    const { v: vid, s: series, i: idx } = entry;
    const next = series.videos[idx + 1];
    app.innerHTML = `
      <div class="player" id="pl">
        <div class="vbox">
          <video id="vid" playsinline preload="metadata"></video>
          <div class="tap l" data-z="l"></div><div class="tap r" data-z="r"></div>
          <div class="flash" id="flash"></div>
          <div class="vmsg" id="vmsg">Loading video…</div>
        </div>
        <div class="ctl" id="ctl">
          <div class="seekwrap"><div class="marks" id="marks"></div><input type="range" id="seek" min="0" max="1000" value="0" aria-label="Seek"></div>
          <div class="ctlrow">
            <span class="time" id="time">0:00</span>
            <button class="cbtn" id="back10" aria-label="Back 10 seconds">⟲ 10</button>
            <button class="cbtn play" id="play" aria-label="Play">▶</button>
            <button class="cbtn" id="fwd10" aria-label="Forward 10 seconds">10 ⟳</button>
            <span class="time" id="dur">0:00</span>
          </div>
          <div class="ctlrow tools">
            <label class="tool"><span>🐢</span><select aria-label="Speed" id="speed">${SPEEDS.map(s => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}x</option>`).join('')}</select></label>
            <button class="tool" id="mirror"><span>⇋</span>Mirror</button>
            <button class="tool" id="loop"><span>🔁</span><em id="loopTxt">Loop</em></button>
            <button class="tool" id="bm"><span>🔖</span>Mark</button>
            <button class="tool" id="fs"><span>⛶</span><em id="fsTxt">Full</em></button>
          </div>
        </div>
      </div>
      <div class="watch-info">
        <h1>${esc(vid.name)}</h1>
        <div class="muted">${esc(series.name)}${vid.sub ? ' · ' + esc(vid.sub) : ''}</div>
        <div class="actions">
          <button class="btn ${isDone(id) ? 'primary' : 'ghost'}" id="doneBtn">${isDone(id) ? '✓ Done' : 'Mark as done'}</button>
          <button class="btn ${isFav(id) ? 'primary' : 'ghost'}" id="favBtn">${favLabel(id)}</button>
          ${next ? `<a class="btn ghost" href="#/watch/${enc(next.id)}">Next video ›</a>` : ''}
        </div>
        <h3>🔖 Bookmarks</h3>
        <ul class="list" id="bmlist"></ul>
        <h3>📝 Notes</h3>
        <textarea id="notes" rows="5" placeholder="What did you learn? Key details, grips, mistakes…">${esc(Store.note(id))}</textarea>
        <div class="muted small" id="noteState"></div>
      </div>`;

    const pl = $('#pl'), v = $('#vid'), seek = $('#seek'), msg = $('#vmsg');
    let alive = true, loopA = null, loopB = null, loopTimer = null, lastSave = 0, dragging = false;
    let hideTimer = null, retrying = false, mirrored = false, tapTimer = null, tapZone = null, streakUntil = 0;

    // --- progress (#1 resume, #13 progress, #14 done)
    function saveProgress() {
      if (!isFinite(v.duration) || !v.duration) return;
      const p = prog(id) || {};
      const done = p.done || v.currentTime / v.duration > 0.95;
      Store.d.progress[id] = { t: v.currentTime, d: v.duration, done, updated: now() };
      Store.save();
      lastSave = now();
    }

    // --- controls
    const togglePlay = () => (v.paused ? v.play().catch(() => {}) : v.pause());
    const skip = s => { if (isFinite(v.duration)) v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + s)); bumpHide(); };
    function flash(text, side) {
      const f = $('#flash'); f.textContent = text; f.className = 'flash show ' + (side || '');
      clearTimeout(flash.t); flash.t = setTimeout(() => { f.className = 'flash'; }, 500);
    }
    function bumpHide() {
      pl.classList.remove('hidectl'); clearTimeout(hideTimer);
      if (document.fullscreenElement === pl && !v.paused) hideTimer = setTimeout(() => pl.classList.add('hidectl'), 3000);
    }
    // #6 double-tap left/right to skip, single tap = play/pause (or show controls in fullscreen)
    function onTap(zone) {
      if ((tapTimer && tapZone === zone) || (now() < streakUntil && tapZone === zone)) {
        clearTimeout(tapTimer); tapTimer = null; streakUntil = now() + 600;
        skip(zone === 'l' ? -10 : 10); flash(zone === 'l' ? '⟲ 10s' : '10s ⟳', zone); return;
      }
      clearTimeout(tapTimer); tapZone = zone;
      tapTimer = setTimeout(() => {
        tapTimer = null;
        if (document.fullscreenElement === pl && pl.classList.contains('hidectl')) bumpHide(); else { togglePlay(); bumpHide(); }
      }, 260);
    }
    $$('.tap', pl).forEach(z => z.addEventListener('click', () => onTap(z.dataset.z)));
    $('#play').onclick = () => { togglePlay(); bumpHide(); };
    $('#back10').onclick = () => { skip(-10); flash('⟲ 10s', 'l'); };
    $('#fwd10').onclick = () => { skip(10); flash('10s ⟳', 'r'); };
    // #3 slow motion
    $('#speed').onchange = e => { v.playbackRate = +e.target.value; flash(e.target.value + 'x'); bumpHide(); };
    // #4 mirror flip
    $('#mirror').onclick = () => {
      mirrored = !mirrored; v.style.transform = mirrored ? 'scaleX(-1)' : '';
      $('#mirror').classList.toggle('on', mirrored); flash(mirrored ? 'Mirrored' : 'Normal'); bumpHide();
    };
    // #5 A-B loop
    function setLoopUi() {
      $('#loopTxt').textContent = loopA === null ? 'Loop' : loopB === null ? 'Set end' : 'Stop loop';
      $('#loop').classList.toggle('on', loopA !== null);
      drawMarks();
    }
    $('#loop').onclick = () => {
      bumpHide();
      if (loopA === null) { loopA = v.currentTime; toast('Loop start set at ' + fmt(loopA) + '. Tap Loop again at the end of the move.'); }
      else if (loopB === null) {
        if (v.currentTime <= loopA + 0.5) { toast('Play forward a bit, then tap again to set the end.'); return; }
        loopB = v.currentTime; v.currentTime = loopA; v.play().catch(() => {});
        loopTimer = setInterval(() => { if (loopB !== null && v.currentTime >= loopB) v.currentTime = loopA; }, 100);
        toast(`Looping ${fmt(loopA)} → ${fmt(loopB)}`);
      } else { loopA = loopB = null; clearInterval(loopTimer); toast('Loop off'); }
      setLoopUi();
    };
    // #8 bookmarks
    $('#bm').onclick = async () => {
      const t = v.currentTime, wasPlaying = !v.paused;
      v.pause();
      const r = await ask({ title: `Bookmark at ${fmt(t)}`, placeholder: 'e.g. Kimura grip detail', check: 'Also add to my drill list' });
      if (r && alive) {
        const b = { id: uid(), itemId: id, t, label: r.text || 'Moment at ' + fmt(t), created: now(), updated: now() };
        Store.d.bookmarks[b.id] = b;
        if (r.checked) addDrill(b.label, id, t);
        Store.save(); renderBms(); toast(r.checked ? 'Bookmark + drill saved' : 'Bookmark saved');
      }
      if (wasPlaying && alive) v.play().catch(() => {});
    };
    // #7 fullscreen + landscape
    $('#fs').onclick = async () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      try { await pl.requestFullscreen({ navigationUI: 'hide' }); } catch { try { v.webkitEnterFullscreen(); } catch { /* not supported */ } return; }
      try { await screen.orientation.lock('landscape'); } catch { /* desktop browsers can't rotate */ }
    };
    function onFs() {
      const fs = document.fullscreenElement === pl;
      pl.classList.toggle('fs', fs); $('#fsTxt').textContent = fs ? 'Exit' : 'Full';
      if (!fs) { try { screen.orientation.unlock(); } catch { /* ignore */ } pl.classList.remove('hidectl'); }
      bumpHide();
    }
    document.addEventListener('fullscreenchange', onFs);
    pl.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') bumpHide(); });

    // --- seek bar
    seek.addEventListener('input', () => { dragging = true; if (isFinite(v.duration)) { $('#time').textContent = fmt(seek.value / 1000 * v.duration); } bumpHide(); });
    seek.addEventListener('change', () => { dragging = false; if (isFinite(v.duration)) v.currentTime = seek.value / 1000 * v.duration; });
    function drawMarks() {
      const d = v.duration;
      if (!isFinite(d) || !d) { $('#marks').innerHTML = ''; return; }
      let h = Store.bookmarks().filter(b => b.itemId === id).map(b => `<i class="mk" data-l="${(b.t / d * 100).toFixed(2)}"></i>`).join('');
      if (loopA !== null) h += `<b class="lz" data-l="${(loopA / d * 100).toFixed(2)}" data-w="${(((loopB ?? v.currentTime) - loopA) / d * 100).toFixed(2)}"></b>`;
      $('#marks').innerHTML = h; applySizes($('#marks'));
    }

    // --- bookmarks list under the video
    function renderBms() {
      const list = Store.bookmarks().filter(b => b.itemId === id).sort((a, b) => a.t - b.t);
      $('#bmlist').innerHTML = list.length ? list.map(b => `
        <li class="bmrow"><button class="tbtn" data-act="seek" data-t="${b.t}">${fmt(b.t)}</button><span class="bml">${esc(b.label)}</span>
          <button class="ibtn" data-act="drillBm" data-id="${esc(b.id)}" aria-label="Add to drills">+🥋</button>
          <button class="ibtn" data-act="renameBm" data-id="${esc(b.id)}" aria-label="Rename">✎</button>
          <button class="ibtn" data-act="delBm" data-id="${esc(b.id)}" aria-label="Delete">🗑</button></li>`).join('')
        : '<li class="muted small">No bookmarks yet. Tap 🔖 Mark while watching to save a moment.</li>';
      drawMarks();
    }
    refresh = renderBms;
    seekHere = t => { v.currentTime = t; v.play().catch(() => {}); $('#pl').scrollIntoView({ behavior: 'smooth' }); };

    // --- notes (#9)
    let noteTimer = null;
    $('#notes').addEventListener('input', e => {
      $('#noteState').textContent = 'Saving…';
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { Store.d.notes[id] = { text: e.target.value, updated: now() }; Store.save(); $('#noteState').textContent = 'Saved ✓'; }, 600);
    });
    $('#favBtn').onclick = () => {
      const on = toggleFav(id), b = $('#favBtn');
      b.textContent = favLabel(id); b.className = 'btn ' + (on ? 'primary' : 'ghost');
      toast(on ? 'Added to favorites ⭐' : 'Removed from favorites');
    };
    $('#doneBtn').onclick = () => {
      setDone(id, !isDone(id));
      const b = $('#doneBtn'); b.textContent = isDone(id) ? '✓ Done' : 'Mark as done'; b.className = 'btn ' + (isDone(id) ? 'primary' : 'ghost');
    };

    // --- video events
    v.addEventListener('play', () => { $('#play').textContent = '❚❚'; bumpHide(); });
    v.addEventListener('pause', () => { $('#play').textContent = '▶'; saveProgress(); bumpHide(); });
    v.addEventListener('waiting', () => { msg.textContent = 'Loading…'; msg.hidden = false; });
    v.addEventListener('playing', () => { msg.hidden = true; });
    v.addEventListener('canplay', () => { msg.hidden = true; });
    v.addEventListener('timeupdate', () => {
      if (!isFinite(v.duration)) return;
      if (!dragging) { seek.value = Math.round(v.currentTime / v.duration * 1000); $('#time').textContent = fmt(v.currentTime); }
      if (loopA !== null && loopB === null) drawMarks();
      if (now() - lastSave > 5000) saveProgress();
    });
    v.addEventListener('loadedmetadata', () => {
      $('#dur').textContent = fmt(v.duration);
      if (v.dataset.resumeAt) { v.currentTime = +v.dataset.resumeAt; delete v.dataset.resumeAt; return; }
      const p = prog(id);
      if (tParam !== null) v.currentTime = tParam;
      else if (p && !p.done && p.t > 5 && p.t < v.duration - 15) {
        v.currentTime = p.t;
        toast('Resumed at ' + fmt(p.t), { label: 'Start over', fn: () => { v.currentTime = 0; } });
      }
      drawMarks();
      v.play().catch(() => { msg.textContent = 'Tap ▶ to play'; msg.hidden = false; });
    });
    v.addEventListener('ended', () => {
      saveProgress(); setDone(id, true);
      $('#doneBtn').textContent = '✓ Done'; $('#doneBtn').className = 'btn primary';
      if (next) toast('Finished! 🎉', { label: 'Next video ›', fn: () => { location.hash = '#/watch/' + enc(next.id); } });
      else toast('Finished this series! 🎉');
    });
    // OneDrive video links expire after a while; quietly get a fresh one and continue.
    v.addEventListener('error', async () => {
      if (!alive || retrying || DEMO) { if (DEMO) { msg.textContent = 'Demo video missing'; msg.hidden = false; } return; }
      retrying = true;
      const t = v.currentTime, wasPlaying = !v.paused;
      try { v.dataset.resumeAt = t; v.src = await videoUrl(id); if (wasPlaying) v.play().catch(() => {}); }
      catch (e) { msg.textContent = navigator.onLine ? 'Could not load the video.' : 'You are offline. Videos need internet.'; msg.hidden = false; }
      setTimeout(() => { retrying = false; }, 10000);
    });

    // desktop keyboard: space, ←, →
    function onKey(e) {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('#dlg').open) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') skip(-10);
      else if (e.key === 'ArrowRight') skip(10);
    }
    document.addEventListener('keydown', onKey);
    const onHide = () => { if (document.visibilityState === 'hidden') saveProgress(); };
    document.addEventListener('visibilitychange', onHide);

    cleanup = () => {
      alive = false; saveProgress(); clearInterval(loopTimer); clearTimeout(hideTimer); clearTimeout(tapTimer);
      if (noteTimer) { clearTimeout(noteTimer); Store.d.notes[id] = { text: $('#notes').value, updated: now() }; Store.save(); }
      v.pause(); v.removeAttribute('src'); v.load();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onHide);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };

    renderBms();
    const src = await videoUrl(id);
    if (alive) v.src = src;
  }

  function addDrill(text, itemId, t) {
    const d = { id: uid(), text, itemId: itemId || null, t: t ?? null, done: false, created: now(), updated: now() };
    Store.d.drills[d.id] = d;
    return d;
  }

  // #10 search, #11 drill list, plus all notes
  function Study(tab) {
    const tabs = [['bookmarks', '🔖 Bookmarks'], ['notes', '📝 Notes'], ['drills', '🥋 Drills']];
    app.innerHTML = `<h1>Study</h1>
      <div class="seg">${tabs.map(([k, l]) => `<a href="#/study?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${tab === 'drills' ? `<div class="addrow"><input id="drillIn" maxlength="200" placeholder="Add a move to practice…"><button class="btn primary" id="drillAdd">Add</button></div>` : ''}
      <input id="q" class="search" type="search" placeholder="Search ${tab}… (e.g. kimura)" value="${esc(sessionStorage.getItem('bjj.q') || '')}">
      <div id="studyList"></div>`;
    const draw = () => {
      const q = $('#q').value.trim().toLowerCase();
      sessionStorage.setItem('bjj.q', $('#q').value);
      const vname = itemId => { const e = Library.get(itemId); return e ? e.v.name : 'Video not in library'; };
      const match = (...xs) => !q || xs.some(x => String(x || '').toLowerCase().includes(q));
      let html = '';
      if (tab === 'bookmarks') {
        const list = Store.bookmarks().filter(b => match(b.label, vname(b.itemId), Library.get(b.itemId) && Library.get(b.itemId).s.name)).sort((a, b) => b.created - a.created);
        html = list.length ? `<ul class="list">${list.map(b => `
          <li class="srow"><a href="#/watch/${enc(b.itemId)}?t=${Math.floor(b.t)}"><b>${esc(b.label)}</b><small>${esc(vname(b.itemId))} · ${fmt(b.t)}</small></a>
            <button class="ibtn" data-act="drillBm" data-id="${esc(b.id)}" aria-label="Add to drills">+🥋</button>
            <button class="ibtn" data-act="delBm" data-id="${esc(b.id)}" aria-label="Delete">🗑</button></li>`).join('')}</ul>`
          : emptyState(q ? 'No matches' : 'No bookmarks yet', q ? 'Try another word.' : 'While watching, tap 🔖 Mark to save a moment.');
      } else if (tab === 'notes') {
        const list = Object.entries(Store.d.notes).filter(([k, n]) => !n.deleted && n.text.trim() && match(n.text, vname(k))).sort((a, b) => b[1].updated - a[1].updated);
        html = list.length ? `<ul class="list">${list.map(([k, n]) => `
          <li class="srow note"><a href="#/watch/${enc(k)}"><b>${esc(vname(k))}</b><p>${esc(n.text)}</p><small>${ago(n.updated)}</small></a></li>`).join('')}</ul>`
          : emptyState(q ? 'No matches' : 'No notes yet', q ? 'Try another word.' : 'Write notes under any video.');
      } else {
        const list = Store.drills().filter(d => match(d.text, d.itemId && vname(d.itemId))).sort((a, b) => (a.done - b.done) || (b.created - a.created));
        const doneN = list.filter(d => d.done).length;
        html = list.length ? `<ul class="list">${list.map(d => `
          <li class="drow ${d.done ? 'done' : ''}"><button class="check ${d.done ? 'on' : ''}" data-act="toggleDrill" data-id="${esc(d.id)}" aria-label="Done">✓</button>
            <span class="dtxt">${esc(d.text)}${d.itemId ? `<small>${esc(vname(d.itemId))}${d.t !== null ? ' · ' + fmt(d.t) : ''}</small>` : ''}</span>
            ${d.itemId ? `<a class="ibtn" href="#/watch/${enc(d.itemId)}${d.t !== null ? '?t=' + Math.floor(d.t) : ''}" aria-label="Watch">▶</a>` : ''}
            <button class="ibtn" data-act="delDrill" data-id="${esc(d.id)}" aria-label="Delete">🗑</button></li>`).join('')}</ul>
            ${doneN ? `<button class="btn ghost full" data-act="clearDrills">Clear ${doneN} finished</button>` : ''}`
          : emptyState(q ? 'No matches' : 'Drill list is empty', q ? 'Try another word.' : 'Add moves you want to practice this week.');
      }
      $('#studyList').innerHTML = html;
    };
    $('#q').addEventListener('input', draw);
    if (tab === 'drills') {
      const add = () => { const t = $('#drillIn').value.trim(); if (!t) return; addDrill(t); Store.save(); $('#drillIn').value = ''; draw(); };
      $('#drillAdd').onclick = add;
      $('#drillIn').onkeydown = e => { if (e.key === 'Enter') add(); };
    }
    refresh = draw;
    draw();
  }

  async function Picker(folderId) {
    if (DEMO) {
      app.innerHTML = `<h1>Choose folder</h1><p class="muted">Demo mode: loads sample folders.</p><button class="btn primary full" id="use">Use demo folder</button>`;
      $('#use').onclick = () => { Store.d.settings = { rootId: 'demo', rootName: 'Demo', updated: now() }; Store.save(); Library.set(demoLibrary()); location.hash = '#/'; };
      return;
    }
    app.innerHTML = '<div class="center"><div class="spinner"></div></div>';
    const [me, kids] = await Promise.all([graph(`/me/drive/items/${enc(folderId)}`), listChildren(folderId)]);
    const name = folderId === 'root' ? 'My files' : (me ? me.name : 'Folder');
    const parent = folderId !== 'root' && me && me.parentReference && me.parentReference.id;
    const folders = kids.filter(k => k.folder).sort(natural);
    const vids = kids.filter(isVideo).length;
    app.innerHTML = `<h1>Choose your BJJ folder</h1>
      <p class="muted">Open the folder that holds your instructionals, then tap the green button.</p>
      <div class="crumb">${parent ? `<a class="btn ghost sm" href="#/pick/${enc(parent)}">‹ Up</a>` : ''}<b>📁 ${esc(name)}</b></div>
      ${folderId !== 'root' ? `<button class="btn primary full" id="use">✓ Use "${esc(name)}"</button>` : ''}
      <ul class="list">${folders.map(f => `<li><a class="frow" href="#/pick/${enc(f.id)}">📁 ${esc(f.name)}<small>${f.folder.childCount} items ›</small></a></li>`).join('') || '<li class="muted small">No folders inside.</li>'}</ul>
      ${vids ? `<p class="muted small">${vids} video${vids === 1 ? '' : 's'} directly in this folder.</p>` : ''}`;
    const use = $('#use');
    if (use) use.onclick = () => {
      Store.d.settings = { ...Store.d.settings, rootId: folderId, rootName: name, updated: now() };
      Store.save(); Library.set(null); location.hash = '#/';
    };
  }

  function Settings() {
    const t = Auth.tokens || {};
    const lib = Library.data;
    const count = lib ? lib.series.reduce((n, s) => n + s.videos.length, 0) : 0;
    const theme = localStorage.getItem('bjj.theme') || 'dark';
    const standalone = matchMedia('(display-mode: standalone)').matches;
    app.innerHTML = `<h1>Settings</h1>
      <div class="panel"><h3>📁 Library</h3>
        <p>Folder: <b>${esc(Store.d.settings.rootName || 'not chosen')}</b><br><span class="muted small">${count} videos · checked ${ago(lib && lib.scannedAt)}</span></p>
        <div class="btns"><a class="btn ghost" href="#/pick/root">Change folder</a><button class="btn ghost" id="rescan">Rescan for new videos</button></div></div>
      <div class="panel"><h3>📱 App</h3>
        ${standalone ? '<p>Installed on your home screen ✓</p>' : installEvt ? '<button class="btn primary" id="install">Add to home screen</button>' : '<p class="small">To add it to your home screen: in Chrome tap <b>⋮</b> then <b>Add to Home screen</b>.</p>'}
        <div class="btns"><button class="btn ghost" id="theme">${theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}</button></div></div>
      <div class="panel"><h3>☁️ Backup</h3>
        <p class="small">Bookmarks, notes and progress are saved on this phone and backed up to a private app folder in your OneDrive (<b>Apps › Mat Study</b>).<br><span class="muted">Last backup: ${DEMO ? 'demo mode' : ago(Sync.last)}${Sync.failed ? ' (will retry)' : ''}</span></p>
        <div class="btns"><button class="btn ghost" id="syncNow">Back up now</button><button class="btn ghost" id="export">Download a copy</button></div></div>
      <div class="panel"><h3>🔒 Safety</h3>
        <ul class="small plain">
          <li>✓ Only your Microsoft account can open this app.</li>
          <li>✓ It can only <b>read</b> your files. It cannot change or delete them.</li>
          <li>✓ No server and no other company in between: your phone talks straight to Microsoft.</li>
        </ul>
        ${DEMO ? '' : `<p class="small">Signed in as <b>${esc(t.name || 'you')}</b></p><button class="btn danger" id="signout">Sign out</button>`}</div>`;
    $('#rescan').onclick = async () => { const b = $('#rescan'); b.disabled = true; b.textContent = 'Scanning…'; try { await Library.scan(); toast('Library updated ✓'); } catch (e) { fail(e); return; } route(); };
    $('#theme').onclick = () => { localStorage.setItem('bjj.theme', theme === 'dark' ? 'light' : 'dark'); applyTheme(); route(); };
    $('#syncNow').onclick = async () => { Sync.dirty = true; await Sync.run(); toast(Sync.failed ? 'Backup failed, will retry' : 'Backed up ✓'); route(); };
    $('#export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.d, null, 2)], { type: 'application/json' }));
      a.download = 'mat-study-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const inst = $('#install');
    if (inst) inst.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; route(); };
    const so = $('#signout');
    if (so) so.onclick = () => { if (confirm('Sign out of Mat Study?')) Auth.signOut(); };
  }

  // ---------- list actions (buttons with data-act)
  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.preventDefault();
    const { act, id } = b.dataset;
    const bm = id && Store.d.bookmarks[id];
    if (act === 'seek' && seekHere) seekHere(+b.dataset.t);
    else if (act === 'toggleDone') { setDone(id, !isDone(id)); route(); return; }
    else if (act === 'toggleFav') { toast(toggleFav(id) ? 'Added to favorites ⭐' : 'Removed from favorites'); route(); return; }
    else if (act === 'allDone') {
      const s = Library.series(id);
      if (s && confirm(`Mark all ${s.videos.length} videos in "${s.name}" as done?`)) { s.videos.forEach(v => setDone(v.id, true)); route(); }
      return;
    } else if (act === 'rmAdd') {
      if (!rmIds().includes(id)) setRoadmap([...rmIds(), id]);
      toast(`Added as roadmap step ${rmIds().length} 🗺️`); route(); return;
    } else if (act === 'rmUp' || act === 'rmDown' || act === 'rmDel') {
      const ids = [...rmIds()], i = ids.indexOf(id);
      if (i < 0) return;
      if (act === 'rmDel') {
        const before = [...ids]; ids.splice(i, 1); setRoadmap(ids);
        toast('Removed from roadmap', { label: 'Undo', fn: () => { setRoadmap(before); route(); } });
      } else {
        const j = act === 'rmUp' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]]; setRoadmap(ids);
      }
      route(); return;
    }
    else if (act === 'drillBm' && bm) { addDrill(bm.label, bm.itemId, bm.t); Store.save(); toast('Added to drill list 🥋'); }
    else if (act === 'renameBm' && bm) {
      const r = await ask({ title: 'Rename bookmark', value: bm.label });
      if (r && r.text) { Store.d.bookmarks[id] = { ...bm, label: r.text, updated: now() }; Store.save(); }
    } else if (act === 'delBm' && bm) {
      Store.d.bookmarks[id] = { ...bm, deleted: true, updated: now() }; Store.save();
      toast('Bookmark deleted', { label: 'Undo', fn: () => { Store.d.bookmarks[id] = { ...bm, updated: now() }; Store.save(); if (refresh) refresh(); } });
    } else if (act === 'toggleDrill') { const d = Store.d.drills[id]; Store.d.drills[id] = { ...d, done: !d.done, updated: now() }; Store.save(); }
    else if (act === 'delDrill') {
      const d = Store.d.drills[id]; Store.d.drills[id] = { ...d, deleted: true, updated: now() }; Store.save();
      toast('Drill deleted', { label: 'Undo', fn: () => { Store.d.drills[id] = { ...d, updated: now() }; Store.save(); if (refresh) refresh(); } });
    } else if (act === 'clearDrills') { Store.drills().filter(d => d.done).forEach(d => { Store.d.drills[d.id] = { ...d, deleted: true, updated: now() }; }); Store.save(); }
    if (refresh) refresh();
  });

  // ---------- gate screens (shown before the app opens)
  function gate(html) { showTabs(false); app.innerHTML = `<div class="empty gate">${html}</div>`; }
  function screenNeedsSetup() {
    gate(`<div class="big-emoji">🔧</div><h2>Almost ready</h2><p>This app is not connected to Microsoft yet. Open <b>SETUP.md</b> and follow step 1.</p>
      ${IS_LOCAL ? '<p><a class="btn ghost" href="?demo#/">Try demo mode</a></p>' : ''}`);
  }
  function screenSignIn(note) {
    teardown();
    gate(`<div class="big-emoji">🥋</div><h2>Mat Study</h2><p>${esc(note || 'Your private BJJ instructional player.')}</p>
      <button class="btn primary big" id="signin">Sign in with Microsoft</button>`);
    $('#signin').onclick = () => Auth.login(!Auth.tokens);
  }
  function screenOwner(code) {
    gate(`<div class="big-emoji">🔑</div><h2>One last step</h2>
      <p>This is your <b>owner code</b>. Send it to Claude, or paste it into <b>config.js</b> as OWNER_HASH. After that, only your account can open this app.</p>
      <code class="owner" id="code">${esc(code)}</code>
      <button class="btn primary" id="copy">Copy code</button>`);
    $('#copy').onclick = () => navigator.clipboard.writeText(code).then(() => toast('Copied ✓'));
  }
  function screenBlocked() {
    gate(`<div class="big-emoji">⛔</div><h2>Private app</h2><p>This app only works for its owner's Microsoft account.</p>
      <button class="btn ghost" id="other">Use a different account</button>`);
    $('#other').onclick = () => Auth.login(true);
  }

  // ---------- start
  async function start() {
    applyTheme(); updateNet();
    if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!DEMO) {
      if (!CFG.CLIENT_ID) return screenNeedsSetup();
      try { await Auth.handleRedirect(); } catch (e) { return screenSignIn(e.message); }
      const t = Auth.tokens;
      if (!t || !t.oid) return screenSignIn();
      const code = await ownerCode(t.oid);
      if (!CFG.OWNER_HASH) return screenOwner(code);
      if (code !== CFG.OWNER_HASH) { Auth.tokens = null; return screenBlocked(); }
    }
    showTabs(true);
    window.addEventListener('hashchange', route);
    route();
    if (DEMO) return;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && Sync.dirty) Sync.run(); });
    // Get latest bookmarks/notes from OneDrive, then look for new videos if the list is old.
    const changed = await Sync.run();
    const atHome = !location.hash || location.hash === '#/';
    if (changed && !location.hash.startsWith('#/watch')) route();
    const lib = Library.data, st = Store.d.settings;
    if (st.rootId && lib && lib.rootId === st.rootId && now() - lib.scannedAt > 6 * 3600 * 1000 && navigator.onLine) {
      try { await Library.scan(); if (atHome && (!location.hash || location.hash === '#/')) route(); } catch (e) { console.warn('scan', e); }
    }
  }
  start();
})();
