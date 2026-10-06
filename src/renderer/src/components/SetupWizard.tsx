import { useEffect, useState } from 'react'
import type { Account } from '../../../shared/types'
import { errorMessage } from '../api'
import { AGENT_LABEL } from '../agents-model'
import { setUi, useUi } from '../store'
import { ModalFrame } from './ModalFrame'

type Step = 'agents' | 'hooks' | 'codex'

/** 1ª abertura: detecta CLIs, cria agentes yolo, instala hooks e guia o /hooks do Codex */
export function SetupWizard() {
  const app = useUi((s) => s.app)
  const [step, setStep] = useState<Step>('agents')
  const [detected, setDetected] = useState<{ claude: boolean; codex: boolean } | null>(null)
  const [drafts, setDrafts] = useState<(Account & { on: boolean })[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void window.gt.request<{ claude: boolean; codex: boolean }>({ t: 'agents.detect' }).then((d) => {
      setDetected(d)
      const existing = app?.accounts ?? []
      const base = existing.length ? existing.map((a) => ({ ...a, on: true })) : suggest(d)
      setDrafts(base)
    })
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => setUi({ modal: null })
  const hasCodex = drafts.some((d) => d.on && d.agent === 'codex')

  const saveAgents = async () => {
    try {
      const accounts = drafts.filter((d) => d.on).map(({ on: _on, ...a }) => a)
      await window.gt.request({ t: 'accounts.save', accounts })
      setMsg(null)
      setStep('hooks')
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }
  const installHooks = async () => {
    try {
      await window.gt.request({ t: 'hooks.install' })
      setMsg({ ok: true, text: 'Hooks instalados ✓' })
    } catch (e) {
      setMsg({ ok: false, text: `Não consegui instalar: ${errorMessage(e)}` })
    }
  }

  return (
    <ModalFrame className="modal setup">
      <h3>Configurar agentes</h3>
      {step === 'agents' && (
        <>
          <p className="sb-dim">Escolha quais agentes abrir pelo app. O comando é digitado no seu shell; dá para mudar depois em Preferências → Agentes.</p>
          {!detected && <p className="sb-dim">Procurando claude e codex no seu shell…</p>}
          {drafts.map((d, i) => (
            <div key={d.id} className="setup-agent">
              <label className="check">
                <input type="checkbox" checked={d.on} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span style={{ color: d.color }}>{d.label}</span> <span className="sb-dim">({AGENT_LABEL[d.agent]})</span>
                {detected && !detected[d.agent] && <span className="card-note warn"> não encontrado no shell</span>}
              </label>
              <input className="text-input" value={d.command} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))} />
            </div>
          ))}
          {msg && <p className={msg.ok ? 'ok' : 'c-bad'}>{msg.text}</p>}
          <div className="modal-actions">
            <button onClick={close}>Depois</button>
            <button className="primary" disabled={!drafts.some((d) => d.on)} onClick={() => void saveAgents()}>
              Salvar e continuar
            </button>
          </div>
        </>
      )}
      {step === 'hooks' && (
        <>
          <p>Os hooks deixam o app ver quando o agente está trabalhando (🟢), precisa de você (🟡) ou terminou (🔵), e em qual worktree ele está.</p>
          <p className="sb-dim">O app acrescenta uma entrada nos arquivos de configuração do Claude/Codex, com backup, sem mexer nos seus hooks.</p>
          {msg && <p className={msg.ok ? 'ok' : 'c-bad'}>{msg.text}</p>}
          <div className="modal-actions">
            <button onClick={() => (hasCodex ? setStep('codex') : close())}>Pular</button>
            {msg?.ok ? (
              <button className="primary" onClick={() => (hasCodex ? setStep('codex') : close())}>
                {hasCodex ? 'Continuar' : 'Concluir'}
              </button>
            ) : (
              <button className="primary" onClick={() => void installHooks()}>
                Instalar hooks
              </button>
            )}
          </div>
        </>
      )}
      {step === 'codex' && (
        <>
          <p>
            <strong>Um passo no Codex (uma vez só):</strong> o Codex só roda hooks que você aprovou.
          </p>
          <ol>
            <li>Abra uma sessão Codex pelo app (⌘T).</li>
            <li>
              Digite <code>/hooks</code> e confie no hook do <strong>Gerenciador de Terminal</strong> (gt-hook).
            </li>
            <li>Pronto: os estados 🟢🟡🔵 passam a aparecer nas sessões Codex.</li>
          </ol>
          <p className="sb-dim">Se esquecer, o app mostra um lembrete quando uma sessão Codex rodar sem mandar eventos.</p>
          <div className="modal-actions">
            <button className="primary" onClick={close}>
              Concluir
            </button>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

function suggest(d: { claude: boolean; codex: boolean }): (Account & { on: boolean })[] {
  return [
    { id: 'claude', label: 'Claude', command: 'claude --dangerously-skip-permissions', color: '#d97757', agent: 'claude', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null, on: d.claude },
    { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null, on: d.codex },
  ]
}
