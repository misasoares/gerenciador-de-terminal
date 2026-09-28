import { useMemo, useState } from 'react'
import { hooksBanner } from '../agents-model'
import { errorMessage } from '../api'
import { useUi } from '../store'

/** enquanto faltar hook, não dá para fechar; depois de instalar, confirma e some */
export function HooksBanner() {
  const warnings = useUi((s) => s.app?.hookWarnings)
  const panes = useUi((s) => s.app?.panes)
  const kind = useMemo(() => hooksBanner(warnings, panes ?? []), [warnings, panes])
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const install = async () => {
    try {
      await window.gt.request({ t: 'hooks.install' })
      setResult({ ok: true, text: 'Hooks instalados ✓ — reinicie as sessões do Claude abertas (/exit e claude-… --continue).' })
      setTimeout(() => setResult(null), 12_000)
    } catch (e) {
      setResult({ ok: false, text: `Não consegui instalar: ${errorMessage(e)}` })
    }
  }

  if (result?.ok) return <div className="hooks-banner ok">{result.text}</div>
  if (kind === 'codex-trust') {
    return (
      <div className="hooks-banner">
        <strong>O Codex não está mandando eventos.</strong> Abra o Codex, digite <code>/hooks</code> e confie no hook do Gerenciador de Terminal (gt-hook).
      </div>
    )
  }
  if (kind !== 'install' || !warnings) return null
  return (
    <div className="hooks-banner">
      <strong>Os hooks dos agentes não estão instalados.</strong> Sem eles o app não mostra 🟢🟡🔵 nem percebe a troca de worktree.
      <span className="sb-dim"> ({warnings.join(', ')})</span>
      <button className="primary" onClick={() => void install()}>
        Instalar hooks
      </button>
      {result && !result.ok && <span className="hooks-error">{result.text}</span>}
    </div>
  )
}
