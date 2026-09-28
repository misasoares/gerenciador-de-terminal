import { useState } from 'react'
import type { Account, AgentKind } from '../../../shared/types'
import { SESSION_COLORS } from '../../../shared/settings'
import { errorMessage } from '../api'
import { AGENT_LABEL, newAgentDraft } from '../agents-model'
import { setUi, useUi } from '../store'

export function AgentsPanel() {
  const saved = useUi((s) => s.app?.accounts ?? [])
  const [list, setList] = useState<Account[]>(saved.map((a) => ({ ...a, configDirMatch: [...a.configDirMatch] })))
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (i: number, patch: Partial<Account>) => setList(list.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setList(next)
  }
  const save = async () => {
    try {
      await window.gt.request({ t: 'accounts.save', accounts: list })
      setMsg({ ok: true, text: 'Agentes salvos ✓' })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }
  const reinstall = async () => {
    try {
      await window.gt.request({ t: 'hooks.install' })
      setMsg({ ok: true, text: 'Hooks instalados ✓' })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }
  const add = (agent: AgentKind) => setList([...list, newAgentDraft(list, agent)])

  return (
    <div className="agents-panel">
      {list.map((a, i) => (
        <div key={i} className="agent-row">
          <div className="agent-line">
            <select value={a.color} onChange={(e) => set(i, { color: e.target.value })} style={{ color: a.color }} title="Cor">
              {[a.color, ...SESSION_COLORS.map((c) => c.hex).filter((h) => h !== a.color)].map((h) => (
                <option key={h} value={h} style={{ color: h }}>
                  ■ {SESSION_COLORS.find((c) => c.hex === h)?.label ?? h}
                </option>
              ))}
            </select>
            <input className="text-input" value={a.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Nome" />
            <select value={a.agent} onChange={(e) => set(i, { agent: e.target.value as AgentKind })}>
              <option value="claude">{AGENT_LABEL.claude}</option>
              <option value="codex">{AGENT_LABEL.codex}</option>
            </select>
            <button onClick={() => move(i, -1)} title="Subir">↑</button>
            <button onClick={() => move(i, 1)} title="Descer">↓</button>
            <button onClick={() => setList(list.filter((_, j) => j !== i))} title="Remover">✕</button>
          </div>
          <input className="text-input mono" value={a.command} onChange={(e) => set(i, { command: e.target.value })} placeholder="comando digitado no shell" />
          <label className="check">
            <input type="checkbox" checked={a.planUsage !== false} onChange={(e) => set(i, { planUsage: e.target.checked })} /> usa o plano (mostrar uso)
          </label>
          <button className="sb-mini" onClick={() => setOpen(open === a.id ? null : a.id)}>
            {open === a.id ? '▾' : '▸'} identificação avançada
          </button>
          {open === a.id && (
            <div className="agent-adv">
              <label>
                pasta de config contém ({a.agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'}), separado por vírgula
                <input className="text-input mono" value={a.configDirMatch.join(', ')} onChange={(e) => set(i, { configDirMatch: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              </label>
              <label>
                --settings contém (desempate)
                <input className="text-input mono" value={a.settingsMatch ?? ''} onChange={(e) => set(i, { settingsMatch: e.target.value.trim() || null })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={a.isDefault} onChange={(e) => set(i, { isDefault: e.target.checked })} /> padrão quando a pasta de config não está definida
              </label>
            </div>
          )}
        </div>
      ))}
      <div className="agent-actions">
        <button onClick={() => add('claude')}>+ Claude</button>
        <button onClick={() => add('codex')}>+ Codex</button>
        <span className="ph-spacer" />
        <button onClick={() => void reinstall()}>Reinstalar hooks</button>
        <button onClick={() => setUi({ modal: { kind: 'setup' } })}>Abrir assistente</button>
        <button className="primary" onClick={() => void save()}>
          Salvar agentes
        </button>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'c-bad'}>{msg.text}</p>}
    </div>
  )
}
