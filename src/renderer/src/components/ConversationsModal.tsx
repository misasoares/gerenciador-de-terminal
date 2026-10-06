import { useEffect, useMemo, useState } from 'react'
import type { ConversationInfo } from '../../../shared/types'
import { revealPane } from '../actions'
import { AGENT_LABEL } from '../agents-model'
import { filterConversations, relativeTime } from '../conversations-model'
import { openConversations, resumeConversation } from '../flows'
import { setUi, useUi } from '../store'
import { CascadeItem, useCascade } from './Cascade'
import { ModalFrame } from './ModalFrame'

type Props = { paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }

export function ConversationsModal({ paths, title, accountId, replacePaneId, projectPaths }: Props) {
  const accounts = useUi((s) => s.app?.accounts ?? [])
  const [list, setList] = useState<ConversationInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [chosen, setChosen] = useState<Record<string, string>>({})

  useEffect(() => {
    setList(null)
    window.gt
      .request<ConversationInfo[]>({ t: 'conversations.list', paths })
      .then(setList)
      .catch((e) => setError(String(e)))
  }, [paths.join('\n')])

  const shown = useMemo(() => filterConversations(list ?? [], q), [list, q])
  const cascade = useCascade(shown.length)
  const close = () => setUi({ modal: null })
  const accountFor = (c: ConversationInfo) => chosen[c.sessionId] ?? (accountId && c.accountIds.includes(accountId) ? accountId : c.accountIds[0])
  const act = (c: ConversationInfo | undefined) => {
    if (!c) return
    if (c.openPaneId) {
      close()
      revealPane(c.openPaneId)
      return
    }
    const acc = accountFor(c)
    if (acc) void resumeConversation(c, acc, replacePaneId)
  }

  return (
    <ModalFrame
      onClose={close}
      className="modal conv-modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        if (e.key === 'ArrowDown') setSel((i) => Math.min(i + 1, shown.length - 1))
        if (e.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
        if (e.key === 'Enter') act(shown[sel])
      }}
    >
      <h3>Conversas · {title}</h3>
      <input className="text-input" autoFocus placeholder="filtrar por título, mensagem ou branch" value={q} onChange={(e) => { setQ(e.target.value); setSel(0) }} />
      {error && <p className="c-bad">{error}</p>}
      {!list && !error && <p className="sb-dim">lendo conversas…</p>}
      {list && shown.length === 0 && (
        <p className="sb-dim">
          Nenhuma conversa nesta pasta.{' '}
          {projectPaths && projectPaths.length > paths.length && (
            <button className="ph-link" onClick={() => openConversations({ paths: projectPaths, title: `${title} · projeto inteiro`, accountId, replacePaneId })}>
              ver o projeto inteiro
            </button>
          )}
        </p>
      )}
      <div className="conv-list">
        {shown.map((c, i) => {
          const acc = accountFor(c)
          return (
            <CascadeItem i={i} on={cascade} key={`${c.agent}:${c.sessionId}`} className={`conv-row${i === sel ? ' selected' : ''}`} onMouseEnter={() => setSel(i)} onDoubleClick={() => act(c)}>
              <span className="conv-agent">{AGENT_LABEL[c.agent]}</span>
              <span className="conv-title" title={c.title}>{c.title}</span>
              <span className="conv-meta">
                {paths.length > 1 && <>{c.cwd.split('/').pop()} · </>}
                {c.branch && <>⎇ {c.branch} · </>}
                {relativeTime(c.lastActivity, Date.now())} · {c.messages} msg
              </span>
              {c.accountIds.length > 1 ? (
                <select value={acc} onChange={(e) => setChosen({ ...chosen, [c.sessionId]: e.target.value })} onClick={(e) => e.stopPropagation()}>
                  {c.accountIds.map((id) => (
                    <option key={id} value={id}>{accounts.find((a) => a.id === id)?.label ?? id}</option>
                  ))}
                </select>
              ) : (
                <span className="conv-account">{acc ? (accounts.find((a) => a.id === acc)?.label ?? acc) : <span title="cadastre o agente na aba Agentes">conta não configurada</span>}</span>
              )}
              <button className="primary" disabled={!c.openPaneId && !acc} onClick={() => act(c)}>
                {c.openPaneId ? 'Focar' : 'Retomar'}
              </button>
            </CascadeItem>
          )
        })}
      </div>
    </ModalFrame>
  )
}
