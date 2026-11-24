/* Commander Legacy — public page. Reads top to bottom:
   headline → up next (when a menu exists) → game nights → standings → the decks today.
   Data and card helpers come from core.js. */
(() => {
'use strict';
const {$, esc, state, TYPE_ORDER, BASICS, FLAG_TEXT, fmtDate, fmtShort, joinNames, plural, dot,
       load, loadCards, info, img, pic, typeOf, ready, deckById, hasMenu, nightNo, pColor, cmdAt,
       deckStats, playerStats, crossStats, tagsOf, isLand, roleDefs, health} = CL;

const DEFAULT_UI = {who:'decks', metric:'wins', cards:'all', view:'type'};
const ui = (() => { try { return Object.assign({}, DEFAULT_UI, JSON.parse(localStorage.getItem('ui-v1'))); } catch { return {...DEFAULT_UI}; } })();
const saveUi = () => { try { localStorage.setItem('ui-v1', JSON.stringify(ui)); } catch {} };
let activeDeck = null, menuDeck = null;
let nightIdx = null;   // which night the recap shows (null = latest)

const pips = colors => `<span class="pips">${[...colors].map(c => `<img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}">`).join('')}</span>`;
function seg(name, opts, label){
  return `<div class="seg" role="group" aria-label="${label}">${opts.map(([v,l]) =>
    `<button data-ui="${name}" data-v="${v}" aria-pressed="${ui[name] === v}">${l}</button>`).join('')}</div>`;
}
function bindSeg(root, rerender){
  root.querySelectorAll('[data-ui]').forEach(b => b.onclick = () => { ui[b.dataset.ui] = b.dataset.v; saveUi(); rerender(); });
}
function bindCards(root){
  root.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => showSwap(state.changes[+b.dataset.swap]));
  root.querySelectorAll('[data-card]').forEach(b => b.onclick = () => showCard(b.dataset.card, b.dataset.why));
}

/* ---------- hero: one generated sentence ---------- */
function leaders(rows){
  const top = Math.max(0, ...rows.map(r => r.wins));
  if (!top) return null;
  const names = rows.filter(r => r.wins === top).map(r => r.label);
  return {names:joinNames(names), count:names.length};
}
function renderHero(){
  const lastDate = state.games.length ? state.games[state.games.length - 1].date : null;
  let headline = 'Five precons. Every game night, every deck changes a few cards. Watch them grow.';
  if (lastDate){
    const wins = state.games.filter(g => g.date === lastDate && g.winner);
    const who = wins.map(g => `${g.winnerPlayer ? `<b>${esc(g.winnerPlayer)}</b> won with the ` : 'The '}${dot(deckById(g.winner).color)}<b>${esc(deckById(g.winner).name)}</b>${g.winnerPlayer ? '' : ' won'}`);
    const top = leaders(state.decks.map(d => ({label:d.name, ...deckStats(d)})));
    const topP = leaders(state.players.map(p => ({label:p, ...playerStats(p)})));
    headline = `${who.length ? who.join(', ') : 'No winner yet'} on night ${nightNo(lastDate)}. ` +
      (top ? `${esc(top.names)} ${top.count > 1 ? 'share the deck lead' : 'lead the decks'}` : '') +
      (topP ? `; ${esc(topP.names)} ${topP.count > 1 ? 'share the player lead' : 'leads the players'}.` : '.');
  }
  $('#headline').innerHTML = headline;
  $('#facts').innerHTML = [plural(state.nights.length, 'night'), plural(state.games.length, 'game'),
    plural(state.changes.length, 'card swap'), plural(state.players.length, 'player')].map(x => `<span>${x}</span>`).join('');
}

