import random, sys
sys.path.insert(0, 'tests')
from synth import fake_month, render_page, photograph
from paperlog import vision

def score(pages, rows):
    err = ferr = uns = 0
    for p in pages:
        half = slice(0, 24) if p.side == 'left' else slice(24, 48)
        for r, row in enumerate(rows):
            want = row['sleep'][half] if row else '.' * 24
            err += sum(a != b for a, b in zip(p.sleep[r], want))
            wf = {f % 24 for f in (row['feeds'] if row else []) if (f < 24) == (p.side == 'left')}
            ferr += len(wf ^ set(p.feeds[r]))
            uns += len(p.uncertain[r])
    return err, ferr, uns

def run(n=6, **kw):
    tot = [0, 0, 0]; fails = 0
    for seed in range(n):
        rnd = random.Random(seed)
        rows = fake_month(rnd.randint(8, 31), seed=seed)
        pages = [render_page('left', rows, rnd, hard=kw.get('hard'), dot_colour=kw.get('dots', 'red')),
                 render_page('right', rows, rnd, hard=kw.get('hard'), dot_colour=kw.get('dots', 'red'))]
        if kw.get('spread'):
            shots = [photograph(pages, rnd, max_dim=kw.get('dim', 1280), curl=kw.get('curl', 0))]
        else:
            shots = [photograph([p], rnd, max_dim=kw.get('dim', 1280)) for p in pages]
        got = []
        try:
            for i, s in enumerate(shots):
                got += vision.read_photo(s, side_hint=['left', 'right'][i] if not kw.get('spread') else None)
        except vision.ReadError as e:
            fails += 1; continue
        if sorted(p.side for p in got) != ['left', 'right']:
            fails += 1; continue
        for i, v in enumerate(score(got, rows)):
            tot[i] += v
    cells = n * 2 * 31 * 24
    print(kw, f"frame/side failures {fails}/{n}  cell err {tot[0]}/{cells}  feed err {tot[1]}  flagged {tot[2]}")

if __name__ == '__main__':
    run(hard=False)
    run(hard=True)
    run(hard=True, dots='black')
    run(hard=True, spread=True, dim=1280)
    run(hard=True, spread=True, dim=2560, curl=0.04)
