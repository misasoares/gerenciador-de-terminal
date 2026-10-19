import type { AgentKind, SessionStatus } from '../../shared/types'
import { profileOf } from '../agent-profiles'
import type { Mailbox } from './mailbox'

export const USER_TYPING_GRACE_MS = 5000
export const INTERRUPT_QUIET_MS = 1500
export const READY_TIMEOUT_MS = 60_000
/** sem ficar working tanto tempo depois da entrega, a CLI ignorou a colagem: a fila anda */
export const PICKUP_TIMEOUT_MS = 30_000
/** o Esc de interromper vale para a entrega por esse tempo */
const INTERRUPT_WINDOW_MS = 30_000
/** pausa entre o fim da colagem e o Enter */
const PASTE_SETTLE_MS = 150

export interface DeliveryPane {
  id: string
  alive: boolean
  agent: AgentKind | null
  status: SessionStatus | null
  /** quando o status atual começou */
  statusSince: number
  /** primeiro SessionStart do painel (null = a CLI ainda não ficou pronta) */
  sessionSince: number | null
  createdAt: number
  lastUserInputAt: number
  lastOutputAt: number
}

export interface DeliveryDeps {
  mailbox: Mailbox
  pane(id: string): DeliveryPane | null
  writeRaw(id: string, data: string): void
  now(): number
  /** espera entre o fim da colagem e o Enter */
  sleep(ms: number): Promise<void>
  /** o processo da CLI está vivo e na frente do terminal (não o shell): o status pode estar velho se ela caiu sem SessionEnd */
  agentAtFront(id: string): Promise<boolean>
}

/** colagem entre marcadores de bracketed paste + Enter; ESC no texto sairia da colagem, então não passa */
export function pasteAndSubmit(text: string): [string, string] {
  return ['\x1b[200~' + text.replace(/\x1b/g, '') + '\x1b[201~', '\r']
}

export class Deliverer {
  /** destinatários com colagem em andamento */
  private busy = new Set<string>()
  /** última entrega por destinatário: a próxima espera o agente pegar a mensagem (working) e voltar a parar */
  private delivered = new Map<string, { at: number; sawWorking: boolean }>()
  private interruptedAt = new Map<string, number>()

  constructor(private d: DeliveryDeps) {}

  /** tenta entregar a próxima de cada destinatário com fila; chamado em onChange e a cada 1 s */
  async tick(): Promise<void> {
    // working precisa ser visto mesmo sem fila: é o que prova que o agente pegou a mensagem
    for (const [to, d] of this.delivered) if (this.d.pane(to)?.status === 'working') d.sawWorking = true
    const targets = new Set(this.d.mailbox.all().filter((m) => m.state === 'na-fila').map((m) => m.to))
    await Promise.all([...targets].map((to) => this.deliverTo(to)))
  }

  /**
   * manda a tecla de interromper só se o destinatário está trabalhando ou pedindo permissão: parado, Esc Esc abre o menu de voltar no histórico.
   * true = há um Esc nosso valendo (agora ou há pouco) e a próxima entrega aproveita a janela; false = nada foi interrompido
   */
  interrupt(to: string): boolean {
    const p = this.d.pane(to)
    if (!p?.alive) return false
    // um segundo Esc logo depois do primeiro também viraria Esc Esc
    if (this.inInterruptWindow(to)) return true
    if (p.status !== 'working' && p.status !== 'needs-you') return false
    this.d.writeRaw(to, profileOf(p.agent ?? 'claude').interruptKey)
    this.interruptedAt.set(to, this.d.now())
    return true
  }

  private inInterruptWindow(to: string): boolean {
    const at = this.interruptedAt.get(to)
    return at !== undefined && this.d.now() - at <= INTERRUPT_WINDOW_MS
  }

  /** recados atrasados: na fila há mais de 60 s sem SessionStart */
  late(to: string): boolean {
    const p = this.d.pane(to)
    if (!p || p.sessionSince !== null) return false
    const now = this.d.now()
    return this.d.mailbox.queued(to).some((m) => now - m.createdAt > READY_TIMEOUT_MS)
  }

  private ready(p: DeliveryPane): boolean {
    const now = this.d.now()
    if (!p.alive || now - p.lastUserInputAt < USER_TYPING_GRACE_MS) return false
    const last = this.delivered.get(p.id)
    const settled = p.status === 'idle' || p.status === 'your-turn'
    const free = !last || last.sawWorking || now - last.at >= PICKUP_TIMEOUT_MS
    if (settled) return free
    // sem sessão (nenhum hook ainda) não entrega: a tela pode ser um aviso de atualização, de confiança na pasta ou de login, e o Enter escolheria a opção padrão
    // Esc no Claude não dispara Stop: depois de um Esc nosso (com ou sem texto), o silêncio do terminal é o sinal de que ele parou
    const stuck = p.status === 'working' || p.status === 'needs-you'
    return stuck && this.inInterruptWindow(p.id) && now - p.lastOutputAt >= INTERRUPT_QUIET_MS
  }

  private async deliverTo(to: string): Promise<void> {
    if (this.busy.has(to)) return
    const p = this.d.pane(to)
    const m = this.d.mailbox.next(to)
    if (!p || !m || !this.ready(p)) return
    this.busy.add(to)
    try {
      // sem a CLI na frente, a colagem e o Enter iriam para o shell e virariam comando
      if (!(await this.d.agentAtFront(to))) return
      // o estado pode ter mudado enquanto o ps rodava
      const cur = this.d.pane(to)
      if (!cur || this.d.mailbox.next(to)?.id !== m.id || !this.ready(cur)) return
      const [paste, enter] = pasteAndSubmit(m.text)
      // depois do Esc a CLI devolve o texto cancelado à caixa de entrada: Ctrl-U antes, senão as duas viram um pedido só
      if (this.inInterruptWindow(to)) this.d.writeRaw(to, '\x15')
      this.d.writeRaw(to, paste)
      await this.d.sleep(PASTE_SETTLE_MS)
      this.d.writeRaw(to, enter)
      this.delivered.set(to, { at: this.d.now(), sawWorking: cur.status === 'working' })
      this.interruptedAt.delete(to)
      this.d.mailbox.markDelivered(m.id)
    } finally {
      this.busy.delete(to)
    }
  }
}
