# Commander Legacy tracker

Static site (plain HTML/JS, no build) tracking our five 2022 Starter Commander decks: games, wins and card swaps over time. Card images come from Scryfall in the browser.

## Hosting
Settings → Pages → Deploy from branch → `main` / root. Every commit is live about a minute later.

## Adding data
Edit the files in `data/` (the GitHub web editor is fine). Fields are separated by `;`, dates are `YYYY-MM-DD`.
Decks can be referred to by name (`Flyers`, `Demons`, `Zombies`, `Tokens`, `Dragons`) or by their original id (`flight`, `chaos`, `grave`, `tokens`, `dragons`).

**`data/changes.csv`**: one row per swap.
```
date;deck;out;in;note
2026-10-18;flight;Storm Herd;Sun Titan;Storm Herd was too slow
```
Swapping out the current commander makes the incoming card the new commander.

**`data/games.csv`**: one row per game. Pair each player with their deck as `player:deck`:
```
date;decks;winner;note
2026-10-18;Mo:dragons,Anna:flight,Ben:chaos,Lea:grave;Mo;turn 9
```
`winner` can be the player or the deck. Player names just need to be spelled the same each time; there's no player list to maintain.
Plain deck ids without players (`flight,chaos`) still work, but those games only count toward the deck ranking.
Leave `decks` empty if all five decks played without names, and `winner` empty for an unfinished game.

Typos (unknown decks, a card that isn't in the deck, a card Scryfall doesn't know) show up in a red box at the bottom of the page.

**Other files:** `data/decks.json` holds deck names, colours, starting commander, the Moxfield link and an optional `pilot`. `data/decks/*.txt` are the original lists (MTGO format; don't edit these, log swaps instead). `data/site.json` sets the title and subtitle.

Reading the data in R: `data.table::fread("data/games.csv", sep = ";")`.

**After changing `app.js` or `style.css`:** bump the `?v=` number on both links in `index.html`, otherwise browsers may combine the new page with old cached files.
