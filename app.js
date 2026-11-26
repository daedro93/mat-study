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
  const isToc = it => !!it.file && /\.html?$/i.test(it.name) && (it.size || 0) < 2e6;

  // ---------- table-of-contents files
  // The file is only read as text. Its code is never run.
  const TS = /^\d{1,2}(?::\d{1,2}){1,2}$/;
  const toSec = s => String(s).trim().split(':').reduce((a, x) => a * 60 + (+x || 0), 0);
  // Turns a JavaScript object written in the file into JSON (quotes the keys, fixes quotes).
  function jsToJson(src) {
    let out = '', i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src[j] + (src[j + 1] || ''); j += 2; } else s += src[j++]; }
        if (c === "'") s = s.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"');
        out += '"' + s + '"'; i = j + 1; continue;
      }
      const w = /^[A-Za-z_$\d][\w$]*/.exec(src.slice(i, i + 64));
      if (w) { out += /^\s*:/.test(src.slice(i + w[0].length, i + w[0].length + 20)) ? '"' + w[0] + '"' : w[0]; i += w[0].length; continue; }
      out += c; i++;
    }
    return out.replace(/,(\s*[\]}])/g, '$1');
  }
  function parseToc(text) {
    const vols = {};
    const title = ((text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim();
    // Style 1: data = { 1: [["Chapter name", "0:00"], ...], 2: [...] }
    const m = text.match(/\bdata\s*=\s*\{/);
    if (m) {
      const start = m.index + m[0].length - 1;
      let depth = 0, q = null, end = -1;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { end = i; break; }
      }
      try {
        const obj = end > 0 ? JSON.parse(jsToJson(text.slice(start, end + 1))) : {};
        for (const [k, rows] of Object.entries(obj)) {
          if (!Array.isArray(rows)) continue;
          const list = rows.filter(r => Array.isArray(r) && r.length >= 2).map(([a, b]) => {
            const ts = TS.test(String(b).trim()) ? b : a, nm = ts === b ? a : b;
            return TS.test(String(ts).trim()) ? { t: toSec(ts), name: String(nm).slice(0, 200) } : null;
          }).filter(Boolean);
          if (list.length) vols[k] = list;
        }
      } catch { /* try the plain-text way below */ }
    }
    // Style 2: plain lines like "Vol 1" then "3:23 Snap downs" or "Snap downs - 3:23"
    if (!Object.keys(vols).length) {
      const plain = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|section)>/gi, '\n').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      let cur = '1';
      for (const line of plain.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
        const t = line.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
        const h = !t && line.match(/^(?:vol(?:ume)?|part|disc|dvd)\.?\s*(\d{1,3})\b/i);
        if (h) { cur = h[1]; continue; }
        if (!t) continue;
        const name = line.replace(t[1], '').replace(/^[\s\-–|:.)]+|[\s\-–|:.(]+$/g, '').slice(0, 200);
        if (name) (vols[cur] = vols[cur] || []).push({ t: toSec(t[1]), name });
      }
    }
    return { title, vols };
  }
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
  // Run fn over items, at most `limit` at a time, keeping the original order.
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
    }));
    return out;
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
  // A popup with one big button per choice. Resolves to the chosen value, or null.
  function choose(title, options) {
    return new Promise(resolve => {
      const d = $('#dlg');
      d.innerHTML = `<h3>${esc(title)}</h3><div class="choices">${options.map((o, i) => `<button class="btn ghost full" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>
        <div class="dlg-btns"><button class="btn ghost" id="dlgNo">Cancel</button></div>`;
      let finished = false;
      const done = v => { if (finished) return; finished = true; d.close(); resolve(v); };
      $$('.choices button', d).forEach(b => { b.onclick = () => done(options[+b.dataset.i].value); });
      $('#dlgNo').onclick = () => done(null);
      d.oncancel = e => { e.preventDefault(); done(null); };
      d.showModal();
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
    if ((r.status === 429 || r.status === 503) && retry) { // OneDrive says "slow down": wait, then try once more
      await new Promise(res => setTimeout(res, Math.min(30, +r.headers.get('Retry-After') || 3) * 1000));
      return graph(path, opts, false);
    }
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
  const blank = () => ({ progress: {}, notes: {}, bookmarks: {}, drills: {}, favs: {}, dlists: {}, roadmaps: {}, snotes: {}, tags: {}, tagdefs: {}, toc: {}, roadmap: { steps: [], updated: 0 }, settings: { updated: 0 } });
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
      dlists: mergeMap(a.dlists, b.dlists), roadmaps: mergeMap(a.roadmaps, b.roadmaps), snotes: mergeMap(a.snotes, b.snotes),
      tags: mergeMap(a.tags, b.tags), tagdefs: mergeMap(a.tagdefs, b.tagdefs), toc: mergeMap(a.toc, b.toc),
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
          migrate();
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
        const tocs = new Map(); // instructional id -> table-of-contents file found in its folder
        const noteToc = (sid, k) => { if (!tocs.has(sid)) tocs.set(sid, k); };
        const collect = async (folderId, out, depth, prefix, sid) => {
          for (const k of (await listChildren(folderId)).sort(natural)) {
            if (k.folder && depth < 4) await collect(k.id, out, depth + 1, prefix ? prefix + ' / ' + k.name : k.name, sid);
            else if (isVideo(k)) out.push(mapVid(k, prefix));
            else if (isToc(k)) noteToc(sid, k);
          }
        };
        // Layout: BJJ folder / Instructor folder / Instructional folder / (Vol folders) / videos.
        // A top folder that only holds videos is an instructional by itself.
        // A top folder with sub-folders is an instructor (group); each sub-folder is one instructional.
        const series = [], loose = [];
        let found = 0;
        const step = add => { found += add; if (onStep) onStep(found); };
        for (const it of (await listChildren(st.rootId)).sort(natural)) {
          if (!it.folder) { if (isVideo(it)) loose.push(mapVid(it, '')); continue; }
          const kids = (await listChildren(it.id)).sort(natural);
          const direct = kids.filter(isVideo).map(k => mapVid(k, ''));
          const subs = kids.filter(k => k.folder);
          if (!subs.length) {
            if (direct.length) { series.push({ id: it.id, name: it.name, group: null, videos: direct }); step(direct.length); const t = kids.find(isToc); if (t) noteToc(it.id, t); }
            continue;
          }
          const group = { id: it.id, name: it.name };
          const inner = await mapLimit(subs, 6, async sf => {
            const vids = [];
            await collect(sf.id, vids, 0, '', sf.id);
            step(vids.length);
            return vids.length ? { id: sf.id, name: sf.name, group, videos: vids } : null;
          });
          if (direct.length) { series.push({ id: it.id, name: it.name + ' (other videos)', group, videos: direct }); step(direct.length); }
          series.push(...inner.filter(Boolean));
        }
        if (loose.length) series.unshift({ id: st.rootId, name: st.rootName || 'Videos', group: null, videos: loose });
        this.set({ v: 2, rootId: st.rootId, scannedAt: now(), series });
        await this.loadTocs(tocs);
      } finally { this.scanning = false; }
    },
    // Load chapters from new or changed table-of-contents files. A file you added by hand wins.
    async loadTocs(tocs) {
      let added = 0;
      await mapLimit([...tocs].filter(([sid, k]) => {
        const old = Store.d.toc[sid];
        return !(old && !old.deleted && old.src === 'file') && !(old && !old.deleted && old.fileId === k.id && old.mod === k.lastModifiedDateTime);
      }), 4, async ([sid, k]) => {
        try {
          const url = k['@microsoft.graph.downloadUrl'] || ((await graph(`/me/drive/items/${enc(k.id)}`)) || {})['@microsoft.graph.downloadUrl'];
          if (!url) return;
          const p = parseToc(await (await fetch(url)).text());
          if (!Object.keys(p.vols).length) return;
          Store.d.toc[sid] = { ...p, src: 'auto', file: k.name, fileId: k.id, mod: k.lastModifiedDateTime, updated: now() };
          added++;
        } catch (e) { console.warn('toc', k.name, e); }
      });
      if (added) Store.save();
      return added;
    },
    // Quick chapter-file check: asks OneDrive search for .html files instead of opening every folder.
    async findTocs() {
      const st = Store.d.settings, lib = this.data;
      if (!lib || !st.rootId) return { found: 0, added: 0 };
      if (DEMO) return { found: 0, added: 0 };
      const sids = new Set(lib.series.map(s => s.id));
      let files = [];
      try {
        let url = `/me/drive/items/${enc(st.rootId)}/search(q='html')?$top=200`;
        while (url) { const j = await graph(url); if (!j) break; files.push(...j.value.filter(isToc)); url = j['@odata.nextLink']; }
      } catch (e) { console.warn('toc search', e); files = []; }
      // Which instructional each file belongs to: walk up its folders until we reach one.
      const up = new Map();
      const seriesOf = async (pid, depth = 0) => {
        if (!pid || depth > 6 || pid === st.rootId) return null;
        if (sids.has(pid)) return pid;
        if (!up.has(pid)) { const it = await graph(`/me/drive/items/${enc(pid)}?$select=id,parentReference`); up.set(pid, it && it.parentReference && it.parentReference.id); }
        return seriesOf(up.get(pid), depth + 1);
      };
      const tocs = new Map();
      for (const f of files.sort(natural)) {
        const sid = await seriesOf(f.parentReference && f.parentReference.id);
        if (sid && !tocs.has(sid)) tocs.set(sid, f);
      }
      // Search can miss brand-new files for a few minutes; then look inside each instructional folder instead.
      if (!files.length) {
        const look = async (folderId, sid, depth) => {
          for (const k of await listChildren(folderId)) {
            if (k.folder && depth < 4) await look(k.id, sid, depth + 1);
            else if (isToc(k) && !tocs.has(sid)) tocs.set(sid, k);
          }
        };
        await mapLimit(lib.series.filter(s => !/ \(other videos\)$/.test(s.name)), 6, s => look(s.id, s.id, 0));
      }
      return { found: tocs.size, added: await this.loadTocs(tocs) };
    },
  };
  Library.reindex();

  function demoLibrary() {
    const mk = (sid, names) => names.map((n, i) => ({ id: sid + '-' + i, name: n, sub: '', size: 0, thumb: '' }));
    const jd = { id: 'jd', name: 'John Danaher' }, gr = { id: 'gr', name: 'Gordon Ryan' };
    return {
      v: 2, rootId: 'demo', scannedAt: now(), series: [
        { id: 'a', name: 'Ageless Jiu Jitsu - Top Game (Gi)', group: null, videos: mk('a', [1, 2, 3, 4, 5, 6, 7, 8].map(n => 'Ageless Top Game Gi ' + n)) },
        { id: 'k', name: 'Kimura Trap', group: null, videos: mk('k', ['Chapter 1 - The Grip', 'Chapter 2 - From Closed Guard']) },
        { id: 'g', name: 'Guard Retention System', group: jd, videos: mk('g', ['Vol 1 - Frames and Distance', 'Vol 2 - Hip Escapes', 'Vol 3 - Inversions', 'Vol 4 - Recovering Guard']) },
        { id: 'l', name: 'Leg Locks Enter the System', group: jd, videos: mk('l', ['Part 1 - Ashi Garami', 'Part 2 - Heel Hook Mechanics', 'Part 3 - Escapes']) },
        { id: 'b', name: 'Back Attacks Enter the System', group: jd, videos: mk('b', ['Vol 1 - Back Control', 'Vol 2 - Body Triangle', 'Vol 3 - Strangles']) },
        { id: 'p', name: 'Systematically Attacking the Guard', group: gr, videos: mk('p', ['Part 1 - Standing Passing', 'Part 2 - Body Lock Pass']) },
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

  // ---------- tags (ready-made + your own), on videos and instructionals
  const PRESET_TAGS = ['Guard passing', 'Guard retention', 'Closed guard', 'Half guard', 'Open guard', 'Butterfly guard', 'De La Riva',
    'Leg locks', 'Back attacks', 'Mount', 'Side control', 'Turtle', 'Escapes', 'Sweeps', 'Takedowns', 'Wrestling',
    'Chokes', 'Arm locks', 'Submissions', 'Fundamentals', 'Gi', 'No-gi', 'Self defense', 'Conditioning'];
  const customTags = () => Object.values(Store.d.tagdefs).filter(t => !t.deleted).map(t => t.name).sort((a, b) => a.localeCompare(b));
  const allTags = () => [...PRESET_TAGS, ...customTags().filter(t => !PRESET_TAGS.includes(t))];
  const tagsOf = id => { const live = new Set(allTags()); return ((Store.d.tags[id] && Store.d.tags[id].list) || []).filter(t => live.has(t)); };
  function setTags(id, list) { Store.d.tags[id] = { list, updated: now() }; Store.save(); }
  // A video's own tags plus the tags of its instructional.
  const effTags = (v, s) => [...new Set([...tagsOf(v.id), ...tagsOf(s.id)])];
  function usedTags() {
    const count = new Map();
    for (const id of Object.keys(Store.d.tags)) {
      if (!Library.get(id) && !Library.series(id)) continue;
      for (const t of tagsOf(id)) count.set(t, (count.get(t) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
  }
  const tagLink = (t, cls = '') => `<a class="tag ${cls}" href="#/tag/${enc(t)}">${esc(t)}</a>`;
  // Tag chips + the edit button. `inh` = instructional whose tags this video inherits.
  function tagsInner(id, inh) {
    const own = tagsOf(id), inherited = inh ? tagsOf(inh).filter(t => !own.includes(t)) : [];
    return own.map(t => tagLink(t)).join('') + inherited.map(t => tagLink(t, 'inh')).join('')
      + `<button class="tag add" data-act="editTags" data-id="${esc(id)}">🏷️ ${own.length ? 'Edit tags' : '+ Add tags'}</button>`;
  }
  const tagBox = (id, inh) => `<div class="tags" data-for="${esc(id)}" data-inh="${esc(inh || '')}">${tagsInner(id, inh)}</div>`;
  // Popup: tap tags to turn them on/off, or create a new one.
  function pickTags(title, selected) {
    return new Promise(resolve => {
      const d = $('#dlg'), sel = new Set(selected);
      let finished = false;
      const done = v => { if (finished) return; finished = true; d.close(); resolve(v); };
      const draw = (typed = '') => {
        d.innerHTML = `<h3>${esc(title)}</h3>
          <div class="tagpick">${allTags().map((t, i) => `<button class="chip ${sel.has(t) ? 'on' : ''}" data-i="${i}">${sel.has(t) ? '✓ ' : ''}${esc(t)}</button>`).join('')}</div>
          <div class="addrow"><input id="newTag" maxlength="40" placeholder="Make your own tag…" value="${esc(typed)}"><button class="btn ghost" id="addTag">+ Add</button></div>
          <div class="dlg-btns"><button class="btn ghost" id="dlgNo">Cancel</button><button class="btn primary" id="dlgOk">Save</button></div>`;
        const tags = allTags();
        $$('.tagpick .chip', d).forEach(b => { b.onclick = () => { const t = tags[+b.dataset.i]; sel.has(t) ? sel.delete(t) : sel.add(t); draw($('#newTag').value); }; });
        const add = () => {
          const name = $('#newTag').value.trim().replace(/\s+/g, ' ');
          if (!name) return;
          const existing = allTags().find(t => t.toLowerCase() === name.toLowerCase());
          if (existing) sel.add(existing);
          else { Store.d.tagdefs[name.toLowerCase()] = { name, created: now(), updated: now() }; Store.save(); sel.add(name); }
          draw();
        };
        $('#addTag').onclick = add;
        $('#newTag').onkeydown = e => { if (e.key === 'Enter') add(); };
        $('#dlgOk').onclick = () => done(allTags().filter(t => sel.has(t)));
        $('#dlgNo').onclick = () => done(null);
      };
      d.oncancel = e => { e.preventDefault(); done(null); };
      draw();
      d.showModal();
    });
  }

  // ---------- roadmaps (named study orders of instructionals, each with notes + drills)
  // The first version had one unnamed roadmap; turn it into "My roadmap".
  function migrate() {
    const old = Store.d.roadmap;
    if (old && old.steps && old.steps.length && !Store.d.roadmaps['rm-main']) {
      Store.d.roadmaps['rm-main'] = { id: 'rm-main', name: 'My roadmap', steps: [...old.steps], notes: '', created: 1, updated: old.updated || now() };
      writeJSON('bjj.data.v1', Store.d);
    }
  }
  migrate();
  const byCreated = (a, b) => (a.created || 0) - (b.created || 0);
  const roadmaps = () => Object.values(Store.d.roadmaps).filter(r => !r.deleted).sort(byCreated);
  function curRoadmap() {
    const all = roadmaps(), id = localStorage.getItem('bjj.rm');
    return all.find(r => r.id === id) || all[0] || null;
  }
  function saveRm(r) { Store.d.roadmaps[r.id] = { ...r, updated: now() }; Store.save(); return Store.d.roadmaps[r.id]; }
  function newRoadmap(name) {
    const r = { id: uid(), name, steps: [], notes: '', created: now(), updated: now() };
    Store.d.roadmaps[r.id] = r; Store.save(); localStorage.setItem('bjj.rm', r.id);
    return r;
  }
  const rmSteps = r => r.steps.map(id => Library.series(id)).filter(Boolean);
  function nextOf(r) {
    const steps = rmSteps(r);
    const i = steps.findIndex(s => !seriesDone(s));
    if (i < 0) return null;
    const s = steps[i];
    return { r, s, v: s.videos.find(v => !isDone(v.id)), step: i + 1, total: steps.length };
  }
  // Ask which roadmap (only when there is more than one).
  async function pickRoadmap(title) {
    const all = roadmaps();
    if (!all.length) {
      const r = await ask({ title: 'Name your first roadmap', placeholder: 'e.g. Leg lock path', okLabel: 'Create' });
      return r ? newRoadmap(r.text || 'My roadmap') : null;
    }
    if (all.length === 1) return all[0];
    const id = await choose(title, all.map(r => ({ label: '🗺️ ' + r.name, value: r.id })));
    return id ? Store.d.roadmaps[id] : null;
  }

  // ---------- drill lists (General + your own named lists + one per roadmap)
  const dlists = () => Object.values(Store.d.dlists).filter(l => !l.deleted).sort(byCreated);
  // A drill whose list was deleted falls back to General.
  const listOf = d => (d.listId && ((Store.d.dlists[d.listId] && !Store.d.dlists[d.listId].deleted) || (Store.d.roadmaps[d.listId] && !Store.d.roadmaps[d.listId].deleted))) ? d.listId : null;
  const allLists = () => [{ id: null, name: 'General' }, ...dlists().map(l => ({ id: l.id, name: l.name })), ...roadmaps().map(r => ({ id: r.id, name: '🗺️ ' + r.name }))];
  const listName = id => (allLists().find(l => l.id === id) || { name: 'General' }).name;
  function makeList(name) {
    const l = { id: uid(), name: name || 'New list', created: now(), updated: now() };
    Store.d.dlists[l.id] = l; Store.save();
    return l;
  }
  async function pickList() {
    const last = localStorage.getItem('bjj.lastList');
    const opts = allLists().map(l => ({ label: l.name, value: l.id === null ? 'general' : l.id }));
    if (last) opts.sort((a, b) => (b.value === last) - (a.value === last)); // last used first
    opts.push({ label: '➕ New list…', value: 'new' });
    const v = await choose('Add to which drill list?', opts);
    if (!v) return null;
    if (v === 'new') {
      const r = await ask({ title: 'Name your new drill list', placeholder: 'e.g. Guard drills', okLabel: 'Create' });
      if (!r) return null;
      const l = makeList(r.text);
      localStorage.setItem('bjj.lastList', l.id);
      return { id: l.id };
    }
    localStorage.setItem('bjj.lastList', v);
    return { id: v === 'general' ? null : v };
  }
  // Bookmark popup: a name, plus which drill list (if any) to also add it to.
  function askBookmark(t) {
    return new Promise(resolve => {
      const d = $('#dlg');
      const last = localStorage.getItem('bjj.bmList') || '';
      const lists = allLists().map(l => ({ name: l.name, value: l.id === null ? 'general' : l.id }));
      const sel = lists.some(l => l.value === last) ? last : '';
      d.innerHTML = `<h3>Bookmark at ${fmt(t)}</h3>
        <input id="dlgIn" maxlength="200" autocomplete="off" placeholder="e.g. Kimura grip detail">
        <label class="fld">🥋 Also add as a drill to:
          <select id="dlgList">
            <option value="">No, just a bookmark</option>
            ${lists.map(l => `<option value="${esc(l.value)}" ${l.value === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
            <option value="new">➕ New list…</option>
          </select></label>
        <input id="dlgNew" maxlength="80" autocomplete="off" placeholder="Name the new list, e.g. Guard drills" hidden>
        <div class="dlg-btns"><button class="btn ghost" id="dlgNo">Cancel</button><button class="btn primary" id="dlgOk">Save</button></div>`;
      let finished = false;
      const done = ok => {
        if (finished) return; finished = true;
        let out = null;
        if (ok) {
          const v = $('#dlgList').value;
          out = { text: $('#dlgIn').value.trim(), list: null };
          if (v === 'new') out.list = { newName: $('#dlgNew').value.trim() };
          else if (v) out.list = { id: v === 'general' ? null : v };
          localStorage.setItem('bjj.bmList', v === 'new' ? '' : v);
        }
        d.close(); resolve(out);
      };
      $('#dlgList').onchange = () => { const n = $('#dlgList').value === 'new'; $('#dlgNew').hidden = !n; if (n) $('#dlgNew').focus(); };
      $('#dlgOk').onclick = () => done(true);
      $('#dlgNo').onclick = () => done(false);
      $('#dlgIn').onkeydown = e => { if (e.key === 'Enter') done(true); };
      d.oncancel = e => { e.preventDefault(); done(false); };
      d.showModal();
      setTimeout(() => $('#dlgIn').focus(), 60);
    });
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
    setTab(parts[0] === 'note' ? 'study' : ['study', 'settings', 'roadmap'].includes(parts[0]) ? parts[0] : 'home');
    window.scrollTo(0, 0);
    const page = { series: () => SeriesPage(parts[1]), watch: () => Watch(parts[1], q.has('t') ? +q.get('t') : null), roadmap: Roadmap, group: () => GroupPage(parts[1]), note: () => NotePage(parts[1]), tag: () => TagPage(parts[1]),
      study: () => Study(q.get('tab') || 'bookmarks'), settings: Settings, pick: () => Picker(parts[1] || 'root') }[parts[0]] || Home;
    Promise.resolve().then(page).catch(fail);
  }

  // ---------- pages
  function Home() {
    const lib = Library.data;
    if (!Store.d.settings.rootId) { app.innerHTML = emptyState('Pick your BJJ folder', 'Choose the OneDrive folder where your instructionals are. You only do this once.', '#/pick/root', 'Choose folder'); return; }
    if (!lib || lib.rootId !== Store.d.settings.rootId || lib.v !== 2) { return scanScreen(); }
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
    const used = usedTags();
    if (used.length) html += `<div class="chips tagrow">${used.map(t => tagLink(t)).join('')}</div>`;
    for (const nx of roadmaps().map(nextOf).filter(Boolean).slice(0, 3)) {
      html += `<a class="next-card" href="#/watch/${enc(nx.v.id)}">
        <div class="thumb">${thumb(nx.v)}${bar(nx.v.id)}</div>
        <div class="ntxt"><small>🗺️ ${esc(nx.r.name)} · step ${nx.step} of ${nx.total}</small><b>${esc(nx.s.name)}</b><span>Next: ${esc(nx.v.name)}</span></div></a>`;
    }
    const cont = continueList();
    if (cont.length) html += `<section><h2 class="row-h">▶ Continue watching</h2><div class="row">${cont.map(card).join('')}</div></section>`;
    const favV = Object.keys(Store.d.favs).filter(id => isFav(id) && Library.get(id)).map(id => Library.get(id).v);
    if (favV.length) html += `<section><h2 class="row-h">⭐ Favorite videos</h2><div class="row">${favV.map(card).join('')}</div></section>`;
    const favS = lib.series.filter(s => isFav(s.id));
    if (favS.length) html += `<section><h2 class="row-h">⭐ Favorite instructionals</h2><div class="row">${favS.map(scard).join('')}</div></section>`;
    // One row per instructor; tap the title to see all their instructionals.
    for (const g of groups(lib)) {
      html += g.group
        ? `<section><a class="row-title" href="#/group/${enc(g.group.id)}"><h2>👤 ${esc(g.group.name)}</h2><span>${g.series.length} instructional${g.series.length === 1 ? '' : 's'} ›</span></a>
            <div class="row">${g.series.map(scard).join('')}</div></section>`
        : `<section><h2 class="row-h">📼 Instructionals</h2><div class="row">${g.series.map(scard).join('')}</div></section>`;
    }
    return html;
  }

  // Groups instructionals by instructor folder, keeping folder order. Stand-alone instructionals come first.
  function groups(lib) {
    const out = [], byId = new Map(), solo = { group: null, series: [] };
    for (const s of lib.series) {
      if (!s.group) { solo.series.push(s); continue; }
      if (!byId.has(s.group.id)) { const g = { group: s.group, series: [] }; byId.set(s.group.id, g); out.push(g); }
      byId.get(s.group.id).series.push(s);
    }
    return solo.series.length ? [solo, ...out] : out;
  }
  const fullName = s => (s.group ? s.group.name + ' › ' : '') + s.name;

  // A card for a whole instructional (tap → its video list).
  function scard(s) {
    const d = doneCount(s), n = s.videos.length;
    return `<a class="card" href="#/series/${enc(s.id)}">
      <div class="thumb">${thumb(s.videos[0])}${seriesDone(s) ? '<span class="badge">✓</span>' : ''}<span class="count">${n} videos</span><div class="bar"><i data-w="${(d / n * 100).toFixed(1)}"></i></div></div>
      <div class="ct">${isFav(s.id) ? '⭐ ' : ''}${esc(s.name)}</div>${d ? `<small>${d}/${n} done</small>` : ''}</a>`;
  }
  function srow(s, extra) {
    const d = doneCount(s), n = s.videos.length;
    return `<li><a class="vrow vlink" href="#/series/${enc(s.id)}"><div class="thumb sm">${thumb(s.videos[0])}<div class="bar"><i data-w="${(d / n * 100).toFixed(1)}"></i></div></div>
      <div class="vtxt"><b>${isFav(s.id) ? '⭐ ' : ''}${seriesDone(s) ? '✓ ' : ''}${esc(s.name)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}<small>${n} videos${d ? ` · ${d} done` : ''}</small></div></a></li>`;
  }

  // Everything with one tag: tagged instructionals, then tagged videos.
  function TagPage(tag) {
    const series = ((Library.data && Library.data.series) || []);
    const sHits = series.filter(s => tagsOf(s.id).includes(tag));
    const vHits = [];
    for (const s of series) for (const v of s.videos) if (tagsOf(v.id).includes(tag)) vHits.push({ v, s });
    const others = usedTags().filter(t => t !== tag);
    app.innerHTML = `<a class="back" href="#/">‹ Library</a><h1>🏷️ ${esc(tag)}</h1>
      ${others.length ? `<div class="chips tagrow">${others.map(t => tagLink(t)).join('')}</div>` : ''}
      ${sHits.length ? `<h3>📼 Instructionals (${sHits.length})</h3><ul class="list">${sHits.map(s => srow(s, s.group && s.group.name)).join('')}</ul>` : ''}
      ${vHits.length ? `<h3>🎬 Videos (${vHits.length})</h3><ul class="list">${vHits.map(({ v, s }) => videoRow(v, fullName(s))).join('')}</ul>` : ''}
      ${!sHits.length && !vHits.length ? emptyState('Nothing tagged yet', `Open an instructional or video and tap "🏷️ + Add tags" to tag it "${tag}".`) : ''}`;
    applySizes();
  }

  function GroupPage(id) {
    const g = Library.data && groups(Library.data).find(x => x.group && x.group.id === id);
    if (!g) { app.innerHTML = emptyState('Not found', 'This folder is not in your library.', '#/', 'Back'); return; }
    const total = g.series.reduce((n, s) => n + s.videos.length, 0);
    app.innerHTML = `<a class="back" href="#/">‹ Library</a><h1>👤 ${esc(g.group.name)}</h1>
      <p class="muted small">${g.series.length} instructionals · ${total} videos</p>
      <input id="gq" class="search" type="search" placeholder="Filter ${esc(g.group.name)}'s instructionals…"><ul class="list" id="glist"></ul>`;
    const draw = () => {
      const q = $('#gq').value.trim().toLowerCase();
      const list = g.series.filter(s => !q || s.name.toLowerCase().includes(q)).sort((a, b) => isFav(b.id) - isFav(a.id));
      $('#glist').innerHTML = list.map(s => srow(s)).join('') || '<li class="muted small">No matches.</li>';
      applySizes();
    };
    $('#gq').addEventListener('input', draw);
    draw();
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
    const all = hay => words.every(w => hay.toLowerCase().includes(w));
    const sHits = Library.data.series.filter(s => all(fullName(s) + ' ' + tagsOf(s.id).join(' ')));
    for (const s of Library.data.series) for (const v of s.videos) {
      if (all(v.name + ' ' + v.sub + ' ' + fullName(s) + ' ' + effTags(v, s).join(' '))) hits.push({ v, s });
    }
    if (!hits.length && !sHits.length) return emptyState('Nothing found', 'Try a different word, like "guard" or "heel hook".');
    let html = '';
    if (sHits.length) html += `<h3>📼 Instructionals (${sHits.length})</h3><ul class="list">${sHits.slice(0, 30).map(s => srow(s, s.group && s.group.name)).join('')}</ul>`;
    if (hits.length) html += `<h3>🎬 Videos (${hits.length}${hits.length > 150 ? ', showing first 150' : ''})</h3>
      <ul class="list">${hits.slice(0, 150).map(({ v, s }) => videoRow(v, fullName(s) + (v.sub ? ' · ' + v.sub : ''))).join('')}</ul>`;
    return html;
  }

  async function scanScreen() {
    app.innerHTML = `<div class="empty"><div class="spinner"></div><h2>Finding your videos…</h2><p id="scanMsg">Looking in "${esc(Store.d.settings.rootName)}"</p><p class="small">Only names are read, nothing is downloaded. You only wait like this once.</p></div>`;
    await Library.scan(n => { const m = $('#scanMsg'); if (m) m.textContent = `Found ${n} video${n === 1 ? '' : 's'} so far…`; });
    if (location.hash === '' || location.hash === '#/') route();
  }

  function SeriesPage(id) {
    const s = ((Library.data && Library.data.series) || []).find(x => x.id === id);
    if (!s) { app.innerHTML = emptyState('Not found', 'This folder is not in your library.', '#/', 'Back'); return; }
    const d = doneCount(s);
    const inRms = roadmaps().filter(r => r.steps.includes(s.id));
    app.innerHTML = `${s.group ? `<a class="back" href="#/group/${enc(s.group.id)}">‹ ${esc(s.group.name)}</a>` : '<a class="back" href="#/">‹ Library</a>'}
      <h1>${esc(s.name)}</h1>
      <div class="progress-line"><div class="bar wide"><i data-w="${(d / s.videos.length * 100).toFixed(1)}"></i></div><span>${d} of ${s.videos.length} done</span></div>
      <div class="actions">
        <button class="btn ${isFav(s.id) ? 'primary' : 'ghost'}" data-act="toggleFav" data-id="${esc(s.id)}">${favLabel(s.id)}</button>
        ${inRms.map(r => `<button class="btn ghost" data-act="openRm" data-id="${esc(r.id)}">🗺️ ${esc(r.name)} · step ${r.steps.indexOf(s.id) + 1}</button>`).join('')}
        ${inRms.length < roadmaps().length || !roadmaps().length ? `<button class="btn ghost" data-act="rmAdd" data-id="${esc(s.id)}">🗺️ Add to roadmap</button>` : ''}
        ${d < s.videos.length ? `<button class="btn ghost" data-act="allDone" data-id="${esc(s.id)}">✓ Mark all done</button>` : ''}
      </div>
      ${tagBox(s.id)}
      ${tocPanel(s)}
      <ul class="list">${s.videos.map(v => videoRow(v, v.sub)).join('')}</ul>`;
    applySizes();
    const inp = $('#tocFile');
    $$('[data-toc="add"]').forEach(b => { b.onclick = () => inp.click(); });
    const rm = $('[data-toc="remove"]');
    if (rm) rm.onclick = () => {
      const old = Store.d.toc[s.id];
      Store.d.toc[s.id] = { deleted: true, updated: now() }; Store.save(); route();
      toast('Chapters removed', { label: 'Undo', fn: () => { Store.d.toc[s.id] = { ...old, updated: now() }; Store.save(); route(); } });
    };
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 2e6) { toast('That file is too big for a table of contents.'); return; }
      const p = parseToc(await f.text());
      const n = Object.keys(p.vols).length;
      if (!n) { toast("Couldn't find any chapter times in that file."); return; }
      Store.d.toc[s.id] = { ...p, src: 'file', file: f.name, updated: now() }; Store.save(); route();
      const matched = tocMap(s).size;
      toast(matched ? `📑 Chapters added to ${matched} of ${s.videos.length} videos` : `Found ${n} volumes, but couldn't match them to the videos.`);
    };
  }
  function tocPanel(s) {
    const toc = Store.d.toc[s.id];
    const input = '<input type="file" id="tocFile" accept=".html,.htm,text/html" hidden>';
    if (!toc || toc.deleted) {
      return `<div class="panel tocp"><h3>📑 Chapters</h3>
        <p class="small muted">Add this instructional's table-of-contents file (.html) to see chapters under each video.
        Or put the file in this instructional's OneDrive folder and tap <b>📑 Find chapter files</b> in Settings.</p>
        <button class="btn ghost" data-toc="add">📑 Add table of contents</button>${input}</div>`;
    }
    const map = tocMap(s), missing = s.videos.filter(v => !map.has(v.id));
    return `<div class="panel tocp"><h3>📑 Chapters</h3>
      <p class="small">From <b>${esc(toc.file || 'file')}</b> · ${map.size} of ${s.videos.length} videos have chapters</p>
      ${missing.length && map.size ? `<p class="small muted">No chapters for: ${missing.map(v => esc(v.name)).join(', ')}</p>` : ''}
      ${!map.size ? `<p class="small muted">The file has ${Object.keys(toc.vols).length} volumes but this folder has ${s.videos.length} videos, so they couldn't be matched. Names with "Vol 1", "Vol 2"… match best.</p>` : ''}
      <div class="btns"><button class="btn ghost sm" data-toc="add">Replace file</button><button class="btn ghost sm" data-toc="remove">Remove</button></div>${input}</div>`;
  }

  function Roadmap() {
    const all = roadmaps(), r = curRoadmap();
    let html = `<h1>🗺️ Roadmaps</h1>
      <div class="chips">${all.map(x => `<button class="chip ${r && x.id === r.id ? 'on' : ''}" data-act="openRm" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join('')}
        <button class="chip add" data-act="newRm">+ New roadmap</button></div>`;
    if (!r) {
      app.innerHTML = html + emptyState('No roadmap yet', 'A roadmap is your study order: instructional 1, then 2, then 3. Give it a name like "Leg lock path".')
        + '<button class="btn primary full" data-act="newRm">+ Create my first roadmap</button>';
      return;
    }
    const steps = rmSteps(r);
    const cur = steps.findIndex(s => !seriesDone(s));
    html += `<div class="rmhead"><h2>${esc(r.name)}</h2>
        <button class="ibtn" data-act="renameRm" data-id="${esc(r.id)}" aria-label="Rename roadmap">✎</button>
        <button class="ibtn" data-act="delRm" data-id="${esc(r.id)}" aria-label="Delete roadmap">🗑</button></div>
      <p class="muted small">Finish one instructional, then the next one is up.</p>`;
    if (steps.length) {
      html += `<ol class="road">${steps.map((s, i) => {
        const d = doneCount(s), state = seriesDone(s) ? 'done' : i === cur ? 'cur' : 'todo';
        const nextV = s.videos.find(v => !isDone(v.id));
        return `<li class="step ${state}">
          <div class="dot">${state === 'done' ? '✓' : i + 1}</div>
          <div class="sbody">
            <a href="#/series/${enc(s.id)}"><b>${esc(s.name)}</b>
              <small>${s.group ? esc(s.group.name) + ' · ' : ''}${state === 'cur' ? '▶ Studying now · ' : state === 'done' ? 'Finished · ' : ''}${d}/${s.videos.length} videos</small></a>
            <div class="bar wide"><i data-w="${(d / s.videos.length * 100).toFixed(1)}"></i></div>
            ${state === 'cur' && nextV ? `<a class="btn primary sm cont" href="#/watch/${enc(nextV.id)}">▶ Continue: ${esc(nextV.name)}</a>` : ''}
          </div>
          <div class="sbtns">
            <button class="ibtn" data-act="rmUp" data-id="${esc(s.id)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="ibtn" data-act="rmDown" data-id="${esc(s.id)}" aria-label="Move down" ${i === steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="ibtn" data-act="rmDel" data-id="${esc(s.id)}" aria-label="Remove">✕</button>
          </div></li>`;
      }).join('')}</ol>`;
      if (cur < 0) html += `<p class="center-text">🏆 You finished this roadmap! Add the next instructional below.</p>`;
    } else {
      html += `<p class="muted small">No steps yet. Add instructionals below in the order you want to study them.</p>`;
    }
    const myDrills = Store.drills().filter(d => listOf(d) === r.id).sort(drillSort);
    html += `<h3>📝 Notes for this roadmap</h3>
      <textarea id="rmNotes" rows="4" placeholder="Goals, ideas, what to focus on…">${esc(r.notes || '')}</textarea><div class="muted small" id="rmNoteState"></div>
      <h3>🥋 Drills for this roadmap</h3>
      <div class="addrow"><input id="rmDrillIn" maxlength="200" placeholder="Add a drill…"><button class="btn primary" id="rmDrillAdd">Add</button></div>
      <ul class="list">${myDrills.map(d => drillRow(d)).join('') || '<li class="muted small">No drills yet.</li>'}</ul>`;
    const notIn = ((Library.data && Library.data.series) || []).filter(s => !r.steps.includes(s.id));
    if (notIn.length) html += `<h3>➕ Add an instructional</h3>
      <input id="rq" class="search" type="search" placeholder="Search instructionals…"><ul class="list" id="rlist"></ul>`;
    app.innerHTML = html;
    applySizes();
    let noteTimer = null;
    $('#rmNotes').addEventListener('input', e => {
      $('#rmNoteState').textContent = 'Saving…'; clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { saveRm({ ...Store.d.roadmaps[r.id], notes: e.target.value }); $('#rmNoteState').textContent = 'Saved ✓'; }, 600);
    });
    cleanup = () => { if (noteTimer) { clearTimeout(noteTimer); saveRm({ ...Store.d.roadmaps[r.id], notes: $('#rmNotes').value }); } };
    const addD = () => { const t = $('#rmDrillIn').value.trim(); if (!t) return; addDrill(t, null, null, r.id); Store.save(); route(); };
    $('#rmDrillAdd').onclick = addD;
    $('#rmDrillIn').onkeydown = e => { if (e.key === 'Enter') addD(); };
    if (!notIn.length) return;
    const draw = () => {
      const q = $('#rq').value.trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const list = notIn.filter(s => words.every(w => fullName(s).toLowerCase().includes(w))).sort((a, b) => isFav(b.id) - isFav(a.id));
      $('#rlist').innerHTML = list.map(s => `<li class="srow"><span class="dtxt"><b>${isFav(s.id) ? '⭐ ' : ''}${esc(s.name)}</b><small>${s.group ? esc(s.group.name) + ' · ' : ''}${s.videos.length} videos · ${doneCount(s)} done</small></span>
        <button class="btn ghost sm" data-act="rmAdd" data-id="${esc(s.id)}" data-rm="${esc(r.id)}">+ Add</button></li>`).join('') || '<li class="muted small">No matches.</li>';
    };
    $('#rq').addEventListener('input', draw);
    draw();
  }

  // ---------- chapters (from table-of-contents files; demo has sample ones)
  const DEMO_CHAPTERS = [[0, 'Introduction'], [14, 'The core concept'], [38, 'Grips and frames'], [66, 'Common mistakes'], [95, 'Live drilling']].map(([t, name]) => ({ t, name }));
  // Which volume number a video is: "Vol 3", "Part 2", "Ep 4", or the last small number in the name.
  function volNum(s) {
    if (!s) return null;
    const m = s.match(/(?:vol(?:ume)?|part|pt|disc|dvd|chapter|ch|episode|ep)\.?\s*[-_#]?\s*(\d{1,3})/i);
    if (m) return +m[1];
    const nums = (s.match(/\d+/g) || []).map(Number).filter(n => n > 0 && n < 100);
    return nums.length ? nums[nums.length - 1] : null;
  }
  // Matches each video of an instructional to its volume in the table of contents.
  function tocMap(s) {
    const map = new Map(), toc = Store.d.toc[s.id];
    if (!toc || toc.deleted || !toc.vols) return map;
    const keys = Object.keys(toc.vols).sort((a, b) => (+a || 0) - (+b || 0));
    const nums = s.videos.map(v => volNum(v.name) ?? volNum(v.sub));
    const distinct = nums.every(n => n !== null) && new Set(nums).size === nums.length;
    if (distinct && nums.some(n => toc.vols[n])) s.videos.forEach((v, i) => { if (toc.vols[nums[i]]) map.set(v.id, toc.vols[nums[i]]); });
    else if (s.videos.length === keys.length) s.videos.forEach((v, i) => map.set(v.id, toc.vols[keys[i]]));
    return map;
  }
  function chaptersOf(vid, s) {
    const toc = Store.d.toc[s.id];
    const list = tocMap(s).get(vid.id) || vid.chapters || (DEMO && (!toc || toc.deleted) ? DEMO_CHAPTERS : []);
    return list.slice().sort((a, b) => a.t - b.t);
  }
  const chapterAt = (chs, t) => { let c = null; for (const x of chs) { if (x.t <= t + 0.25) c = x; else break; } return c; };
  // Sleep timer lives outside the player, so it keeps counting when the next video starts.
  const Sleep = { at: 0, eov: false };
  const autoOn = () => localStorage.getItem('bjj.autoplay') === 'on';

  async function Watch(id, tParam) {
    const entry = Library.get(id);
    if (!entry) { app.innerHTML = emptyState('Video not found', 'Try "Rescan library" in Settings.', '#/settings', 'Settings'); return; }
    const { v: vid, s: series, i: idx } = entry;
    const next = series.videos[idx + 1], prev = series.videos[idx - 1];
    const chs = chaptersOf(vid, series);
    const go = to => { location.hash = '#/watch/' + enc(to.id); };
    app.innerHTML = `
      <div class="player" id="pl">
        <div class="vbox">
          <video id="vid" playsinline preload="metadata"></video>
          <div class="tap l" data-z="l"></div><div class="tap r" data-z="r"></div>
          <div class="flash" id="flash"></div>
          <div class="vmsg" id="vmsg">Loading video…</div>
          <button class="looppill" id="loopPill" hidden></button>
          <div class="upnext" id="upnext" hidden></div>
        </div>
        <div class="ctl" id="ctl">
          <div class="seekwrap"><div class="marks" id="marks"></div><div class="seektip" id="seektip" hidden></div><input type="range" id="seek" min="0" max="1000" value="0" aria-label="Seek"></div>
          <div class="ctlrow info">
            <span class="pill" id="time">0:00 / 0:00</span>
            ${chs.length ? '<button class="pill chap" id="chapBtn"><span id="chapName"></span><b>›</b></button>' : ''}
            <button class="apsw ${autoOn() ? 'on' : ''}" id="apBtn" role="switch" aria-checked="${autoOn()}" aria-label="Auto-play next video"><i>${autoOn() ? '▶' : '❚❚'}</i></button>
            <button class="ic" id="gear" aria-label="Settings">⚙️</button>
            <button class="ic" id="fs" aria-label="Fullscreen">⛶</button>
          </div>
          <div class="ctlrow">
            <button class="cbtn sm" id="prevV" aria-label="Previous video" ${prev ? '' : 'disabled'}>⏮</button>
            <button class="cbtn" id="back10" aria-label="Back 10 seconds">⟲ 10</button>
            <button class="cbtn play" id="play" aria-label="Play">▶</button>
            <button class="cbtn" id="fwd10" aria-label="Forward 10 seconds">10 ⟳</button>
            <button class="cbtn sm" id="nextV" aria-label="Next video" ${next ? '' : 'disabled'}>⏭</button>
          </div>
          <div class="ctlrow tools">
            <button class="tool" id="bm"><span>🔖</span>Mark</button>
            <button class="tool" id="mirror"><span>⇋</span>Mirror</button>
          </div>
        </div>
        <div class="sheetwrap" id="sheetwrap" hidden><div class="sheet" id="sheet"></div></div>
      </div>
      <div class="watch-info">
        <h1>${esc(vid.name)}</h1>
        <a class="muted" href="#/series/${enc(series.id)}">${esc(fullName(series))}${vid.sub ? ' · ' + esc(vid.sub) : ''} ›</a>
        ${tagBox(id, series.id)}
        <div class="actions">
          <button class="btn ${isDone(id) ? 'primary' : 'ghost'}" id="doneBtn">${isDone(id) ? '✓ Done' : 'Mark as done'}</button>
          <button class="btn ${isFav(id) ? 'primary' : 'ghost'}" id="favBtn">${favLabel(id)}</button>
        </div>
        <div class="actions">
          ${prev ? `<a class="btn ghost" href="#/watch/${enc(prev.id)}">‹ Previous video</a>` : ''}
          ${next ? `<a class="btn ghost" href="#/watch/${enc(next.id)}">Next video ›</a>` : ''}
        </div>
        ${chs.length ? `<h3>📑 Chapters</h3><ul class="list chlist" id="chlist">${chs.map((c, i) => `
          <li><button class="chrow" data-act="seek" data-t="${c.t}" data-ci="${i}"><span class="tbtn">${fmt(c.t)}</span><span class="bml">${esc(c.name)}</span></button></li>`).join('')}</ul>` : ''}
        <h3>🔖 Bookmarks</h3>
        <ul class="list" id="bmlist"></ul>
        <h3>📝 Notes</h3>
        <textarea id="notes" rows="5" placeholder="What did you learn? Key details, grips, mistakes…">${esc(Store.note(id))}</textarea>
        <div class="muted small" id="noteState"></div>
      </div>`;

    const pl = $('#pl'), v = $('#vid'), seek = $('#seek'), msg = $('#vmsg');
    let alive = true, loopA = null, loopB = null, loopTimer = null, lastSave = 0, dragging = false;
    let hideTimer = null, retrying = false, mirrored = false, tapTimer = null, tapZone = null, streakUntil = 0;
    let curCh = null;

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
      if (document.fullscreenElement === pl && !v.paused && $('#sheetwrap').hidden) hideTimer = setTimeout(() => pl.classList.add('hidectl'), 3000);
    }
    // double-tap left/right to skip, single tap = play/pause (or show controls in fullscreen)
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
    $('#prevV').onclick = () => { if (prev) go(prev); };
    $('#nextV').onclick = () => { if (next) go(next); };
    // mirror flip
    $('#mirror').onclick = () => {
      mirrored = !mirrored; v.style.transform = mirrored ? 'scaleX(-1)' : '';
      $('#mirror').classList.toggle('on', mirrored); flash(mirrored ? 'Mirrored' : 'Normal'); bumpHide();
    };

    // --- auto-play switch (off unless you turn it on)
    function drawAuto() {
      const on = autoOn(), b = $('#apBtn');
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.querySelector('i').textContent = on ? '▶' : '❚❚';
    }
    function toggleAuto() {
      localStorage.setItem('bjj.autoplay', autoOn() ? 'off' : 'on'); drawAuto();
      toast(autoOn() ? 'Auto-play is on ⏭️ The next video will start by itself.' : 'Auto-play is off');
    }
    $('#apBtn').onclick = () => { toggleAuto(); bumpHide(); };

    // --- A-B loop (started from the ⚙️ menu, finished with the pill on the video)
    function setLoopUi() {
      const p = $('#loopPill');
      p.hidden = loopA === null;
      p.textContent = loopA === null ? '' : loopB === null ? `🔁 Start ${fmt(loopA)} · tap here at the end` : `🔁 ${fmt(loopA)}–${fmt(loopB)}  ✕ Stop`;
      p.classList.toggle('on', loopB !== null);
      drawMarks();
    }
    function loopStep() {
      if (loopA === null) { loopA = v.currentTime; v.play().catch(() => {}); }
      else if (loopB === null) {
        if (v.currentTime <= loopA + 0.5) { toast('Play forward a bit, then tap again to set the end.'); return; }
        loopB = v.currentTime; v.currentTime = loopA; v.play().catch(() => {});
        loopTimer = setInterval(() => { if (loopB !== null && v.currentTime >= loopB) v.currentTime = loopA; }, 100);
        toast(`Looping ${fmt(loopA)} → ${fmt(loopB)}`);
      } else { loopA = loopB = null; clearInterval(loopTimer); toast('Loop off'); }
      setLoopUi();
    }
    $('#loopPill').onclick = e => { e.stopPropagation(); loopStep(); bumpHide(); };

    // --- ⚙️ menu and chapter list (a sheet that slides up over the player, like YouTube)
    const SLEEP_OPTS = [[0, 'Off'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], ['eov', 'End of this video']];
    const sleepLabel = () => Sleep.eov ? 'End of video' : Sleep.at ? Math.max(1, Math.ceil((Sleep.at - now()) / 60000)) + ' min left' : 'Off';
    const speedLabel = () => v.playbackRate === 1 ? 'Normal' : v.playbackRate + 'x';
    const loopLabel = () => loopA === null ? 'Off' : loopB === null ? 'Setting end…' : `${fmt(loopA)}–${fmt(loopB)}`;
    function openSheet(page) {
      const s = $('#sheet');
      const row = (act, icon, label, val, more = true) => `<button class="mrow" data-m="${act}"><span class="mi">${icon}</span><span class="ml">${label}</span><span class="mv">${esc(val)}</span>${more ? '<b>›</b>' : ''}</button>`;
      const head = title => `<div class="mhead"><button class="ic" data-m="main" aria-label="Back">‹</button><b>${title}</b><button class="ic" data-m="close" aria-label="Close">✕</button></div>`;
      if (page === 'main') {
        s.innerHTML = `<div class="mhead"><b>Settings</b><button class="ic" data-m="close" aria-label="Close">✕</button></div>`
          + row('sleep', '🌙', 'Sleep timer', sleepLabel()) + row('speed', '🐢', 'Playback speed', speedLabel())
          + row('loop', '🔁', loopA === null ? 'Loop a move' : 'Stop loop', loopLabel(), false)
          + (document.pictureInPictureEnabled ? row('pip', '🗗', 'Mini player', '', false) : '')
          + row('auto', '⏭️', 'Auto-play next', autoOn() ? 'On' : 'Off', false);
      } else if (page === 'speed') {
        s.innerHTML = head('Playback speed') + SPEEDS.map(x => `<button class="mrow" data-m="setSpeed" data-x="${x}"><span class="mi">${v.playbackRate === x ? '✓' : ''}</span><span class="ml">${x === 1 ? 'Normal' : x + 'x'}</span></button>`).join('');
      } else if (page === 'sleep') {
        const cur = Sleep.eov ? 'eov' : Sleep.at ? null : 0;
        s.innerHTML = head('Sleep timer') + (Sleep.at ? `<p class="small mnote">Pausing in ${sleepLabel().replace(' left', '')}.</p>` : '')
          + SLEEP_OPTS.map(([x, l]) => `<button class="mrow" data-m="setSleep" data-x="${x}"><span class="mi">${cur === x ? '✓' : ''}</span><span class="ml">${l}</span></button>`).join('');
      } else if (page === 'chapters') {
        s.innerHTML = `<div class="mhead"><b>Chapters</b><button class="ic" data-m="close" aria-label="Close">✕</button></div>`
          + chs.map((c, i) => `<button class="mrow chap-item ${curCh === c ? 'cur' : ''}" data-m="setCh" data-x="${i}"><span class="tbtn">${fmt(c.t)}</span><span class="ml">${esc(c.name)}</span></button>`).join('');
        const cur = $('.chap-item.cur', s); if (cur) setTimeout(() => cur.scrollIntoView({ block: 'nearest' }), 0);
      }
      $('#sheetwrap').hidden = false; clearTimeout(hideTimer); pl.classList.remove('hidectl');
    }
    const closeSheet = () => { $('#sheetwrap').hidden = true; bumpHide(); };
    $('#gear').onclick = () => openSheet('main');
    if (chs.length) $('#chapBtn').onclick = () => openSheet('chapters');
    $('#sheetwrap').onclick = async e => {
      if (!e.target.closest('#sheet')) { closeSheet(); return; }
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m, x = b.dataset.x;
      if (m === 'main' || m === 'speed' || m === 'sleep') openSheet(m);
      else if (m === 'close') closeSheet();
      else if (m === 'setSpeed') { v.playbackRate = +x; flash(speedLabel()); closeSheet(); }
      else if (m === 'setSleep') {
        Sleep.eov = x === 'eov'; Sleep.at = !Sleep.eov && +x ? now() + x * 60000 : 0;
        toast(Sleep.eov ? '🌙 Will pause at the end of this video' : Sleep.at ? `🌙 Will pause in ${x} minutes` : 'Sleep timer off');
        closeSheet();
      } else if (m === 'loop') {
        closeSheet(); loopStep();
        if (loopB === null && loopA !== null) toast('Loop start set at ' + fmt(loopA) + '. Tap the 🔁 pill on the video at the end of the move.');
      } else if (m === 'pip') {
        closeSheet();
        try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); }
        catch { toast('Mini player is not available right now.'); }
      } else if (m === 'auto') { toggleAuto(); openSheet('main'); }
      else if (m === 'setCh') { v.currentTime = chs[+x].t; v.play().catch(() => {}); closeSheet(); }
    };
    function checkSleep() {
      if (Sleep.at && now() >= Sleep.at) { Sleep.at = 0; v.pause(); toast('🌙 Sleep timer: video paused'); }
    }
    const sleepTimer = setInterval(checkSleep, 1000);

    // --- bookmarks
    $('#bm').onclick = async () => {
      const t = v.currentTime, wasPlaying = !v.paused;
      v.pause();
      const r = await askBookmark(t);
      if (r && alive) {
        const b = { id: uid(), itemId: id, t, label: r.text || 'Moment at ' + fmt(t), created: now(), updated: now() };
        Store.d.bookmarks[b.id] = b;
        let msg = 'Bookmark saved';
        if (r.list) {
          const listId = r.list.newName !== undefined ? makeList(r.list.newName).id : r.list.id;
          addDrill(b.label, id, t, listId); msg = 'Bookmark saved + added to ' + listName(listId) + ' 🥋';
        }
        Store.save(); renderBms(); toast(msg);
      }
      if (wasPlaying && alive) v.play().catch(() => {});
    };
    // --- fullscreen + landscape
    $('#fs').onclick = async () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      try { await pl.requestFullscreen({ navigationUI: 'hide' }); } catch { try { v.webkitEnterFullscreen(); } catch { /* not supported */ } return; }
      try { await screen.orientation.lock('landscape'); } catch { /* desktop browsers can't rotate */ }
    };
    function onFs() {
      const fs = document.fullscreenElement === pl;
      pl.classList.toggle('fs', fs); $('#fs').textContent = fs ? '⤡' : '⛶';
      if (!fs) { try { screen.orientation.unlock(); } catch { /* ignore */ } pl.classList.remove('hidectl'); }
      bumpHide();
    }
    document.addEventListener('fullscreenchange', onFs);
    pl.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') bumpHide(); });

    // --- lock-screen and notification controls
    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (ms) {
      try {
        ms.metadata = new MediaMetadata({ title: vid.name, artist: fullName(series), album: 'Mat Study',
          artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
      } catch { /* ignore */ }
      const handlers = {
        play: () => v.play().catch(() => {}),
        pause: () => v.pause(),
        seekbackward: d => skip(-(d.seekOffset || 10)),
        seekforward: d => skip(d.seekOffset || 10),
        seekto: d => { if (isFinite(v.duration)) v.currentTime = d.seekTime; },
        previoustrack: prev ? () => go(prev) : null,
        nexttrack: next ? () => go(next) : null,
      };
      Object.entries(handlers).forEach(([k, fn]) => { try { ms.setActionHandler(k, fn); } catch { /* not supported */ } });
    }
    let lastPos = 0;
    function updatePos() {
      if (!ms || !ms.setPositionState || !isFinite(v.duration) || !v.duration) return;
      try { ms.setPositionState({ duration: v.duration, playbackRate: v.playbackRate || 1, position: Math.min(v.currentTime, v.duration) }); } catch { /* ignore */ }
    }

    // --- auto-play the next video with a 5 second countdown
    let upTimer = null;
    function cancelUpNext() { clearInterval(upTimer); upTimer = null; $('#upnext').hidden = true; }
    function showUpNext() {
      let n = 5;
      const box = $('#upnext');
      box.innerHTML = `<div class="small">Up next in <b id="upN">${n}</b></div><div class="upname">${esc(next.name)}</div>
        <div class="btns"><button class="btn ghost" id="upCancel">Cancel</button><button class="btn primary" id="upGo">Play now</button></div>`;
      $('#upCancel').onclick = e => { e.stopPropagation(); cancelUpNext(); };
      $('#upGo').onclick = e => { e.stopPropagation(); cancelUpNext(); go(next); };
      box.hidden = false; pl.classList.remove('hidectl');
      upTimer = setInterval(() => {
        n -= 1;
        if (n <= 0) { cancelUpNext(); if (alive) go(next); }
        else $('#upN').textContent = n;
      }, 1000);
    }
    v.addEventListener('play', cancelUpNext);
    v.addEventListener('seeking', () => { if (upTimer) cancelUpNext(); });

    // --- time, chapter name and seek bar
    const timeText = t => fmt(t) + ' / ' + (isFinite(v.duration) ? fmt(v.duration) : '0:00');
    function drawChapter(t) {
      if (!chs.length) return;
      const c = chapterAt(chs, t);
      if (c === curCh) return;
      curCh = c;
      $('#chapName').textContent = c ? c.name : chs[0].name;
      $$('#chlist .chrow').forEach(b => b.classList.toggle('cur', c && chs[+b.dataset.ci] === c));
    }
    seek.addEventListener('input', () => {
      dragging = true;
      if (isFinite(v.duration)) {
        const t = seek.value / 1000 * v.duration, c = chapterAt(chs, t), tip = $('#seektip');
        $('#time').textContent = timeText(t);
        tip.textContent = fmt(t) + (c ? ' · ' + c.name : ''); tip.hidden = false;
        tip.style.left = Math.min(80, Math.max(20, seek.value / 10)) + '%';
      }
      bumpHide();
    });
    seek.addEventListener('change', () => { dragging = false; $('#seektip').hidden = true; if (isFinite(v.duration)) v.currentTime = seek.value / 1000 * v.duration; });
    function drawMarks() {
      const d = v.duration;
      if (!isFinite(d) || !d) { $('#marks').innerHTML = ''; return; }
      let h = chs.filter(c => c.t > 0 && c.t < d).map(c => `<i class="cg" data-l="${(c.t / d * 100).toFixed(2)}"></i>`).join('');
      h += Store.bookmarks().filter(b => b.itemId === id).map(b => `<i class="mk" data-l="${(b.t / d * 100).toFixed(2)}"></i>`).join('');
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

    // --- notes
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
      if (!dragging) { seek.value = Math.round(v.currentTime / v.duration * 1000); $('#time').textContent = timeText(v.currentTime); }
      drawChapter(v.currentTime);
      checkSleep();
      if (loopA !== null && loopB === null) drawMarks();
      if (now() - lastSave > 5000) saveProgress();
      if (now() - lastPos > 1000) { lastPos = now(); updatePos(); }
    });
    v.addEventListener('ratechange', updatePos);
    v.addEventListener('seeked', updatePos);
    v.addEventListener('loadedmetadata', () => {
      $('#time').textContent = timeText(v.currentTime);
      if (v.dataset.resumeAt) { v.currentTime = +v.dataset.resumeAt; delete v.dataset.resumeAt; return; }
      const p = prog(id);
      if (tParam !== null) v.currentTime = tParam;
      else if (p && !p.done && p.t > 5 && p.t < v.duration - 15) {
        v.currentTime = p.t;
        toast('Resumed at ' + fmt(p.t), { label: 'Start over', fn: () => { v.currentTime = 0; } });
      }
      drawMarks(); drawChapter(v.currentTime);
      v.play().catch(() => { msg.textContent = 'Tap ▶ to play'; msg.hidden = false; });
    });
    v.addEventListener('ended', () => {
      saveProgress(); setDone(id, true);
      $('#doneBtn').textContent = '✓ Done'; $('#doneBtn').className = 'btn primary';
      if (Sleep.eov) { Sleep.eov = false; toast('🌙 Sleep timer: stopped at the end of the video'); return; }
      if (next && loopA === null && autoOn()) showUpNext();
      else if (next) toast('Finished! 🎉', { label: 'Next video ›', fn: () => go(next) });
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

    // desktop keyboard: space, ←, →, Esc closes the menu
    function onKey(e) {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('#dlg').open) return;
      if (e.key === 'Escape' && !$('#sheetwrap').hidden) closeSheet();
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') skip(-10);
      else if (e.key === 'ArrowRight') skip(10);
    }
    document.addEventListener('keydown', onKey);
    const onHide = () => { if (document.visibilityState === 'hidden') saveProgress(); };
    document.addEventListener('visibilitychange', onHide);

    cleanup = () => {
      alive = false; saveProgress(); clearInterval(loopTimer); clearTimeout(hideTimer); clearTimeout(tapTimer); clearInterval(upTimer); clearInterval(sleepTimer);
      if (ms) ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'].forEach(k => { try { ms.setActionHandler(k, null); } catch { /* ignore */ } });
      if (ms) ms.metadata = null;
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

  function addDrill(text, itemId, t, listId) {
    const d = { id: uid(), text, itemId: itemId || null, t: t ?? null, listId: listId || null, done: false, created: now(), updated: now() };
    Store.d.drills[d.id] = d;
    return d;
  }
  const drillSort = (a, b) => (a.done - b.done) || (b.created - a.created);
  const vname = itemId => { const e = Library.get(itemId); return e ? e.v.name : 'Video not in library'; };
  function drillRow(d, showList) {
    const where = [showList ? listName(listOf(d)) : '', d.itemId ? vname(d.itemId) + (d.t !== null ? ' · ' + fmt(d.t) : '') : ''].filter(Boolean).join(' · ');
    return `<li class="drow ${d.done ? 'done' : ''}"><button class="check ${d.done ? 'on' : ''}" data-act="toggleDrill" data-id="${esc(d.id)}" aria-label="Done">✓</button>
      <span class="dtxt">${esc(d.text)}${where ? `<small>${esc(where)}</small>` : ''}</span>
      ${d.itemId ? `<a class="ibtn" href="#/watch/${enc(d.itemId)}${d.t !== null ? '?t=' + Math.floor(d.t) : ''}" aria-label="Watch">▶</a>` : ''}
      <button class="ibtn" data-act="moveDrill" data-id="${esc(d.id)}" aria-label="Move to another list">⇄</button>
      <button class="ibtn" data-act="delDrill" data-id="${esc(d.id)}" aria-label="Delete">🗑</button></li>`;
  }

  // A named note that isn't tied to a video.
  function NotePage(id) {
    const n = Store.d.snotes[id];
    if (!n || n.deleted) { location.hash = '#/study?tab=notes'; return; }
    app.innerHTML = `<a class="back" href="#/study?tab=notes">‹ Notes</a>
      <input id="nTitle" class="search title-in" maxlength="120" placeholder="Note name" value="${esc(n.title)}">
      <textarea id="nText" rows="14" placeholder="Write anything: game plan, competition notes, ideas…">${esc(n.text)}</textarea>
      <div class="rowbetween"><span class="muted small" id="nState">${ago(n.updated)}</span><button class="btn danger sm" id="nDel">Delete note</button></div>`;
    let timer = null;
    const save = () => { timer = null; Store.d.snotes[id] = { ...Store.d.snotes[id], title: $('#nTitle').value.trim() || 'Untitled note', text: $('#nText').value, updated: now() }; Store.save(); $('#nState').textContent = 'Saved ✓'; };
    const later = () => { $('#nState').textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(save, 600); };
    $('#nTitle').addEventListener('input', later);
    $('#nText').addEventListener('input', later);
    $('#nDel').onclick = () => {
      if (!confirm('Delete this note?')) return;
      clearTimeout(timer); timer = null;
      const before = Store.d.snotes[id];
      Store.d.snotes[id] = { ...before, deleted: true, updated: now() }; Store.save();
      location.hash = '#/study?tab=notes';
      toast('Note deleted', { label: 'Undo', fn: () => { Store.d.snotes[id] = { ...before, deleted: false, updated: now() }; Store.save(); route(); } });
    };
    cleanup = () => { if (timer) { clearTimeout(timer); save(); } };
    if (!n.text && n.title === 'Untitled note') { $('#nTitle').select(); $('#nTitle').focus(); }
  }

  // #10 search, #11 drill list, plus all notes
  function Study(tab) {
    const tabs = [['bookmarks', '🔖 Bookmarks'], ['notes', '📝 Notes'], ['drills', '🥋 Drills']];
    // Which drill list is open: 'all', 'general', or a list/roadmap id.
    let dl = sessionStorage.getItem('bjj.dl') || 'all';
    if (dl !== 'all' && dl !== 'general' && !allLists().some(l => l.id === dl)) dl = 'all';
    const dlId = dl === 'all' || dl === 'general' ? null : dl;
    const ownList = dlId && Store.d.dlists[dlId];
    let top = '';
    if (tab === 'drills') {
      top = `<div class="chips">
          <button class="chip ${dl === 'all' ? 'on' : ''}" data-act="selDl" data-id="all">All</button>
          ${allLists().map(l => { const v = l.id === null ? 'general' : l.id; return `<button class="chip ${dl === v ? 'on' : ''}" data-act="selDl" data-id="${esc(v)}">${esc(l.name)}</button>`; }).join('')}
          <button class="chip add" data-act="newList">+ New list</button></div>
        ${ownList ? `<div class="rmhead"><h2>${esc(ownList.name)}</h2><button class="ibtn" data-act="renameList" data-id="${esc(dlId)}" aria-label="Rename list">✎</button><button class="ibtn" data-act="delList" data-id="${esc(dlId)}" aria-label="Delete list">🗑</button></div>` : ''}
        ${dlId && Store.d.roadmaps[dlId] ? `<p class="small"><a class="link" href="#/roadmap" data-act="openRm" data-id="${esc(dlId)}">Open this roadmap ›</a></p>` : ''}
        <div class="addrow"><input id="drillIn" maxlength="200" placeholder="Add a move to ${esc(dl === 'all' ? 'General' : listName(dlId))}…"><button class="btn primary" id="drillAdd">Add</button></div>`;
    } else if (tab === 'notes') {
      top = `<button class="btn primary full" id="newNote">+ New note</button>`;
    }
    app.innerHTML = `<h1>Study</h1>
      <div class="seg">${tabs.map(([k, l]) => `<a href="#/study?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${top}
      <input id="q" class="search" type="search" placeholder="Search ${tab}… (e.g. kimura)" value="${esc(sessionStorage.getItem('bjj.q') || '')}">
      <div id="studyList"></div>`;
    const draw = () => {
      const q = $('#q').value.trim().toLowerCase();
      sessionStorage.setItem('bjj.q', $('#q').value);
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
        // Your named notes, roadmap notes and video notes, newest first.
        const items = [
          ...Object.values(Store.d.snotes).filter(n => !n.deleted).map(n => ({ href: '#/note/' + enc(n.id), title: '📄 ' + n.title, text: n.text, updated: n.updated })),
          ...roadmaps().filter(r => (r.notes || '').trim()).map(r => ({ href: '#/roadmap', act: r.id, title: '🗺️ ' + r.name, text: r.notes, updated: r.updated })),
          ...Object.entries(Store.d.notes).filter(([, n]) => !n.deleted && n.text.trim()).map(([k, n]) => ({ href: '#/watch/' + enc(k), title: '🎬 ' + vname(k), text: n.text, updated: n.updated })),
        ].filter(x => match(x.title, x.text)).sort((a, b) => b.updated - a.updated);
        html = items.length ? `<ul class="list">${items.map(x => `
          <li class="srow note"><a href="${x.href}" ${x.act ? `data-act="openRm" data-id="${esc(x.act)}"` : ''}><b>${esc(x.title)}</b>${x.text ? `<p>${esc(x.text)}</p>` : ''}<small>${ago(x.updated)}</small></a></li>`).join('')}</ul>`
          : emptyState(q ? 'No matches' : 'No notes yet', q ? 'Try another word.' : 'Tap "+ New note", or write notes under any video.');
      } else {
        const inView = d => dl === 'all' || (dl === 'general' ? listOf(d) === null : listOf(d) === dlId);
        const list = Store.drills().filter(d => inView(d) && match(d.text, d.itemId && vname(d.itemId), listName(listOf(d)))).sort(drillSort);
        const doneN = list.filter(d => d.done).length;
        html = list.length ? `<ul class="list">${list.map(d => drillRow(d, dl === 'all')).join('')}</ul>
            ${doneN ? `<button class="btn ghost full" data-act="clearDrills">Clear ${doneN} finished</button>` : ''}`
          : emptyState(q ? 'No matches' : 'This list is empty', q ? 'Try another word.' : 'Add moves you want to practice.');
      }
      $('#studyList').innerHTML = html;
    };
    $('#q').addEventListener('input', draw);
    if (tab === 'drills') {
      const add = () => { const t = $('#drillIn').value.trim(); if (!t) return; addDrill(t, null, null, dlId); Store.save(); $('#drillIn').value = ''; draw(); };
      $('#drillAdd').onclick = add;
      $('#drillIn').onkeydown = e => { if (e.key === 'Enter') add(); };
    }
    if (tab === 'notes') $('#newNote').onclick = () => {
      const n = { id: uid(), title: 'Untitled note', text: '', created: now(), updated: now() };
      Store.d.snotes[n.id] = n; Store.save(); location.hash = '#/note/' + enc(n.id);
    };
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
        <div class="btns"><a class="btn ghost" href="#/pick/root">Change folder</a><button class="btn ghost" id="rescan">Rescan for new videos</button><button class="btn ghost" id="findToc">📑 Find chapter files</button></div>
        <p class="small muted">"Find chapter files" only looks for table-of-contents (.html) files, so it's much faster than a full rescan.</p></div>
      <div class="panel"><h3>📱 App</h3>
        ${standalone ? '<p>Installed on your home screen ✓</p>' : installEvt ? '<button class="btn primary" id="install">Add to home screen</button>' : '<p class="small">To add it to your home screen: in Chrome tap <b>⋮</b> then <b>Add to Home screen</b>.</p>'}
        <div class="btns"><button class="btn ghost" id="theme">${theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}</button></div></div>
      <div class="panel"><h3>🏷️ My custom tags</h3>
        ${customTags().length ? `<ul class="list">${Object.entries(Store.d.tagdefs).filter(([, t]) => !t.deleted).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, t]) => `
          <li class="srow"><a class="dtxt" href="#/tag/${enc(t.name)}">${esc(t.name)}</a><button class="ibtn" data-act="delTag" data-id="${esc(k)}" aria-label="Delete tag">🗑</button></li>`).join('')}</ul>`
          : '<p class="small muted">None yet. Make one from "🏷️ + Add tags" on any video or instructional.</p>'}</div>
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
    $('#findToc').onclick = async () => {
      const b = $('#findToc'); b.disabled = true; b.textContent = 'Looking…';
      try {
        const r = await Library.findTocs();
        toast(!r.found ? 'No chapter files found. Put the .html file inside the instructional folder.'
          : r.added ? `📑 Added chapters to ${r.added} instructional${r.added > 1 ? 's' : ''}` : `Found ${r.found} chapter file${r.found > 1 ? 's' : ''}, all already loaded ✓`);
      } catch (e) { fail(e); }
      b.disabled = false; b.textContent = '📑 Find chapter files';
    };
    $('#theme').onclick =() => { localStorage.setItem('bjj.theme', theme === 'dark' ? 'light' : 'dark'); applyTheme(); route(); };
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
      const r = b.dataset.rm ? Store.d.roadmaps[b.dataset.rm] : await pickRoadmap('Add to which roadmap?');
      if (!r) return;
      if (!r.steps.includes(id)) saveRm({ ...r, steps: [...r.steps, id] });
      toast(`Added to "${r.name}" as step ${Store.d.roadmaps[r.id].steps.length} 🗺️`); route(); return;
    } else if (act === 'rmUp' || act === 'rmDown' || act === 'rmDel') {
      const r = curRoadmap();
      if (!r) return;
      const ids = [...r.steps], i = ids.indexOf(id);
      if (i < 0) return;
      if (act === 'rmDel') {
        const before = [...ids]; ids.splice(i, 1); saveRm({ ...r, steps: ids });
        toast('Removed from roadmap', { label: 'Undo', fn: () => { saveRm({ ...Store.d.roadmaps[r.id], steps: before }); route(); } });
      } else {
        const j = act === 'rmUp' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]]; saveRm({ ...r, steps: ids });
      }
      route(); return;
    } else if (act === 'openRm') {
      localStorage.setItem('bjj.rm', id);
      if (location.hash === '#/roadmap') route(); else location.hash = '#/roadmap';
      return;
    } else if (act === 'newRm') {
      const r = await ask({ title: 'Name your roadmap', placeholder: 'e.g. Leg lock path, Guard game', okLabel: 'Create' });
      if (r) { newRoadmap(r.text || 'My roadmap'); toast('Roadmap created 🗺️'); if (location.hash === '#/roadmap') route(); else location.hash = '#/roadmap'; }
      return;
    } else if (act === 'renameRm') {
      const cur = Store.d.roadmaps[id], r = await ask({ title: 'Rename roadmap', value: cur.name });
      if (r && r.text) saveRm({ ...cur, name: r.text });
      route(); return;
    } else if (act === 'delRm') {
      const cur = Store.d.roadmaps[id];
      if (!confirm(`Delete the roadmap "${cur.name}"? Its drills move to General. Your videos and progress are not touched.`)) return;
      saveRm({ ...cur, deleted: true });
      toast('Roadmap deleted', { label: 'Undo', fn: () => { saveRm({ ...Store.d.roadmaps[id], deleted: false }); localStorage.setItem('bjj.rm', id); route(); } });
      route(); return;
    } else if (act === 'editTags') {
      const name = (Library.get(id) && Library.get(id).v.name) || (Library.series(id) && Library.series(id).name) || '';
      const picked = await pickTags('Tags for ' + name, tagsOf(id));
      if (!picked) return;
      setTags(id, picked);
      // Update just the tag row (so a playing video isn't interrupted).
      $$('.tags', app).filter(x => x.dataset.for === id).forEach(box => { box.innerHTML = tagsInner(id, box.dataset.inh); });
      toast(picked.length ? 'Tags saved 🏷️' : 'Tags removed');
      return;
    } else if (act === 'delTag') {
      const def = Store.d.tagdefs[id];
      if (!def || !confirm(`Delete the tag "${def.name}"? It will be removed from everything that has it.`)) return;
      Store.d.tagdefs[id] = { ...def, deleted: true, updated: now() }; Store.save();
      toast('Tag deleted', { label: 'Undo', fn: () => { Store.d.tagdefs[id] = { ...def, deleted: false, updated: now() }; Store.save(); route(); } });
      route(); return;
    } else if (act === 'selDl') { sessionStorage.setItem('bjj.dl', id); route(); return; }
    else if (act === 'newList') {
      const r = await ask({ title: 'Name your drill list', placeholder: 'e.g. This week, Guard drills', okLabel: 'Create' });
      if (r) { const l = makeList(r.text); sessionStorage.setItem('bjj.dl', l.id); toast('List created 🥋'); }
      route(); return;
    } else if (act === 'renameList') {
      const l = Store.d.dlists[id], r = await ask({ title: 'Rename list', value: l.name });
      if (r && r.text) { Store.d.dlists[id] = { ...l, name: r.text, updated: now() }; Store.save(); }
      route(); return;
    } else if (act === 'delList') {
      const l = Store.d.dlists[id];
      if (!confirm(`Delete the list "${l.name}"? Its drills move to General.`)) return;
      Store.d.dlists[id] = { ...l, deleted: true, updated: now() }; Store.save(); sessionStorage.setItem('bjj.dl', 'all');
      toast('List deleted', { label: 'Undo', fn: () => { Store.d.dlists[id] = { ...l, deleted: false, updated: now() }; Store.save(); sessionStorage.setItem('bjj.dl', id); route(); } });
      route(); return;
    } else if (act === 'moveDrill') {
      const d = Store.d.drills[id], to = await pickList();
      if (to) { Store.d.drills[id] = { ...d, listId: to.id, updated: now() }; Store.save(); toast('Moved to ' + listName(to.id)); }
    }
    else if (act === 'drillBm' && bm) {
      const to = await pickList();
      if (to) { addDrill(bm.label, bm.itemId, bm.t, to.id); Store.save(); toast('Added to ' + listName(to.id) + ' 🥋'); }
    }
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
