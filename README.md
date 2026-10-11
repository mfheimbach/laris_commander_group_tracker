# Commander Legacy tracker

Static site (plain HTML/JS, no build) tracking our five 2022 Starter Commander decks: games, wins and card swaps over time. Card images come from Scryfall in the browser.

## Hosting
Settings → Pages → Deploy from branch → `main` / root. Every commit is live about a minute later.

## Adding data
Edit the files in `data/` (the GitHub web editor is fine). Fields are separated by `;`, dates are `YYYY-MM-DD`.
Decks can be referred to by id (`flight`, `chaos`, `grave`, `tokens`, `dragons`), full name, or pilot.

**`data/changes.csv`**: one row per swap.
```
date;deck;out;in;note
2026-10-18;flight;Storm Herd;Sun Titan;Storm Herd was too slow
```
Swapping out the current commander makes the incoming card the new commander.

**`data/games.csv`**: one row per game.
```
date;decks;winner;note
2026-10-18;flight,chaos,grave,dragons;dragons;turn 9
```
Leave `decks` empty if all five played, and `winner` empty for an unfinished game.

Typos (unknown decks, a card that isn't in the deck, a card Scryfall doesn't know) show up in a red box at the bottom of the page.

**Other files:** `data/decks.json` holds deck names, colours, starting commander and an optional `pilot`. `data/decks/*.txt` are the original lists (MTGO format; don't edit these, log swaps instead). `data/site.json` sets the title and subtitle.

Reading the data in R: `data.table::fread("data/games.csv", sep = ";")`.
