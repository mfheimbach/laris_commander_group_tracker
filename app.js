/* Commander Legacy tracker. Plain JS, no build step.
   Data lives in /data; card images come from Scryfall in the browser. */
(() => {
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS = {flight:'--flight', chaos:'--chaos', grave:'--grave', tokens:'--tokens', dragons:'--dragons'};
const FALLBACK = ['#3987e5','#d6463f','#9085e9','#199e70','#c98500'];
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
const fmtShort = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short'});
const TYPE_ORDER = ['Commander','Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land','Other'];
const BASICS = new Set(['Plains','Island','Swamp','Mountain','Forest','Wastes']);

let state = {decks:[], games:[], changes:[], nights:[], warnings:[], current:null};
let cards = {};           // name -> scryfall info
let activeDeck = null;
const PLAYER_COLORS = ['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
const ui = (() => { try { return Object.assign({chart:'decks', metric:'wins', stats:'decks'}, JSON.parse(localStorage.getItem('ui-v1'))); } catch { return {chart:'decks', metric:'wins', stats:'decks'}; } })();
const saveUi = () => { try { localStorage.setItem('ui-v1', JSON.stringify(ui)); } catch {} };
const pColor = p => PLAYER_COLORS[state.players.indexOf(p)] || '#7c7a73';
const joinNames = a => a.length < 2 ? (a[0] || '') : a.slice(0,-1).join(', ') + ' & ' + a[a.length-1];

/* ---------- data loading ---------- */
async function getText(path){
  const r = await fetch(path, {cache:'no-store'});
  if (!r.ok) throw new Error(path + ': ' + r.status);
  return r.text();
}
function parseCSV(txt){
  const lines = txt.replace(/\r/g,'').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const head = lines.shift().split(';').map(h => h.trim().toLowerCase());
  return lines.map(l => {
    const v = l.split(';'); const o = {};
    head.forEach((h,i) => o[h] = (v[i] ?? '').trim().replace(/^"(.*)"$/,'$1'));
    return o;
  });
}
function parseList(txt){
  return txt.replace(/\r/g,'').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)x?\s+(.+)$/); return m ? {qty:+m[1], name:m[2].trim()} : {qty:1, name:l};
  });
}

async function load(){
  const [site, decks, games, changes] = await Promise.all([
    getText('data/site.json').then(JSON.parse).catch(() => ({})),
    getText('data/decks.json').then(JSON.parse),
    getText('data/games.csv').then(parseCSV),
    getText('data/changes.csv').then(parseCSV),
  ]);
  if (site.title){ $('#site-title').textContent = site.title; document.title = site.title; }
  if (site.subtitle) $('#site-sub').textContent = site.subtitle;
  for (const [i,d] of decks.entries()){
    d.list = parseList(await getText(`data/decks/${d.id}.txt`));
    d.color = getComputedStyle(document.documentElement).getPropertyValue(COLORS[d.id] || '').trim() || FALLBACK[i % FALLBACK.length];
  }
  state.decks = decks;
  const find = key => {
    const k = (key||'').toLowerCase();
    return decks.find(d => d.id.toLowerCase() === k || d.name.toLowerCase() === k || (d.pilot && d.pilot.toLowerCase() === k));
  };
  state.find = find;

  // decks column: "flight,chaos" or with players "Mo:flight,Anna:chaos"; winner: deck or player
  state.games = games.filter(g => g.date).map((g,i) => {
    const entries = g.decks ? g.decks.split(',').map(s => s.trim()).filter(Boolean) : decks.map(d => d.id);
    const seats = entries.map(e => {
      const [a, b] = e.includes(':') ? e.split(':').map(s => s.trim()) : [null, e];
      const d = find(b); if (!d) warn(`games.csv row ${i+2}: unknown deck "${b}"`);
      return d ? {player:a || null, deck:d.id} : null;
    }).filter(Boolean);
    let winner = null, winnerPlayer = null;
    if (g.winner){
      const seat = seats.find(s => s.player && s.player.toLowerCase() === g.winner.toLowerCase());
      const d = seat ? null : find(g.winner);
      if (seat){ winner = seat.deck; winnerPlayer = seat.player; }
      else if (d){ winner = d.id; winnerPlayer = (seats.find(s => s.deck === d.id) || {}).player || null; }
      else warn(`games.csv row ${i+2}: unknown winner "${g.winner}"`);
    }
    return {date:g.date, seats, decks:seats.map(s => s.deck), winner, winnerPlayer, note:g.note || ''};
  });
  state.players = [...new Set(state.games.flatMap(g => g.seats.map(s => s.player)).filter(Boolean))];
  state.changes = changes.filter(c => c.date).map((c,i) => {
    const d = find(c.deck); if (!d) warn(`changes.csv row ${i+2}: unknown deck "${c.deck}"`);
    return {date:c.date, deck:d ? d.id : null, out:c.out, in:c.in, note:c.note || '', row:i+2};
  }).filter(c => c.deck);
  state.nights = [...new Set([...state.games.map(g => g.date), ...state.changes.map(c => c.date)])].sort();
  replay();
}
function warn(msg){ state.warnings.push(msg); }

