import { getUi, subscribeUi } from './store'

/** foco desta janela para o daemon: só quando muda; janela sem foco conta como nenhum painel */
export class FocusReporter {
  private last: string | null | undefined = undefined

  constructor(private send: (paneId: string | null) => void) {}

  report(paneId: string | null, windowFocused: boolean): void {
    const target = windowFocused ? paneId : null
    if (target === this.last) return
    this.last = target
    this.send(target)
  }

  /** conexão nova com o daemon: o próximo report sempre vai */
  reset(): void {
    this.last = undefined
  }
}

/** o daemon não hiberna o painel em foco e acorda o hibernado quando ele ganha foco */
export function startFocusSync(): void {
  const reporter = new FocusReporter((paneId) => window.gt.send({ t: 'pane.focus', paneId }))
  let connected = getUi().connected
  const push = () => reporter.report(getUi().focusedPaneId, document.hasFocus())
  subscribeUi(() => {
    const now = getUi().connected
    if (now && !connected) reporter.reset()
    connected = now
    push()
  })
  window.addEventListener('focus', push)
  window.addEventListener('blur', push)
  push()
}
