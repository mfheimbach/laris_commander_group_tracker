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

  state.games = games.filter(g => g.date).map((g,i) => {
    const ids = g.decks ? g.decks.split(',').map(s => s.trim()).filter(Boolean) : decks.map(d => d.id);
    const ds = ids.map(id => { const d = find(id); if (!d) warn(`games.csv row ${i+2}: unknown deck "${id}"`); return d; }).filter(Boolean);
    const w = g.winner ? find(g.winner) : null;
    if (g.winner && !w) warn(`games.csv row ${i+2}: unknown winner "${g.winner}"`);
    return {date:g.date, decks:ds.map(d => d.id), winner:w ? w.id : null, note:g.note || ''};
  });
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

/* ---------- render: hero + strip ---------- */
const pips = colors => `<span class="pips">${[...colors].map(c => `<img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}">`).join('')}</span>`;

function renderHero(){
  const games = state.games.length, nights = state.nights.length, swaps = state.changes.length;
  let leader = '–';
  if (games){
    const best = state.decks.map(d => [d, deckStats(d).wins]).sort((a,b) => b[1]-a[1]);
    leader = best[0][1] === 0 ? '–' : (best[1] && best[1][1] === best[0][1] ? 'Tied' : best[0][0].name);
  }
  $('#stats').innerHTML = [
    [nights, 'game nights'], [games, 'games played'], [swaps, 'cards swapped'], [leader, 'most wins'],
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
    h += `<div class="tl-label tl-head" style="min-height:0">Wins</div><div class="tl-chart" id="tl-chart" style="grid-column:2/-1"></div>`;
  }
  for (const d of state.decks){
    h += `<div class="tl-row"><div class="tl-label" style="--c:${d.color}"><i></i>${esc(d.name)}</div>`;
    h += cols.map((c,i) => {
      if (i === 0) return `<div class="tl-cell"><button class="c" data-card="${esc(d.commander0)}" title="${esc(d.commander0)}">${pic(d.commander0,'small','thumb')}</button></div>`;
      const gs = state.games.filter(g => g.date === c && g.decks.includes(d.id));
      const w = gs.filter(g => g.winner === d.id).length;
      const sw = d.swaps.filter(s => s.date === c);
      let inner = '';
      if (w) inner += `<span class="win">★ ${w > 1 ? w + ' wins' : 'Win'}</span>`;
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

function drawChart(cols){
  const host = $('#tl-chart');
  const series = state.decks.map(d => {
    let acc = 0;
    return {d, v:cols.map((c,i) => i === 0 ? 0 : (acc += state.games.filter(g => g.date === c && g.winner === d.id).length))};
  });
  const max = Math.max(1, ...series.flatMap(s => s.v));
  const draw = () => {
    const W = host.clientWidth, H = 170, pt = 16, pb = 14, n = cols.length;
    const x = i => (i + .5) * W / n, y = v => pt + (H - pt - pb) * (1 - v / max);
    const ticks = [...new Set([0, Math.round(max/2), max])];
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Cumulative wins per deck">`;
    s += ticks.map(t => `<line x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="#2a2e37" stroke-width="1"/><text x="4" y="${y(t)-4}" fill="#7c7a73" font-size="10">${t}</text>`).join('');
    // small vertical offset per deck so tied lines stay visible
    series.forEach((sr, k) => {
      const off = (k - (series.length-1)/2) * 2.5;
      const pts = sr.v.map((v,i) => `${x(i)},${y(v)+off}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${sr.d.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      s += sr.v.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)+off}" r="4" fill="${sr.d.color}" stroke="#15171c" stroke-width="2"/>`).join('');
    });
    s += cols.map((c,i) => `<rect class="hit" data-i="${i}" x="${i*W/n}" y="0" width="${W/n}" height="${H}" fill="transparent"/>`).join('');
    s += `<line id="xh" x1="0" x2="0" y1="${pt-6}" y2="${H-pb}" stroke="#7c7a73" stroke-dasharray="3 3" visibility="hidden"/>`;
    host.innerHTML = s + '</svg>';
    const tip = $('#tip'), xh = host.querySelector('#xh');
    host.querySelectorAll('.hit').forEach(r => {
      r.onmousemove = e => {
        const i = +r.dataset.i;
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility','visible');
        const rows = series.map(sr => [sr.d, sr.v[i]]).sort((a,b) => b[1]-a[1]);
        tip.innerHTML = `<b>${i === 0 ? 'Start' : `Night ${i} · ${fmtShort(cols[i])}`}</b>` +
          rows.map(([d,v]) => `<div class="r" style="--c:${d.color}"><span><i></i>${esc(d.name)}</span><span>${v}</span></div>`).join('');
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      };
      r.onmouseleave = () => { tip.hidden = true; xh.setAttribute('visibility','hidden'); };
    });
  };
  draw();
  new ResizeObserver(() => draw()).observe(host);
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
      <h4 style="font:600 .8rem Inter;text-transform:uppercase;letter-spacing:.12em;color:var(--text-2);margin:18px 0 6px">History</h4>
      ${log}
    </div>
    <div>${main}</div></div>`;
  $('#deck-detail').querySelectorAll('[data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card));
}

/* ---------- render: stats ---------- */
function renderStats(){
  const body = $('#stat-body');
  if (!state.games.length){ body.innerHTML = `<p class="hint">Stats appear after the first logged game.</p>`; return; }
  const rows = state.decks.map(d => ({d, ...deckStats(d)}));
  body.innerHTML = `<h3 style="font-size:1rem;margin:0 0 12px">Win rate</h3><div class="bars">` + rows.map(r => {
    const rate = r.played ? r.wins / r.played : 0, exp = r.played ? r.expected / r.played : 0;
    return `<div class="lab" style="--c:${r.d.color}"><i></i>${esc(r.d.name)}</div>
      <div class="track" title="Fair share: ${Math.round(exp*100)}%"><div class="fill" style="--c:${r.d.color};width:${rate*100}%"></div>
        ${r.played ? `<span style="position:absolute;top:-3px;bottom:-3px;left:${exp*100}%;width:2px;background:var(--text-2)"></span>` : ''}</div>
      <div class="val">${r.wins} / ${r.played} · ${Math.round(rate*100)}%</div>`;
  }).join('') + `</div><p class="stat-note">The thin line marks a fair share: how often each deck would win if every game were a coin flip between the decks at the table. With this few games, treat any gap as noise.</p>`;
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
  renderHero(); renderStrip(); renderTimeline(); renderTabs(); renderDetail(); renderStats();
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