/* Apply all swaps in order to get each deck's current list. */
function replay(){
  for (const d of state.decks){
    const m = new Map(); d.list.forEach(c => m.set(c.name, {qty:c.qty, added:null}));
    d.commander0 = d.commander;
    d.cur = d.commander; d.removed = []; d.swaps = [];
    const chs = state.changes.filter(c => c.deck === d.id).sort((a,b) => a.date.localeCompare(b.date));
    for (const c of chs){
      c.isCmd = false;
      if (c.out){
        const key = [...m.keys()].find(k => k.toLowerCase() === c.out.toLowerCase());
        if (!key){ warn(`changes.csv row ${c.row}: "${c.out}" is not in ${d.name} at that point (typo?)`); }
        else {
          if (key === d.cur){ c.isCmd = true; d.cur = c.in || d.cur; }
          const e = m.get(key); e.qty -= 1; if (e.qty <= 0) m.delete(key);
          d.removed.push({name:key, date:c.date});
        }
      }
      if (c.in){
        const key = [...m.keys()].find(k => k.toLowerCase() === c.in.toLowerCase()) || c.in;
        const e = m.get(key) || {qty:0, added:null}; e.qty += 1; e.added = c.date; m.set(key, e);
        d.removed = d.removed.filter(r => r.name.toLowerCase() !== key.toLowerCase());
      }
      d.swaps.push(c);
    }
    d.now = m;
  }
}

/* ---------- Scryfall ---------- */
const CACHE_KEY = 'sfcache-v1', WEEK = 7*864e5;
function readCache(){ try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } }
function writeCache(c){ try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }
const fuzzyImg = (name, v='normal') => `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=${v}`;

function slim(card){
  const f = card.image_uris ? card : (card.card_faces && card.card_faces[0]) || {};
  const iu = f.image_uris || {};
  return {name:card.name, type:card.type_line || f.type_line || '', cmc:card.cmc ?? 0,
          small:iu.small, normal:iu.normal, art:iu.art_crop, uri:card.scryfall_uri, t:Date.now()};
}
async function loadCards(){
  const names = new Set();
  for (const d of state.decks){ d.list.forEach(c => names.add(c.name)); }
  state.changes.forEach(c => { if (c.in) names.add(c.in); if (c.out) names.add(c.out); });
  const cache = readCache();
  const need = [];
  for (const n of names){
    const hit = cache[n.toLowerCase()];
    if (hit && Date.now() - hit.t < WEEK) cards[n.toLowerCase()] = hit; else need.push(n);
  }
  for (let i = 0; i < need.length; i += 75){
    const chunk = need.slice(i, i+75);
    try {
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({identifiers:chunk.map(name => ({name}))})});
      const j = await r.json();
      for (const c of j.data || []){
        const s = slim(c);
        const key = chunk.find(n => n.toLowerCase() === c.name.toLowerCase() || c.name.toLowerCase().startsWith(n.toLowerCase() + ' //'));
        cards[(key || c.name).toLowerCase()] = s; cache[(key || c.name).toLowerCase()] = s;
      }
      for (const nf of j.not_found || []) warn(`Scryfall doesn't know "${nf.name}" (typo?)`);
    } catch(e){ console.warn('Scryfall', e); }
    if (i + 75 < need.length) await new Promise(r => setTimeout(r, 120));
  }
  writeCache(cache);
}
const info = n => cards[(n||'').toLowerCase()] || {};
let cardsReady = false;
const img = (n, v='normal') => info(n)[v] || (cardsReady ? fuzzyImg(n, v === 'art' ? 'art_crop' : v) : '');
/* <img> once we know the URL, a named placeholder before that */
const pic = (n, v, cls='', lazy=true) => { const u = img(n, v); return u ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(u)}" alt="${esc(n)}"${lazy ? ' loading="lazy"' : ''}>` : `<span class="ph ${cls}">${esc(n)}</span>`; };
function typeOf(n){
  const t = info(n).type || '';
  if (!t) return 'Other';
  const front = t.split('//')[0];
  for (const k of ['Land','Creature','Planeswalker','Battle','Instant','Sorcery','Artifact','Enchantment']) if (front.includes(k)) return k;
  return 'Other';
}

