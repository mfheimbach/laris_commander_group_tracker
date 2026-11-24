# Commander Legacy tracker

Static site (plain HTML/JS, no build) tracking our five 2022 Starter Commander decks: games, wins and card swaps over time. Card images and card data come from Scryfall in the browser.

- `index.html` + `app.js`: the public page
- `admin.html` + `admin.js`: where nights and menus are entered
- `core.js`: data loading shared by both
- `data/`: everything the site shows

## Hosting
Settings → Pages → Deploy from branch → `main` / root. Every commit is live about a minute later.

## Entering data: the admin page
Open `admin.html` (linked in the page footer). It works on a phone.

**Connect once per device.** Open the [pre-filled token form](https://github.com/settings/personal-access-tokens/new?name=Commander+Legacy+admin&description=Saves+game+nights+from+the+tracker+admin+page&target_name=mfheimbach&expires_in=366&contents=write) (name, a one-year expiry and Contents write access are already filled in). Under *Repository access* choose *Only select repositories* → this repo, then *Generate token*. The name doesn't matter. Paste the token into the admin page; it is stored only in that browser and sent only to GitHub. When it expires, make a new one the same way.

- **Save a night:** date, who sat at which deck, the winner, the swaps per deck and a quote. Menu options appear as chips to tap; any other card can be typed. Cards are checked against Scryfall (colours, Commander legality, Game Changer). One press commits everything. What you typed survives a reload until it is saved.
- **Next menu:** per deck, the cards that could go and the cards that could come in, plus a one-line brief. Shown on the site as "Up next". Saving a night clears it.
- **Lists:** each deck's current list in Moxfield's import format, and links to edit the data files by hand.

## The data files
Fields are separated by `;`, dates are `YYYY-MM-DD`. Decks are referred to by id (`flight`, `chaos`, `grave`, `tokens`, `dragons`) or by name (`Flyers`, `Demons`, `Zombies`, `Tokens`, `Dragons`).

**`data/changes.csv`**: one row per swap. Swapping out the current commander makes the incoming card the new commander.
```
date;deck;out;in;note
2026-10-18;flight;Storm Herd;Sun Titan;Storm Herd was too slow
```

**`data/games.csv`**: one row per game, each player paired with a deck. `winner` is the player (or the deck).
```
date;decks;winner;note
2026-10-18;Mo:dragons,Anna:flight,Ben:chaos,Lea:grave;Mo;turn 9
```

**`data/next.csv`**: the menu for the coming night. `kind` is `cut`, `add`, `brief` (text in `reason`) or `picks` (number in `card`, default 3).
```
deck;kind;card;reason
dragons;brief;;More dragons, cheaper ones
dragons;cut;Spit Flame;narrow removal
dragons;add;Lathliss, Dragon Queen;every dragon brings a friend
```

Typos (unknown decks, a card that isn't in the deck, a card Scryfall doesn't know) show up in a red box at the bottom of the public page.

**Other files:** `data/decks.json` holds deck names, colours, starting commander and the Moxfield link. `data/decks/*.txt` are the original lists (don't edit these, log swaps instead). `data/site.json` sets the title and the repository the admin page writes to.

Reading the data in R: `data.table::fread("data/games.csv", sep = ";")`.

## Changing the code
After changing any `.js` or `.css` file, bump the `?v=` number on the links in `index.html` and `admin.html`, otherwise browsers may combine new pages with old cached files.

The admin token sits in the browser's storage for `<user>.github.io`, which all of that user's GitHub Pages sites share. Keep the token limited to this repository.
