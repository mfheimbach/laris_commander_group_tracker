/* Commander Legacy — admin page. Everything is entered here once and committed straight to the repo
   through the GitHub API, using a token that only ever lives in this browser. */
(() => {
'use strict';
const {$, esc, state, FILES, HEAD, BASICS, FLAG_TEXT, fmtDate, plural, dot, field,
       load, loadCards, lookup, autocomplete, info, flags, deckById, inDeck, hasMenu, nightNo, exportList} = CL;

const LS_TOKEN = 'cl-admin-token', LS_DRAFT = 'cl-admin-draft-v1', LS_MENU = 'cl-admin-menu-v1';
const ls = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let token = ls.get(LS_TOKEN) || '';
let repo = '', branch = 'main';
let conn = {ok:false, msg:''};
let tab = 'night', menuDeck = null;
let draft = null, menu = null;         // working copies: the night being entered, the next menu
let busy = '', flash = null;           // flash: {ok, html}
const overrides = {};                  // path -> text we just committed (shown before GitHub Pages catches up)

/* ---------- GitHub ---------- */
function repoFromLocation(){
  if (location.hostname.endsWith('.github.io')){
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (seg) return location.hostname.split('.')[0] + '/' + seg;
  }
  return '';
}
async function gh(path, opts = {}){
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {cache:'no-store', ...opts,
    headers:{Authorization:'Bearer ' + token, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', ...(opts.headers || {})},
    body:opts.body ? JSON.stringify(opts.body) : undefined});
  if (!r.ok){
    let m = r.statusText; try { m = (await r.clone().json()).message || m; } catch {}
    const e = new Error(m); e.status = r.status; throw e;
  }
  return r;
}
const ghText = async path => {
  if (path in overrides) return overrides[path];
  return (await gh(`/contents/${path}?ref=${encodeURIComponent(branch)}`, {headers:{Accept:'application/vnd.github.raw+json'}})).text();
};
async function connect(){
  conn = {ok:false, msg:''};
  if (!token) return;
  if (!repo){ conn.msg = 'No repository configured. Add "repo": "owner/name" to data/site.json.'; return; }
  try {
    const j = await (await gh('')).json();
    branch = j.default_branch || 'main';
    conn.ok = true;
  } catch(e){
    conn.msg = e.status === 401 ? 'GitHub rejected this token. It may have expired.'
      : e.status === 404 ? `This token can't see ${repo}. Check that the token includes this repository.`
      : 'Could not reach GitHub: ' + e.message;
  }
}
/* one commit for several files, built on top of the branch's current head */
async function commit(files, message){
  const ref = await (await gh(`/git/ref/heads/${branch}`)).json();
  const head = ref.object.sha;
  const base = await (await gh(`/git/commits/${head}`)).json();
  const tree = await (await gh('/git/trees', {method:'POST', body:{base_tree:base.tree.sha,
    tree:Object.entries(files).map(([path, content]) => ({path, mode:'100644', type:'blob', content}))}})).json();
  const c = await (await gh('/git/commits', {method:'POST', body:{message, tree:tree.sha, parents:[head]}})).json();
  await gh(`/git/refs/heads/${branch}`, {method:'PATCH', body:{sha:c.sha}});
  Object.assign(overrides, files);
  return c;
}
const explain = e => e.status === 403 ? 'GitHub refused the write. The token needs Contents set to write access for this repository.'
  : e.status === 422 || e.status === 409 ? 'The repository changed while saving. Press save again.'
  : e.status === 401 ? 'GitHub rejected the token. It may have expired.'
  : 'Saving failed: ' + e.message;

/* ---------- working copies ---------- */
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const newGame = () => ({seats:{}, winner:'', note:''});
function newDraft(){
  return {date:today(), games:[newGame()], clearMenu:true,
    swaps:Object.fromEntries(state.decks.map(d => [d.id, {outs:[], ins:[], quote:''}]))};
}
function loadDraft(){
  let d = null; try { d = JSON.parse(ls.get(LS_DRAFT)); } catch {}
  const fresh = newDraft();
  if (!d || !d.swaps || !Array.isArray(d.games) || !d.games.length) return fresh;
  for (const id of Object.keys(fresh.swaps)) d.swaps[id] = d.swaps[id] || fresh.swaps[id];
  return d;
}
const saveDraft = () => ls.set(LS_DRAFT, JSON.stringify(draft));
const copyMenu = () => JSON.parse(JSON.stringify(state.menu));
function loadMenu(){
  let m = null; try { m = JSON.parse(ls.get(LS_MENU)); } catch {}
  const fresh = copyMenu();
  if (!m) return fresh;
  for (const id of Object.keys(fresh)) m[id] = m[id] || fresh[id];
  return m;
}
const saveMenu = () => ls.set(LS_MENU, JSON.stringify(menu));
const menuDirty = () => JSON.stringify(menu) !== JSON.stringify(state.menu);

/* ---------- small render helpers ---------- */
const FLAG_ICON = {gc:'🔥', banned:'⛔', offcolor:'⚠', dup:'⚠', unknown:'?'};
const badges = (d, name) => flags(d, name).map(f => `<span class="flag flag-${f}" title="${FLAG_TEXT[f]}">${FLAG_ICON[f]} ${FLAG_TEXT[f]}</span>`).join('');
const cleanPlayer = s => String(s || '').replace(/[;:,\r\n]+/g, ' ').trim();

function renderConnect(){
  $('#conn-status').innerHTML = conn.ok ? `<span class="ok">● Connected</span>` : `<span class="off">● Not connected</span>`;
  const el = $('#connect');
  if (conn.ok){
    el.innerHTML = `<p class="conn-line">Saving to <b>${esc(repo)}</b>. <button class="link" data-act="disconnect">Forget token on this device</button></p>`;
    return;
  }
  el.innerHTML = `<div class="card pad connect">
    <h3 class="card-h">Connect once on this device</h3>
    ${conn.msg ? `<p class="warn">${esc(conn.msg)}</p>` : ''}
    <ol class="steps">
      <li><a href="https://github.com/settings/personal-access-tokens/new?name=Commander+Legacy+admin&description=Saves+game+nights+from+the+tracker+admin+page&target_name=mfheimbach&expires_in=366&contents=write" target="_blank" rel="noopener">Open the pre-filled token form on GitHub ↗</a>. Name, expiry and the Contents permission are already set.</li>
      <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick ${esc(repo.split('/')[1] || 'this repository')}. This is the one thing to set by hand.</li>
      <li>Check that <b>Contents</b> shows write access (labelled "Read and write" or "Write"), then <b>Generate token</b>.</li>
      <li>Paste the token here. It is stored only in this browser.</li>
    </ol>
    <div class="adder"><input type="password" id="token-in" placeholder="github_pat_…" autocomplete="off"><button class="btn" data-act="connect">Connect</button></div>
    <p class="hint">You can fill everything in without connecting; only saving needs the token.</p>
  </div>`;
}
function renderTabs(){
  const menuCount = state.decks.filter(d => hasMenu(d.id)).length;
  $('#tabs').innerHTML = `<div class="seg" role="tablist">${[
    ['night', 'Save a night'], ['menu', `Next menu${menuCount ? ` · ${menuCount}` : ''}`], ['export', 'Lists']
  ].map(([v, l]) => `<button role="tab" data-act="tab" data-v="${v}" aria-pressed="${tab === v}">${l}</button>`).join('')}</div>`;
}
function renderLists(){
  $('#dl-players').innerHTML = state.players.map(p => `<option value="${esc(p)}">`).join('');
  $('#dl-decks').innerHTML = state.decks.map(d =>
    `<datalist id="dl-deck-${d.id}">${[...d.now.keys()].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`).join('');
}
const flashHtml = () => flash ? `<p class="${flash.ok ? 'done' : 'warn'}">${flash.html}</p>` : '';

/* ---------- tab: save a night ---------- */
function nightIssues(){
  const errs = [], notes = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) errs.push('Pick a date.');
  let rows = 0;
  draft.games.forEach((g, i) => {
    const seated = state.decks.filter(d => cleanPlayer(g.seats[d.id]));
    const label = draft.games.length > 1 ? `Game ${i+1}: ` : '';
    if (!seated.length && !g.note && !g.winner) return;          // untouched game card
    rows++;
    if (seated.length < 2) errs.push(label + 'seat at least two players.');
    const names = seated.map(d => cleanPlayer(g.seats[d.id]).toLowerCase());
    if (new Set(names).size < names.length) errs.push(label + 'the same player sits at two decks.');
    if (!g.winner || !cleanPlayer(g.seats[g.winner])) notes.push(label + 'no winner set.');
  });
  for (const d of state.decks){
    const s = draft.swaps[d.id];
    if (s.outs.length !== s.ins.length) errs.push(`${d.name}: ${s.outs.length} out but ${s.ins.length} in.`);
    rows += Math.min(s.outs.length, s.ins.length);
    s.outs.filter(o => !inDeck(d, o)).forEach(o => errs.push(`${d.name}: "${o}" is not in the deck.`));
    for (const n of s.ins) for (const f of flags(d, n)){
      if (f === 'gc') continue;
      if (f === 'dup' && s.outs.some(o => o.toLowerCase() === n.toLowerCase())) continue;
      notes.push(`${d.name}: ${n} is ${FLAG_TEXT[f]}.`);
    }
  }
  if (!rows) errs.push('Nothing entered yet.');
  return {errs, notes};
}
function swapCard(d){
  const s = draft.swaps[d.id], m = state.menu[d.id];
  const chip = (kind, name, on, extra = '') => `<button class="chip${on ? ' on' : ''}" data-act="${kind}" data-deck="${d.id}" data-card="${esc(name)}">${esc(name)}${extra}</button>`;
  const cutNames = m.cut.map(x => x.card), addNames = m.add.map(x => x.card);
  const outsOther = s.outs.filter(o => !cutNames.includes(o)), insOther = s.ins.filter(o => !addNames.includes(o));
  const gcMark = n => info(n).gc ? ' 🔥' : '';
  const pairs = s.outs.map((o, i) => [o, s.ins[i]]).filter(([, i]) => i);
  const okCount = s.outs.length === s.ins.length;
  return `<div class="card pad swapcard" style="--c:${d.color}">
    <div class="sw-head">${dot(d.color)}<b>${esc(d.name)}</b>
      <span class="count ${okCount ? (s.outs.length ? 'good' : '') : 'bad'}">${s.outs.length} out · ${s.ins.length} in${m.picks && hasMenu(d.id) ? ` · menu says ${m.picks}` : ''}</span></div>
    <p class="lbl">Out</p>
    <div class="chips">${cutNames.map(n => chip('out', n, s.outs.includes(n))).join('')}${outsOther.map(n => chip('out', n, true, ' ×')).join('')}</div>
    <div class="adder"><input list="dl-deck-${d.id}" data-add="out" data-deck="${d.id}" placeholder="${cutNames.length ? 'Other card from the deck…' : 'Card from the deck…'}" autocomplete="off"><button class="btn ghost" data-act="add-out" data-deck="${d.id}">Add</button></div>
    <p class="lbl">In</p>
    <div class="chips">${addNames.map(n => chip('in', n, s.ins.includes(n), gcMark(n))).join('')}${insOther.map(n => chip('in', n, true, gcMark(n) + ' ×')).join('')}</div>
    <div class="adder"><input list="dl-sf" data-add="in" data-sf data-deck="${d.id}" placeholder="${addNames.length ? 'Any other card…' : 'Search any card…'}" autocomplete="off"><button class="btn ghost" data-act="add-in" data-deck="${d.id}">Add</button></div>
    ${pairs.length ? `<ul class="pairs">${pairs.map(([o, i]) => `<li><span class="o">${esc(o)}</span> → <b>${esc(i)}</b> ${badges(d, i)}</li>`).join('')}</ul>` : ''}
    <input class="wide" data-f="quote" data-deck="${d.id}" value="${esc(s.quote)}" placeholder="Quote or complaint (optional)">
  </div>`;
}
function nightHint(){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) return '';
  return state.nights.includes(draft.date) ? `Adds to night ${nightNo(draft.date)}`
    : `This becomes night ${state.nights.filter(x => x < draft.date).length + 1}`;
}
function renderNightTab(){
  const games = draft.games.map((g, gi) => `<div class="card pad">
      <div class="sw-head"><h3 class="card-h">${draft.games.length > 1 ? `Game ${gi+1}` : 'The game'}</h3>
        ${draft.games.length > 1 ? `<button class="link" data-act="del-game" data-g="${gi}">Remove</button>` : ''}</div>
      <div class="seatgrid">${state.decks.map(d => `<div class="seatrow">
          <span class="seat-deck">${dot(d.color)}${esc(d.name)}</span>
          <input list="dl-players" data-f="seat" data-g="${gi}" data-deck="${d.id}" value="${esc(g.seats[d.id] || '')}" placeholder="sat out" autocomplete="off">
          <label class="winner"><input type="radio" name="win-${gi}" data-f="winner" data-g="${gi}" value="${d.id}" ${g.winner === d.id ? 'checked' : ''}> won</label>
        </div>`).join('')}</div>
      <input class="wide" data-f="gnote" data-g="${gi}" value="${esc(g.note)}" placeholder="Note about the game (optional)">
    </div>`).join('');
  $('#panel').innerHTML = `${flashHtml()}
    <div class="card pad when"><h3 class="card-h">When</h3>
      <div class="adder"><input type="date" data-f="date" value="${esc(draft.date)}"><span class="hint" id="night-hint">${nightHint()}</span></div></div>
    ${games}
    <button class="btn ghost block" data-act="add-game">+ Another game this night</button>
    <h2 class="adm-h">Card swaps</h2>
    ${state.decks.map(swapCard).join('')}
    <div class="card pad savebox" id="savebox"></div>`;
  renderSaveBox();
}
function renderSaveBox(){
  const {errs, notes} = nightIssues();
  const el = $('#savebox'); if (!el) return;
  const anyMenu = state.decks.some(d => hasMenu(d.id));
  el.innerHTML = `
    ${errs.length ? `<ul class="issues bad">${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${notes.length ? `<ul class="issues">${notes.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${anyMenu ? `<label class="check"><input type="checkbox" data-f="clearMenu" ${draft.clearMenu ? 'checked' : ''}> Clear the next-night menu afterwards</label>` : ''}
    <button class="btn primary block" data-act="save-night" ${errs.length || !conn.ok || busy ? 'disabled' : ''}>${busy || 'Save night'}</button>
    ${!conn.ok ? `<p class="hint">Connect at the top of the page to save.</p>` : ''}
    <button class="link" data-act="reset-night">Start over</button>`;
}
async function saveNight(){
  if (nightIssues().errs.length || !conn.ok) return;
  busy = 'Saving…'; renderSaveBox();
  try {
    const [changesTxt, gamesTxt] = await Promise.all([ghText(FILES.changes), ghText(FILES.games)]);
    const date = draft.date, changeRows = [], gameRows = [];
    let headline = '';
    for (const g of draft.games){
      const seated = state.decks.filter(d => cleanPlayer(g.seats[d.id]));
      if (seated.length < 2) continue;
      const winner = g.winner && cleanPlayer(g.seats[g.winner]) ? cleanPlayer(g.seats[g.winner]) : '';
      gameRows.push([date, seated.map(d => `${cleanPlayer(g.seats[d.id])}:${d.id}`).join(','), winner, field(g.note)].join(';'));
      if (winner) headline = `, ${winner} wins with ${deckById(g.winner).name}`;
    }
    for (const d of state.decks){
      const s = draft.swaps[d.id];
      s.outs.forEach((o, i) => changeRows.push([date, d.id, inDeck(d, o) || o, s.ins[i], i === 0 ? field(s.quote) : ''].join(';')));
    }
    const append = (txt, rows, head) => rows.length ? (txt.trim() ? txt.replace(/\s+$/, '') : head) + '\n' + rows.join('\n') + '\n' : null;
    const files = {};
    const c1 = append(changesTxt, changeRows, HEAD.changes), g1 = append(gamesTxt, gameRows, HEAD.games);
    if (c1) files[FILES.changes] = c1;
    if (g1) files[FILES.games] = g1;
    if (draft.clearMenu && state.decks.some(d => hasMenu(d.id))) files[FILES.next] = HEAD.next + '\n';
    const n = state.nights.includes(date) ? nightNo(date) : state.nights.filter(x => x < date).length + 1;
    const c = await commit(files, `Night ${n} (${date}): ${plural(changeRows.length, 'swap')}${headline}`);
    ls.set(LS_DRAFT, null);
    if (files[FILES.next]) ls.set(LS_MENU, null);
    await reload();
    draft = newDraft(); menu = loadMenu();
    flash = {ok:true, html:`Night ${n} saved: ${plural(changeRows.length, 'swap')}, ${plural(gameRows.length, 'game')}. The site updates in about a minute. <a href="${esc(c.html_url || `https://github.com/${repo}/commits/${branch}`)}" target="_blank" rel="noopener">See the commit ↗</a>`};
  } catch(e){ flash = {ok:false, html:esc(explain(e))}; }
  busy = ''; renderAll(); scrollTo({top:0, behavior:'smooth'});
}

/* ---------- tab: next menu ---------- */
function menuRow(d, kind, x, i){
  return `<li class="mrow"><span class="mname">${esc(x.card)} ${kind === 'add' ? badges(d, x.card) : (inDeck(d, x.card) ? '' : '<span class="flag flag-unknown">? not in the deck</span>')}</span>
    <input data-f="reason" data-kind="${kind}" data-i="${i}" value="${esc(x.reason)}" placeholder="Why? (optional)">
    <button class="icon-btn sm" data-act="menu-del" data-kind="${kind}" data-i="${i}" aria-label="Remove ${esc(x.card)}">×</button></li>`;
}
function renderMenuTab(){
  const d = deckById(menuDeck) || state.decks[0], m = menu[d.id];
  const side = (kind, title, list, ph) => `<div class="card pad">
      <h3 class="card-h">${title} · ${m[kind].length}</h3>
      <ul class="mlist">${m[kind].map((x, i) => menuRow(d, kind, x, i)).join('') || '<li class="hint">Nothing yet.</li>'}</ul>
      <div class="adder"><input list="${list}" data-add="menu-${kind}" ${kind === 'add' ? 'data-sf' : ''} placeholder="${ph}" autocomplete="off"><button class="btn ghost" data-act="menu-add" data-kind="${kind}">Add</button></div>
      <details class="paste"><summary>Paste several</summary>
        <textarea data-paste="${kind}" rows="5" placeholder="One card per line. Optional reason after a | sign:&#10;Hunter's Prowess | 6 mana combat trick"></textarea>
        <button class="btn ghost" data-act="menu-paste" data-kind="${kind}">Add all</button></details>
    </div>`;
  $('#panel').innerHTML = `${flashHtml()}
    <p class="hint">The menu is what players see under "Up next" on the site: cards that could go and cards that could come in.</p>
    <div class="chips deckpick">${state.decks.map(x => `<button class="chip${x.id === d.id ? ' on' : ''}" data-act="menu-deck" data-deck="${x.id}" style="--c:${x.color}">${dot(x.color)}${esc(x.name)}${menu[x.id].cut.length + menu[x.id].add.length ? ` · ${menu[x.id].cut.length}/${menu[x.id].add.length}` : ''}</button>`).join('')}</div>
    <div class="card pad"><h3 class="card-h">${esc(d.name)}: the brief</h3>
      <input class="wide" data-f="brief" value="${esc(m.brief)}" placeholder="What should this round fix? e.g. more dragons, cheaper, fewer combat tricks">
      <label class="inline">Swaps this round <input type="number" min="1" max="10" data-f="picks" value="${m.picks}"></label></div>
    ${side('cut', 'Could go', 'dl-deck-' + d.id, 'Card from the deck…')}
    ${side('add', 'Could come in', 'dl-sf', 'Search any card…')}
    <div class="card pad savebox" id="savebox"></div>`;
  renderMenuSave();
}
function renderMenuSave(){
  const el = $('#savebox'); if (!el) return;
  const total = Object.values(menu).reduce((t, m) => t + m.cut.length + m.add.length, 0);
  el.innerHTML = `<button class="btn primary block" data-act="save-menu" ${!conn.ok || busy || !menuDirty() ? 'disabled' : ''}>${busy || (menuDirty() ? 'Save menu for all decks' : 'Menu saved')}</button>
    ${!conn.ok ? `<p class="hint">Connect at the top of the page to save.</p>` : ''}
    ${total ? `<button class="link" data-act="clear-menu">Empty the whole menu</button>` : ''}`;
}
function menuCsv(){
  const rows = [HEAD.next];
  for (const d of state.decks){
    const m = menu[d.id];
    if (m.brief.trim()) rows.push([d.id, 'brief', '', field(m.brief)].join(';'));
    if (+m.picks && +m.picks !== 3) rows.push([d.id, 'picks', +m.picks, ''].join(';'));
    for (const k of ['cut', 'add']) m[k].forEach(x => rows.push([d.id, k, field(x.card), field(x.reason)].join(';')));
  }
  return rows.join('\n') + '\n';
}
async function saveMenuNow(){
  if (!conn.ok) return;
  busy = 'Saving…'; renderMenuSave();
  try {
    const total = Object.values(menu).reduce((t, m) => t + m.cut.length + m.add.length, 0);
    await commit({[FILES.next]:menuCsv()}, total ? `Next-night menu: ${plural(total, 'option')}` : 'Clear next-night menu');
    ls.set(LS_MENU, null);
    await reload(); menu = loadMenu();
    flash = {ok:true, html:'Menu saved. It shows on the site under "Up next" in about a minute.'};
  } catch(e){ flash = {ok:false, html:esc(explain(e))}; }
  busy = ''; renderAll();
}
/* add one card to the menu; returns an error string or '' */
async function menuAdd(d, kind, raw, reason = ''){
  const m = menu[d.id]; raw = raw.trim(); if (!raw) return '';
  let name;
  if (kind === 'cut'){ name = inDeck(d, raw); if (!name) return `"${raw}" is not in ${d.name}`; }
  else { const s = await lookup(raw); if (!s) return `"${raw}" not found on Scryfall`; name = s.name; }
  if (m[kind].some(x => x.card.toLowerCase() === name.toLowerCase())) return '';
  m[kind].push({card:name, reason});
  return '';
}

/* ---------- tab: lists ---------- */
function renderExportTab(){
  $('#panel').innerHTML = `${flashHtml()}
    <p class="hint">Current lists in Moxfield's import format. Copy one and paste it into the deck's bulk edit.</p>
    ${state.decks.map(d => `<div class="card pad"><div class="sw-head">${dot(d.color)}<b>${esc(d.name)}</b>
      <span class="count">${d.size} cards · ${d.changed} changed</span>
      <button class="btn ghost" data-act="copy" data-deck="${d.id}">Copy list</button></div>
      <textarea readonly rows="4" id="list-${d.id}">${esc(exportList(d))}</textarea>
      ${d.moxfield ? `<a class="hint" href="${esc(d.moxfield)}" target="_blank" rel="noopener">Open in Moxfield ↗</a>` : ''}</div>`).join('')}
    <div class="card pad"><h3 class="card-h">Fix a mistake</h3>
      <p class="hint">Saved rows can be edited or deleted directly in the data files:</p>
      <p>${['changes', 'games', 'next'].map(k => `<a href="https://github.com/${esc(repo)}/edit/${esc(branch)}/${FILES[k]}" target="_blank" rel="noopener">${FILES[k].split('/')[1]} ↗</a>`).join(' · ')}</p></div>`;
}

/* ---------- events ---------- */
function renderAll(){
  renderConnect(); renderTabs(); renderLists();
  ({night:renderNightTab, menu:renderMenuTab, export:renderExportTab})[tab]();
  flash = null;
}
const toggle = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); };
let sfTimer = 0;

document.addEventListener('input', e => {
  const t = e.target, f = t.dataset.f;
  if (t.dataset.sf !== undefined){
    clearTimeout(sfTimer);
    sfTimer = setTimeout(async () => { $('#dl-sf').innerHTML = (await autocomplete(t.value)).slice(0, 12).map(n => `<option value="${esc(n)}">`).join(''); }, 250);
  }
  if (!f) return;
  if (tab === 'night'){
    if (f === 'date'){ draft.date = t.value; $('#night-hint').textContent = nightHint(); }
    if (f === 'seat'){ draft.games[+t.dataset.g].seats[t.dataset.deck] = t.value; }
    if (f === 'winner'){ draft.games[+t.dataset.g].winner = t.value; }
    if (f === 'gnote'){ draft.games[+t.dataset.g].note = t.value; }
    if (f === 'quote'){ draft.swaps[t.dataset.deck].quote = t.value; }
    if (f === 'clearMenu'){ draft.clearMenu = t.checked; }
    saveDraft(); renderSaveBox();
  } else if (tab === 'menu'){
    const m = menu[menuDeck];
    if (f === 'brief') m.brief = t.value;
    if (f === 'picks') m.picks = Math.max(1, +t.value || 3);
    if (f === 'reason') m[t.dataset.kind][+t.dataset.i].reason = t.value;
    saveMenu(); renderMenuSave();
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.dataset || !e.target.dataset.add) return;
  e.preventDefault();
  const btn = e.target.parentElement.querySelector('button'); if (btn) btn.click();
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, d = b.dataset.deck ? deckById(b.dataset.deck) : null;
  const input = b.parentElement.querySelector('input');
  switch (act){
    case 'connect': token = ($('#token-in').value || '').trim(); ls.set(LS_TOKEN, token || null);
      $('#connect').innerHTML = '<p class="hint">Connecting…</p>'; await connect();
      if (conn.ok){ await reload(); draft = loadDraft(); menu = loadMenu(); } else if (conn.msg.includes('rejected')){ token = ''; ls.set(LS_TOKEN, null); }
      renderAll(); break;
    case 'disconnect': token = ''; ls.set(LS_TOKEN, null); conn = {ok:false, msg:''}; renderAll(); break;
    case 'tab': tab = b.dataset.v; renderAll(); break;

    case 'add-game': draft.games.push(newGame()); saveDraft(); renderNightTab(); break;
    case 'del-game': draft.games.splice(+b.dataset.g, 1); saveDraft(); renderNightTab(); break;
    case 'out': toggle(draft.swaps[d.id].outs, b.dataset.card); saveDraft(); renderNightTab(); break;
    case 'in': toggle(draft.swaps[d.id].ins, b.dataset.card); saveDraft(); renderNightTab(); break;
    case 'add-out': {
      const name = inDeck(d, input.value);
      if (!name){ if (input.value.trim()) input.setCustomValidity('Not in this deck'), input.reportValidity(); break; }
      if (!draft.swaps[d.id].outs.includes(name)) draft.swaps[d.id].outs.push(name);
      saveDraft(); renderNightTab(); break; }
    case 'add-in': {
      const raw = input.value.trim(); if (!raw) break;
      b.disabled = true; b.textContent = '…';
      const s = await lookup(raw);
      if (!s){ b.disabled = false; b.textContent = 'Add'; input.setCustomValidity('Not found on Scryfall'); input.reportValidity(); break; }
      if (!draft.swaps[d.id].ins.includes(s.name)) draft.swaps[d.id].ins.push(s.name);
      saveDraft(); renderNightTab(); break; }
    case 'save-night': await saveNight(); break;
    case 'reset-night': if (confirm('Throw away everything entered for this night?')){ ls.set(LS_DRAFT, null); draft = newDraft(); renderNightTab(); } break;

    case 'menu-deck': menuDeck = d.id; renderMenuTab(); break;
    case 'menu-del': menu[menuDeck][b.dataset.kind].splice(+b.dataset.i, 1); saveMenu(); renderMenuTab(); break;
    case 'menu-add': {
      b.disabled = true;
      const err = await menuAdd(deckById(menuDeck), b.dataset.kind, input.value);
      if (err){ b.disabled = false; input.setCustomValidity(err); input.reportValidity(); break; }
      saveMenu(); renderMenuTab(); break; }
    case 'menu-paste': {
      const ta = b.parentElement.querySelector('textarea'), errs = [];
      b.disabled = true; b.textContent = 'Checking…';
      for (const line of ta.value.split('\n')){
        const [name, ...why] = line.replace(/^\s*\d+x?\s+/, '').split('|');
        const err = await menuAdd(deckById(menuDeck), b.dataset.kind, name || '', why.join('|').trim());
        if (err) errs.push(err);
      }
      saveMenu();
      if (errs.length) flash = {ok:false, html:'Skipped: ' + errs.map(esc).join('; ')};
      renderAll(); break; }
    case 'save-menu': await saveMenuNow(); break;
    case 'clear-menu': if (confirm('Empty the menu for all decks?')){ for (const m of Object.values(menu)){ m.cut = []; m.add = []; m.brief = ''; m.picks = 3; } saveMenu(); renderMenuTab(); } break;

    case 'copy': {
      const ta = $('#list-' + d.id);
      try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
      b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = 'Copy list', 1500); break; }
  }
});
document.addEventListener('input', e => { if (e.target.setCustomValidity) e.target.setCustomValidity(''); }, true);

/* ---------- boot ---------- */
async function reload(){
  await load(conn.ok ? ghText : undefined);
  await loadCards([...Object.values(draft ? draft.swaps : {}).flatMap(s => s.ins), ...Object.values(menu || {}).flatMap(m => m.add.map(x => x.card))]);
}
(async () => {
  try {
    await load();                                   // from the site itself: quick, and tells us the repo
    repo = repoFromLocation() || state.site.repo || '';
    await connect();
    if (conn.ok) await load(ghText);                // then straight from GitHub, so nothing is stale
    draft = loadDraft(); menu = loadMenu(); menuDeck = state.decks[0].id;
    renderAll();
    await reload(); renderAll();
  } catch(e){ $('#panel').innerHTML = `<p class="warn">Could not load data: ${esc(e.message)}</p>`; }
})();
})();
