import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { revealPane } from '../actions'
import { machineChip } from '../machine-model'
import { setUi, showError, useUi } from '../store'
import { Switch } from './Switch'
import { formatEtime, gb, pressureLabel } from '../../../shared/machine-format'
import type { MachineLevel } from '../../../shared/types'

const tone = (l: MachineLevel) => (l === 'bad' ? 'u-bad' : l === 'warn' ? 'u-warn' : undefined)

/** CPU/RAM na barra de status; clique abre os consumidores (o daemon só roda ps enquanto aberto) */
export function MachineChip() {
  const v = useUi((s) => s.machine)
  const lim = useUi((s) => s.app?.settings.machine)
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    window.gt.send({ t: 'machine.watch' })
    // o daemon trata o watch como aluguel: renova enquanto o painel está aberto
    const renew = setInterval(() => window.gt.send({ t: 'machine.watch' }), 3000)
    return () => {
      clearInterval(renew)
      window.gt.send({ t: 'machine.unwatch' })
      setUi({ machineDetail: null })
    }
  }, [open])
  if (!v || !lim) return null
  const vm = machineChip(v, lim)
  return (
    <>
      <button ref={chipRef} className={`st-machine${vm.dim ? ' u-dim' : ''}`} title={vm.tooltip} onClick={() => setOpen((o) => !o)}>
        {vm.bars.map((b) => (
          <span key={b.label} className={tone(b.level)}>
            {b.label}
            <span className="m-bar" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={`m-seg${i < b.filled ? ' on' : ''}`} />
              ))}
            </span>
            {b.percent}%
          </span>
        ))}
        {vm.swap && <span className={tone(vm.swap.level)}>{vm.swap.text} ⚠</span>}
      </button>
      {open && chipRef.current && createPortal(<MachinePanel anchor={chipRef.current} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function MachinePanel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const v = useUi((s) => s.machine)!
  const detail = useUi((s) => s.machineDetail)
  const panes = useUi((s) => s.app?.panes ?? [])
  const settings = useUi((s) => s.app?.settings)
  const [showSessions, setShowSessions] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [anchor, onClose])
  const r = anchor.getBoundingClientRect()
  const style = { bottom: window.innerHeight - r.top + 6, right: Math.max(8, window.innerWidth - r.right) }
  const nameOf = (id: string) => {
    const p = panes.find((x) => x.id === id)
    return p?.name ?? (p ? `sessão ${p.seq}` : id.slice(0, 6))
  }
  return (
    <div ref={ref} className="machine-panel" style={style} role="dialog" aria-label="Uso da máquina">
      <div className="mp-title">Uso da máquina</div>
      <div>
        CPU {Math.round(v.cpu)}% · RAM {gb(v.ram.used)}/{gb(v.ram.total)} GB
      </div>
      <div className="mp-dim">
        swap {gb(v.swap.used)} GB · {pressureLabel(v.pressure)}
      </div>
      {(() => {
        const n = panes.filter((p) => p.hibernated).length
        return n > 0 ? <div className="mp-dim">💤 {n === 1 ? '1 sessão hibernada' : `${n} sessões hibernadas`}</div> : null
      })()}
      {settings && (
        <label className="mp-switch">
          <span title={`Encerra o agente de sessões paradas há ${settings.hibernate.minutes} min e retoma a conversa ao focar`}>💤 Hibernar sessões ociosas</span>
          <Switch
            checked={settings.hibernate.enabled}
            label="Hibernar sessões ociosas"
            onChange={(enabled) => window.gt.request({ t: 'settings.save', settings: { ...settings, hibernate: { ...settings.hibernate, enabled } } }).catch(showError)}
          />
        </label>
      )}
      {v.level !== 'ok' && (
        <div className={v.level === 'bad' ? 'u-bad' : 'u-warn'}>
          {v.level === 'bad' ? 'Bloqueia contratar' : 'No limite'}: {v.reasons.join(' · ')}
        </div>
      )}
      {!detail ? (
        <div className="mp-dim mp-sub">medindo processos…</div>
      ) : (
        <>
          <div className="mp-sub">Consumidores</div>
          {detail.groups.map((g) => (
            <div key={g.key}>
              <div className="mp-row">
                {g.key === 'sessoes' ? (
                  <button className="mp-link" onClick={() => setShowSessions((s) => !s)}>
                    {showSessions ? '▾' : '▸'} {g.label} ({g.count})
                  </button>
                ) : (
                  <span>{g.label}</span>
                )}
                {g.count === 0 ? (
                  <span className="mp-dim mp-span2">— desligado</span>
                ) : (
                  <>
                    <span>{gb(g.rss)} GB</span>
                    <span>{Math.round(g.cpu)}%</span>
                  </>
                )}
              </div>
              {g.key === 'sessoes' &&
                showSessions &&
                (g.paneIds ?? []).map((id) => (
                  <div key={id} className="mp-row mp-indent">
                    <button
                      className="mp-link"
                      onClick={() => {
                        revealPane(id)
                        onClose()
                      }}
                    >
                      {nameOf(id)}
                    </button>
                    <span>{gb(detail.perPane[id]?.rss ?? 0)} GB</span>
                    <span>{Math.round(detail.perPane[id]?.cpu ?? 0)}%</span>
                  </div>
                ))}
            </div>
          ))}
          <div className="mp-sub">Maiores processos</div>
          {detail.top.map((p) => (
            <div key={p.pid} className="mp-row mp-row4" title={`pid ${p.pid}`}>
              <span className="mp-name">{p.name}</span>
              <span>{Math.round(p.cpu)}%</span>
              <span>{gb(p.rss)} GB</span>
              <span className="mp-dim">{formatEtime(p.etime)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
