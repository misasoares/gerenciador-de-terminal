const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const pad = (n: number) => String(n).padStart(2, '0')

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatReset(resetsAt: number, now: number): string {
  const r = new Date(resetsAt)
  const n = new Date(now)
  const sameDay = r.getFullYear() === n.getFullYear() && r.getMonth() === n.getMonth() && r.getDate() === n.getDate()
  return sameDay ? `renova às ${formatClock(resetsAt)}` : `renova ${DIAS[r.getDay()]} ${formatClock(resetsAt)}`
}
