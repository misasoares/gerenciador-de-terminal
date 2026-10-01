import type { ConversationInfo } from '../../shared/types'
import { errorMessage } from './api'

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterConversations(list: ConversationInfo[], q: string): ConversationInfo[] {
  const n = normalize(q.trim())
  if (!n) return list
  return list.filter((c) => normalize(`${c.title} ${c.branch ?? ''}`).includes(n))
}

const pad = (n: number) => String(n).padStart(2, '0')

export function relativeTime(ms: number, now: number): string {
  const diff = now - ms
  if (diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`
  const d = new Date(ms)
  const today = new Date(now)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `há ${Math.floor(diff / 3_600_000)} h`
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return `ontem ${clock}`
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${clock}`
}

export function isMissing(e: unknown): boolean {
  return errorMessage(e).includes('conversation-missing')
}
