import { describe, expect, it } from 'vitest'
import { Deliverer, INTERRUPT_QUIET_MS, PICKUP_TIMEOUT_MS, pasteAndSubmit, READY_TIMEOUT_MS, USER_TYPING_GRACE_MS, type DeliveryPane } from '../../src/daemon/team/delivery'
import { Mailbox } from '../../src/daemon/team/mailbox'

const msg = { from: 'p1', to: 'p2', fromName: 'lider', toName: 'dev-1', fromAgent: 'claude' as const, kind: 'equipe' as const, team: 'p1', body: 'oi', text: 'oi', interrupt: false }

function setup(over: Partial<DeliveryPane> = {}) {
  let t = 100_000
  const written: string[] = []
  const panes: Record<string, DeliveryPane> = {
    p2: { id: 'p2', alive: true, agent: 'claude', status: 'your-turn', statusSince: 50_000, sessionSince: 1, createdAt: 0, lastUserInputAt: 0, lastOutputAt: 0, ...over },
  }
  /** painéis cujo agente não está rodando na frente do shell */
  const agentGone = new Set<string>()
  const mb = new Mailbox([], () => {}, () => t)
  const d = new Deliverer({
    mailbox: mb,
    pane: (id) => panes[id] ?? null,
    writeRaw: (_id, data) => void written.push(data),
    now: () => t,
    sleep: async () => {},
    agentAtFront: async (id) => !agentGone.has(id),
  })
  return { d, mb, panes, written, agentGone, advance: (ms: number) => void (t += ms), now: () => t }
}

