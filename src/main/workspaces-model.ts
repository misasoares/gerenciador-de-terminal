import type { WorkspaceSummary } from '../shared/types'

/** sem Electron: decide o que abrir ao iniciar o app */
export function decideStartup(list: WorkspaceSummary[]): { kind: 'direct'; id: string } | { kind: 'chooser' } {
  if (list.length >= 2) return { kind: 'chooser' }
  return { kind: 'direct', id: list[0]?.id ?? 'principal' }
}

export function closeDialogText(name: string, sessions: number): string {
  const mid = sessions === 1 ? 'A sessão continua rodando' : `As ${sessions} sessões continuam rodando`
  return `Fechar a janela "${name}"? ${mid} em segundo plano. Você reabre pelo menu Janela ou pelo Dock.`
}

export function closedNoticeText(name: string, sessions: number): string {
  return `${name} fechado · ${sessions === 1 ? '1 sessão continua' : `${sessions} sessões continuam`} em segundo plano`
}

/** badge do Dock = o que espera você em todos os espaços (abertos ou não) */
export function badgeTotal(list: WorkspaceSummary[]): string {
  const n = list.reduce((acc, w) => acc + w.attention, 0)
  return n > 0 ? String(n) : ''
}