/* ---------- derived numbers ---------- */
function deckStats(d){
  const gs = state.games.filter(g => g.decks.includes(d.id));
  const wins = gs.filter(g => g.winner === d.id).length;
  const expected = gs.reduce((s,g) => s + (g.winner ? 1/g.decks.length : 0), 0);
  return {played:gs.length, wins, expected, swaps:d.swaps.length};
}

function playerStats(p){
  const gs = state.games.filter(g => g.seats.some(s => s.player === p));
  const wins = gs.filter(g => g.winnerPlayer === p).length;
  const expected = gs.reduce((s,g) => s + (g.winner ? 1/g.seats.length : 0), 0);
  const decks = [...new Set(gs.map(g => g.seats.find(s => s.player === p).deck))];
  return {played:gs.length, wins, expected, decks};
}
const leaderOf = rows => {
  const top = Math.max(0, ...rows.map(r => r.wins));
  return top ? joinNames(rows.filter(r => r.wins === top).map(r => r.label)) : '–';
};
/* who played a deck most / best, and which deck a player played most / best */
function crossStats(){
  const cells = {};   // `${player}|${deck}` -> {games, wins}
  for (const g of state.games) for (const st of g.seats){
    if (!st.player) continue;
    const k = st.player + '|' + st.deck, c = cells[k] || (cells[k] = {games:0, wins:0});
    c.games++; if (g.winnerPlayer === st.player) c.wins++;
  }
  const pick = (pairs, f) => {           // pairs: [label, {games,wins}]
    const m = Math.max(0, ...pairs.map(([,c]) => f(c)));
    return m ? {names:pairs.filter(([,c]) => f(c) === m).map(([l]) => l), n:m} : null;
  };
  const forDeck = id => { const ps = state.players.map(p => [p, cells[p+'|'+id]]).filter(([,c]) => c);
    return {most:pick(ps, c => c.games), best:pick(ps, c => c.wins)}; };
  const forPlayer = p => { const ds = state.decks.map(d => [d.name, cells[p+'|'+d.id]]).filter(([,c]) => c);
    return {most:pick(ds, c => c.games), best:pick(ds, c => c.wins)}; };
  return {cells, forDeck, forPlayer};
}

/* ---------- render: hero + strip ---------- */
const pips = colors => `<span class="pips">${[...colors].map(c => `<img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}">`).join('')}</span>`;

function renderHero(){
  const games = state.games.length, nights = state.nights.length, swaps = state.changes.length;
  const leader = leaderOf(state.decks.map(d => ({label:d.name, ...deckStats(d)})));
  const topPlayer = leaderOf(state.players.map(p => ({label:p, ...playerStats(p)})));
  $('#stats').innerHTML = [
    [nights, 'game nights'], [games, 'games played'], [swaps, 'cards swapped'], [leader, 'top deck'], ...(state.players.length ? [[topPlayer, 'top player']] : []),
  ].map(([v,l]) => `<div class="stat"><b${typeof v === 'string' && v.length > 3 ? ' class="txt"' : ''}>${esc(v)}</b><span>${l}</span></div>`).join('');
}

function renderStrip(){
  $('#deck-strip').innerHTML = state.decks.map(d => {
    const s = deckStats(d);
    return `<button class="deck-card" data-deck="${d.id}" style="--c:${d.color}">
      ${pips(d.colors)}
      <div class="art" style="${img(d.cur,'art') ? `background-image:url('${esc(img(d.cur,'art'))}')` : ''}"></div>
      <div class="body"><h3>${esc(d.name)}</h3>
        <p class="cmd">${esc(d.cur)}${d.pilot ? ' · ' + esc(d.pilot) : ''}</p>
        <div class="meta"><span><b>${s.wins}</b> ${s.wins === 1 ? 'win' : 'wins'}</span><span><b>${s.played}</b> ${s.played === 1 ? 'game' : 'games'}</span><span><b>${s.swaps}</b> ${s.swaps === 1 ? 'swap' : 'swaps'}</span></div>
      </div></button>`;
  }).join('');
  document.querySelectorAll('.deck-card').forEach(b => b.onclick = () => {
    selectDeck(b.dataset.deck); $('#deck-h').scrollIntoView({behavior:'smooth'});
  });
}

