// recorte de uma gravação de screencast (tempos variáveis) → sequência f00001.jpg… a fps constante, exata no tempo:
// o quadro k mostra o último quadro bom com t ≤ from + k/fps·speed. Hardlink (sem recompressão).
// uso: node clipseq.mjs <dirGravação> <out> --from a --to b [--speed 1] [--fps 30]
import fs from 'node:fs'; import path from 'node:path'
const [recArg, out, ...rest] = process.argv.slice(2); const rec = path.resolve(recArg)
const o = { from: 0, to: Infinity, speed: 1, fps: 30 }
for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, '')] = rest[i + 1]
const from = Number(o.from), to = Number(o.to), speed = Number(o.speed), fps = Number(o.fps)
const fr = JSON.parse(fs.readFileSync(path.join(rec, 'frames.json'), 'utf8')).frames.filter((f) => !f.bad)
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
const n = Math.round(((to - from) / speed) * fps)
let j = 0
for (let k = 0; k < n; k++) {
  const t = from + (k / fps) * speed
  while (j + 1 < fr.length && fr[j + 1].t <= t) j++
  const dst = path.join(out, `f${String(k + 1).padStart(5, '0')}.jpg`)
  try { fs.linkSync(path.join(rec, fr[j].file), dst) } catch { fs.copyFileSync(path.join(rec, fr[j].file), dst) }
}
fs.writeFileSync(path.join(out, 'seq.json'), JSON.stringify({ fps, frames: n, duration: n / fps, source: { from, to, speed } }))
console.log(out, n, 'quadros', (n / fps).toFixed(2) + 's')
