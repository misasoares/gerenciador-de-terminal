# marca quadros com zoom errado (efeito das capturas paradas): a faixa do topo (abas/cabeçalhos) destoa do último quadro bom
# e um quadro seguinte (até 8) volta a se parecer com ele
import json, sys
from PIL import Image
rec = sys.argv[1]
meta = json.load(open(f'{rec}/frames.json')); fr = meta['frames']
def thumb(f):
    im = Image.open(f'{rec}/{f["file"]}'); im.draft('L', (im.width // 8, im.height // 8)); return list(im.convert('L').resize((64, 36)).getdata())
th = [thumb(f)[:64 * 4] for f in fr]
d = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / len(a)
bad = set(); p = 0
for i in range(1, len(fr)):
    if d(th[i], th[p]) <= 8: p = i; continue
    nxt = next((j for j in range(i + 1, min(len(fr), i + 9)) if d(th[j], th[p]) < 6), None)
    if nxt is not None: bad.update(range(i, nxt))
    else: p = i  # mudança legítima (troca de aba, layout novo)
for i, f in enumerate(fr): f['bad'] = i in bad
json.dump(meta, open(f'{rec}/frames.json', 'w'), indent=1)
print(rec.split('/')[-2], 'quadros ruins:', len(bad), 'em', len(fr))
