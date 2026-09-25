import { addProjectFlow } from '../flows'

const SHORTCUTS = [
  ['⌘T', 'nova sessão'],
  ['⌘D / ⇧⌘D', 'dividir'],
  ['⌘W', 'esconder'],
  ['⌘1…9', 'abas'],
  ['⌥⌘←→', 'foco'],
  ['⌘B', 'sidebar'],
]

/** 2m: CTA + arrastar pasta + atalhos */
export function EmptyState({ hasProjects }: { hasProjects: boolean }) {
  return (
    <div className="empty-state">
      {hasProjects ? (
        <p>Nenhum painel nesta aba. ⌘T abre uma nova sessão; ⌘D abre um terminal.</p>
      ) : (
        <>
          <p className="empty-title">Nenhum projeto adicionado</p>
          <button className="primary" onClick={() => void addProjectFlow()}>
            + Adicionar projeto
          </button>
          <p className="sb-dim">ou arraste uma pasta com git aqui</p>
        </>
      )}
      <div className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <span key={k}>
            <kbd>{k}</kbd> {v}
          </span>
        ))}
      </div>
    </div>
  )
}
