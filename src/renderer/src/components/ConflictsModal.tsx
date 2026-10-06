import { useEffect, useState } from 'react'
import { worktreeLabel } from '../header'
import { setUi, showError, useUi } from '../store'
import { ModalFrame } from './ModalFrame'

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `há ${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`
}

export function ConflictsModal({ projectPath }: { projectPath: string }) {
  const project = useUi((s) => s.app?.projects.find((p) => p.path === projectPath))
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  if (!project) return null
  const rep = project.conflicts
  const label = (p: string) => {
    const w = project.worktrees.find((x) => x.path === p)
    return w ? worktreeLabel(w) : (p.split('/').pop() ?? p)
  }
  const close = () => setUi({ modal: null })
  const rerun = () => window.gt.request({ t: 'conflicts.analyze', projectPath }).catch(showError)

  return (
    <ModalFrame onClose={close} className="modal conflicts" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="conflicts-head">
        <h3>Conflitos · {project.name.toUpperCase()}</h3>
        <span className="sb-dim">{rep?.running ? 'analisando…' : rep ? `analisado ${ago(rep.analyzedAt, now)} · ${rep.comparisons} comparações` : ''}</span>
        <button onClick={() => void rerun()} disabled={rep?.running} title="Analisar de novo">
          ↻
        </button>
      </div>
      {!rep || (rep.running && rep.analyzedAt === 0) ? (
        <p className="sb-dim">Analisando as worktrees…</p>
      ) : (
        <>
          <div className="field-label">CONTRA A MAIN</div>
          <div className="conflicts-main">
            {rep.vsMain.map((v) => (
              <div key={v.worktreePath} className={v.files.length ? 'c-bad' : 'c-ok'}>
                {v.files.length ? '⚠' : '✓'} {label(v.worktreePath)}
                {v.files.length > 0 && <span className="c-files">: {v.files.join(', ')}</span>}
                {v.dirty && v.files.length > 0 && <span className="c-dirty">inclui alterações não commitadas</span>}
              </div>
            ))}
          </div>
          <div className="field-label">ENTRE WORKTREES</div>
          {rep.pairs.length === 0 ? (
            <p className="ok">✓ Nenhum par em conflito</p>
          ) : (
            rep.pairs.map((p) => (
              <div key={`${p.a}|${p.b}`} className="c-pair">
                <div className="c-bad">
                  ⚠ {label(p.a)} ↔ {label(p.b)}
                  {p.dirty && <span className="c-dirty">inclui alterações não commitadas</span>}
                </div>
                <div className="c-files">{p.files.join(', ')}</div>
                <div className="sb-dim">
                  Se mergear {label(p.a)} primeiro, {label(p.b)} vai conflitar (e vice-versa).
                </div>
              </div>
            ))
          )}
          <p className="sb-dim">Sem conflito: {rep.cleanPairs} {rep.cleanPairs === 1 ? 'par' : 'pares'}</p>
          {rep.errors.map((e) => (
            <p key={e.worktreePath} className="c-bad">
              não analisada: {label(e.worktreePath)} — {e.message}
            </p>
          ))}
        </>
      )}
      <div className="modal-actions">
        <button className="primary" autoFocus onClick={close}>
          Fechar
        </button>
      </div>
    </ModalFrame>
  )
}
