import type { UpdateStatus } from '../../shared/update'

export interface UpdateItem {
  text: string
  tone: 'info' | 'warn'
  action: { label: string; run: 'install' | 'open-release' } | null
  /** mostra "Ver novidades" */
  notes: boolean
}

export function updateItem(s: UpdateStatus, platform: string): UpdateItem | null {
  switch (s.kind) {
    case 'ready':
      return { text: `● Versão ${s.version} pronta`, tone: 'info', action: { label: 'Atualizar', run: 'install' }, notes: true }
    case 'notify-only':
      return { text: `● Versão ${s.version} disponível`, tone: 'info', action: { label: 'Baixar', run: 'open-release' }, notes: true }
    case 'blocked':
      return {
        text: `Versão ${s.version} disponível · ${platform === 'darwin' ? 'mova o app para Aplicativos' : 'mova o AppImage para uma pasta sua'} para atualizar`,
        tone: 'warn',
        action: null,
        notes: false,
      }
    case 'failed-last':
      return { text: `A atualização para ${s.to} falhou; você continua na ${s.current}`, tone: 'warn', action: null, notes: false }
    default:
      return null
  }
}

export function updatedNotice(version: string, resumed: number): string {
  const n = resumed === 0 ? '' : resumed === 1 ? ' · 1 sessão retomada' : ` · ${resumed} sessões retomadas`
  return `Atualizado para ${version}${n}`
}