/* ---------- render: timeline ---------- */
function renderTimeline(){
  const cols = ['start', ...state.nights];
  const el = $('#timeline');
  el.style.gridTemplateColumns = `${innerWidth < 600 ? 104 : 150}px repeat(${cols.length}, minmax(124px, 1fr))`;
  let h = `<div class="tl-head tl-colhead"></div>`;
  h += cols.map((c,i) => i === 0
    ? `<div class="tl-colhead"><b>Start</b>Out of the box</div>`
    : `<div class="tl-colhead"><b>Night ${i}</b>${fmtShort(c)}</div>`).join('');
  if (state.games.length){
    h += `<div class="tl-label tl-head chart-label" style="min-height:0"><span>${ui.metric === 'power' ? 'Power' : 'Wins'}<small>${ui.chart === 'players' ? 'players' : 'decks'}</small></span></div><div class="tl-chart" id="tl-chart" style="grid-column:2/-1"></div>`;
  }
  for (const d of state.decks){
    h += `<div class="tl-row"><div class="tl-label" style="--c:${d.color}"><i></i>${esc(d.name)}</div>`;
    h += cols.map((c,i) => {
      if (i === 0) return `<div class="tl-cell"><button class="c" data-card="${esc(d.commander0)}" title="${esc(d.commander0)}">${pic(d.commander0,'small','thumb')}</button></div>`;
      const gs = state.games.filter(g => g.date === c && g.decks.includes(d.id));
      const w = gs.filter(g => g.winner === d.id).length;
      const sw = d.swaps.filter(s => s.date === c);
      let inner = '';
      if (w){ const who = [...new Set(gs.filter(g => g.winner === d.id).map(g => g.winnerPlayer).filter(Boolean))].join(', ');
        inner += `<span class="win">★ ${w > 1 ? w + ' wins' : 'Win'}${who ? ' · ' + esc(who) : ''}</span>`; }
      inner += sw.map(s => `<button class="swap${s.isCmd ? ' cmdswap' : ''}" data-swap="${state.changes.indexOf(s)}" title="${esc(s.out || '—')} → ${esc(s.in || '—')}">
          ${s.out ? pic(s.out,'small','out') : ''}
          <span class="arr">→</span>
          ${s.in ? pic(s.in,'small','in') : ''}</button>`).join('');
      if (gs.length && !w) inner += `<span class="played">played ${gs.length > 1 ? gs.length + '×' : ''}</span>`;
      return `<div class="tl-cell">${inner}</div>`;
    }).join('');
    h += `</div>`;
  }
  if (!state.nights.length) h += `<div class="empty" style="grid-column:1/-1">No game nights logged yet. The first swaps and wins will show up here.</div>`;
  el.innerHTML = h;
  el.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => showSwap(state.changes[+b.dataset.swap]));
  el.querySelectorAll('.tl-cell [data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card));
  if (state.games.length) drawChart(cols);
}

function seg(name, opts){
  return `<div class="seg" role="group">${opts.map(([v,l]) => `<button data-ui="${name}" data-v="${v}" aria-pressed="${ui[name] === v}">${l}</button>`).join('')}</div>`;
}
function bindSeg(root, rerender){
  root.querySelectorAll('[data-ui]').forEach(b => b.onclick = () => { ui[b.dataset.ui] = b.dataset.v; saveUi(); rerender(); });
}
function renderChartControls(){
  const el = $('#chart-controls'); if (!el) return;
  el.innerHTML = state.games.length ? seg('chart', [['decks','Decks'],['players','Players']]) + seg('metric', [['wins','Wins'],['power','Power']]) : '';
  bindSeg(el, () => { renderChartControls(); renderTimeline(); });
}

