/* Commander Legacy — public page. Reads top to bottom:
   headline → up next (when a menu exists) → game nights → standings → the decks today.
   Data and card helpers come from core.js. */
(() => {
'use strict';
const {$, esc, state, TYPE_ORDER, BASICS, FLAG_TEXT, fmtDate, fmtShort, joinNames, plural, dot,
       load, loadCards, info, img, pic, typeOf, ready, deckById, hasMenu, nightNo, pColor, cmdAt,
       deckStats, playerStats, crossStats} = CL;

const DEFAULT_UI = {who:'decks', metric:'wins', cards:'all'};
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
function renderStrip(){
  $('#deck-strip').innerHTML = state.decks.map(d => {
    const s = deckStats(d);
    return `<button class="deck-card" role="tab" aria-selected="${d.id === activeDeck}" data-deck="${d.id}" style="--c:${d.color}">
      <div class="art" style="${img(d.cur,'art') ? `background-image:url('${esc(img(d.cur,'art'))}')` : ''}">${pips(d.colors)}</div>
      <div class="body"><h3>${esc(d.name)}</h3><p class="cmd">${esc(d.cur)}</p>
        <p class="meta">${plural(s.wins,'win')} · ${d.changed} of ${d.size} cards new</p></div></button>`;
  }).join('');
  document.querySelectorAll('.deck-card').forEach(b => b.onclick = () => { activeDeck = b.dataset.deck; renderStrip(); renderDetail(); });
}

function renderDetail(){
  const d = deckById(activeDeck), s = deckStats(d), cx = crossStats().forDeck(d.id);
  const latest = d.swaps.length ? d.swaps[d.swaps.length - 1].date : null;
  const onlyNew = ui.cards === 'new' && d.changed > 0;
  const groups = {};
  for (const [name, e] of d.now){
    if (onlyNew && !e.added) continue;
    const g = name === d.cur ? 'Commander' : typeOf(name);
    (groups[g] = groups[g] || []).push({name, ...e});
  }
  const cardBtn = c => {
    const fresh = c.added && c.added === latest;
    return `<button class="c${fresh ? ' is-new' : c.added ? ' is-added' : ''}" data-card="${esc(c.name)}" title="${esc(c.name)}${c.added ? ` · added night ${nightNo(c.added)}` : ''}">
      ${pic(c.name,'small')}${c.qty > 1 ? `<span class="qty">×${c.qty}</span>` : ''}${fresh ? `<span class="new">new</span>` : c.added ? `<span class="added">N${nightNo(c.added)}</span>` : ''}</button>`;
  };
  let main = '';
  for (const g of TYPE_ORDER){
    if (!groups[g] || g === 'Commander') continue;
    const list = groups[g].sort((a,b) => (BASICS.has(a.name) - BASICS.has(b.name)) || (info(a.name).cmc||0) - (info(b.name).cmc||0) || a.name.localeCompare(b.name));
    const label = {Sorcery:'Sorceries', Other: ready() ? 'Other' : 'Cards'}[g] || g + 's';
    main += `<div class="group"><h4>${label} <span>${list.reduce((t,c) => t + c.qty, 0)}</span></h4><div class="grid">${list.map(cardBtn).join('')}</div></div>`;
  }
  if (d.removed.length) main += `<details class="group gy"><summary><h4>Swapped out <span>${d.removed.length}</span></h4></summary><div class="grid">${d.removed.map(r => cardBtn({name:r.name, qty:1})).join('')}</div></details>`;

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
      ${d.moxfield ? `<a class="mox" href="${esc(d.moxfield)}" target="_blank" rel="noopener">Open in Moxfield ↗</a>` : ''}
      <h4 class="card-h hist-h">History</h4>${log}
    </aside>
    <div><div class="list-head"><h4 class="card-h">The list</h4>${d.changed ? seg('cards', [['all', `All ${d.size}`], ['new', `New ${d.changed}`]], 'Which cards to show') : ''}</div>${main}</div></div>`;
  bindSeg($('#deck-detail'), renderDetail);
  bindCards($('#deck-detail'));
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

/* ---------- boot ---------- */
function renderAll(){
  renderHero(); renderUpNext(); renderCampaign(); renderNight(); renderStandings(); renderStrip(); renderDetail();
  const w = $('#warnings');
  if (state.warnings.length){ w.hidden = false; w.innerHTML = '<b>Data check:</b><br>' + [...new Set(state.warnings)].map(esc).join('<br>'); }
}
load().then(() => {
  if (state.site.title){ $('#site-title').textContent = $('#nav-brand').textContent = document.title = state.site.title; }
  activeDeck = state.decks[0].id;
  renderAll();                                   // fast first paint
  return loadCards().finally(renderAll);         // then real images + card types
}).catch(e => {
  document.querySelector('main').innerHTML = `<p class="warn">Could not load data: ${esc(e.message)}</p>`;
});
})();
