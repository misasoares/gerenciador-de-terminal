import fs from 'node:fs'
import path from 'node:path'

export const HOOK_EVENTS = [
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

export const HOOK_MARKER = 'gt-hook'

export const GT_HOOK_SCRIPT = `#!/bin/sh
# gerenciador-terminal: repassa o evento do Claude Code ao daemon do app.
# Fora do app (sem GT_PANE_ID) ou sem daemon, sai sem fazer nada.
if [ -z "$GT_PANE_ID" ] || [ ! -S "$GT_SOCKET" ]; then
  cat >/dev/null
  exit 0
fi
cfg=$(printf '%s' "\${CLAUDE_CONFIG_DIR:-}" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
{
  printf '{"id":0,"req":{"t":"hook","paneId":"%s","configDir":"%s","payload":' "$GT_PANE_ID" "$cfg"
  tr -d '\\n\\r'
  printf '}}\\n'
} | nc -U -w 1 "$GT_SOCKET" >/dev/null 2>&1
exit 0
`

/** tolera o script ausente (app desinstalado, GT_HOME temporário apagado): sai 0 sem quebrar o Claude */
export function hookCommand(scriptPath: string): string {
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

export function mergeHooks(settings: Record<string, unknown>, command: string): Record<string, unknown> {
  const hooks = { ...((settings.hooks as Record<string, HookGroup[]> | undefined) ?? {}) }
  for (const ev of HOOK_EVENTS) {
    const groups = (hooks[ev] ?? []).filter((g) => !isOurs(g))
    groups.push({ hooks: [{ type: 'command', command, timeout: 5 } as HookHandler] })
    hooks[ev] = groups
  }
  return { ...settings, hooks }
}

export function hasHooks(settings: unknown, command: string): boolean {
  const hooks = ((settings as { hooks?: Record<string, HookGroup[]> } | null)?.hooks ?? {}) as Record<string, HookGroup[]>
  return HOOK_EVENTS.every((ev) => (hooks[ev] ?? []).some((g) => g.hooks?.some((h) => h.command === command)))
}

export function installHooks(settingsPath: string, command: string): { backup: string | null } {
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
  const next = mergeHooks(current, command)
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
  const seen = new Set<string>()
  const missing: string[] = []
  for (const f of settingsFiles(userHome)) {
    let real = f
    try {
      real = fs.realpathSync(f)
    } catch {
      // ainda não existe
    }
    if (seen.has(real)) continue
    seen.add(real)
    let ok = false
    try {
      ok = hasHooks(JSON.parse(fs.readFileSync(real, 'utf8')), command)
    } catch {
      ok = false
    }
    if (!ok) missing.push(f)
  }
  return missing
}