/* cumulative series per entity: wins, or power = wins minus fair share (1/seats per game played) */
function chartSeries(cols){
  const ents = ui.chart === 'players'
    ? state.players.map(p => ({key:p, label:p, color:pColor(p), seat:g => g.seats.some(s => s.player === p), won:g => g.winnerPlayer === p}))
    : state.decks.map(d => ({key:d.id, label:d.name, color:d.color, seat:g => g.decks.includes(d.id), won:g => g.winner === d.id}));
  return ents.map(e => {
    let acc = 0;
    const v = cols.map((c,i) => {
      if (i === 0) return 0;
      for (const g of state.games.filter(g => g.date === c && g.winner && e.seat(g)))
        acc += (e.won(g) ? 1 : 0) - (ui.metric === 'power' ? 1 / g.seats.length : 0);
      return Math.round(acc * 100) / 100;
    });
    return {...e, v};
  });
}

function drawChart(cols){
  const host = $('#tl-chart');
  const series = chartSeries(cols);
  if (!series.length){ host.innerHTML = `<p class="hint" style="padding:16px">No player names logged yet.</p>`; return; }
  const all = series.flatMap(s => s.v);
  const max = Math.max(ui.metric === 'power' ? .5 : 1, ...all), min = Math.min(0, ...all);
  const fmt = v => ui.metric === 'power' ? (v > 0 ? '+' : '') + v.toFixed(2).replace(/\.?0+$/,'') : String(v);
  const draw = () => {
    const W = host.clientWidth, H = 180, pt = 16, pb = 14, n = cols.length;
    const x = i => (i + .5) * W / n, y = v => pt + (H - pt - pb) * (max - v) / (max - min || 1);
    const ticks = ui.metric === 'power' ? [...new Set([min, 0, max].map(t => Math.round(t*4)/4))] : [...new Set([0, Math.round(max/2), max])];
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="${ui.metric === 'power' ? 'Power' : 'Cumulative wins'} per ${ui.chart === 'players' ? 'player' : 'deck'}">`;
    s += ticks.map(t => `<line x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 && ui.metric === 'power' ? '#4a4f5c' : '#2a2e37'}" stroke-width="1"/><text x="4" y="${y(t)-4}" fill="#7c7a73" font-size="10">${fmt(t)}</text>`).join('');
    series.forEach((sr, k) => {
      const off = (k - (series.length-1)/2) * 2;   // keep tied lines visible
      const pts = sr.v.map((v,i) => `${x(i)},${y(v)+off}`).join(' ');
      s += `<g class="ln" data-k="${k}"><polyline points="${pts}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      s += sr.v.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)+off}" r="4" fill="${sr.color}" stroke="#15171c" stroke-width="2"/>`).join('') + '</g>';
    });
    s += cols.map((c,i) => `<rect class="hit" data-i="${i}" x="${i*W/n}" y="0" width="${W/n}" height="${H}" fill="transparent"/>`).join('');
    s += `<line id="xh" x1="0" x2="0" y1="${pt-6}" y2="${H-pb}" stroke="#7c7a73" stroke-dasharray="3 3" visibility="hidden"/>`;
    host.innerHTML = s + '</svg>' + (ui.chart === 'players'
      ? `<div class="legend">${series.map(sr => `<span style="--c:${sr.color}"><i></i>${esc(sr.label)}</span>`).join('')}</div>` : '');
    const tip = $('#tip'), xh = host.querySelector('#xh');
    host.querySelectorAll('.hit').forEach(r => {
      r.onmousemove = e => {
        const i = +r.dataset.i;
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility','visible');
        const rows = series.map(sr => [sr, sr.v[i]]).sort((a,b) => b[1]-a[1]);
        tip.innerHTML = `<b>${i === 0 ? 'Start' : `Night ${i} · ${fmtShort(cols[i])}`}</b>` +
          rows.map(([sr,v]) => `<div class="r" style="--c:${sr.color}"><span><i></i>${esc(sr.label)}</span><span>${fmt(v)}</span></div>`).join('');
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      };
      r.onmouseleave = () => { tip.hidden = true; xh.setAttribute('visibility','hidden'); };
    });
  };
  draw();
  if (host._ro) host._ro.disconnect();
  host._ro = new ResizeObserver(() => draw()); host._ro.observe(host);
}

/* ---------- render: deck detail ---------- */
function renderTabs(){
  $('#tabs').innerHTML = state.decks.map(d =>
    `<button class="tab" role="tab" data-deck="${d.id}" style="--c:${d.color}" aria-selected="${d.id === activeDeck}">${esc(d.name)}</button>`).join('');
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => selectDeck(t.dataset.deck));
}
function selectDeck(id){ activeDeck = id; renderTabs(); renderDetail(); }

