// C: reabre o app com o daemon vivo (sem semear estado) e grava a volta das sessões
import fs from 'node:fs'; import path from 'node:path'
import { launch, sleep, REPO } from './gt.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips/recC')
const g = await launch({ width: 1920, height: 1080 })
await g.startRec(path.join(OUT, 'frames')); g.mark('reaberto')
fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true })
for (let i = 0; i < 12; i++) { await sleep(1500); await g.shot(path.join(OUT, 'stills', `${String(i).padStart(3, '0')}.png`)) }
console.log('frames', await g.stopRec())
console.log(JSON.stringify((await g.state()).panes.map((p) => [p.name ?? p.id, p.claude?.status, p.alive])))
await g.close()
