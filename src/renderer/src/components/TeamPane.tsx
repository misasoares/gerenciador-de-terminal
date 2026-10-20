import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { TeamFeedView } from '../../../shared/types'
import { dropOnPane, floatPane, focusPane, hidePaneAnimated, PANE_MIME, revealPane } from '../actions'
import { errorMessage } from '../api'
import { dropZone, type DropZone } from '../layout'
import { useUi } from '../store'
import { onTeamChanged } from '../team-events'
import { deliveryMark, feedLine, leaderOfTeamPane, parseGroupInput } from '../team-model'
import { FloatControls } from './FloatControls'
import { STATUS_DOT } from './PaneHeader'

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** grupo da equipe: toda a conversa de um líder e dos devs dele, e uma caixa para você escrever com @nome */
export function TeamPane({ paneId, floating }: { paneId: string; floating?: boolean }) {
  const leaderId = leaderOfTeamPane(paneId)
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const [feed, setFeed] = useState<TeamFeedView | null>(null)
  const [text, setText] = useState('')
  const [interrupt, setInterrupt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  /** a lista estava no fim antes do item novo: continua grudada nele */
  const atBottom = useRef(true)
  const [zone, setZone] = useState<DropZone | null>(null)
  const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect()
    return dropZone((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  useEffect(() => {
    let alive = true
    const load = () => {
      window.gt
        .request<TeamFeedView>({ t: 'team.feed', leaderId })
        .then((f) => alive && setFeed(f))
        .catch((e) => alive && setError(errorMessage(e)))
    }
    load()
    const off = onTeamChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [leaderId])

  const count = feed?.items.length ?? 0
  useEffect(() => {
    const el = list.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [count])

  const members = feed?.members ?? []
  // "@" no fim do que foi digitado (sem espaço depois): mostra os membros para escolher
  const mention = /(^|\s)@([^\s@]*)$/.exec(text)
  const suggestions = mention ? members.filter((m) => m.name.toLowerCase().startsWith(mention[2].toLowerCase())) : []

  const send = async () => {
    if (!feed?.active || sending) return
    const p = parseGroupInput(text, members.map((m) => m.name))
    setSending(true)
    try {
      await window.gt.request({ t: 'team.say', leaderId, to: p.to, text: p.text, interrupt: p.interrupt || interrupt })
      setText('')
      setInterrupt(false)
      setError(null)
      atBottom.current = true
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  const pick = (name: string) => {
    if (!mention) return
    setText(text.slice(0, text.length - mention[2].length) + name + ' ')
  }

  return (
    <div
      className={`pane team-pane${focused ? ' focused' : ''}`}
      onMouseDown={() => focusPane(paneId)}
      onDragOver={(e) => {
        if (floating || !e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        setZone(zoneAt(e))
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData(PANE_MIME)
        setZone(null)
        if (floating || !dragged || dragged === paneId) return
        e.preventDefault()
        dropOnPane(dragged, paneId, zoneAt(e))
      }}
    >
      {zone && <div className={`drop-zone drop-${zone}`} />}
      <div
        className={`pane-header file-header${floating ? ' float-drag' : ''}`}
        draggable={!floating}
        onDragStart={(e) => !floating && e.dataTransfer.setData(PANE_MIME, paneId)}
      >
        <span className="file-name">👥 Equipe de {feed?.leaderName ?? '…'}</span>
        <span className="team-chips">
          {members.map((m) => (
            <button key={m.id} className="team-chip" title={`${m.cli}${m.leader ? ' · líder' : ''}`} onClick={() => revealPane(m.id)}>
              {m.status && <span>{STATUS_DOT[m.status]}</span>}
              {m.leader && '👑'}
              {m.name}
            </button>
          ))}
        </span>
        <span className="ph-spacer" />
        {floating ? (
          <FloatControls paneId={paneId} />
        ) : (
          <>
            <button className="ph-close" title="Flutuar · ⇧⌘F" onClick={() => floatPane(paneId)}>
              ⧉
            </button>
            <button className="ph-close" title="Fechar o grupo" onClick={() => void hidePaneAnimated(paneId)}>
              ✕
            </button>
          </>
        )}
      </div>
      {feed && !feed.active && <div className="file-banner">Esta equipe não está mais ativa.</div>}
      <div
        className="team-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {feed?.items.length === 0 && <div className="team-empty">Nada por aqui ainda. O que a equipe conversar aparece neste grupo.</div>}
        {feed?.items.map((item) => {
          const line = feedLine(item, feed.leaderName)
          if (item.kind === 'event') {
            return (
              <div key={item.id} className={`team-event${item.open ? ' open' : ''}`}>
                <span>
                  {line.icon} {line.text} · {hhmm(item.at)}
                </span>
                {item.open && item.paneId && (
                  <button className="st-btn" onClick={() => revealPane(item.paneId!)}>
                    Ir para o terminal
                  </button>
                )}
              </div>
            )
          }
          return (
            <div key={item.id} className={`team-msg${item.byUser ? ' mine' : ''}`}>
              <div className="team-msg-head">
                {line.icon && `${line.icon} `}
                {line.text}
              </div>
              <div className="team-msg-body">{item.body}</div>
              <div className={`team-msg-foot${item.state === 'falhou' ? ' failed' : ''}`}>
                {deliveryMark(item)} · {hhmm(item.at)}
              </div>
            </div>
          )
        })}
      </div>
      {error && <div className="file-banner error">{error}</div>}
      <div className="team-compose">
        {suggestions.length > 0 && (
          <div className="team-mentions">
            {suggestions.map((m) => (
              <button key={m.id} className="team-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.name)}>
                @{m.name}
              </button>
            ))}
          </div>
        )}
        <button
          className={`st-btn team-bolt${interrupt ? ' on' : ''}`}
          title="Interromper: o dev para o que está fazendo e recebe a mensagem"
          disabled={!feed?.active}
          onClick={() => setInterrupt((v) => !v)}
        >
          ⚡
        </button>
        <textarea
          rows={2}
          value={text}
          disabled={!feed?.active}
          placeholder={feed?.active === false ? '' : 'Mensagem para o líder, ou @nome para um dev (Enter manda, Shift+Enter quebra a linha)'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
      </div>
    </div>
  )
}