function renderDetail(){
  const d = state.decks.find(x => x.id === activeDeck);
  const s = deckStats(d);
  const groups = {};
  for (const [name, e] of d.now){
    const g = name === d.cur ? 'Commander' : typeOf(name);
    (groups[g] = groups[g] || []).push({name, ...e});
  }
  const cardBtn = c => `<button class="c${c.added ? ' is-new' : ''}" data-card="${esc(c.name)}" title="${esc(c.name)}">
      ${pic(c.name,'small')}
      ${c.qty > 1 ? `<span class="qty">×${c.qty}</span>` : ''}
      ${c.added ? `<span class="new">new</span>` : ''}</button>`;
  let main = '';
  for (const g of TYPE_ORDER){
    if (!groups[g] || g === 'Commander') continue;
    const list = groups[g].sort((a,b) => (BASICS.has(a.name) - BASICS.has(b.name)) || (info(a.name).cmc||0) - (info(b.name).cmc||0) || a.name.localeCompare(b.name));
    const n = list.reduce((t,c) => t + c.qty, 0);
    const label = {Sorcery:'Sorceries', Other: cardsReady ? 'Other' : 'Cards'}[g] || g + 's';
    main += `<div class="group"><h4>${label} <span>${n}</span></h4><div class="grid">${list.map(cardBtn).join('')}</div></div>`;
  }
  if (d.removed.length){
    main += `<div class="group gy"><h4>Swapped out <span>${d.removed.length}</span></h4><div class="grid">${d.removed.map(r => cardBtn({name:r.name, qty:1})).join('')}</div></div>`;
  }
  const log = d.swaps.length
    ? `<ul class="log">${[...d.swaps].reverse().map(c => `<li><span class="d">${fmtDate(c.date)}${c.isCmd ? ' · new commander' : ''}</span>
        ${c.out ? `<span class="o">${esc(c.out)}</span> → ` : ''}<b>${esc(c.in)}</b>${c.note ? `<span class="n">“${esc(c.note)}”</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="sub">No swaps yet. This is the deck straight out of the box.</p>`;
  $('#deck-detail').innerHTML = `<div class="detail">
    <div class="side">
      <button class="c" data-card="${esc(d.cur)}">${pic(d.cur,'normal','cmdimg',false)}</button>
      <h3>${esc(d.name)} ${pips(d.colors)}</h3>
      <p class="sub">${s.wins} ${s.wins === 1 ? 'win' : 'wins'} in ${s.played} ${s.played === 1 ? 'game' : 'games'} · ${s.swaps} ${s.swaps === 1 ? 'swap' : 'swaps'}${d.pilot ? ' · played by ' + esc(d.pilot) : ''}</p>
      ${d.moxfield ? `<a class="mox" href="${esc(d.moxfield)}" target="_blank" rel="noopener">Full list on Moxfield ↗</a>` : ''}
      <h4 style="font:600 .8rem Inter;text-transform:uppercase;letter-spacing:.12em;color:var(--text-2);margin:18px 0 6px">History</h4>
      ${log}
    </div>
    <div>${main}</div></div>`;
  $('#deck-detail').querySelectorAll('[data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card));
}

/* ---------- render: stats ---------- */
function bars(rows){
  return `<div class="bars">` + rows.map(r => {
    const rate = r.played ? r.wins / r.played : 0, exp = r.played ? r.expected / r.played : 0;
    return `<div class="lab" style="--c:${r.color}"><span class="rank">${r.rank}</span><i></i><span>${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span></div>
      <div class="track" title="Fair share: ${Math.round(exp*100)}%"><div class="fill" style="--c:${r.color};width:${rate*100}%"></div>
        ${r.played ? `<span class="fair" style="left:${exp*100}%"></span>` : ''}</div>
      <div class="val">${r.wins} / ${r.played} · ${Math.round(rate*100)}%</div>`;
  }).join('') + `</div>`;
}
function ranked(rows){
  const rate = r => r.played ? r.wins / r.played : 0;
  rows.sort((a,b) => b.wins - a.wins || rate(b) - rate(a) || a.label.localeCompare(b.label));
  rows.forEach((r,i) => r.rank = i && r.wins === rows[i-1].wins && rate(r) === rate(rows[i-1]) ? rows[i-1].rank : i + 1);
  return rows;
}
const subLine = x => [
  x.most && `Most: ${esc(joinNames(x.most.names))} (${x.most.n})`,
  x.best && `Best: ${esc(joinNames(x.best.names))} (${x.best.n} ${x.best.n === 1 ? 'win' : 'wins'})`,
].filter(Boolean).join(' · ');

function renderStats(){
  const body = $('#stat-body');
  if (!state.games.length){ body.innerHTML = `<p class="hint">Stats appear after the first logged game.</p>`; return; }
  const cx = crossStats();
  const mode = state.players.length ? ui.stats : 'decks';
  const rows = mode === 'players'
    ? ranked(state.players.map(p => ({label:p, color:pColor(p), ...playerStats(p), sub:subLine(cx.forPlayer(p))})))
    : ranked(state.decks.map(d => ({label:d.name, color:d.color, ...deckStats(d), sub:subLine(cx.forDeck(d.id))})));

  let matrix = '';
  if (state.players.length){
    matrix = `<h3 class="sub-h">Who played what</h3><div class="mx-scroll"><table class="mx"><thead><tr><th></th>${state.decks.map(d =>
      `<th style="--c:${d.color}"><i></i>${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${state.players.map(p =>
      `<tr><th style="--c:${pColor(p)}"><i></i>${esc(p)}</th>${state.decks.map(d => {
        const c = cx.cells[p+'|'+d.id];
        return c ? `<td class="has${c.wins ? ' won' : ''}" title="${esc(p)} on ${esc(d.name)}: ${c.wins} of ${c.games}">${c.wins ? '★'.repeat(Math.min(c.wins,3)) + ' ' : ''}${c.wins}/${c.games}</td>` : '<td></td>';
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="stat-note">Wins / games for each player on each deck.</p>`;
  }

  body.innerHTML = `${state.players.length ? `<div class="stat-ctl">${seg('stats', [['decks','Decks'],['players','Players']])}</div>` : ''}
    ${bars(rows)}
    <p class="stat-note">Ranked by wins, then win rate. The thin line marks a fair share: how often each ${mode === 'players' ? 'player' : 'deck'} would win if every game were a coin flip among the seats at the table. Only four of the five decks play each game, so a deck sitting out doesn't lose anything. With this few games, treat any gap as noise.</p>
    ${matrix}`;
  bindSeg(body, renderStats);
}

/* ---------- modal ---------- */
function openModal(html){ $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
function closeModal(){ $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }
function showCard(n){
  const i = info(n);
  openModal(`<div class="mcards"><figure><img src="${esc(img(n,'normal'))}" alt="${esc(n)}">
    <figcaption>${i.uri ? `<a href="${esc(i.uri)}" target="_blank" rel="noopener">${esc(n)} on Scryfall</a>` : esc(n)}</figcaption></figure></div>`);
}
function showSwap(c){
  const d = state.decks.find(x => x.id === c.deck);
  openModal(`<div class="mcards">
    ${c.out ? `<figure><img src="${esc(img(c.out))}" alt="${esc(c.out)}"><figcaption>Out</figcaption></figure><span class="arrow">→</span>` : ''}
    ${c.in ? `<figure><img src="${esc(img(c.in))}" alt="${esc(c.in)}"><figcaption>In${c.isCmd ? ' · new commander' : ''}</figcaption></figure>` : ''}
    </div><p class="mnote">${esc(d.name)} · ${fmtDate(c.date)}${c.note ? ` · “${esc(c.note)}”` : ''}</p>`);
}
$('#modal').onclick = e => { if (e.target.id === 'modal' || e.target.id === 'modal-close') closeModal(); };
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- boot ---------- */
function renderAll(){
  renderHero(); renderStrip(); renderChartControls(); renderTimeline(); renderTabs(); renderDetail(); renderStats();
  const w = $('#warnings');
  if (state.warnings.length){ w.hidden = false; w.innerHTML = '<b>Data check:</b><br>' + [...new Set(state.warnings)].map(esc).join('<br>'); }
}
load().then(() => {
  activeDeck = state.decks[0].id;
  renderAll();                         // fast first paint with fallback image URLs
  return loadCards().finally(() => { cardsReady = true; renderAll(); });  // then re-render with proper images + card types
}).catch(e => {
  document.querySelector('main').innerHTML = `<p class="warn">Could not load data: ${esc(e.message)}</p>`;
});
})();
