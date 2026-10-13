# estados por painel ao longo de uma gravação (frames.json/marks) e janelas com exatamente um 🟡 na aba Loja
import json, sys
rec = sys.argv[1]
d = json.load(open(f'{rec}/frames/frames.json'))
st = {}; active = 'Loja'; tabof = {'fin': 'Fin', 'api': 'API'}; rows = []
for m in d['marks']:
    t, l = m['t'], m['label']; p = l.split()
    if l.startswith('still'): continue
    if p[0] == 'status': st[p[1]] = p[2]
    if p[0] == 'cmdJ' and len(p) > 2: active = tabof.get(p[2], 'Loja')
    if l.startswith('tab-2'): active = 'Fin'
    if l.startswith('tab-1'): active = 'Loja'
    rows.append((t, active, dict(st), l))
def one_yellow(s):
    devs = {k: v for k, v in s.items() if k.startswith('dev')}
    y = [k for k, v in devs.items() if v == 'needs-you']
    return len(devs) == 3 and len(y) == 1 and all(v == 'working' for k, v in devs.items() if k not in y) and s.get('tech-lead') in ('idle', 'working')
print('janelas com um único 🟡 entre os devs (resto 🟢, líder sem 🔵), aba Loja:')
for i, (t, a, s, l) in enumerate(rows):
    if a == 'Loja' and one_yellow(s):
        nt = rows[i + 1][0] if i + 1 < len(rows) else d['duration']
        if nt - t >= 1.0: print(f'  {t:7.2f}–{nt:7.2f} ({nt - t:4.2f}s)  🟡={[k for k, v in s.items() if k.startswith("dev") and v == "needs-you"][0]}  líder={s.get("tech-lead")}')
if '-v' in sys.argv:
    for t, a, s, l in rows: print(f'{t:7.2f} {a:4} {l:28} ' + ' '.join(f'{k}={v[:5]}' for k, v in sorted(s.items())))
