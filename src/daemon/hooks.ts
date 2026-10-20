import type { AgentKind } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'

export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'StopFailure',
  'CwdChanged',
  'SessionEnd',
] as const

export const HOOK_EVENTS = CLAUDE_HOOK_EVENTS

export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'] as const

export const HOOK_MARKER = 'gt-hook'

export const GT_HOOK_SCRIPT = `#!/bin/sh
# gerenciador-terminal: repassa o evento do agente (Claude Code ou Codex) ao daemon do app.
# Uso: gt-hook [claude|codex]. Fora do app (sem GT_PANE_ID) ou sem daemon, não faz nada.
# $PPID é a CLI (o hookCommand faz exec): o daemon confere se ela está mesmo no painel do GT_PANE_ID.
# O Codex exige JSON no stdout do Stop: para ele, sempre responde {}.
agent="\${1:-claude}"
done_() { [ "$agent" = codex ] && printf '{}'; exit 0; }
if [ -z "$GT_PANE_ID" ] || [ ! -S "$GT_SOCKET" ]; then
  cat >/dev/null
  done_
fi
if [ "$agent" = codex ]; then dir="\${CODEX_HOME:-}"; else dir="\${CLAUDE_CONFIG_DIR:-}"; fi
cfg=$(printf '%s' "$dir" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
{
  printf '{"id":0,"req":{"t":"hook","paneId":"%s","configDir":"%s","agent":"%s","pid":%s,"payload":' "$GT_PANE_ID" "$cfg" "$agent" "$PPID"
  tr -d '\\n\\r'
  printf '}}\\n'
} | nc -U -w 1 "$GT_SOCKET" >/dev/null 2>&1
done_
`

/** tolera o script ausente (app desinstalado, GT_HOME temporário apagado): sai 0 sem quebrar o Claude */
export function hookCommand(scriptPath: string, agent: AgentKind = 'claude'): string {
  if (agent === 'codex') return `sh -c '[ -x "$0" ] && exec "$0" codex; cat >/dev/null; printf "{}"' "${scriptPath}"`
  return `sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "${scriptPath}"`
}

export function writeHookScript(scriptPath: string): void {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
  fs.writeFileSync(scriptPath, GT_HOOK_SCRIPT, { mode: 0o755 })
  fs.chmodSync(scriptPath, 0o755)
}

interface HookHandler {
  type?: string
  command?: string
}
interface HookGroup {
  matcher?: string
  hooks?: HookHandler[]
}

const isOurs = (g: HookGroup): boolean =>
  Array.isArray(g.hooks) && g.hooks.length > 0 && g.hooks.every((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER))

export function mergeHooks(settings: Record<string, unknown>, command: string, events: readonly string[] = CLAUDE_HOOK_EVENTS): Record<string, unknown> {
  const hooks = { ...((settings.hooks as Record<string, HookGroup[]> | undefined) ?? {}) }
  for (const ev of events) {
    const groups = (hooks[ev] ?? []).filter((g) => !isOurs(g))
    groups.push({ hooks: [{ type: 'command', command, timeout: 5 } as HookHandler] })
    hooks[ev] = groups
  }
  return { ...settings, hooks }
}

export function hasHooks(settings: unknown, command: string, events: readonly string[] = CLAUDE_HOOK_EVENTS): boolean {
  const hooks = ((settings as { hooks?: Record<string, HookGroup[]> } | null)?.hooks ?? {}) as Record<string, HookGroup[]>
  return events.every((ev) => (hooks[ev] ?? []).some((g) => g.hooks?.some((h) => h.command === command)))
}

export function installHooks(settingsPath: string, command: string, events: readonly string[] = CLAUDE_HOOK_EVENTS): { backup: string | null } {
  // escreve no alvo real: trocar o symlink por arquivo desligaria os perfis do cswap
  const real = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath
  let current: Record<string, unknown> = {}
  let backup: string | null = null
  if (fs.existsSync(real)) {
    const raw = fs.readFileSync(real, 'utf8')
    try {
      current = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      throw new Error(`${settingsPath} não é um JSON válido; corrija o arquivo antes de instalar os hooks`)
    }
    backup = `${real}.bak-gt-${Date.now()}`
    fs.copyFileSync(real, backup)
  } else {
    fs.mkdirSync(path.dirname(real), { recursive: true })
  }
  const next = mergeHooks(current, command, events)
  const tmp = `${real}.tmp-gt-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, real)
  return { backup }
}

export function settingsFiles(userHome: string): string[] {
  const files = [path.join(userHome, '.claude', 'settings.json')]
  const sessions = path.join(userHome, '.claude-swap-backup', 'sessions')
  try {
    for (const d of fs.readdirSync(sessions, { withFileTypes: true })) {
      if (d.isDirectory()) files.push(path.join(sessions, d.name, 'settings.json'))
    }
  } catch {
    // sem cswap
  }
  return files
}

export function checkProfiles(userHome: string, command: string): string[] {
  return checkTargets(hookTargets(userHome, new Set<AgentKind>(['claude'])), () => command)
}

export function codexHooksFile(userHome: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CODEX_HOME || path.join(userHome, '.codex'), 'hooks.json')
}

export interface HookTarget {
  file: string
  agent: AgentKind
}

export function hookTargets(userHome: string, agents: Set<AgentKind>, env: NodeJS.ProcessEnv = process.env): HookTarget[] {
  const out: HookTarget[] = []
  if (agents.has('claude')) for (const f of settingsFiles(userHome)) out.push({ file: f, agent: 'claude' })
  if (agents.has('codex')) out.push({ file: codexHooksFile(userHome, env), agent: 'codex' })
  return out
}

/** arquivos (reais, sem duplicar symlinks) que ainda não têm o hook do app */
export function checkTargets(targets: HookTarget[], commandFor: (a: AgentKind) => string): string[] {
  const seen = new Set<string>()
  const missing: string[] = []
  for (const t of targets) {
    let real = t.file
    try {
      real = fs.realpathSync(t.file)
    } catch {
      // ainda não existe
    }
    if (seen.has(real)) continue
    seen.add(real)
    const events = t.agent === 'codex' ? CODEX_HOOK_EVENTS : CLAUDE_HOOK_EVENTS
    let ok = false
    try {
      ok = hasHooks(JSON.parse(fs.readFileSync(real, 'utf8')), commandFor(t.agent), events)
    } catch {
      ok = false
    }
    if (!ok) missing.push(t.file)
  }
  return missing
}
