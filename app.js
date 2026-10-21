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
const ui = (() => { try { return Object.assign({who:'decks', metric:'wins'}, JSON.parse(localStorage.getItem('ui-v1'))); } catch { return {who:'decks', metric:'wins'}; } })();
let nightIdx = null;   // which night the recap shows (null = latest)
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
  if (site.title){ $('#site-title').textContent = site.title; $('#nav-brand').textContent = site.title; document.title = site.title; }
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


/* ======================================================================
   RENDER — the page reads as a story:
   headline → latest night → standings → evolution → the decks today
   ====================================================================== */
const pips = colors => `<span class="pips">${[...colors].map(c => `<img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}">`).join('')}</span>`;
const deckById = id => state.decks.find(d => d.id === id);
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
const dot = c => `<i class="dot" style="--c:${c}"></i>`;
const nightNo = date => state.nights.indexOf(date) + 1;

function seg(name, opts, label){
  return `<div class="seg" role="group" aria-label="${label}">${opts.map(([v,l]) =>
    `<button data-ui="${name}" data-v="${v}" aria-pressed="${ui[name] === v}">${l}</button>`).join('')}</div>`;
}
function bindSeg(root, rerender){
  root.querySelectorAll('[data-ui]').forEach(b => b.onclick = () => { ui[b.dataset.ui] = b.dataset.v; saveUi(); rerender(); });
}

/* ---------- hero: one generated sentence instead of a wall of tiles ---------- */
function renderHero(){
  const nights = state.nights.length, games = state.games.length;
  const lastDate = state.games.length ? state.games[state.games.length - 1].date : null;
  let headline = 'Five precons. Every game night, every deck changes a few cards. Watch them grow.';
  if (lastDate){
    const wins = state.games.filter(g => g.date === lastDate && g.winner);
    const who = wins.map(g => `${g.winnerPlayer ? `<b>${esc(g.winnerPlayer)}</b> won with the ` : 'The '}${dot(deckById(g.winner).color)}<b>${esc(deckById(g.winner).name)}</b>${g.winnerPlayer ? '' : ' won'}`);
    const top = leaders(state.decks.map(d => ({label:d.name, ...deckStats(d)})));
    const topP = leaders(state.players.map(p => ({label:p, ...playerStats(p)})));
    headline = `${who.length ? who.join(', ') : 'No winner yet'} on night ${nightNo(lastDate)}. ` +
      (top ? `${esc(top.names)} ${top.count > 1 ? 'share the deck lead' : 'leads the decks'}` : '') +
      (topP ? `; ${esc(topP.names)} ${topP.count > 1 ? 'share the player lead' : 'leads the players'}.` : '.');
  }
  $('#headline').innerHTML = headline;
  $('#facts').innerHTML = [plural(nights, 'night'), plural(games, 'game'), plural(state.changes.length, 'card swap'), plural(state.players.length, 'player')]
    .map(x => `<span>${x}</span>`).join('');
}
function leaders(rows){
  const top = Math.max(0, ...rows.map(r => r.wins));
  if (!top) return null;
  const names = rows.filter(r => r.wins === top).map(r => r.label);
  return {names:joinNames(names), count:names.length, wins:top};
}