describe('Deliverer', () => {
  it('entrega quando o dev está your-turn: a colagem e o Enter, em ordem', async () => {
    const s = setup()
    const m = s.mb.enqueue({ ...msg, text: 'faça x' })
    await s.d.tick()
    expect(s.written).toEqual(pasteAndSubmit('faça x'))
    expect(s.mb.all().find((x) => x.id === m.id)?.state).toBe('entregue')
  })

  it('também entrega em idle', async () => {
    const s = setup({ status: 'idle' })
    s.mb.enqueue(msg)
    await s.d.tick()
    expect(s.written).toHaveLength(2)
  })

  it('não entrega em working nem em needs-you, nem sem sessão ou com o painel morto', async () => {
    const s = setup({ status: 'needs-you' })
    s.mb.enqueue(msg)
    await s.d.tick()
    s.panes.p2.status = 'working'
    await s.d.tick()
    s.panes.p2.status = null
    await s.d.tick()
    s.panes.p2.status = 'your-turn'
    s.panes.p2.alive = false
    await s.d.tick()
    expect(s.written).toEqual([])
    expect(s.mb.queued('p2')).toHaveLength(1)
    s.panes.p2.alive = true
    await s.d.tick()
    expect(s.written).toHaveLength(2)
  })

  it('status your-turn velho com o agente fora (CLI caiu, o shell está na frente): não digita no shell', async () => {
    const s = setup()
    s.agentGone.add('p2')
    s.mb.enqueue(msg)
    await s.d.tick()
    expect(s.written).toEqual([])
    expect(s.mb.queued('p2')).toHaveLength(1)
    s.agentGone.delete('p2')
    await s.d.tick()
    expect(s.written).toEqual(pasteAndSubmit('oi'))
  })

  it('espera 5 s depois da última tecla do usuário', async () => {
    const s = setup()
    s.panes.p2.lastUserInputAt = s.now() - (USER_TYPING_GRACE_MS - 1000)
    s.mb.enqueue(msg)
    await s.d.tick()
    expect(s.written).toEqual([])
    s.panes.p2.lastUserInputAt = s.now() - USER_TYPING_GRACE_MS
    await s.d.tick()
    expect(s.written).toHaveLength(2)
  })

  it('uma por vez: mudar só o statusSince (markSeen: your-turn → idle) não libera a segunda', async () => {
    const s = setup()
    s.mb.enqueue({ ...msg, text: 'um' })
    s.mb.enqueue({ ...msg, text: 'dois' })
    await s.d.tick()
    await s.d.tick()
    expect(s.written).toEqual(pasteAndSubmit('um'))
    s.advance(1000)
    s.panes.p2.status = 'idle'
    s.panes.p2.statusSince = s.now()
    await s.d.tick()
    expect(s.written).toEqual(pasteAndSubmit('um'))
  })

  it('uma por vez: depois de working e de volta a your-turn, a segunda sai', async () => {
    const s = setup()
    s.mb.enqueue({ ...msg, text: 'um' })
    s.mb.enqueue({ ...msg, text: 'dois' })
    await s.d.tick()
    s.advance(1000)
    s.panes.p2.status = 'working'
    s.panes.p2.statusSince = s.now()
    await s.d.tick()
    expect(s.written).toEqual(pasteAndSubmit('um'))
    s.advance(1000)
    s.panes.p2.status = 'your-turn'
    s.panes.p2.statusSince = s.now()
    await s.d.tick()
    expect(s.written).toEqual([...pasteAndSubmit('um'), ...pasteAndSubmit('dois')])
  })

  it('uma por vez: se ele não fica working em 30 s (a CLI ignorou a colagem), a fila anda', async () => {
    const s = setup()
    s.mb.enqueue({ ...msg, text: 'um' })
    s.mb.enqueue({ ...msg, text: 'dois' })
    await s.d.tick()
    s.advance(PICKUP_TIMEOUT_MS - 1000)
    await s.d.tick()
    expect(s.written).toEqual(pasteAndSubmit('um'))
    s.advance(1000)
    await s.d.tick()
    expect(s.written).toEqual([...pasteAndSubmit('um'), ...pasteAndSubmit('dois')])
  })

  it('texto com várias linhas, aspas, $() e acentos vai dentro da colagem, sem alteração', async () => {
    const s = setup()
    const texto = 'linha 1\nfaça "x" e $(rm -rf ~)'
    s.mb.enqueue({ ...msg, text: texto })
    await s.d.tick()
    expect(s.written[0]).toBe('\x1b[200~' + texto + '\x1b[201~')
    expect(s.written[1]).toBe('\r')
  })

  it('o texto não escapa da colagem: ESC embutido é removido', () => {
    expect(pasteAndSubmit('a\x1b[201~rm -rf ~')[0]).toBe('\x1b[200~a[201~rm -rf ~\x1b[201~')
  })

  it('interromper no Claude: Esc e entrega depois de 1,5 s de silêncio, mesmo em working', async () => {
    const s = setup({ status: 'working' })
    s.d.interrupt('p2')
    expect(s.written).toEqual(['\x1b'])
    s.mb.enqueue({ ...msg, text: 'mude de rumo', interrupt: true })
    s.panes.p2.lastOutputAt = s.now() - (INTERRUPT_QUIET_MS - 500)
    await s.d.tick()
    expect(s.written).toEqual(['\x1b'])
    s.panes.p2.lastOutputAt = s.now() - INTERRUPT_QUIET_MS
    await s.d.tick()
    expect(s.written).toEqual(['\x1b', '\x15', ...pasteAndSubmit('mude de rumo')])
  })

  it('mensagem com interrupt limpa a linha (Ctrl-U) antes da colagem; sem interrupt, não', async () => {
    const s = setup({ status: 'working' })
    s.d.interrupt('p2')
    s.mb.enqueue({ ...msg, text: 'novo rumo', interrupt: true })
    s.panes.p2.lastOutputAt = 0
    await s.d.tick()
    // o Esc devolve o texto cancelado à caixa de entrada: sem limpar, os dois virariam um pedido só
    expect(s.written).toEqual(['\x1b', '\x15', ...pasteAndSubmit('novo rumo')])
    const t = setup()
    t.mb.enqueue(msg)
    await t.d.tick()
    expect(t.written).toEqual(pasteAndSubmit('oi'))
  })

  it('destinatário parado: interromper não manda Esc (dois seguidos abririam o menu de voltar no histórico)', () => {
    for (const status of ['idle', 'your-turn', null] as const) {
      const s = setup({ status })
      expect(s.d.interrupt('p2')).toBe(false)
      expect(s.d.interrupt('p2')).toBe(false)
      expect(s.written).toEqual([])
    }
  })

  it('pedindo permissão: interromper manda Esc', () => {
    const s = setup({ status: 'needs-you' })
    expect(s.d.interrupt('p2')).toBe(true)
    expect(s.written).toEqual(['\x1b'])
  })

  it('dois interromper seguidos num working: um Esc só, o segundo aproveita a janela', () => {
    const s = setup({ status: 'working' })
    expect(s.d.interrupt('p2')).toBe(true)
    expect(s.d.interrupt('p2')).toBe(true)
    expect(s.written).toEqual(['\x1b'])
  })

  it('Esc sem texto num working: depois do silêncio a próxima mensagem comum sai (limpando a linha)', async () => {
    const s = setup({ status: 'working' })
    s.d.interrupt('p2')
    s.mb.enqueue(msg)
    s.panes.p2.lastOutputAt = s.now() - (INTERRUPT_QUIET_MS - 500)
    await s.d.tick()
    expect(s.written).toEqual(['\x1b'])
    s.panes.p2.lastOutputAt = s.now() - INTERRUPT_QUIET_MS
    await s.d.tick()
    expect(s.written).toEqual(['\x1b', '\x15', ...pasteAndSubmit('oi')])
  })

  it('working sem Esc nosso: mensagem comum espera, mesmo com o terminal em silêncio', async () => {
    const s = setup({ status: 'working' })
    s.mb.enqueue(msg)
    s.panes.p2.lastOutputAt = 0
    await s.d.tick()
    expect(s.written).toEqual([])
  })

  it('CLI aberta, em silêncio há muito tempo e sem nenhum hook (status null): não entrega', async () => {
    const s = setup({ status: null, sessionSince: null })
    s.mb.enqueue(msg)
    s.advance(10 * 60_000)
    await s.d.tick()
    expect(s.written).toEqual([])
  })

  it('late: na fila há mais de 60 s sem SessionStart', () => {
    const s = setup({ status: null, sessionSince: null })
    const m = s.mb.enqueue(msg)
    expect(s.d.late('p2')).toBe(false)
    s.advance(READY_TIMEOUT_MS + 1000)
    expect(s.d.late('p2')).toBe(true)
    s.panes.p2.sessionSince = s.now()
    expect(s.d.late('p2')).toBe(false)
    expect(m.state).toBe('na-fila')
  })
})
