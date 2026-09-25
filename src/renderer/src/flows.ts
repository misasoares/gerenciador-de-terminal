import type { RemoveCheck } from '../../shared/types'
import { closeDeadPane, moveToTab, openNewPane, openNewSessionDialog, requestKill, revealPane, togglePane } from './actions'
import type { ProjectItem, SessionItem, WorktreeItem } from './sidebar-model'
import { getUi, setUi, showError } from './store'

export async function addProjectFlow(dir?: string): Promise<void> {
  try {
    const path = dir ?? (await window.gt.pickFolder())
    if (!path) return
    await window.gt.request({ t: 'project.add', path })
  } catch (e) {
    showError(e)
  }
}

/** abre o modal certo: bloqueado (sessão aberta) ou confirmação (com ou sem pendências) */
export async function removeWorktreeFlow(path: string): Promise<void> {
  try {
    const check = await window.gt.request<RemoveCheck>({ t: 'worktree.checkRemove', path })
    if (check.isMain) return showError(new Error('A worktree principal não pode ser removida.'))
    setUi({ modal: { kind: check.hasOpenSession ? 'blocked' : 'remove', check } })
  } catch (e) {
    showError(e)
  }
}

export async function confirmRemove(check: RemoveCheck, deleteBranch: boolean): Promise<void> {
  const risky = check.dirtyFiles.length > 0 || check.unpushedCommits.length > 0
  setUi({ modal: null })
  try {
    await window.gt.request({ t: 'worktree.remove', path: check.path, force: risky, deleteBranch })
  } catch (e) {
    showError(e)
  }
}

export async function worktreeMenu(p: ProjectItem, w: WorktreeItem): Promise<void> {
  const choice = await window.gt.contextMenu([
    { id: 'new', label: 'Nova sessão…  ⌘T' },
    { id: 'shell', label: 'Terminal comum' },
    { id: 'finder', label: 'Abrir no Finder' },
    { id: '-', label: '' },
    { id: 'remove', label: 'Remover worktree…', enabled: !w.isMain },
  ])
  if (choice === 'new') openNewSessionDialog(p.path, w.path)
  else if (choice === 'shell') openNewPane({ cwd: w.path, accountId: null }).catch(showError)
  else if (choice === 'finder') void window.gt.openPath(w.path)
  else if (choice === 'remove') await removeWorktreeFlow(w.path)
}

export async function projectMenu(p: ProjectItem): Promise<void> {
  const accounts = getUi().app?.accounts ?? []
  const mark = (on: boolean) => (on ? '✓ ' : '    ')
  const choice = await window.gt.contextMenu([
    ...accounts.map((a) => ({ id: `acct:${a.id}`, label: `${mark(p.defaultAccountId === a.id)}Conta padrão: ${a.label}` })),
    { id: 'acct:', label: `${mark(p.defaultAccountId === null)}Sem conta padrão` },
    { id: '-', label: '' },
    { id: 'remove', label: 'Remover projeto da lista' },
  ])
  if (!choice) return
  try {
    if (choice.startsWith('acct:')) {
      await window.gt.request({ t: 'project.setAccount', path: p.path, accountId: choice.slice(5) || null })
    } else if (choice === 'remove') {
      const r = await window.gt.confirm({ message: `Remover ${p.name} da lista?`, detail: 'Nada é apagado do disco; as sessões abertas continuam.', confirmLabel: 'Remover' })
      if (r.ok) await window.gt.request({ t: 'project.remove', path: p.path })
    }
  } catch (e) {
    showError(e)
  }
}

export async function sessionMenu(s: SessionItem): Promise<void> {
  const tabs = getUi().app?.layout.tabs ?? []
  const choice = await window.gt.contextMenu(
    s.alive
      ? [
          { id: 'focus', label: 'Focar painel' },
          { id: 'toggle', label: s.hidden ? 'Mostrar' : 'Esconder  ⌘W' },
          { id: '-', label: '' },
          ...tabs.map((t, i) => ({ id: `tab:${t.id}`, label: `Mover para aba ${i + 1} · ${t.name}`, enabled: s.tab !== i + 1 })),
          { id: '-', label: '' },
          { id: 'kill', label: 'Encerrar sessão…' },
        ]
      : [{ id: 'forget', label: 'Remover da lista' }],
  )
  if (choice === 'focus') revealPane(s.paneId)
  else if (choice === 'toggle') togglePane(s.paneId)
  else if (choice === 'forget') closeDeadPane(s.paneId)
  else if (choice === 'kill') requestKill(s.paneId)
  else if (choice?.startsWith('tab:')) moveToTab(s.paneId, choice.slice(4))
}

export async function resumeAll(): Promise<void> {
  for (const r of getUi().app?.resumable ?? []) {
    try {
      await openNewPane({ paneId: r.paneId, cwd: r.cwd, accountId: r.accountId, resumeSessionId: r.sessionId ?? undefined })
    } catch (e) {
      showError(e)
    }
  }
}

export async function restartDaemonFlow(): Promise<void> {
  const working = (getUi().app?.panes ?? []).filter((p) => p.claude?.status === 'working').length
  const r = await window.gt.confirm({
    message: 'Reiniciar o daemon?',
    detail: `Todas as sessões serão finalizadas e poderão ser retomadas em seguida.${working ? `\n\n${working} sessão(ões) 🟢 ainda estão trabalhando.` : ''}`,
    confirmLabel: 'Reiniciar',
  })
  if (!r.ok) return
  setUi({ versionMismatch: null })
  await window.gt.restartDaemon()
}