/* ---------- up next: the menu for the coming night ---------- */
function renderUpNext(){
  const decks = state.decks.filter(d => hasMenu(d.id));
  $('#upnext').hidden = $('#nav-upnext').hidden = !decks.length;
  if (!decks.length) return;
  if (!decks.some(d => d.id === menuDeck)) menuDeck = decks[0].id;
  const d = deckById(menuDeck), m = state.menu[d.id];
  const row = (x, kind) => {
    const gc = kind === 'add' && info(x.card).gc;
    return `<li><button class="opt" data-card="${esc(x.card)}" data-why="${esc(x.reason)}">${pic(x.card, 'small', 'opt-img')}
      <span class="opt-txt"><b>${esc(x.card)}</b>${gc ? ` <span class="gc" title="${FLAG_TEXT.gc}">🔥 Game Changer</span>` : ''}${x.reason ? `<small>${esc(x.reason)}</small>` : ''}</span></button></li>`;
  };
  $('#upnext-body').innerHTML = `
    <div class="chips" role="tablist">${decks.map(x => `<button class="chip${x.id === d.id ? ' on' : ''}" role="tab" aria-selected="${x.id === d.id}" data-menu="${x.id}" style="--c:${x.color}">${dot(x.color)}${esc(x.name)}</button>`).join('')}</div>
    <div class="card pad menu" style="--c:${d.color}">
      <div class="menu-head"><p class="brief">${m.brief ? `“${esc(m.brief)}”` : `Options for the ${esc(d.name)}`}</p>
        <span class="pill">Swap ${m.picks} ${m.picks === 1 ? 'card' : 'cards'}</span></div>
      <div class="menu-cols">
        <div><h3 class="card-h">Could go · ${m.cut.length}</h3><ul class="opts">${m.cut.map(x => row(x, 'cut')).join('') || '<li class="hint">Open choice.</li>'}</ul></div>
        <div><h3 class="card-h">Could come in · ${m.add.length}</h3><ul class="opts">${m.add.map(x => row(x, 'add')).join('') || '<li class="hint">Open choice.</li>'}</ul></div>
      </div>
    </div>`;
  $('#upnext-body').querySelectorAll('[data-menu]').forEach(b => b.onclick = () => { menuDeck = b.dataset.menu; renderUpNext(); });
  bindCards($('#upnext-body'));
}

/* ---------- game nights: a compact campaign map picks the night, the recap shows it ---------- */
function renderCampaign(){
  const host = $('#campaign');
  if (!state.nights.length){ host.innerHTML = ''; return; }
  const sel = nightIdx ?? state.nights.length - 1;
  const cell = (d, date, i) => {
    const gs = state.games.filter(g => g.date === date && g.decks.includes(d.id));
    const won = gs.some(g => g.winner === d.id), sw = d.swaps.filter(s => s.date === date);
    const what = won ? 'won' : gs.length ? 'played' : 'sat out';
    return `<button class="cc ${won ? 'won' : gs.length ? 'played' : 'out'}${i === sel ? ' sel' : ''}" data-n="${i}" style="--c:${d.color}"
      title="${esc(d.name)}, night ${i+1}: ${what}${sw.length ? `, ${plural(sw.length, 'swap')}` : ''}"><span class="mk">${won ? '★' : gs.length ? '●' : '○'}</span>${sw.length ? `<small class="${sw.some(s => s.isCmd) ? 'cmd' : ''}">${sw.length}</small>` : ''}</button>`;
  };
  host.innerHTML = `<div class="camp">
      <div class="camp-labels"><div class="camp-corner"></div>${state.decks.map(d => `<div class="camp-label">${dot(d.color)}${esc(d.name)}</div>`).join('')}</div>
      <div class="camp-scroll"><div class="camp-grid" style="grid-template-columns:repeat(${state.nights.length}, 44px)">
        ${state.nights.map((n, i) => `<button class="ch${i === sel ? ' sel' : ''}" data-n="${i}" title="Night ${i+1} · ${fmtDate(n)}"><b>${i+1}</b><span>${fmtShort(n)}</span></button>`).join('')}
        ${state.decks.map(d => state.nights.map((n, i) => cell(d, n, i)).join('')).join('')}
      </div></div>
    </div>
    <p class="legend camp-legend"><span><b class="gold">★</b> won</span><span>● played</span><span>○ sat out</span><span>small number = cards swapped</span></p>`;
  const sc = host.querySelector('.camp-scroll');
  const selEl = host.querySelector('.ch.sel');
  if (selEl) sc.scrollLeft = Math.max(0, selEl.offsetLeft - sc.clientWidth + 88);
  host.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { nightIdx = +b.dataset.n; renderCampaign(); renderNight(); });
}
function renderNight(){
  const host = $('#night');
  if (!state.nights.length){ host.innerHTML = `<div class="card empty">No game nights logged yet.</div>`; return; }
  const i = nightIdx ?? state.nights.length - 1, date = state.nights[i], last = state.nights.length - 1;
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

  host.innerHTML = `<div class="night-bar">
      <button class="icon-btn" data-step="-1" ${i === 0 ? 'disabled' : ''} aria-label="Previous night">‹</button>
      <h3 class="night-title">Night ${i+1}<span>${fmtDate(date)}${i === last ? ' · latest' : ''}</span></h3>
      <button class="icon-btn" data-step="1" ${i === last ? 'disabled' : ''} aria-label="Next night">›</button>
    </div>
    <div class="night-grid">
      <div class="card pad"><h3 class="card-h">At the table</h3>${table}
        ${satOut.length && games.length ? `<p class="sat-out">Sat out: ${satOut.map(d => `${dot(d.color)}${esc(d.name)}`).join(' ')}</p>` : ''}</div>
      <div class="card pad"><h3 class="card-h">New cards <span class="soft">· tap one to see what it replaced</span></h3><div class="night-decks">${changes}</div></div>
    </div>`;
  host.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { nightIdx = Math.max(0, Math.min(last, i + +b.dataset.step)); renderCampaign(); renderNight(); });
  bindCards(host);
}

