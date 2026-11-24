#!/usr/bin/env python3
"""Tag every card the decks have ever contained, using the Scryfall queries in data/tag-rules.json.

Writes data/tags.csv (card;tags). Cards already in tags.csv keep their tags (manual edits win)
unless --all is given. Run from the repo root:  python3 tools/autotag.py [--all]
"""
import csv, io, json, sys, time, urllib.parse, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
UA = {'User-Agent': 'laris-commander-tracker/1.0', 'Accept': 'application/json'}

def rows(path):
    txt = [l for l in path.read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')]
    return list(csv.DictReader(io.StringIO('\n'.join(txt)), delimiter=';')) if txt else []

def all_cards():
    names = set()
    for f in (DATA / 'decks').glob('*.txt'):
        for line in f.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line:
                names.add(line.split(' ', 1)[1] if line.split(' ', 1)[0].rstrip('x').isdigit() else line)
    for r in rows(DATA / 'changes.csv'):
        names.update(n for n in (r.get('in'), r.get('out')) if n)
    for r in rows(DATA / 'next.csv'):
        if r.get('kind') in ('cut', 'add') and r.get('card'): names.add(r['card'])
    return names - {'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'}

def search(q):
    out, url = [], 'https://api.scryfall.com/cards/search?' + urllib.parse.urlencode({'q': q})
    while url:
        for attempt in range(6):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                    j = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 404: return out      # no matches
                if e.code != 429 or attempt == 5: raise
                time.sleep(float(e.headers.get('Retry-After') or 2 ** attempt))   # rate limited: back off
        out += j.get('data', [])
        url = j.get('next_page') if j.get('has_more') else None
        time.sleep(0.25)
    return out

def tag(names, rules):
    queries = [(r['tag'], r['q']) for r in rules['roles']] + [(k, v['q']) for k, v in rules['themes'].items()]
    lower = {n.lower(): n for n in names}
    hits = {n: [] for n in names}
    names = sorted(names)
    for i in range(0, len(names), 35):
        chunk = names[i:i+35]
        ors = ' or '.join('!"%s"' % n.replace('"', '') for n in chunk)
        for t, q in queries:
            for c in search(f'({q}) ({ors})'):
                # full name or front face only: newer cards print famous spells as back faces
                for face in {c['name'], c['name'].split(' // ')[0]}:
                    if face.lower() in lower and t not in hits[lower[face.lower()]]:
                        hits[lower[face.lower()]].append(t)
        print(f'{min(i+35, len(names))}/{len(names)}', file=sys.stderr)
    order = [t for t, _ in queries]
    return {n: sorted(ts, key=order.index) for n, ts in hits.items()}

if __name__ == '__main__':
    rules = json.loads((DATA / 'tag-rules.json').read_text(encoding='utf-8'))
    path = DATA / 'tags.csv'
    old = {} if '--all' in sys.argv or not path.exists() else {r['card']: r['tags'] for r in rows(path)}
    todo = all_cards() - set(old)
    new = tag(todo, rules) if todo else {}
    merged = {**{k: v for k, v in old.items()}, **{k: ','.join(v) for k, v in new.items()}}
    lines = ['card;tags'] + [f'{n};{merged[n]}' for n in sorted(merged, key=str.lower)]
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(new)} cards tagged, {len(merged)} in tags.csv', file=sys.stderr)
