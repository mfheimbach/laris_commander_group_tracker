/* Commander Legacy — shared data layer for the public page (app.js) and the admin page (admin.js).
   Plain JS, no build step. Data lives in /data; card data and images come from Scryfall in the browser. */
window.CL = (() => {
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS = {flight:'--flight', chaos:'--chaos', grave:'--grave', tokens:'--tokens', dragons:'--dragons'};
const FALLBACK = ['#3987e5','#d6463f','#9085e9','#199e70','#c98500'];
const PLAYER_COLORS = ['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
const TYPE_ORDER = ['Commander','Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land','Other'];
const BASICS = new Set(['Plains','Island','Swamp','Mountain','Forest','Wastes']);
const FILES = {games:'data/games.csv', changes:'data/changes.csv', next:'data/next.csv'};
const HEAD = {games:'date;decks;winner;note', changes:'date;deck;out;in;note', next:'deck;kind;card;reason'};

const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
const fmtShort = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short'});
const joinNames = a => a.length < 2 ? (a[0] || '') : a.slice(0,-1).join(', ') + ' & ' + a[a.length-1];
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
const dot = c => `<i class="dot" style="--c:${c}"></i>`;
/* a value that is safe inside one ;-separated field */
const field = s => String(s ?? '').replace(/\s*[;\r\n]+\s*/g, ', ').replace(/^, |, $/g, '').trim();

const state = {site:{}, decks:[], games:[], changes:[], nights:[], players:[], menu:{}, warnings:[]};
let cards = {};           // lower-case name -> slim Scryfall info
let cardsReady = false;

/* ---------- loading ---------- */
async function fetchText(path){
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
const warn = msg => state.warnings.push(msg);
const deckById = id => state.decks.find(d => d.id === id);
const findDeck = key => {
  const k = (key||'').toLowerCase().trim();
  return state.decks.find(d => d.id.toLowerCase() === k || d.name.toLowerCase() === k || (d.pilot && d.pilot.toLowerCase() === k));
};
const nightNo = date => state.nights.indexOf(date) + 1;
const pColor = p => PLAYER_COLORS[state.players.indexOf(p)] || '#7c7a73';

/* read(path) returns the file's text. The admin page passes a reader that asks GitHub directly. */
async function load(read = fetchText){
  state.warnings = [];
  const [site, decks, games, changes, next] = await Promise.all([
    read('data/site.json').then(JSON.parse).catch(() => ({})),
    read('data/decks.json').then(JSON.parse),
    read(FILES.games).then(parseCSV),
    read(FILES.changes).then(parseCSV),
    read(FILES.next).then(parseCSV).catch(() => []),
  ]);
  state.site = site;
  const lists = await Promise.all(decks.map(d => read(`data/decks/${d.id}.txt`)));
  decks.forEach((d,i) => {
    d.list = parseList(lists[i]);
    d.color = getComputedStyle(document.documentElement).getPropertyValue(COLORS[d.id] || '').trim() || FALLBACK[i % FALLBACK.length];
  });
  state.decks = decks;

  // decks column: "flight,chaos" or with players "Mo:flight,Anna:chaos"; winner: deck or player
  state.games = games.filter(g => g.date).map((g,i) => {
    const entries = g.decks ? g.decks.split(',').map(s => s.trim()).filter(Boolean) : decks.map(d => d.id);
    const seats = entries.map(e => {
      const [a, b] = e.includes(':') ? e.split(':').map(s => s.trim()) : [null, e];
      const d = findDeck(b); if (!d) warn(`games.csv row ${i+2}: unknown deck "${b}"`);
      return d ? {player:a || null, deck:d.id} : null;
    }).filter(Boolean);
    let winner = null, winnerPlayer = null;
    if (g.winner){
      const seat = seats.find(s => s.player && s.player.toLowerCase() === g.winner.toLowerCase());
      const d = seat ? null : findDeck(g.winner);
      if (seat){ winner = seat.deck; winnerPlayer = seat.player; }
      else if (d){ winner = d.id; winnerPlayer = (seats.find(s => s.deck === d.id) || {}).player || null; }
      else warn(`games.csv row ${i+2}: unknown winner "${g.winner}"`);
    }
    return {date:g.date, seats, decks:seats.map(s => s.deck), winner, winnerPlayer, note:g.note || ''};
  });
  state.players = [...new Set(state.games.flatMap(g => g.seats.map(s => s.player)).filter(Boolean))];
  state.changes = changes.filter(c => c.date).map((c,i) => {
    const d = findDeck(c.deck); if (!d) warn(`changes.csv row ${i+2}: unknown deck "${c.deck}"`);
    return {date:c.date, deck:d ? d.id : null, out:c.out, in:c.in, note:c.note || '', row:i+2};
  }).filter(c => c.deck);
  state.nights = [...new Set([...state.games.map(g => g.date), ...state.changes.map(c => c.date)])].sort();
  replay();

  // next.csv: the menu for the coming night. kind = cut | add | brief | picks
  state.menu = {};
  for (const d of decks) state.menu[d.id] = {brief:'', picks:3, cut:[], add:[]};
  next.forEach((r,i) => {
    const d = findDeck(r.deck); if (!d){ warn(`next.csv row ${i+2}: unknown deck "${r.deck}"`); return; }
    const m = state.menu[d.id], kind = (r.kind || '').toLowerCase();
    if (kind === 'brief') m.brief = r.reason || r.card || '';
    else if (kind === 'picks') m.picks = +(r.card || r.reason) || 3;
    else if (kind === 'cut' || kind === 'add'){
      if (!r.card) return;
      if (kind === 'cut' && !inDeck(d, r.card)) warn(`next.csv row ${i+2}: "${r.card}" is not in ${d.name} (typo?)`);
      m[kind].push({card:kind === 'cut' ? (inDeck(d, r.card) || r.card) : r.card, reason:r.reason || ''});
    } else warn(`next.csv row ${i+2}: unknown kind "${r.kind}"`);
  });
  return state;
}
const hasMenu = id => { const m = state.menu[id]; return !!m && (m.cut.length || m.add.length || !!m.brief); };
/* exact current name of a card in a deck, or undefined */
const inDeck = (d, name) => [...d.now.keys()].find(k => k.toLowerCase() === String(name).toLowerCase().trim());

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
    d.size = [...m.values()].reduce((t,e) => t + e.qty, 0);
    d.changed = [...m.values()].filter(e => e.added).length;
  }
}
/* commander a deck had on a given night (after that night's commander swaps) */
function cmdAt(d, date){
  let c = d.commander0;
  for (const s of d.swaps) if (s.date <= date && s.isCmd) c = s.in;
  return c;
}
/* current list in MTGO format, commander first */
function exportList(d){
  const rows = [...d.now].filter(([n]) => n !== d.cur).sort((a,b) => (BASICS.has(a[0]) - BASICS.has(b[0])) || a[0].localeCompare(b[0]));
  return [`1 ${d.cur}`, ...rows.map(([n,e]) => `${e.qty} ${n}`)].join('\n');
}

/* ---------- Scryfall ---------- */
const CACHE_KEY = 'sfcache-v2', WEEK = 7*864e5;
function readCache(){ try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } }
function writeCache(c){ try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }
const fuzzyImg = (name, v='normal') => `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=${v}`;

function slim(card){
  const f = card.image_uris ? card : (card.card_faces && card.card_faces[0]) || {};
  const iu = f.image_uris || {};
  return {name:card.name, type:card.type_line || f.type_line || '', cmc:card.cmc ?? 0,
          ci:(card.color_identity || []).join(''), legal:(card.legalities || {}).commander || '', gc:!!card.game_changer,
          small:iu.small, normal:iu.normal, art:iu.art_crop, uri:card.scryfall_uri, t:Date.now()};
}
async function loadCards(extra = []){
  const names = new Set(extra);
  for (const d of state.decks){ d.list.forEach(c => names.add(c.name)); }
  state.changes.forEach(c => { if (c.in) names.add(c.in); if (c.out) names.add(c.out); });
  Object.values(state.menu).forEach(m => [...m.cut, ...m.add].forEach(x => names.add(x.card)));
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
  cardsReady = true;
}
/* Look one card up by (possibly sloppy) name. Returns its info with the canonical name, or null. */
async function lookup(name){
  const k = name.toLowerCase().trim();
  if (cards[k] && cards[k].legal) return cards[k];
  try {
    const r = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(name), {headers:{Accept:'application/json'}});
    if (!r.ok) return null;
    const s = slim(await r.json());
    const front = s.name.split(' // ')[0];
    cards[s.name.toLowerCase()] = cards[front.toLowerCase()] = cards[k] = s;
    const cache = readCache(); cache[s.name.toLowerCase()] = cache[front.toLowerCase()] = s; writeCache(cache);
    return s;
  } catch { return null; }
}
async function autocomplete(q){
  if (q.trim().length < 2) return [];
  try {
    const r = await fetch('https://api.scryfall.com/cards/autocomplete?q=' + encodeURIComponent(q), {headers:{Accept:'application/json'}});
    return r.ok ? ((await r.json()).data || []) : [];
  } catch { return []; }
}
const info = n => cards[(n||'').toLowerCase()] || {};
/* why a card may be a questionable add for a deck: [] = fine */
function flags(d, name){
  const i = info(name), f = [];
  if (!i.name) return ['unknown'];
  if (i.legal && i.legal !== 'legal') f.push('banned');
  if ([...i.ci].some(c => !d.colors.includes(c))) f.push('offcolor');
  if (inDeck(d, name) && !BASICS.has(inDeck(d, name))) f.push('dup');
  if (i.gc) f.push('gc');
  return f;
}
const FLAG_TEXT = {unknown:'not found on Scryfall', banned:'banned in Commander', offcolor:'outside the deck\'s colours', dup:'already in the deck', gc:'Game Changer'};
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
  return {played:gs.length, wins, expected};
}
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

return {$, esc, state, FILES, HEAD, TYPE_ORDER, BASICS, FLAG_TEXT,
  fmtDate, fmtShort, joinNames, plural, dot, field, parseCSV, fetchText,
  load, loadCards, lookup, autocomplete, info, flags, img, pic, typeOf, ready:() => cardsReady,
  deckById, findDeck, inDeck, hasMenu, nightNo, pColor, cmdAt, exportList,
  deckStats, playerStats, crossStats};
})();