/* ---------- standings: ranking + race chart, one Decks/Players toggle ---------- */
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
  x.best && `wins with ${esc(joinNames(x.best.names))}`,
].filter(Boolean).join(' · ');

function renderStandings(){
  const host = $('#standings-body'), tog = $('#who-toggle');
  if (!state.games.length){ host.innerHTML = `<p class="empty">Standings appear after the first logged game.</p>`; tog.innerHTML = ''; return; }
  if (!state.players.length) ui.who = 'decks';
  tog.innerHTML = state.players.length ? seg('who', [['decks','Decks'],['players','Players']], 'Show decks or players') : '';
  bindSeg(tog, renderStandings);

  const cx = crossStats();
  const rows = ui.who === 'players'
    ? ranked(state.players.map(p => ({label:p, color:pColor(p), ...playerStats(p), sub:subLine(cx.forPlayer(p), 'player')})))
    : ranked(state.decks.map(d => ({label:d.name, color:d.color, ...deckStats(d), sub:subLine(cx.forDeck(d.id), 'deck')})));

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
    const every = Math.ceil(n / Math.max(4, Math.floor((W - pl - pr) / 44)));     // thin out x labels when crowded
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="${power ? 'Power' : 'Cumulative wins'} per ${ui.who === 'players' ? 'player' : 'deck'} by night">`;
    s += ticks.map(t => `<line x1="${pl}" x2="${W-pr}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'axis0' : 'grid'}"/><text x="${pl-6}" y="${y(t)+3}" text-anchor="end" class="tick">${fmt(t)}</text>`).join('');
    const show = i => i === n-1 || (i % every === 0 && n-1-i >= every/2);
    s += cols.map((c,i) => show(i) ? `<text x="${x(i)}" y="${H-6}" text-anchor="middle" class="tick">${i ? 'N' + nightNo(c) : 'Start'}</text>` : '').join('');
    series.forEach((sr, k) => {
      const off = (k - (series.length-1)/2) * 1.6;   // nudge so tied lines stay visible
      s += `<polyline points="${sr.v.map((v,i) => `${x(i)},${y(v)+off}`).join(' ')}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 16) s += sr.v.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)+off}" r="3.5" fill="${sr.color}" stroke="var(--surface)" stroke-width="2"/>`).join('');
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

/* ---------- the decks today: deck cards are the tabs ---------- */
const deckSlug = d => d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function deckFromHash(){
  const h = decodeURIComponent(location.hash.slice(1)).toLowerCase();
  return state.decks.find(d => d.id === h || deckSlug(d) === h);
}
function selectDeck(id, scroll){
  activeDeck = id; renderStrip(); renderDetail();
  try { history.replaceState(null, '', '#' + deckSlug(deckById(id))); } catch {}
  if (scroll) $('#decks').scrollIntoView({behavior:'smooth'});
}
function renderStrip(){
  $('#deck-strip').innerHTML = state.decks.map(d => {
    const s = deckStats(d);
    return `<button class="deck-card" role="tab" aria-selected="${d.id === activeDeck}" data-deck="${d.id}" style="--c:${d.color}">
      <div class="art" style="${img(d.cur,'art') ? `background-image:url('${esc(img(d.cur,'art'))}')` : ''}">${pips(d.colors)}</div>
      <div class="body"><h3>${esc(d.name)}</h3><p class="cmd">${esc(d.cur)}</p>
        <p class="meta">${plural(s.wins,'win')} · ${d.changed} of ${d.size} cards new</p></div></button>`;
  }).join('');
  document.querySelectorAll('.deck-card').forEach(b => b.onclick = () => selectDeck(b.dataset.deck));
}

/* ---------- deck health: curve, roles against typical counts, colour balance ---------- */
const MANA = {W:{name:'White', c:'#e9e2c8'}, U:{name:'Blue', c:'#4a90d9'}, B:{name:'Black', c:'#a69aa8'}, R:{name:'Red', c:'#d6513f'}, G:{name:'Green', c:'#3fa36b'}};
function status(n, typical){
  if (!typical) return {cls:'', icon:'', text:''};
  const [lo, hi] = typical;
  if (n < lo) return {cls:'low', icon:'↓', text:'low'};
  if (hi != null && n > hi) return {cls:'high', icon:'↑', text:'high'};
  return {cls:'ok', icon:'✓', text:'ok'};
}
const rangeText = t => !t ? '' : t[1] == null ? `${t[0]}+` : `${t[0]}–${t[1]}`;
function healthPanel(d){
  const h = health(d);
  if (!ready()) return `<div class="card pad health"><p class="hint">Loading card data…</p></div>`;
  // mana curve
  const max = Math.max(1, ...h.curve), W = 260, H = 120, bw = W / 8;
  const curve = `<svg viewBox="0 0 ${W} ${H + 18}" class="curve" role="img" aria-label="Mana curve">
    ${h.curve.map((n, i) => {
      const bh = n ? Math.max(3, (H - 16) * n / max) : 0, x = i * bw + 4, y = H - bh;
      return `<g class="cv" data-i="${i}"><rect x="${i * bw}" y="0" width="${bw}" height="${H + 18}" fill="transparent"/>
        ${n ? `<rect x="${x}" y="${y}" width="${bw - 8}" height="${bh}" rx="3" class="bar"/><text x="${x + (bw - 8) / 2}" y="${y - 4}" text-anchor="middle" class="val">${n}</text>` : ''}
        <text x="${x + (bw - 8) / 2}" y="${H + 14}" text-anchor="middle" class="tick">${i === 7 ? '7+' : i}</text></g>`;
    }).join('')}</svg>`;
  // roles
  const lands = status(h.lands, state.rules.lands);
  const roleRow = (r) => { const st = status(r.count, r.typical);
    return `<li><button class="role ${st.cls}" data-role="${esc(r.tag)}" title="${esc(r.explain || '')}">
      <span class="r-name">${r.theme ? '<b>' + esc(r.label) + '</b>' : esc(r.label)}</span>
      <span class="r-n">${r.count}</span>
      <span class="r-typ" title="typical">${r.typical ? rangeText(r.typical) : ''}</span>
      <span class="r-st">${st.icon ? `${st.icon} ${st.text}` : ''}</span></button></li>`; };
  const roles = `<ul class="roles">
      ${h.roles[0] && h.roles[0].theme ? roleRow(h.roles[0]) : ''}
      <li><button class="role ${lands.cls}" data-role="__lands" title="Lands in the deck"><span class="r-name">Lands</span><span class="r-n">${h.lands}</span>
        <span class="r-typ" title="typical">${rangeText(state.rules.lands)}</span><span class="r-st">${lands.icon} ${lands.text}</span></button></li>
      ${h.roles.filter(r => !r.theme && (r.typical || r.count)).map(roleRow).join('')}
    </ul>`;
  // colours: share of coloured pips vs share of land sources
  const cols = [...d.colors];
  const pipT = cols.reduce((t, c) => t + h.pips[c], 0) || 1, srcT = cols.reduce((t, c) => t + h.sources[c], 0) || 1;
  const colours = cols.map(c => {
    const p = h.pips[c] / pipT, s = h.sources[c] / srcT;
    return `<div class="col-row" style="--m:${MANA[c].c}" title="${MANA[c].name}: ${h.pips[c]} symbols in costs, ${h.sources[c]} lands make it">
      <img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${MANA[c].name}">
      <div class="col-bars"><div class="cb"><span style="width:${p * 100}%"></span></div><div class="cb src"><span style="width:${s * 100}%"></span></div></div>
      <span class="col-n">${Math.round(p * 100)}% · ${Math.round(s * 100)}%</span></div>`;
  }).join('');
  const warn = h.size !== 100 ? `<p class="h-warn">⚠ ${h.size} cards instead of 100</p>` : '';
  return `<div class="card pad health">${warn}<div class="h-grid">
      <div><h4 class="card-h">Mana curve</h4>${curve}<p class="note">Average ${h.avgMv.toFixed(1)} mana · ${h.nonland} spells, without commander</p></div>
      <div><h4 class="card-h">What the deck does <span class="soft">· count · typical</span></h4>${roles}<p class="note">Tap a row to see those cards. Typical counts are a rough guide, not rules.</p></div>
      ${cols.length > 1 ? `<div><h4 class="card-h">Colour balance</h4>${colours}<p class="note">Top bar: share of mana symbols in costs. Bottom: share of lands that make that colour. Big gaps cause colour trouble.</p></div>` : ''}
    </div></div>`;
}

function renderDetail(){
  const d = deckById(activeDeck), s = deckStats(d), cx = crossStats().forDeck(d.id);
  const latest = d.swaps.length ? d.swaps[d.swaps.length - 1].date : null;
  const onlyNew = ui.cards === 'new' && d.changed > 0;
  const byRole = ui.view === 'role';
  const cardBtn = c => {
    const fresh = c.added && c.added === latest;
    return `<button class="c${fresh ? ' is-new' : c.added ? ' is-added' : ''}" data-card="${esc(c.name)}" title="${esc(c.name)}${c.added ? ` · added night ${nightNo(c.added)}` : ''}">
      ${pic(c.name,'small')}${c.qty > 1 ? `<span class="qty">×${c.qty}</span>` : ''}${fresh ? `<span class="new">new</span>` : c.added ? `<span class="added">N${nightNo(c.added)}</span>` : ''}</button>`;
  };
  const sortCards = list => list.sort((a,b) => (BASICS.has(a.name) - BASICS.has(b.name)) || (info(a.name).cmc||0) - (info(b.name).cmc||0) || a.name.localeCompare(b.name));
  const group = (key, label, list, extra = '') => list.length ? `<div class="group" id="grp-${esc(key)}"><h4>${label} <span>${list.reduce((t,c) => t + c.qty, 0)}</span>${extra}</h4><div class="grid">${sortCards(list).map(cardBtn).join('')}</div></div>` : '';
  const cards = [...d.now].filter(([name, e]) => name !== d.cur && !(onlyNew && !e.added)).map(([name, e]) => ({name, ...e}));
  let main = '';
  if (byRole){
    const defs = roleDefs(d), seen = new Set();
    for (const r of defs){
      const list = cards.filter(c => !isLand(c.name) && tagsOf(c.name).includes(r.tag));
      list.forEach(c => seen.add(c.name));
      main += group(r.tag, esc(r.label), list, r.explain ? ` <small class="g-ex">${esc(r.explain)}</small>` : '');
    }
    main += group('__other', 'Everything else', cards.filter(c => !isLand(c.name) && !seen.has(c.name)));
    main += group('__lands', 'Lands', cards.filter(c => isLand(c.name)));
  } else {
    const groups = {};
    for (const c of cards) (groups[typeOf(c.name)] = groups[typeOf(c.name)] || []).push(c);
    for (const g of TYPE_ORDER){
      if (!groups[g] || g === 'Commander') continue;
      main += group(g === 'Land' ? '__lands' : g, {Sorcery:'Sorceries', Other: ready() ? 'Other' : 'Cards'}[g] || g + 's', groups[g]);
    }
  }
  if (!onlyNew && d.removed.length) main += `<details class="group gy"><summary><h4>Swapped out <span>${d.removed.length}</span></h4></summary><div class="grid">${d.removed.map(r => cardBtn({name:r.name, qty:1})).join('')}</div></details>`;

  // history, one foldable block per night, newest first and open
  const byNight = [...new Set(d.swaps.map(c => c.date))].reverse();
  const log = byNight.length ? byNight.map((date, k) => {
    const sw = d.swaps.filter(c => c.date === date), quote = sw.map(c => c.note).find(Boolean);
    return `<details class="hnight" ${k === 0 ? 'open' : ''}><summary>Night ${nightNo(date)} <span>${fmtShort(date)} · ${plural(sw.length, 'swap')}</span></summary>
      <ul class="log">${sw.map(c => `<li>${c.out ? `<span class="o">${esc(c.out)}</span> → ` : ''}<button class="link" data-swap="${state.changes.indexOf(c)}">${esc(c.in)}</button>${c.isCmd ? ' <b class="gold">commander</b>' : ''}</li>`).join('')}</ul>
      ${quote ? `<p class="quote">“${esc(quote)}”</p>` : ''}</details>`;
  }).join('') : `<p class="hint">No swaps yet. Straight out of the box.</p>`;

  $('#deck-detail').innerHTML = `<div class="detail card pad" style="--c:${d.color}">
    <aside class="side">
      <button class="c" data-card="${esc(d.cur)}">${pic(d.cur,'normal','cmdimg',false)}</button>
      <h3>${esc(d.name)} ${pips(d.colors)}</h3>
      <dl class="kv">
        <dt>Record</dt><dd>${s.wins} / ${plural(s.played,'game')}</dd>
        <dt>Changed</dt><dd>${d.changed} of ${d.size} cards</dd>
        ${cx.most ? `<dt>Played most by</dt><dd>${esc(joinNames(cx.most.names))}</dd>` : ''}
        ${cx.best ? `<dt>Wins with</dt><dd>${esc(joinNames(cx.best.names))}</dd>` : ''}
      </dl>
      <div class="side-links">
        <button class="mox" data-act="copy-link">Copy link to this deck</button>
        ${d.moxfield ? `<a class="mox" href="${esc(d.moxfield)}" target="_blank" rel="noopener">Moxfield ↗</a>` : ''}
      </div>
      <h4 class="card-h hist-h">History</h4>${log}
    </aside>
    <div class="detail-main">${healthPanel(d)}
      <div class="list-head"><h4 class="card-h">The list</h4><div class="list-ctl">
        ${seg('view', [['type','By type'], ['role','By role']], 'Group the list')}
        ${d.changed ? seg('cards', [['all', `All ${d.size}`], ['new', `New ${d.changed}`]], 'Which cards to show') : ''}</div></div>
      ${main || '<p class="hint">Nothing to show.</p>'}</div></div>`;
  bindSeg($('#deck-detail'), renderDetail);
  bindCards($('#deck-detail'));
  $('#deck-detail').querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
    ui.view = 'role'; if (b.dataset.role !== '__lands') ui.cards = 'all'; saveUi(); renderDetail();
    const g = document.getElementById('grp-' + b.dataset.role);
    if (g) g.scrollIntoView({behavior:'smooth', block:'start'});
  });
  $('#deck-detail').querySelector('[data-act=copy-link]').onclick = async e => {
    const url = location.href.split('#')[0] + '#' + deckSlug(d), btn = e.currentTarget;
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied ✓'; }
    catch { prompt('Copy this link:', url); }
    setTimeout(() => btn.textContent = 'Copy link to this deck', 1600);
  };
  const tip = $('#tip'), h = health(d);
  $('#deck-detail').querySelectorAll('.cv').forEach(g => {
    g.onmousemove = e => { const i = +g.dataset.i; if (!h.curve[i]) return;
      tip.innerHTML = `<b>${i === 7 ? '7+' : i} mana · ${h.curve[i]}</b>${h.curveCards[i].slice(0, 12).map(n => `<div>${esc(n)}</div>`).join('')}${h.curveCards[i].length > 12 ? `<div class="soft">+${h.curveCards[i].length - 12} more</div>` : ''}`;
      tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; };
    g.onmouseleave = () => tip.hidden = true;
  });
}

/* ---------- modal ---------- */
function openModal(html){ $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
function closeModal(){ $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }
function showCard(n, why){
  const i = info(n);
  openModal(`<div class="mcards"><figure><img src="${esc(img(n,'normal'))}" alt="${esc(n)}">
    <figcaption>${i.uri ? `<a href="${esc(i.uri)}" target="_blank" rel="noopener">${esc(n)} on Scryfall</a>` : esc(n)}</figcaption></figure></div>
    ${why ? `<p class="mnote">“${esc(why)}”</p>` : ''}`);
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
addEventListener('hashchange', () => { const d = deckFromHash(); if (d && d.id !== activeDeck) selectDeck(d.id, true); });

/* ---------- boot ---------- */
function renderAll(){
  renderHero(); renderUpNext(); renderCampaign(); renderNight(); renderStandings(); renderStrip(); renderDetail();
  const w = $('#warnings');
  if (state.warnings.length){ w.hidden = false; w.innerHTML = '<b>Data check:</b><br>' + [...new Set(state.warnings)].map(esc).join('<br>'); }
}
load().then(() => {
  if (state.site.title){ $('#site-title').textContent = $('#nav-brand').textContent = document.title = state.site.title; }
  const linked = deckFromHash();
  activeDeck = (linked || state.decks[0]).id;
  renderAll();                                   // fast first paint
  if (linked) $('#decks').scrollIntoView();
  return loadCards().finally(() => { renderAll(); if (linked) $('#decks').scrollIntoView(); });   // then real images + card data
}).catch(e => {
  document.querySelector('main').innerHTML = `<p class="warn">Could not load data: ${esc(e.message)}</p>`;
});
})();