/* ---------- chapter 1: one night at a time ---------- */
function renderNight(){
  const host = $('#night'), nav = $('#night-nav');
  if (!state.nights.length){ host.innerHTML = `<div class="card empty">No game nights logged yet.</div>`; nav.innerHTML = ''; return; }
  const i = nightIdx ?? state.nights.length - 1, date = state.nights[i];
  nav.innerHTML = `<button class="icon-btn" data-step="-1" ${i === 0 ? 'disabled' : ''} aria-label="Previous night">‹</button>
    <span class="night-label"><b>Night ${i+1}</b> · ${fmtDate(date)}</span>
    <button class="icon-btn" data-step="1" ${i === state.nights.length-1 ? 'disabled' : ''} aria-label="Next night">›</button>`;
  nav.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { nightIdx = Math.max(0, Math.min(state.nights.length-1, i + +b.dataset.step)); renderNight(); });

  const games = state.games.filter(g => g.date === date);
  const played = new Set(games.flatMap(g => g.decks));
  const satOut = state.decks.filter(d => !played.has(d.id));

  const table = games.length ? games.map((g, gi) => `
      ${games.length > 1 ? `<p class="mini-h">Game ${gi+1}</p>` : ''}
      <ul class="seats">${[...g.seats].sort((a,b) => (b.deck === g.winner) - (a.deck === g.winner)).map(st => {
        const d = deckById(st.deck), won = g.winner === st.deck;
        return `<li class="${won ? 'won' : ''}" style="--c:${d.color}">
          <button class="seat-cmd c" data-card="${esc(cmdAt(d, date))}">${pic(cmdAt(d, date), 'art', 'seat-art')}</button>
          <span class="seat-who"><b>${esc(st.player || '—')}</b><span>${dot(d.color)}${esc(d.name)}</span></span>
          ${won ? '<span class="crown" title="Winner">★ Winner</span>' : ''}</li>`;
      }).join('')}</ul>${g.note ? `<p class="quote">“${esc(g.note)}”</p>` : ''}`).join('')
    : `<p class="hint">No game this night, only deck changes.</p>`;

  const swapsBy = state.decks.map(d => ({d, sw: d.swaps.filter(s => s.date === date)})).filter(x => x.sw.length)
    .sort((a,b) => (played.has(b.d.id) - played.has(a.d.id)));
  const changes = swapsBy.length ? swapsBy.map(({d, sw}) => {
    const quote = sw.map(s => s.note).find(Boolean);
    return `<div class="night-deck" style="--c:${d.color}">
      <div class="nd-head">${dot(d.color)}<b>${esc(d.name)}</b><span>${plural(sw.length, 'swap')}</span></div>
      <div class="nd-cards">${sw.map(s => `<button class="swap-in${s.isCmd ? ' cmd' : ''}" data-swap="${state.changes.indexOf(s)}" title="${esc(s.out)} → ${esc(s.in)}">${pic(s.in, 'small')}${s.isCmd ? '<span class="tag">Commander</span>' : ''}</button>`).join('')}</div>
      ${quote ? `<p class="quote">“${esc(quote)}”</p>` : ''}</div>`;
  }).join('') : `<p class="hint">No swaps this night.</p>`;

  host.innerHTML = `<div class="night-grid">
    <div class="card pad"><h3 class="card-h">At the table</h3>${table}
      ${satOut.length && games.length ? `<p class="sat-out">Sat out: ${satOut.map(d => `${dot(d.color)}${esc(d.name)}`).join(' ')}</p>` : ''}</div>
    <div class="card pad"><h3 class="card-h">What changed</h3><div class="night-decks">${changes}</div></div>
  </div>`;
  host.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => showSwap(state.changes[+b.dataset.swap]));
  host.querySelectorAll('[data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card));
}
/* commander a deck had going into a given night (after that night's commander swaps) */
function cmdAt(d, date){
  let c = d.commander0;
  for (const s of d.swaps) if (s.date <= date && s.isCmd) c = s.in;
  return c;
}

/* ---------- chapter 2: ranking + race chart, one Decks/Players toggle ---------- */
function bars(rows){
  return `<ol class="ranking">` + rows.map(r => {
    const rate = r.played ? r.wins / r.played : 0, exp = r.played ? r.expected / r.played : 0;
    return `<li style="--c:${r.color}">
      <span class="rk">${r.rank}</span>
      <div class="rk-body">
        <div class="rk-top">${dot(r.color)}<b>${esc(r.label)}</b><span class="rk-rec"><b>${r.wins}</b> / ${plural(r.played,'game')}</span></div>
        <div class="track" title="Win rate ${Math.round(rate*100)}% · fair share ${Math.round(exp*100)}%"><div class="fill" style="width:${rate*100}%"></div>${r.played ? `<span class="fair" style="left:${exp*100}%"></span>` : ''}</div>
        ${r.sub ? `<small>${r.sub}</small>` : ''}
      </div></li>`;
  }).join('') + `</ol>`;
}
function ranked(rows){
  const rate = r => r.played ? r.wins / r.played : 0;
  rows.sort((a,b) => b.wins - a.wins || rate(b) - rate(a) || a.label.localeCompare(b.label));
  rows.forEach((r,i) => r.rank = i && r.wins === rows[i-1].wins && rate(r) === rate(rows[i-1]) ? rows[i-1].rank : i + 1);
  return rows;
}
const subLine = (x, kind) => [
  x.most && `${kind === 'deck' ? 'Played most by' : 'Plays most'} ${esc(joinNames(x.most.names))}`,
  x.best && `${kind === 'deck' ? 'wins with' : 'wins with'} ${esc(joinNames(x.best.names))}`,
].filter(Boolean).join(' · ');

function renderStandings(){
  const host = $('#standings-body'), tog = $('#who-toggle');
  if (!state.games.length){ host.innerHTML = `<p class="empty">Standings appear after the first logged game.</p>`; tog.innerHTML = ''; return; }
  if (!state.players.length) ui.who = 'decks';
  tog.innerHTML = state.players.length ? seg('who', [['decks','Decks'],['players','Players']], 'Show decks or players') : '';
  bindSeg(tog, renderStandings);

  const cx = crossStats();
  const rows = ui.who === 'players'
    ? ranked(state.players.map(p => ({key:p, label:p, color:pColor(p), ...playerStats(p), sub:subLine(cx.forPlayer(p), 'player')})))
    : ranked(state.decks.map(d => ({key:d.id, label:d.name, color:d.color, ...deckStats(d), sub:subLine(cx.forDeck(d.id), 'deck')})));

  host.innerHTML = `<div class="st-grid">
      <div><h3 class="card-h">Ranking</h3>${bars(rows)}
        <p class="note">Bar = win rate. Tick = fair share, the rate you'd expect if every game were a coin flip among the four seats.</p></div>
      <div><div class="chart-head"><h3 class="card-h">The race</h3>${seg('metric', [['wins','Wins'],['power','Power']], 'Chart metric')}</div>
        <div id="chart"></div>
        <p class="note">${ui.metric === 'power'
          ? '<b>Power</b> = wins minus a fair share (¼ per game at a four-player table). Above zero means winning more than your share; sitting out a night costs nothing.'
          : 'Total wins after each night. Switch to <b>Power</b> to account for who sat out.'}</p></div>
    </div>
    ${state.players.length ? `<details class="mx-wrap"><summary>Who played what</summary>${matrix(cx)}</details>` : ''}`;
  bindSeg(host, renderStandings);
  drawChart();
}
function matrix(cx){
  return `<div class="mx-scroll"><table class="mx"><thead><tr><th></th>${state.decks.map(d =>
    `<th>${dot(d.color)}${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${state.players.map(p =>
    `<tr><th>${dot(pColor(p))}${esc(p)}</th>${state.decks.map(d => {
      const c = cx.cells[p+'|'+d.id];
      return c ? `<td class="has${c.wins ? ' won' : ''}" title="${esc(p)} on ${esc(d.name)}: ${c.wins} of ${plural(c.games,'game')}">${c.wins ? '★ ' : ''}${c.wins}/${c.games}</td>` : '<td>·</td>';
    }).join('')}</tr>`).join('')}</tbody></table></div><p class="note">Wins / games for each player on each deck.</p>`;
}

/* cumulative series per entity: wins, or power = wins minus fair share (1/seats per game played) */
function chartSeries(cols){
  const ents = ui.who === 'players'
    ? state.players.map(p => ({label:p, color:pColor(p), seat:g => g.seats.some(s => s.player === p), won:g => g.winnerPlayer === p}))
    : state.decks.map(d => ({label:d.name, color:d.color, seat:g => g.decks.includes(d.id), won:g => g.winner === d.id}));
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
function drawChart(){
  const host = $('#chart'); if (!host) return;
  const cols = ['start', ...state.nights.filter(n => state.games.some(g => g.date === n))];
  const series = chartSeries(cols);
  const all = series.flatMap(s => s.v);
  const power = ui.metric === 'power';
  const max = Math.max(power ? .5 : 1, ...all), min = Math.min(0, ...all);
  const fmt = v => power ? (v > 0 ? '+' : '') + (Math.round(v*100)/100) : String(v);
  const draw = () => {
    const W = Math.max(260, host.clientWidth), H = 220, pl = 34, pr = 16, pt = 12, pb = 26, n = cols.length;
    const x = i => pl + (n === 1 ? 0 : i * (W - pl - pr) / (n - 1)), y = v => pt + (H - pt - pb) * (max - v) / (max - min || 1);
    const ticks = power ? [...new Set([min, 0, max].map(t => Math.round(t*4)/4))] : [...new Set([0, Math.ceil(max/2), max])];
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="${power ? 'Power' : 'Cumulative wins'} per ${ui.who === 'players' ? 'player' : 'deck'} by night">`;
    s += ticks.map(t => `<line x1="${pl}" x2="${W-pr}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'axis0' : 'grid'}"/><text x="${pl-6}" y="${y(t)+3}" text-anchor="end" class="tick">${fmt(t)}</text>`).join('');
    s += cols.map((c,i) => `<text x="${x(i)}" y="${H-6}" text-anchor="middle" class="tick">${i ? 'N' + nightNo(c) : 'Start'}</text>`).join('');
    series.forEach((sr, k) => {
      const off = (k - (series.length-1)/2) * 1.6;   // nudge so tied lines stay visible
      s += `<polyline points="${sr.v.map((v,i) => `${x(i)},${y(v)+off}`).join(' ')}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      s += sr.v.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)+off}" r="4" fill="${sr.color}" stroke="var(--surface)" stroke-width="2"/>`).join('');
    });
    const hw = n > 1 ? (W - pl - pr) / (n - 1) : W;
    s += cols.map((c,i) => `<rect class="hit" data-i="${i}" x="${x(i) - hw/2}" y="0" width="${hw}" height="${H}" fill="transparent"/>`).join('');
    s += `<line id="xh" y1="${pt}" y2="${H-pb}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
    host.innerHTML = s + '</svg>' + `<div class="legend">${series.map(sr => `<span>${dot(sr.color)}${esc(sr.label)}</span>`).join('')}</div>`;
    const tip = $('#tip'), xh = host.querySelector('#xh');
    host.querySelectorAll('.hit').forEach(r => {
      r.onmousemove = e => {
        const i = +r.dataset.i;
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility','visible');
        tip.innerHTML = `<b>${i === 0 ? 'Start' : `Night ${nightNo(cols[i])} · ${fmtShort(cols[i])}`}</b>` +
          series.map(sr => [sr, sr.v[i]]).sort((a,b) => b[1]-a[1]).map(([sr,v]) => `<div class="r"><span>${dot(sr.color)}${esc(sr.label)}</span><span>${fmt(v)}</span></div>`).join('');
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      };
      r.onmouseleave = () => { tip.hidden = true; xh.setAttribute('visibility','hidden'); };
    });
  };
  draw();
  if (host._ro) host._ro.disconnect();
  host._ro = new ResizeObserver(draw); host._ro.observe(host);
}

/* ---------- chapter 3: swaps only, one row per deck ---------- */
function renderTimeline(){
  const cols = ['start', ...state.nights];
  const el = $('#timeline');
  el.style.gridTemplateColumns = `${innerWidth < 600 ? 96 : 140}px repeat(${cols.length}, minmax(${innerWidth < 600 ? 150 : 170}px, 1fr))`;
  let h = `<div class="tl-corner"></div>` + cols.map((c,i) => {
    if (i === 0) return `<div class="tl-colhead"><b>Start</b><span>Out of the box</span></div>`;
    return `<div class="tl-colhead"><b>Night ${i}</b><span>${fmtShort(c)}</span></div>`;
  }).join('');
  for (const d of state.decks){
    h += `<div class="tl-label" style="--c:${d.color}">${dot(d.color)}<span>${esc(d.name)}</span></div>`;
    h += cols.map((c,i) => {
      if (i === 0) return `<div class="tl-cell"><button class="c tl-start" data-card="${esc(d.commander0)}" title="${esc(d.commander0)}">${pic(d.commander0,'small','thumb')}</button></div>`;
      const won = state.games.some(g => g.date === c && g.winner === d.id);
      const sw = d.swaps.filter(s => s.date === c);
      return `<div class="tl-cell${won ? ' tl-won' : ''}">${won ? '<span class="tl-star" title="Won this night">★</span>' : ''}${sw.map(s =>
        `<button class="swap${s.isCmd ? ' cmdswap' : ''}" data-swap="${state.changes.indexOf(s)}" title="${esc(s.out || '—')} → ${esc(s.in || '—')}">
          ${s.out ? pic(s.out,'small','out') : ''}${s.in ? pic(s.in,'small','in') : ''}</button>`).join('')}</div>`;
    }).join('');
  }
  el.innerHTML = h;
  const sc = el.parentElement; if (!sc._scrolled){ sc.scrollLeft = sc.scrollWidth; sc._scrolled = true; }  // open on the latest night
  el.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => showSwap(state.changes[+b.dataset.swap]));
  el.querySelectorAll('[data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card));
}

/* ---------- chapter 4: deck cards are the tabs ---------- */
function renderStrip(){
  $('#deck-strip').innerHTML = state.decks.map(d => {
    const s = deckStats(d);
    return `<button class="deck-card" role="tab" aria-selected="${d.id === activeDeck}" data-deck="${d.id}" style="--c:${d.color}">
      <div class="art" style="${img(d.cur,'art') ? `background-image:url('${esc(img(d.cur,'art'))}')` : ''}">${pips(d.colors)}</div>
      <div class="body"><h3>${esc(d.name)}</h3><p class="cmd">${esc(d.cur)}</p>
        <p class="meta">${plural(s.wins,'win')} · ${plural(s.swaps,'swap')}</p></div></button>`;
  }).join('');
  document.querySelectorAll('.deck-card').forEach(b => b.onclick = () => { activeDeck = b.dataset.deck; renderStrip(); renderDetail(); });
}

function renderDetail(){
  const d = deckById(activeDeck), s = deckStats(d), cx = crossStats().forDeck(d.id);
  const groups = {};
  for (const [name, e] of d.now){
    const g = name === d.cur ? 'Commander' : typeOf(name);
    (groups[g] = groups[g] || []).push({name, ...e});
  }
  const cardBtn = c => `<button class="c${c.added ? ' is-new' : ''}" data-card="${esc(c.name)}" title="${esc(c.name)}">
      ${pic(c.name,'small')}${c.qty > 1 ? `<span class="qty">×${c.qty}</span>` : ''}${c.added ? `<span class="new">new</span>` : ''}</button>`;
  let main = '';
  for (const g of TYPE_ORDER){
    if (!groups[g] || g === 'Commander') continue;
    const list = groups[g].sort((a,b) => (BASICS.has(a.name) - BASICS.has(b.name)) || (info(a.name).cmc||0) - (info(b.name).cmc||0) || a.name.localeCompare(b.name));
    const label = {Sorcery:'Sorceries', Other: cardsReady ? 'Other' : 'Cards'}[g] || g + 's';
    main += `<div class="group"><h4>${label} <span>${list.reduce((t,c) => t + c.qty, 0)}</span></h4><div class="grid">${list.map(cardBtn).join('')}</div></div>`;
  }
  if (d.removed.length) main += `<details class="group gy"><summary><h4>Swapped out <span>${d.removed.length}</span></h4></summary><div class="grid">${d.removed.map(r => cardBtn({name:r.name, qty:1})).join('')}</div></details>`;

  const log = d.swaps.length
    ? `<ul class="log">${[...d.swaps].reverse().map(c => `<li><span class="d">Night ${nightNo(c.date)} · ${fmtShort(c.date)}${c.isCmd ? ' · <b class="gold">new commander</b>' : ''}</span>
        ${c.out ? `<span class="o">${esc(c.out)}</span> → ` : ''}<b>${esc(c.in)}</b>${c.note ? `<span class="n">“${esc(c.note)}”</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="hint">No swaps yet. Straight out of the box.</p>`;
  $('#deck-detail').innerHTML = `<div class="detail card pad" style="--c:${d.color}">
    <aside class="side">
      <button class="c" data-card="${esc(d.cur)}">${pic(d.cur,'normal','cmdimg',false)}</button>
      <h3>${esc(d.name)} ${pips(d.colors)}</h3>
      <dl class="kv">
        <dt>Record</dt><dd>${s.wins} / ${plural(s.played,'game')}</dd>
        ${cx.most ? `<dt>Played most by</dt><dd>${esc(joinNames(cx.most.names))}</dd>` : ''}
        ${cx.best ? `<dt>Wins with</dt><dd>${esc(joinNames(cx.best.names))}</dd>` : ''}
      </dl>
      ${d.moxfield ? `<a class="mox" href="${esc(d.moxfield)}" target="_blank" rel="noopener">Open in Moxfield ↗</a>` : ''}
      <details class="hist" open><summary>History <span>${d.swaps.length}</span></summary>${log}</details>
    </aside>
    <div>${main}</div></div>`;
  $('#deck-detail').querySelectorAll('[data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card));
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
  const d = deckById(c.deck);
  openModal(`<div class="mcards">
    ${c.out ? `<figure><img src="${esc(img(c.out))}" alt="${esc(c.out)}"><figcaption>Out</figcaption></figure><span class="arrow">→</span>` : ''}
    ${c.in ? `<figure><img src="${esc(img(c.in))}" alt="${esc(c.in)}"><figcaption>In${c.isCmd ? ' · new commander' : ''}</figcaption></figure>` : ''}
    </div><p class="mnote">${esc(d.name)} · Night ${nightNo(c.date)}${c.note ? ` · “${esc(c.note)}”` : ''}</p>`);
}
$('#modal').onclick = e => { if (e.target.id === 'modal' || e.target.id === 'modal-close') closeModal(); };
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- boot ---------- */
function renderAll(){
  renderHero(); renderNight(); renderStandings(); renderTimeline(); renderStrip(); renderDetail();
  const w = $('#warnings');
  if (state.warnings.length){ w.hidden = false; w.innerHTML = '<b>Data check:</b><br>' + [...new Set(state.warnings)].map(esc).join('<br>'); }
}
load().then(() => {
  activeDeck = state.decks[0].id;
  renderAll();                         // fast first paint
  return loadCards().finally(() => { cardsReady = true; renderAll(); });  // then real images + card types
}).catch(e => {
  document.querySelector('main').innerHTML = `<p class="warn">Could not load data: ${esc(e.message)}</p>`;
});
})();
