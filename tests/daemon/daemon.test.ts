import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Daemon, type DaemonOptions } from '../../src/daemon/daemon'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { hirePreamble } from '../../src/daemon/hire'
import { leaderBriefing } from '../../src/daemon/team/briefing'
import { buildPaneEnv } from '../../src/daemon/panes'
import { DEFAULT_SETTINGS, type TerminalSettings } from '../../src/shared/settings'
import { connectApp } from '../helpers/app-client'
import { RpcClient } from '../../src/shared/rpc-client'
import { makeRepo, type TestRepo } from '../helpers/repo'
import { runWithInput } from '../helpers/run'
import { projectDirName } from '../../src/daemon/conversations/files'
import type { ConversationInfo } from '../../src/shared/types'
import { waitFor } from '../helpers/wait'

let daemons: Daemon[] = []
let repo: TestRepo | null = null

afterEach(async () => {
  for (const d of daemons) await d.stop(true)
  daemons = []
  repo?.cleanup()
  repo = null
})

function opts(home: string, extra: Partial<DaemonOptions> = {}): DaemonOptions {
  const userHome = path.join(home, 'user')
  fs.mkdirSync(userHome, { recursive: true })
  return {
    home,
    socketPath: path.join(home, 'd.sock'),
    stateFile: path.join(home, 'state.json'),
    hookScriptPath: path.join(home, 'bin', 'gt-hook'),
    userHome,
    shell: '/bin/sh',
    shellArgs: [],
    env: { PATH: process.env.PATH, HOME: userHome, ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/x', GT_PANE_ID: 'herdado' },
    pollMs: 60_000,
    gitPollMs: 500,
    fetchIntervalMs: 3_600_000,
    conflictsDebounceMs: 5000,
    ...extra,
  }
}

async function boot(extra: Partial<DaemonOptions> = {}, home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))) {
  const o = opts(home, extra)
  const d = await Daemon.start(o)
  daemons.push(d)
  const app = await connectApp(o.socketPath)
  // instalação nova começa sem agentes; os testes usam as contas de exemplo (misa, mslabs, weboption…)
  if (d && (await app.client.request<{ accounts: unknown[] }>({ t: 'state.get' })).accounts.length === 0) {
    await app.client.request({ t: 'accounts.save', accounts: DEFAULT_ACCOUNTS })
  }
  return { o, d, app, home }
}

/** a hibernação vem desligada por padrão */
async function enableHibernate(app: Awaited<ReturnType<typeof connectApp>>) {
  const { settings } = await app.client.request<{ settings: TerminalSettings }>({ t: 'state.get' })
  await app.client.request({ t: 'settings.save', settings: { ...settings, hibernate: { ...settings.hibernate, enabled: true } } })
}

function hook(o: DaemonOptions, paneId: string, payload: Record<string, unknown>, configDir?: string) {
  return runWithInput('/bin/sh', [o.hookScriptPath], JSON.stringify(payload), {
    PATH: '/usr/bin:/bin', GT_PANE_ID: paneId, GT_SOCKET: o.socketPath, ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
  })
}

function fakeClaudeConv(o: DaemonOptions, cwd: string, id: string, text = 'oi'): string {
  const f = path.join(o.userHome, '.claude', 'projects', projectDirName(cwd), `${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ type: 'user', message: { role: 'user', content: text }, cwd, timestamp: 't' }) + '\n')
  return f
}

function fakeCodexConv(o: DaemonOptions, cwd: string, id: string): string {
  const f = path.join(o.userHome, '.codex', 'sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const meta = { type: 'session_meta', payload: { id, cwd } }
  const msg = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'oi' }] } }
  fs.writeFileSync(f, JSON.stringify(meta) + '\n' + JSON.stringify(msg) + '\n')
  return f
}

/** `claude` falso no PATH: imprime os argumentos e espera; sai com SIGTERM */
function fakeAgentEnv(home: string): Record<string, string> {
  const bin = path.join(home, 'fakebin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'claude'), "#!/bin/sh\necho \"fake-claude $*\"\ntrap 'exit 143' TERM\nwhile :; do sleep 0.2; done\n", { mode: 0o755 })
  return { PATH: `${bin}:${process.env.PATH}`, HOME: path.join(home, 'user') }
}

/** agentes falsos de verdade no painel (claude-mslabs e codex): a entrega só digita com a CLI na frente do shell */
function fakeTeamEnv(): Record<string, string> {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-f-')))
  const env = fakeAgentEnv(home)
  const bin = path.join(home, 'fakebin')
  // lê a entrada em modo raw, como uma CLI de verdade, e ecoa: no modo canônico do tty a colagem longa se perde
  const reader = '#!/bin/sh\nstty raw -echo 2>/dev/null\nwhile :; do cat || sleep 0.2; done\n'
  const team = path.join(home, 'teambin')
  fs.mkdirSync(team)
  fs.writeFileSync(path.join(team, 'claude'), reader, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'claude-mslabs'), `#!/bin/sh\nexec "${path.join(team, 'claude')}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'codex'), reader, { mode: 0o755 })
  return env
}

async function leaderIn(repoDir: string, extra: Partial<DaemonOptions> = {}) {
  const b = await boot(extra)
  await b.app.client.request({ t: 'project.add', path: repoDir })
  const { paneId } = await b.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repoDir, accountId: 'mslabs', cols: 80, rows: 24 })
  await b.app.waitState((s) => s.panes.find((p) => p.id === paneId)?.projectPath === repoDir)
  await b.app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'Lider', root: { type: 'leaf', paneId } }], activeTabId: 't' } })
  const call = (tool: string, args: Record<string, unknown>) => b.app.client.request<Record<string, unknown>>({ t: 'mcp.call', callerPaneId: paneId, tool, args })
  return { ...b, leader: paneId, call }
}

describe('buildPaneEnv', () => {
  it('remove variáveis do daemon/Claude e garante LANG e TERM', () => {
    const env = buildPaneEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/x', CLAUDE_CODE_ENTRYPOINT: 'cli', GT_PANE_ID: 'a', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'gerenciador-terminal' })
  })
  it('respeita LANG existente', () => {
    expect(buildPaneEnv({ LANG: 'pt_BR.UTF-8' }).LANG).toBe('pt_BR.UTF-8')
  })
})

describe('Daemon', () => {
  it('adiciona projeto e publica worktrees com status git', async () => {
    repo = makeRepo()
    const { app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const st = await app.waitState((s) => s.projects[0]?.worktrees[0]?.git?.branch === 'main')
    expect(st.projects[0]).toMatchObject({ path: repo.dir, name: 'meu projeto' })
  })

  it('cria painel, anexa, recebe saída e o ambiente vem limpo', async () => {
    repo = makeRepo()
    const { app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 100, rows: 30 })
    const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId, cols: 90, rows: 20 })
    expect(typeof snapshot).toBe('string')
    app.client.send({ t: 'pane.input', paneId, data: 'echo "[$ELECTRON_RUN_AS_NODE][$CLAUDECODE][$CLAUDE_CONFIG_DIR][$GT_PANE_ID][$LANG]"\r' })
    await app.waitState(() => app.output(paneId).includes(`[][][][${paneId}][en_US.UTF-8]`))
    await app.waitState((s) => s.panes.some((p) => p.id === paneId && p.worktreePath === repo!.dir))
  })

  it('hooks: sessão, estado, título, conta e worktree nova criada pelo Claude', async () => {
    repo = makeRepo()
    const { o, app, home } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const transcript = path.join(home, 't.jsonl')
    fs.writeFileSync(transcript, JSON.stringify({ type: 'custom-title', customTitle: 'minha tarefa' }) + '\n')
    const base = { session_id: 's1', cwd: repo.dir, transcript_path: transcript }
    const mslabs = '/Users/u/.claude-swap-backup/sessions/3-misael_mslabs-dev.com'

    await hook(o, paneId, { ...base, hook_event_name: 'SessionStart', source: 'startup' }, mslabs)
    let st = await app.waitState((s) => s.panes[0]?.claude?.title === 'minha tarefa')
    expect(st.panes[0]).toMatchObject({ accountId: 'mslabs', claude: { sessionId: 's1', status: 'idle' } })

    await hook(o, paneId, { ...base, hook_event_name: 'UserPromptSubmit' }, mslabs)
    await app.waitState((s) => s.panes[0]?.claude?.status === 'working')
    await hook(o, paneId, { ...base, hook_event_name: 'PermissionRequest' }, mslabs)
    await app.waitState((s) => s.panes[0]?.claude?.status === 'needs-you')

    // o Claude cria uma worktree e entra nela
    const nova = path.join(repo.dir, '.claude', 'worktrees', 'feat x')
    repo.git('worktree', 'add', '-b', 'feat-x', nova)
    await hook(o, paneId, { ...base, cwd: nova, hook_event_name: 'CwdChanged' }, mslabs)
    st = await app.waitState((s) => s.panes[0]?.worktreePath === nova)
    expect(st.projects[0].worktrees.map((w) => w.path)).toContain(nova)

    await hook(o, paneId, { ...base, cwd: nova, hook_event_name: 'Stop' }, mslabs)
    await app.waitState((s) => s.panes[0]?.claude?.status === 'your-turn')
    await hook(o, paneId, { ...base, cwd: nova, hook_event_name: 'SessionEnd' }, mslabs)
    st = await app.waitState((s) => s.panes[0]?.claude === null)
    expect(st.panes[0].accountId).toBeNull()
  })

  it('uso do plano: login aprendido pelo hook, agrupado, sem gateway e com aviso', async () => {
    repo = makeRepo()
    const reads: string[] = []
    const { o, app } = await boot({
      usageRead: async (l) => {
        reads.push(l.key)
        return { kind: 'ok', plan: 'max', windows: [{ kind: 'week', percent: 85, resetsAt: null }] }
      },
    })
    // misa é o padrão: começa lendo o diretório padrão
    await app.waitState((s) => s.usage.some((u) => u.loginKey === 'claude:'))
    let st = app.state()!
    expect(st.usageHints['weboption-max']).toBeTruthy() // ainda sem login descoberto
    expect(st.usageHints.weboption).toBeUndefined() // gateway: nem aparece

    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const mslabs = '/Users/u/.claude-swap-backup/sessions/3-misael_mslabs-dev.com'
    await hook(o, paneId, { session_id: 's1', cwd: repo.dir, hook_event_name: 'SessionStart', source: 'startup' }, mslabs)
    st = await app.waitState((s) => s.usage.some((u) => u.loginKey === `claude:${mslabs}`))
    expect(st.usage.find((u) => u.loginKey === `claude:${mslabs}`)).toMatchObject({ accountIds: ['mslabs'], status: 'ok' })
    expect(reads).toContain(`claude:${mslabs}`)
    await app.waitState(() => app.alerts().includes('mslabs: 80% da janela semanal'))
    await waitFor(() => JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).loginDirs?.mslabs === mslabs)
  })

  it('conversas: lista por pasta, marca painel aberto, recusa conversa ausente e retoma no cwd de início', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    fakeClaudeConv(o, repo.dir, 'cafe-0001', 'Corrigir login')
    const wt = path.join(repo.dir, '.claude', 'worktrees', 'x')
    repo.git('worktree', 'add', '-b', 'x', wt)

    const list = await app.client.request<ConversationInfo[]>({ t: 'conversations.list', paths: [repo.dir] })
    expect(list.map((c) => [c.sessionId, c.title, c.accountIds, c.openPaneId])).toEqual([['cafe-0001', 'Corrigir login', ['misa'], null]])

    await expect(app.client.request({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', resumeSessionId: 'sumiu', cols: 80, rows: 24 })).rejects.toThrow('conversation-missing')

    // o painel guardava o cwd da worktree, mas a conversa começou na pasta principal
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: wt, accountId: 'misa', resumeSessionId: 'cafe-0001', cols: 80, rows: 24 })
    const st = await app.waitState((s) => s.panes.some((p) => p.id === paneId))
    expect(st.panes.find((p) => p.id === paneId)?.cwd).toBe(repo.dir)
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'cafe-0001', cwd: repo.dir, transcript_path: path.join(o.userHome, '.claude', 'projects', projectDirName(repo.dir), 'cafe-0001.jsonl') })
    await app.waitState((s) => s.panes.some((p) => p.claude?.sessionId === 'cafe-0001'))
    const again = await app.client.request<ConversationInfo[]>({ t: 'conversations.list', paths: [repo.dir] })
    expect(again[0].openPaneId).toBe(paneId)
  })

  it('arquivos: ler, salvar, listar, vigiar e filePanes podado pelo layout', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const f = path.join(repo.dir, '.env')
    fs.writeFileSync(f, 'A=1\n')
    const r = await app.client.request<{ content: string; mtimeMs: number }>({ t: 'file.read', path: f })
    expect(r.content).toBe('A=1\n')
    await app.client.request({ t: 'file.write', path: f, content: 'A=2\n', expectedMtimeMs: r.mtimeMs })
    expect(fs.readFileSync(f, 'utf8')).toBe('A=2\n')
    await expect(app.client.request({ t: 'file.write', path: f, content: 'x', expectedMtimeMs: 1 })).rejects.toThrow('file-changed')
    const list = await app.client.request<{ files: string[] }>({ t: 'file.list', root: repo.dir })
    expect(list.files).toContain('.env')
    expect(await app.client.request({ t: 'file.exists', cwd: repo.dir, paths: ['.env', 'nada'] })).toEqual([{ path: '.env', abs: f }])

    await app.client.request({ t: 'file.watch', path: f })
    await new Promise((r) => setTimeout(r, 50))
    fs.writeFileSync(f, 'A=3\n')
    await waitFor(() => app.fileEvents().some((e) => e.path === f))

    await app.client.request({ t: 'filepane.set', id: 'file:1', path: f, mode: 'edit' })
    await app.waitState((s) => s.filePanes['file:1']?.path === f)
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'A', root: { type: 'leaf', paneId: 'file:1' } }], activeTabId: 't' } })
    expect((await app.client.request<{ filePanes: Record<string, unknown> }>({ t: 'state.get' })).filePanes['file:1']).toBeTruthy()
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'A', root: null }], activeTabId: 't' } })
    await app.waitState((s) => !s.filePanes['file:1'])
  })

  it('worktree do agente: 2 escritas em outra worktree viram a efetiva; SessionStart volta; worktree removida volta', async () => {
    repo = makeRepo()
    const wt = path.join(repo.dir, '.claude', 'worktrees', 'dev2')
    repo.git('worktree', 'add', '-b', 'dev2', wt)
    const { o, app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await app.waitState((s) => s.panes.some((p) => p.id === paneId && p.worktreePath === repo!.dir))
    const base = { session_id: 's1', cwd: repo.dir }
    await hook(o, paneId, { ...base, hook_event_name: 'SessionStart', source: 'startup' })
    await hook(o, paneId, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `W="${wt}"; git -C "$W" status` } })
    let st = await app.waitState((s) => s.panes[0]?.claude?.sessionId === 's1')
    expect(st.panes[0]).toMatchObject({ worktreePath: repo.dir })
    await hook(o, paneId, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'a.ts') } })
    st = await app.waitState((s) => s.panes[0]?.worktreeInferred === true)
    expect(st.panes[0]).toMatchObject({ worktreePath: wt, shellWorktreePath: repo.dir, projectPath: repo.dir })

    await hook(o, paneId, { ...base, hook_event_name: 'SessionStart', source: 'clear' })
    await app.waitState((s) => s.panes[0]?.worktreeInferred === false && s.panes[0]?.worktreePath === repo!.dir)

    for (let i = 0; i < 2; i++) await hook(o, paneId, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(wt, `b${i}.ts`) } })
    await app.waitState((s) => s.panes[0]?.worktreePath === wt)
    repo.git('worktree', 'remove', '--force', wt)
    await app.waitState((s) => s.panes[0]?.worktreePath === repo!.dir && s.panes[0]?.worktreeInferred === false, 15_000)
  })

  it('poller: cd no shell muda a worktree; sessão sem processo claude é encerrada', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt b')
    repo.git('worktree', 'add', '-b', 'b', wt)
    const { o, app } = await boot({ pollMs: 200 })
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    app.client.send({ t: 'pane.input', paneId, data: `cd "${wt}"\r` })
    await app.waitState((s) => s.panes[0]?.worktreePath === wt)

    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 's9', cwd: wt })
    await app.waitState((s) => s.panes[0]?.claude?.sessionId === 's9', 2000).catch(() => null)
    await app.waitState((s) => s.panes[0]?.claude === null)
  })

  it('painel aberto com conta digita o comando da conta', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    // o eco pode chegar antes do attach (vai no snapshot) ou depois (vai em pane.data)
    await app.waitState(() => (snapshot + app.output(paneId)).includes('claude-mslabs'))
    const st = await app.waitState((s) => s.panes[0]?.accountId === 'mslabs')
    expect(st.panes[0].id).toBe(paneId)
  })

  it('reinício do daemon: painéis vivos viram retomáveis com o mesmo id', async () => {
    repo = makeRepo()
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await hook(first.o, paneId, { hook_event_name: 'SessionStart', session_id: 'abcd-1234', cwd: repo.dir })
    await first.app.waitState((s) => s.panes[0]?.claude?.sessionId === 'abcd-1234')
    first.app.client.close()
    await first.d.stop(true)
    daemons = []

    const second = await boot({}, first.home)
    fakeClaudeConv(second.o, repo.dir, 'abcd-1234')
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.resumable[0]).toEqual({ paneId, cwd: repo.dir, accountId: 'misa', sessionId: 'abcd-1234', agent: 'claude', transcriptPath: null })
    expect(st.panes).toEqual([])

    await second.app.client.request({ t: 'pane.create', paneId, cwd: repo.dir, accountId: 'misa', resumeSessionId: 'abcd-1234', cols: 80, rows: 24 })
    const { snapshot } = await second.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    await second.app.waitState((s) => s.resumable.length === 0 && s.panes[0]?.id === paneId)
    await second.app.waitState(() => (snapshot + second.app.output(paneId)).includes('claude --resume abcd-1234'))
  })

  it('hibernação: sessão ociosa hiberna e acorda com --resume ao focar', async () => {
    repo = makeRepo()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    const { o, app } = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    await enableHibernate(app)
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', cols: 80, rows: 24 })
    const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    await waitFor(() => (snapshot + app.output(paneId)).includes('fake-claude'))
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'feed-0001', cwd: repo.dir, source: 'startup' })
    await hook(o, paneId, { hook_event_name: 'Stop', session_id: 'feed-0001', cwd: repo.dir })

    const st = await app.waitState((s) => !!s.panes[0]?.hibernated)
    expect(st.panes[0].alive).toBe(true)
    // o poll já zerou a sessão (agente sumiu): a conta segue a da hibernação
    const gone = await app.waitState((s) => !!s.panes[0]?.hibernated && s.panes[0].claude === null)
    expect(gone.panes[0].accountId).toBe('misa')

    app.client.send({ t: 'pane.focus', paneId })
    await app.waitState((s) => !s.panes[0]?.hibernated && s.panes[0]?.waking === true)
    await waitFor(() => (snapshot + app.output(paneId)).includes('fake-claude --resume feed-0001'))
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'feed-0001', cwd: repo.dir, source: 'resume' })
    await app.waitState((s) => s.panes[0]?.waking === false && s.panes[0]?.claude?.sessionId === 'feed-0001')
  })

  it('hibernação: painel em foco ou líder não hiberna', async () => {
    repo = makeRepo()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    const { o, app } = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    await enableHibernate(app)
    const mk = async () => (await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo!.dir, accountId: 'misa', cols: 80, rows: 24 })).paneId
    const focused = await mk()
    const leader = await mk()
    app.client.send({ t: 'pane.focus', paneId: focused })
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    for (const [id, s] of [[focused, 'f-1'], [leader, 'l-1']]) {
      await hook(o, id, { hook_event_name: 'SessionStart', session_id: s, cwd: repo.dir, source: 'startup' })
      await hook(o, id, { hook_event_name: 'Stop', session_id: s, cwd: repo.dir })
    }
    await new Promise((r) => setTimeout(r, 1500))
    const st = app.state()!
    expect(st.panes.filter((p) => p.claude).length).toBe(2)
    expect(st.panes.every((p) => !p.hibernated)).toBe(true)
  })

  it('encerrar espaço com sessão hibernada guarda a conversa para retomar', async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    repo = makeRepo()
    const { o, app } = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    await enableHibernate(app)
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Outro' })
    const ws = await connectApp(o.socketPath, id)
    const { paneId } = await ws.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', cols: 80, rows: 24 })
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'cafe-0003', cwd: repo.dir, source: 'startup' })
    await hook(o, paneId, { hook_event_name: 'Stop', session_id: 'cafe-0003', cwd: repo.dir })
    await ws.waitState((s) => !!s.panes.find((p) => p.id === paneId)?.hibernated && s.panes.find((p) => p.id === paneId)?.claude === null)
    await app.client.request({ t: 'workspace.end', id })
    const st = await ws.waitState((s) => s.resumable.some((r) => r.paneId === paneId))
    expect(st.resumable.find((r) => r.paneId === paneId)).toMatchObject({ accountId: 'misa', sessionId: 'cafe-0003', agent: 'claude' })
    ws.client.close()
  })

  it('reinício do daemon: sessão hibernada vira retomável com a sessão da hibernação', async () => {
    repo = makeRepo()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    const first = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    await enableHibernate(first.app)
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', cols: 80, rows: 24 })
    await hook(first.o, paneId, { hook_event_name: 'SessionStart', session_id: 'beef-0002', cwd: repo.dir, source: 'startup' })
    await hook(first.o, paneId, { hook_event_name: 'Stop', session_id: 'beef-0002', cwd: repo.dir })
    await first.app.waitState((s) => !!s.panes[0]?.hibernated)
    first.app.client.close()
    await first.d.stop(true)
    daemons = []

    const second = await boot({}, home)
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.resumable[0]).toMatchObject({ paneId, accountId: 'misa', sessionId: 'beef-0002', agent: 'claude' })
  })

  it('reinício do daemon: sessão Codex sem agente Codex retoma com codex, não com o Claude padrão', async () => {
    repo = makeRepo()
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await runWithInput('/bin/sh', [first.o.hookScriptPath, 'codex'], JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abcd-1234', cwd: repo.dir, source: 'startup' }), { PATH: '/usr/bin:/bin', GT_PANE_ID: paneId, GT_SOCKET: first.o.socketPath })
    await first.app.waitState((s) => s.panes[0]?.claude?.sessionId === 'abcd-1234')
    first.app.client.close()
    await first.d.stop(true)
    daemons = []

    const second = await boot({}, first.home)
    fakeCodexConv(second.o, repo.dir, 'abcd-1234')
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.resumable[0]).toMatchObject({ accountId: null, sessionId: 'abcd-1234', agent: 'codex' })
    await second.app.client.request({ t: 'pane.create', paneId, cwd: repo.dir, accountId: null, resumeSessionId: 'abcd-1234', resumeAgent: 'codex', cols: 80, rows: 24 })
    const { snapshot } = await second.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    // o eco do shell quebra a linha comprida em 80 colunas: compara sem espaços nem controles
    const flat = () => (snapshot + second.app.output(paneId)).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\s+/g, '')
    await second.app.waitState(() => flat().includes('resumeabcd-1234'))
    expect(flat()).toContain(('codex --no-daemon -c \'mcp_servers.gerenciador.command=').replace(/\s+/g, ''))
    expect(flat()).toContain(('mcp_servers.gerenciador.env={ELECTRON_RUN_AS_NODE="1",GT_PANE_ID="' + paneId).replace(/\s+/g, ''))
    expect(flat()).not.toContain('claude--resume')
  })

  it('layout é salvo e volta após reinício; avisos de hooks e instalação', async () => {
    const first = await boot()
    let st = await first.app.waitState((s) => s.hookWarnings.length === 1)
    expect(st.hookWarnings[0]).toBe(path.join(first.o.userHome, '.claude', 'settings.json'))
    await first.app.client.request({ t: 'hooks.install' })
    await first.app.waitState((s) => s.hookWarnings.length === 0)

    const layout = { tabs: [{ id: 't1', name: 'Trabalho', root: { type: 'leaf' as const, paneId: 'x' } }], activeTabId: 't1' }
    await first.app.client.request({ t: 'layout.save', layout })
    await new Promise((r) => setTimeout(r, 400))
    first.app.client.close()
    await first.d.stop(false)
    daemons = []
    const second = await boot({}, first.home)
    st = await second.app.waitState((s) => s.layout.tabs.length === 1)
    expect(st.layout).toEqual(layout)
  })

  it('I3: worktree criada ou removida por fora aparece/some sem painel nenhum nela', async () => {
    repo = makeRepo()
    const { app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const wt = path.join(repo.root, 'wt externa')
    repo.git('worktree', 'add', '-b', 'externa', wt)
    await app.waitState((s) => !!s.projects[0]?.worktrees.some((w) => w.path === wt))
    repo.git('worktree', 'remove', wt)
    await app.waitState((s) => !!s.projects[0] && !s.projects[0].worktrees.some((w) => w.path === wt))
  })

  it('I6: hook de subagente (agent_id) não muda a worktree do painel', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt sub')
    repo.git('worktree', 'add', '-b', 'sub', wt)
    const { o, app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 's1', cwd: repo.dir })
    await app.waitState((s) => s.panes[0]?.claude?.sessionId === 's1' && s.panes[0].worktreePath === repo!.dir)
    await hook(o, paneId, { hook_event_name: 'PostToolUse', session_id: 's1', cwd: wt, agent_id: 'a1', agent_type: 'general-purpose' })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'working')
    await new Promise((r) => setTimeout(r, 800)) // tempo para um relocate indevido acontecer
    const st = app.state()!
    expect(st.panes[0].cwd).toBe(repo.dir)
    expect(st.panes[0].worktreePath).toBe(repo.dir)
  })

  it('pane.seen transforma 🔵 em ⚪', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await hook(o, paneId, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: repo.dir })
    await hook(o, paneId, { hook_event_name: 'Stop', session_id: 's1', cwd: repo.dir })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'your-turn')
    await app.client.request({ t: 'pane.seen', paneId })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'idle')
  })

  it('conflitos: analisa sob demanda e reanalisa sozinho quando uma worktree muda', async () => {
    repo = makeRepo()
    repo.write('f.txt', 'x\n'); repo.git('add', '.'); repo.git('commit', '-m', 'f')
    const a = path.join(repo.root, 'wt a'), b = path.join(repo.root, 'wt b')
    repo.git('worktree', 'add', '-b', 'a', a)
    repo.git('worktree', 'add', '-b', 'b', b)
    fs.writeFileSync(path.join(a, 'f.txt'), 'A\n')
    const { app } = await boot({ gitPollMs: 300, conflictsDebounceMs: 200 })
    await app.client.request({ t: 'project.add', path: repo.dir })
    await app.client.request({ t: 'conflicts.analyze', projectPath: repo.dir })
    let st = await app.waitState((s) => !!s.projects[0]?.conflicts && !s.projects[0].conflicts.running)
    expect(st.projects[0].conflicts!.pairs).toEqual([])
    // b passa a mexer na mesma linha, sem commitar: a reanálise automática precisa pegar
    fs.writeFileSync(path.join(b, 'f.txt'), 'B\n')
    st = await app.waitState((s) => (s.projects[0]?.conflicts?.pairs.length ?? 0) === 1, 15_000)
    expect(st.projects[0].conflicts!.pairs[0]).toMatchObject({ files: ['f.txt'], dirty: true })
  })

  it('nome e cor da sessão: especiais, persistem após reinício e validam cor', async () => {
    repo = makeRepo()
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const name = 'Revisão "PR #12" 🚀'
    await first.app.client.request({ t: 'pane.meta', paneId, name, color: '#3b82f6' })
    await first.app.waitState((s) => s.panes[0]?.name === name && s.panes[0]?.color === '#3b82f6')
    await expect(first.app.client.request({ t: 'pane.meta', paneId, color: 'red; drop' })).rejects.toThrow('cor inválida')
    await first.app.client.request({ t: 'pane.meta', paneId, name: '   ' })
    await first.app.waitState((s) => s.panes[0]?.name === null)
    await first.app.client.request({ t: 'pane.meta', paneId, name })
    await first.app.client.request({ t: 'settings.save', settings: { ...DEFAULT_SETTINGS, terminalTheme: 'dracula', fontFamily: 'JetBrains Mono', fontSize: 99, lineHeight: 1.3 } })
    await first.app.waitState((s) => s.settings.terminalTheme === 'dracula' && s.settings.fontSize === 24)
    await new Promise((r) => setTimeout(r, 400))
    first.app.client.close()
    await first.d.stop(true)
    daemons = []
    const second = await boot({}, first.home)
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.settings).toMatchObject({ terminalTheme: 'dracula', fontFamily: 'JetBrains Mono', fontSize: 24 })
    // o painel retomado com o mesmo id recupera nome e cor
    await second.app.client.request({ t: 'pane.create', paneId, cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await second.app.waitState((s) => s.panes[0]?.name === name && s.panes[0]?.color === '#3b82f6')
  })

  it('instância com GT_HOME próprio instala o hook no caminho canônico, sem repontar o global', async () => {
    const { app, o } = await boot()
    await app.client.request({ t: 'hooks.install' })
    const canonical = path.join(o.userHome, '.gerenciador-terminal', 'bin', 'gt-hook')
    const settings = JSON.parse(fs.readFileSync(path.join(o.userHome, '.claude', 'settings.json'), 'utf8'))
    const cmds = settings.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command))
    expect(cmds).toEqual([`sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "${canonical}"`])
    expect(fs.statSync(canonical).mode & 0o111).not.toBe(0)
    expect(o.hookScriptPath).not.toBe(canonical)
  })

  it('attach com sequência: dados levam o seq do último attach; detach para o envio', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await new Promise((r) => setTimeout(r, 500)) // o prompt inicial do sh sai antes de qualquer assinatura
    const seqs: number[] = []
    app.client.onMessage((m) => { if (m.t === 'pane.data' && m.paneId === paneId) seqs.push(m.seq) })
    await app.client.request({ t: 'pane.attach', paneId, seq: 1 })
    await app.client.request({ t: 'pane.attach', paneId, seq: 2 })
    app.client.send({ t: 'pane.input', paneId, data: 'echo um\r' })
    await app.waitState(() => seqs.length > 0)
    expect(new Set(seqs)).toEqual(new Set([2]))
    await app.client.request({ t: 'pane.detach', paneId })
    const n = seqs.length
    app.client.send({ t: 'pane.input', paneId, data: 'echo dois\r' })
    await new Promise((r) => setTimeout(r, 500))
    expect(seqs.length).toBe(n)
  })

  it('comando da conta espera o prompt, e sai mesmo se o shell nunca imprimir nada', async () => {
    repo = makeRepo()
    const slow = await boot({ shellArgs: ['-c', 'sleep 1; printf "PRONTO\\n"; exec cat'] })
    const a = await slow.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const snap = await slow.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId: a.paneId })
    await slow.app.waitState(() => (snap.snapshot + slow.app.output(a.paneId)).includes('claude-mslabs'), 8000)
    const all = snap.snapshot + slow.app.output(a.paneId)
    expect(all.indexOf('PRONTO')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('PRONTO')).toBeLessThan(all.indexOf('claude-mslabs'))

    const mute = await boot({ shellArgs: ['-c', 'exec cat'] })
    const b = await mute.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const snapB = await mute.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId: b.paneId })
    await mute.app.waitState(() => (snapB.snapshot + mute.app.output(b.paneId)).includes('claude-mslabs'), 8000)
  }, 20_000)

  it('hello informa a versão do protocolo e o buildId', async () => {
    const { o } = await boot()
    const c = await RpcClient.connect(o.socketPath)
    await expect(c.request({ t: 'hello', role: 'app', version: 2 })).resolves.toEqual({ protocolVersion: 2, buildId: 'test' })
    c.close()
  })

  it('I7: edição de arquivo já alterado (sem mudar a contagem) também reanalisa, via hook', async () => {
    repo = makeRepo()
    repo.write('f.txt', 'l1\nl2\nl3\nl4\nl5\n'); repo.git('add', '.'); repo.git('commit', '-m', 'f')
    const a = path.join(repo.root, 'wt a'), b = path.join(repo.root, 'wt b')
    repo.git('worktree', 'add', '-b', 'a', a)
    repo.git('worktree', 'add', '-b', 'b', b)
    fs.writeFileSync(path.join(a, 'f.txt'), 'A1\nl2\nl3\nl4\nl5\n'); repo.git('-C', a, 'commit', '-qam', 'a')
    fs.writeFileSync(path.join(b, 'f.txt'), 'l1\nl2\nl3\nl4\nB5\n') // já alterado, sem conflito
    const { o, app } = await boot({ gitPollMs: 300, conflictsDebounceMs: 200 })
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: b, accountId: null, cols: 80, rows: 24 })
    await app.waitState((s) => s.panes[0]?.worktreePath === b && (s.projects[0]?.worktrees[2]?.git?.changed ?? 0) === 1)
    await app.client.request({ t: 'conflicts.analyze', projectPath: repo.dir })
    await app.waitState((s) => !!s.projects[0]?.conflicts && !s.projects[0].conflicts.running && s.projects[0].conflicts.pairs.length === 0)
    // o Claude mexe de novo no mesmo arquivo (continua 1 alterado) e agora conflita com a
    fs.writeFileSync(path.join(b, 'f.txt'), 'B1\nl2\nl3\nl4\nB5\n')
    await hook(o, paneId, { hook_event_name: 'PostToolUse', session_id: 's1', cwd: b })
    await app.waitState((s) => (s.projects[0]?.conflicts?.pairs.length ?? 0) === 1, 10_000)
  })

  it('nome longo com emoji não é cortado no meio do emoji', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await app.client.request({ t: 'pane.meta', paneId, name: 'a'.repeat(59) + '🚀fim' })
    const st = await app.waitState((s) => !!s.panes[0]?.name)
    expect(st.panes[0].name).toBe('a'.repeat(59) + '🚀')
  })

  it('o que o usuário digita durante a espera do prompt vem depois do comando da conta', async () => {
    repo = makeRepo()
    const { app } = await boot({ shellArgs: ['-c', 'sleep 1; printf "PRONTO\\n"; exec cat'] })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const snap = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    app.client.send({ t: 'pane.input', paneId, data: 'digitado' })
    await app.waitState(() => (snap.snapshot + app.output(paneId)).includes('digitado') && (snap.snapshot + app.output(paneId)).includes('claude-mslabs'), 8000)
    const all = snap.snapshot + app.output(paneId)
    expect(all.indexOf('claude-mslabs')).toBeLessThan(all.indexOf('digitado'))
  })

  it('agentes: salva válidos, recusa inválidos sem mexer no estado, detecta CLIs pelo shell', async () => {
    const shell = path.join(fs.realpathSync(os.tmpdir()), `gt-fake-shell-${process.pid}.sh`)
    fs.writeFileSync(shell, '#!/bin/sh\necho claude\n', { mode: 0o755 })
    const { app } = await boot({ detectShell: shell })
    const claude = { id: 'claude', label: 'Claude', command: 'claude --dangerously-skip-permissions', color: '#d97757', agent: 'claude' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }
    await app.client.request({ t: 'accounts.save', accounts: [claude] })
    await app.waitState((s) => s.accounts.length === 1 && s.accounts[0].agent === 'claude')
    await expect(app.client.request({ t: 'accounts.save', accounts: [claude, claude] })).rejects.toThrow('repetido')
    expect(app.state()!.accounts).toHaveLength(1)
    await expect(app.client.request({ t: 'agents.detect' })).resolves.toEqual({ claude: true, codex: false })
  })

  it('Codex: eventos pelo gt-hook viram estados e a sessão registra o tipo', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const codex = (payload: Record<string, unknown>) =>
      runWithInput('/bin/sh', [o.hookScriptPath, 'codex'], JSON.stringify(payload), { PATH: '/usr/bin:/bin', GT_PANE_ID: paneId, GT_SOCKET: o.socketPath })
    const r = await codex({ hook_event_name: 'SessionStart', session_id: 'cx', cwd: repo.dir, source: 'startup' })
    expect(r.stdout).toBe('{}')
    await app.waitState((s) => s.panes[0]?.claude?.agent === 'codex')
    await codex({ hook_event_name: 'UserPromptSubmit', session_id: 'cx', cwd: repo.dir })
    await codex({ hook_event_name: 'Interrupt', session_id: 'cx', cwd: repo.dir })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'your-turn')
  })

  it('Codex rodando sem mandar hooks → agentHooksMissing', async () => {
    repo = makeRepo()
    const bin = path.join(repo.root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    const { app } = await boot({ pollMs: 200, codexHookGraceMs: 600 })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    app.client.send({ t: 'pane.input', paneId, data: `"${path.join(bin, 'codex')}" --yolo\r` })
    await app.waitState((s) => s.panes[0]?.agentHooksMissing === true, 8000)
  })

  it('Codex que manda SessionStart antes do primeiro poll não dispara aviso falso', async () => {
    repo = makeRepo()
    const bin = path.join(repo.root, 'bin')
    fs.mkdirSync(bin)
    const { o, app } = await boot({ pollMs: 1500, codexHookGraceMs: 300 })
    fs.writeFileSync(
      path.join(bin, 'codex'),
      `#!/bin/sh\necho '{"hook_event_name":"SessionStart","session_id":"cx","source":"startup"}' | /bin/sh "${o.hookScriptPath}" codex >/dev/null\nsleep 30\n`,
      { mode: 0o755 },
    )
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    app.client.send({ t: 'pane.input', paneId, data: `"${path.join(bin, 'codex')}" --yolo\r` })
    await app.waitState((s) => s.panes[0]?.claude?.agent === 'codex', 8000)
    await new Promise((r) => setTimeout(r, 4000)) // 2+ polls depois do grace
    expect(app.state()!.panes[0].agentHooksMissing).toBe(false)
  })

  it('erros de requisição voltam como mensagem', async () => {
    const { app } = await boot()
    await expect(app.client.request({ t: 'pane.create', cwd: '/', accountId: 'nao-existe', cols: 80, rows: 24 })).rejects.toThrow('conta desconhecida')
    await expect(app.client.request({ t: 'project.add', path: '/' })).rejects.toThrow('não é um repositório git')
  })
  it('espaços: duas janelas veem projetos, sessões e layout separados; mesmo projeto nos dois', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Outro' })
    const other = await connectApp(o.socketPath, id)
    await app.client.request({ t: 'project.add', path: repo.dir })
    let s2 = await other.waitState((s) => s.workspaceId === id)
    expect(s2.projects).toEqual([])
    await other.client.request({ t: 'project.add', path: repo.dir })
    s2 = await other.waitState((s) => s.projects.length === 1)
    const { paneId } = await other.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await other.waitState((s) => s.panes.some((p) => p.id === paneId))
    expect(app.state()!.panes.some((p) => p.id === paneId)).toBe(false)
    await other.client.request({ t: 'layout.save', layout: { tabs: [{ id: 'x', name: 'X', root: { type: 'leaf', paneId } }], activeTabId: 'x' } })
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 'y', name: 'Y', root: null }], activeTabId: 'y' } })
    expect((await other.client.request<{ layout: { tabs: { id: string }[] } }>({ t: 'state.get' })).layout.tabs[0].id).toBe('x')
    await app.client.request({ t: 'project.remove', path: repo.dir })
    expect((await other.client.request<{ projects: unknown[] }>({ t: 'state.get' })).projects).toHaveLength(1)
    // hook com a janela do espaço fechada: o estado da sessão segue atualizando
    other.client.close()
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'w1', cwd: repo.dir })
    const again = await connectApp(o.socketPath, id)
    await again.waitState((s) => s.panes.find((p) => p.id === paneId)?.claude?.sessionId === 'w1')
    expect(app.state()!.workspaces.map((w) => w.name).sort()).toEqual(['Outro', 'Principal'])
  })
  it('espaços: renomear, encerrar (sessões viram retomáveis do espaço) e mover sessão viva', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Principal' })
    let list = await app.client.request<{ id: string; name: string }[]>({ t: 'workspace.list' })
    expect(list.find((w) => w.id === id)?.name).toBe('Principal 2')
    await app.client.request({ t: 'workspace.rename', id, name: 'Revisões' })
    const rev = await connectApp(o.socketPath, id)
    await rev.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await rev.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await rev.client.request({ t: 'pane.moveWorkspace', paneId, to: 'principal' })
    await app.waitState((s) => s.panes.some((p) => p.id === paneId && p.alive))
    expect(app.state()!.projects.map((p) => p.path)).toContain(repo.dir)
    await rev.client.request({ t: 'pane.moveWorkspace', paneId, to: id })
    await rev.waitState((s) => s.panes.some((p) => p.id === paneId && p.alive))
    // painel de arquivo no layout do espaço: encerrar não o apaga
    await rev.client.request({ t: 'filepane.set', id: 'file:1', path: path.join(repo.dir, 'README.md'), mode: 'view' })
    await rev.client.request({ t: 'layout.save', layout: { tabs: [{ id: 'r', name: 'R', root: { type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId }, { type: 'leaf', paneId: 'file:1' }] } }], activeTabId: 'r' } })
    await app.client.request({ t: 'workspace.end', id })
    const st = await rev.waitState((s) => s.resumable.some((r) => r.paneId === paneId))
    expect(st.panes.find((p) => p.id === paneId)?.alive ?? false).toBe(false)
    expect(st.filePanes['file:1']).toBeTruthy()
    list = await app.client.request({ t: 'workspace.list' })
    expect(list.find((w) => w.id === id)).toMatchObject({ name: 'Revisões', open: false, sessions: 0 })
  })
  it('espaços: "não perguntar de novo" ao fechar fica no estado e no state.json', async () => {
    const { o, app } = await boot()
    expect(app.state()!.askOnCloseWindow).toBe(true)
    await app.client.request({ t: 'workspace.setAskOnClose', ask: false })
    await app.waitState((s) => s.askOnCloseWindow === false)
    await waitFor(() => JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).askOnCloseWindow === false || null)
  })
  it('espaços: o resumo conta o que espera você em cada espaço, mesmo com a janela fechada (badge do Dock)', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Outro' })
    const other = await connectApp(o.socketPath, id)
    const { paneId } = await other.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    other.client.close()
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'a1', cwd: repo.dir })
    await hook(o, paneId, { hook_event_name: 'PermissionRequest', session_id: 'a1', cwd: repo.dir })
    const st = await app.waitState((s) => s.workspaces.find((w) => w.id === id)?.attention === 1)
    expect(st.workspaces.find((w) => w.id === 'principal')?.attention).toBe(0)
  })
  it('espaços: o resumo traz abas e sessões de cada espaço (para navegar entre janelas)', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Outro' })
    const other = await connectApp(o.socketPath, id)
    const mk = async () => (await other.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo!.dir, accountId: null, cols: 80, rows: 24 })).paneId
    const a = await mk()
    const b = await mk()
    const c = await mk()
    await other.client.request({ t: 'pane.meta', paneId: a, name: 'api' })
    await hook(o, b, { hook_event_name: 'SessionStart', session_id: 'n1', cwd: repo.dir })
    await hook(o, b, { hook_event_name: 'PermissionRequest', session_id: 'n1', cwd: repo.dir })
    await other.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't1', name: 'Back', root: { type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: a }, { type: 'leaf', paneId: b }] } }, { id: 't2', name: 'Vazia', root: null }], activeTabId: 't1' } })
    const st = await app.waitState((s) => s.workspaces.find((w) => w.id === id)?.tabs[0]?.panes[1]?.status === 'needs-you')
    const w = st.workspaces.find((x) => x.id === id)!
    const seqOf = (pid: string) => other.state()!.panes.find((p) => p.id === pid)!.seq
    expect(w.tabs).toEqual([
      { id: 't1', name: 'Back', panes: [{ id: a, label: 'api', status: null }, { id: b, label: `sessão ${seqOf(b)}`, status: 'needs-you' }] },
    ])
    expect(w.hidden).toEqual([{ id: c, label: `terminal ${seqOf(c)}`, status: null }])
  })
  it('contratar: grava mcp.json e toda sessão Claude recebe --mcp-config', async () => {
    const { o, app } = await boot({ nodeBinary: '/bin/app-x', mcpScriptPath: '/opt/app/gt-mcp.js' })
    const cfg = JSON.parse(fs.readFileSync(path.join(o.home, 'mcp.json'), 'utf8'))
    expect(cfg).toEqual({ mcpServers: { 'gerenciador-terminal': { command: '/bin/app-x', args: ['/opt/app/gt-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } } } })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: o.userHome, accountId: 'mslabs', cols: 200, rows: 24 })
    // a saída só chega a quem se inscreve: lê o snapshot do terminal até o comando aparecer
    const screen = await waitFor(async () => {
      const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
      return snapshot.includes('--mcp-config') ? snapshot : null
    }, 8000)
    expect(screen).toContain(`claude-mslabs --mcp-config '${path.join(o.home, 'mcp.json')}'`)
  })

  it('contratar: marca de líder aparece no estado e sobrevive a reiniciar o daemon', async () => {
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: first.o.userHome, accountId: null, cols: 80, rows: 24 })
    await first.app.client.request({ t: 'pane.setLeader', paneId, leader: true })
    await first.app.waitState((s) => s.panes.find((p) => p.id === paneId)?.leader === true)
    await first.d.stop(true)
    daemons = daemons.filter((x) => x !== first.d)
    const second = await boot({}, first.home)
    await second.app.client.request({ t: 'pane.create', paneId, cwd: first.o.userHome, accountId: null, cols: 80, rows: 24 })
    const st = await second.app.waitState((s) => s.panes.some((p) => p.id === paneId))
    expect(st.panes.find((p) => p.id === paneId)).toMatchObject({ leader: true, createdBy: null })
  })

  it('contratar: só o líder cria; worktree, nome, conta, prompt e aba do líder', async () => {
    repo = makeRepo()
    const { o, app, leader, call } = await leaderIn(repo.dir)
    await expect(call('contratar_dev', { nome: 'dev-1' })).rejects.toThrow('esta sessão não é líder')
    await expect(call('listar_equipe', {})).rejects.toThrow('esta sessão não está numa equipe')
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    const base = repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim()
    const r = await call('contratar_dev', { nome: 'dev-1', prompt: `faça "X" e 'Y'`, conta: 'weboption-max' })
    const dir = path.join(repo.dir, '.claude', 'worktrees', 'dev-1')
    expect(r).toMatchObject({ nome: 'dev-1', pasta: dir, branch: `${base}-dev-1`, conta: 'weboption-max' })
    expect(String(r.comando)).toContain(`-n 'dev-1'`)
    expect(fs.existsSync(dir)).toBe(true)
    const st = await app.waitState((s) => s.panes.some((p) => p.name === 'dev-1'))
    const dev = st.panes.find((p) => p.name === 'dev-1')!
    expect(dev).toMatchObject({ cwd: dir, accountId: 'weboption-max', createdBy: leader, leader: false })
    expect(fs.readFileSync(path.join(o.home, 'prompts', `${dev.id}.txt`), 'utf8')).toBe(
      hirePreamble({ name: 'dev-1', leaderName: `sessão ${app.state()!.panes.find((p) => p.id === leader)!.seq}`, leaderAgent: 'claude', agent: 'claude' }) + '\n\n' + `faça "X" e 'Y'`,
    )
    expect((await app.client.request<{ layout: { tabs: { root: unknown }[] } }>({ t: 'state.get' })).layout.tabs[0].root).toEqual({
      type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: leader }, { type: 'leaf', paneId: dev.id }],
    })
    // repetido: nome, pasta e branch ganham -2
    const r2 = await call('contratar_dev', { nome: 'dev-1', worktree: false })
    expect(r2).toMatchObject({ nome: 'dev-1-2', pasta: repo.dir, branch: null, conta: 'mslabs' })
    const r3 = await call('contratar_dev', { nome: 'dev-1-2' })
    expect(r3).toMatchObject({ nome: 'dev-1-2-2', branch: `${base}-dev-1-2-2` })
  })

  it('contratar: teto, listar, renomear e encerrar só as criadas', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    const s0 = (await app.client.request<{ settings: TerminalSettings }>({ t: 'state.get' })).settings
    await app.client.request({ t: 'settings.save', settings: { ...s0, maxHiredPerLeader: 1 } })
    await call('contratar_dev', { nome: 'dev-1', worktree: false })
    await expect(call('contratar_dev', { nome: 'dev-2', worktree: false })).rejects.toThrow('limite de 1 sessões atingido; encerre alguma ou aumente o limite nas preferências')
    const { paneId: mine } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await app.client.request({ t: 'pane.meta', paneId: mine, name: 'minha' })
    const list = (await call('listar_equipe', {})) as unknown as { nome: string; criadaPorMim: boolean; eu: boolean; status: string }[]
    expect(list.find((x) => x.nome === 'dev-1')).toMatchObject({ criadaPorMim: true, status: 'terminal' })
    expect(list.filter((x) => x.eu)).toHaveLength(1)
    // a lista é da equipe: a sessão solta do usuário não entra
    expect(list.find((x) => x.nome === 'minha')).toBeUndefined()
    await call('renomear_dev', { nome: 'dev-1', novo_nome: 'dev-a' })
    await expect(call('demitir_dev', { nome: 'minha' })).rejects.toThrow('só encerra sessões criadas por esta sessão')
    const devId = (await app.waitState((s) => s.panes.some((p) => p.name === 'dev-a'))).panes.find((p) => p.name === 'dev-a')!.id
    await call('demitir_dev', { nome: 'dev-a' })
    // demitido some: sai da lista de sessões e do layout do espaço (a worktree e a conversa ficam)
    await app.waitState((s) => !s.panes.some((p) => p.id === devId))
    const layout = (await app.client.request<{ layout: { tabs: { root: unknown }[] } }>({ t: 'state.get' })).layout
    expect(JSON.stringify(layout)).not.toContain(devId)
    expect(app.state()!.panes.find((p) => p.id === mine)?.alive).toBe(true)
  })

  it('contratar: modelo vai na linha de comando do Claude', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    const r = await call('contratar_dev', { nome: 'dev-1', worktree: false, modelo: 'sonnet' })
    expect(String(r.comando)).toContain(`--model 'sonnet'`)
    expect(r.modelo).toBe('sonnet')
  })

  it('contratar: dev Codex recebe o MCP e o prompt inicial (preâmbulo + tarefa) na linha de comando, sem passar pela fila', async () => {
    repo = makeRepo()
    const { o, app, leader, call } = await leaderIn(repo.dir)
    const codex = { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }
    await app.client.request({ t: 'accounts.save', accounts: [...DEFAULT_ACCOUNTS, codex] })
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await app.client.request({ t: 'pane.meta', paneId: leader, name: 'lider' })
    const r = await call('contratar_dev', { nome: 'dev-1', worktree: false, conta: 'codex', prompt: 'faz X' })
    const comando = String(r.comando)
    expect(comando).toContain(`-c 'mcp_servers.gerenciador.env=`)
    const file = /"\$\(cat '([^']+)'\)"$/.exec(comando)?.[1]
    expect(file).toBeDefined()
    const prompt = fs.readFileSync(file!, 'utf8')
    expect(prompt).toContain('Você é dev-1')
    expect(prompt).toContain('mandar_mensagem(para: "lider")')
    expect(prompt).toContain('faz X')
    await new Promise((r) => setTimeout(r, 600)) // o estado é salvo 300 ms depois da mudança
    expect(JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).mailbox ?? []).toEqual([])
  })

  it('líder: apresentação entregue só para quem não é Claude', async () => {
    repo = makeRepo()
    const { o, app, leader } = await leaderIn(repo.dir, { env: fakeTeamEnv() })
    const codexHook = (id: string, ev: Record<string, unknown>) => runWithInput('/bin/sh', [o.hookScriptPath, 'codex'], JSON.stringify(ev), { PATH: '/usr/bin:/bin', GT_PANE_ID: id, GT_SOCKET: o.socketPath })
    await codexHook(leader, { hook_event_name: 'SessionStart', session_id: 'cx-L', cwd: repo.dir, source: 'startup' })
    await codexHook(leader, { hook_event_name: 'Stop', session_id: 'cx-L', cwd: repo.dir })
    await app.waitState((s) => s.panes.find((p) => p.id === leader)?.claude?.agent === 'codex')
    await app.client.request({ t: 'pane.attach', paneId: leader })
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    const flat = () => app.output(leader).replace(/\s+/g, '')
    await app.waitState(() => flat().includes('Respondasó"ok,souolíder".'))
    expect(flat()).toContain(leaderBriefing('codex').slice(0, 60).replace(/\s+/g, ''))

    // Claude: nada na fila
    const claude = await leaderIn(repo.dir)
    await hook(claude.o, claude.leader, { hook_event_name: 'SessionStart', session_id: 's-C', cwd: repo.dir, source: 'startup' })
    await hook(claude.o, claude.leader, { hook_event_name: 'Stop', session_id: 's-C', cwd: repo.dir })
    await claude.app.client.request({ t: 'pane.attach', paneId: claude.leader })
    await claude.app.client.request({ t: 'pane.setLeader', paneId: claude.leader, leader: true })
    await new Promise((r) => setTimeout(r, 2500))
    expect(claude.app.output(claude.leader)).not.toContain('[gerenciador]')
    expect(JSON.parse(fs.readFileSync(claude.o.stateFile, 'utf8')).mailbox ?? []).toEqual([])
  })

  it('demitir e sair do painel: a fila falha com o motivo', async () => {
    repo = makeRepo()
    const { o, app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await call('contratar_dev', { nome: 'dev-1', worktree: false })
    await call('contratar_dev', { nome: 'dev-2', worktree: false })
    const panes = (await app.waitState((s) => s.panes.some((p) => p.name === 'dev-2'))).panes
    const d1 = panes.find((p) => p.name === 'dev-1')!.id
    const d2 = panes.find((p) => p.name === 'dev-2')!.id
    // ninguém tem sessão ainda: as mensagens ficam na fila
    await call('mandar_mensagem', { para: 'dev-1', texto: 'a' })
    await call('mandar_mensagem', { para: 'dev-2', texto: 'b' })
    const mailbox = () => {
      app.client.request({ t: 'state.get' }).catch(() => {})
      return (JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).mailbox ?? []) as { to: string; state: string; error: string | null }[]
    }
    await call('demitir_dev', { nome: 'dev-1' })
    await app.client.request({ t: 'pane.kill', paneId: d2 })
    await waitFor(async () => (mailbox().filter((m) => m.state === 'falhou').length === 2 ? true : null), 5000)
    expect(mailbox().find((m) => m.to === d1)).toMatchObject({ state: 'falhou', error: 'demitido' })
    expect(mailbox().find((m) => m.to === d2)).toMatchObject({ state: 'falhou', error: 'sessão encerrada' })
    await expect(call('mandar_mensagem', { para: 'dev-1', texto: 'oi' })).rejects.toThrow('sessão não encontrada neste espaço: dev-1')
  })

  it('reinício do daemon com mensagem na fila: volta e é entregue uma única vez', async () => {
    repo = makeRepo()
    const env = fakeTeamEnv()
    const first = await leaderIn(repo.dir, { env })
    await first.app.client.request({ t: 'pane.setLeader', paneId: first.leader, leader: true })
    await first.app.client.request({ t: 'pane.meta', paneId: first.leader, name: 'lider' })
    await first.call('contratar_dev', { nome: 'dev-1', worktree: false })
    const dev = (await first.app.waitState((s) => s.panes.some((p) => p.name === 'dev-1'))).panes.find((p) => p.name === 'dev-1')!.id
    for (const id of [first.leader, dev]) {
      await hook(first.o, id, { hook_event_name: 'SessionStart', session_id: `s-${id}`, cwd: repo.dir, source: 'startup' })
      await hook(first.o, id, { hook_event_name: 'Stop', session_id: `s-${id}`, cwd: repo.dir })
    }
    await hook(first.o, dev, { hook_event_name: 'UserPromptSubmit', session_id: `s-${dev}`, cwd: repo.dir })
    await first.app.waitState((s) => s.panes.find((p) => p.id === dev)?.claude?.status === 'working')
    await first.call('mandar_mensagem', { para: 'dev-1', texto: 'recadoUnicoQ7' })
    first.app.client.close()
    await first.d.stop(true)
    daemons = daemons.filter((x) => x !== first.d)
    const saved = JSON.parse(fs.readFileSync(first.o.stateFile, 'utf8')).mailbox as { state: string }[]
    expect(saved.map((m) => m.state)).toEqual(['na-fila'])

    const second = await boot({ env }, first.home)
    for (const id of [first.leader, dev]) await second.app.client.request({ t: 'pane.create', paneId: id, cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    await second.app.client.request({ t: 'pane.attach', paneId: dev })
    await hook(second.o, dev, { hook_event_name: 'SessionStart', session_id: 's2', cwd: repo.dir, source: 'startup' })
    await hook(second.o, dev, { hook_event_name: 'Stop', session_id: 's2', cwd: repo.dir })
    await second.app.waitState(() => second.app.output(dev).includes('recadoUnicoQ7'))
    await new Promise((r) => setTimeout(r, 2500)) // vários ticks: nada de duplicar
    expect(second.app.output(dev).split('recadoUnicoQ7').length - 1).toBe(1)
    await waitFor(async () => ((JSON.parse(fs.readFileSync(second.o.stateFile, 'utf8')).mailbox as { state: string }[]).every((m) => m.state === 'entregue') ? true : null), 5000)
  })

  it('Codex aberto e em silêncio, sem nenhum hook: mensagem espera na fila (a tela pode ser um aviso de atualização ou de confiança)', async () => {
    repo = makeRepo()
    const { o, app, leader, call } = await leaderIn(repo.dir, { env: fakeTeamEnv(), pollMs: 200 })
    const codex = { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }
    await app.client.request({ t: 'accounts.save', accounts: [...DEFAULT_ACCOUNTS, codex] })
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await call('contratar_dev', { nome: 'dev-1', worktree: false, conta: 'codex' })
    const dev = (await app.waitState((s) => s.panes.some((p) => p.name === 'dev-1'))).panes.find((p) => p.name === 'dev-1')!.id
    await app.client.request({ t: 'pane.attach', paneId: dev })
    await call('mandar_mensagem', { para: 'dev-1', texto: 'semHookQ3' })
    await new Promise((r) => setTimeout(r, 7000)) // mais que processo visto (3 s) + silêncio (2 s) da regra antiga
    expect(app.output(dev)).not.toContain('semHookQ3')
    expect((JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).mailbox as { state: string }[]).map((m) => m.state)).toEqual(['na-fila'])
  }, 15_000)

  it('mensagens: status your-turn com a CLI fora do painel (só o shell) não digita no shell', async () => {
    repo = makeRepo()
    // sem agente falso: claude-mslabs não existe e o painel fica no shell
    const { o, app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await call('contratar_dev', { nome: 'dev-1', worktree: false })
    const dev = (await app.waitState((s) => s.panes.some((p) => p.name === 'dev-1'))).panes.find((p) => p.name === 'dev-1')!.id
    await hook(o, dev, { hook_event_name: 'SessionStart', session_id: 's-d', cwd: repo.dir, source: 'startup' })
    await hook(o, dev, { hook_event_name: 'Stop', session_id: 's-d', cwd: repo.dir })
    await app.waitState((s) => s.panes.find((p) => p.id === dev)?.claude?.status === 'your-turn')
    await app.client.request({ t: 'pane.attach', paneId: dev })
    await call('mandar_mensagem', { para: 'dev-1', texto: 'naoExecuteZ9' })
    await new Promise((r) => setTimeout(r, 2500))
    expect(app.output(dev)).not.toContain('naoExecuteZ9')
    expect((JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).mailbox as { state: string }[]).map((m) => m.state)).toEqual(['na-fila'])
  })

  it('mensagens: dev manda ao líder, fila, entrega e regras de equipe', async () => {
    repo = makeRepo()
    const { o, app, leader, call } = await leaderIn(repo.dir, { env: fakeTeamEnv() })
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await app.client.request({ t: 'pane.meta', paneId: leader, name: 'lider' })
    await call('contratar_dev', { nome: 'dev-1', worktree: false })
    const dev = (await app.waitState((s) => s.panes.some((p) => p.name === 'dev-1'))).panes.find((p) => p.name === 'dev-1')!.id
    const callDev = (tool: string, args: Record<string, unknown>) => app.client.request<Record<string, unknown>>({ t: 'mcp.call', callerPaneId: dev, tool, args })
    for (const id of [leader, dev]) {
      await hook(o, id, { hook_event_name: 'SessionStart', session_id: `s-${id}`, cwd: repo.dir, source: 'startup' })
      await hook(o, id, { hook_event_name: 'Stop', session_id: `s-${id}`, cwd: repo.dir })
    }
    await app.waitState((s) => s.panes.filter((p) => p.claude?.status === 'your-turn').length === 2)
    await app.client.request({ t: 'pane.attach', paneId: leader })
    await callDev('mandar_mensagem', { para: 'lider', texto: 'terminei a parte 1' })
    await app.waitState(() => app.output(leader).includes('[equipe] de dev-1'))
    expect(app.output(leader)).toContain('terminei a parte 1')

    // regras de equipe
    const { paneId: solta } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await app.client.request({ t: 'pane.meta', paneId: solta, name: 'x' })
    const callSolta = (tool: string, args: Record<string, unknown>) => app.client.request<Record<string, unknown>>({ t: 'mcp.call', callerPaneId: solta, tool, args })
    await expect(callDev('mandar_mensagem', { para: 'x', texto: 'oi' })).rejects.toThrow('fora da sua equipe: x')
    await expect(callDev('mandar_mensagem', { para: 'dev-1', texto: 'oi' })).rejects.toThrow('não dá para mandar mensagem para si mesmo')
    await expect(callDev('mandar_mensagem', { para: 'zzz', texto: 'oi' })).rejects.toThrow('sessão não encontrada neste espaço: zzz')
    await expect(callSolta('mandar_mensagem', { para: 'lider', texto: 'oi' })).rejects.toThrow('esta sessão não está numa equipe')

    // o dev também enxerga a equipe
    const equipe = (await callDev('listar_equipe', {})) as unknown as Record<string, unknown>[]
    expect(equipe.map((m) => m.nome).sort()).toEqual(['dev-1', 'lider'])
    for (const m of equipe) expect(m).toEqual(expect.objectContaining({ nome: expect.any(String), cli: 'Claude', status: expect.any(String), desde_s: expect.any(Number), fila: expect.any(Number), atrasada: false }))
  })

  it('contratar: líder em HEAD solto pedindo worktree → erro e nada criado', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    repo.git('checkout', '--detach')
    await waitFor(async () => ((await app.client.request<{ projects: { worktrees: { branch: string | null }[] }[] }>({ t: 'state.get' })).projects[0].worktrees[0].branch === null ? true : null), 8000)
    await expect(call('contratar_dev', { nome: 'dev-1' })).rejects.toThrow('HEAD solto')
    expect(app.state()!.panes.some((p) => p.name === 'dev-1')).toBe(false)
  })
  it('flutuante: opacidade do fundo lembrada por painel, limitada entre 0 e 1', async () => {
    const { app } = await boot()
    const { paneId: b } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: '/', accountId: null, cols: 80, rows: 24 })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'float' })
    await app.client.request({ t: 'float.prefs', paneId: b, opacity: 0.6 })
    let st = await app.waitState((s) => s.workspaces[0].floating[0]?.opacity === 0.6)
    expect(st.workspaces[0].floating[0]).toMatchObject({ paneId: b, opacity: 0.6, onTop: true })
    await app.client.request({ t: 'float.prefs', paneId: b, opacity: -2 })
    st = await app.waitState((s) => s.workspaces[0].floating[0]?.opacity === 0)
    await app.client.request({ t: 'float.prefs', paneId: b, opacity: 7 })
    st = await app.waitState((s) => s.workspaces[0].floating[0]?.opacity === 1)
    expect(st.workspaces[0].floating[0].opacity).toBe(1)
  })
  it('flutuante: flutuar, encaixar na aba ativa, esconder; prefs lembradas', async () => {
    const { app } = await boot()
    const mk = async () => (await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: '/', accountId: null, cols: 80, rows: 24 })).paneId
    const a = await mk()
    const b = await mk()
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'A', root: { type: 'leaf', paneId: a } }], activeTabId: 't' } })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'float' })
    let st = await app.waitState((s) => s.floating.includes(b))
    expect(st.workspaces.find((w) => w.id === 'principal')!.floating).toEqual([{ paneId: b, bounds: null, onTop: true, allDesks: false, opacity: 1 }])
    await app.client.request({ t: 'float.prefs', paneId: b, bounds: { x: 10, y: 20, width: 500, height: 300 }, allDesks: true })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'dock' })
    st = await app.waitState((s) => !s.floating.includes(b))
    expect(st.layout.tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: a }, { type: 'leaf', paneId: b }] })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'float' })
    st = await app.waitState((s) => s.floating.includes(b))
    expect(st.workspaces[0].floating[0]).toEqual({ paneId: b, bounds: { x: 10, y: 20, width: 500, height: 300 }, onTop: true, allDesks: true, opacity: 1 })
    // esconder: sai das flutuantes sem mexer na grade (flutuar já tinha tirado a folha)
    const before = st.layout
    expect(JSON.stringify(before)).not.toContain(b)
    await app.client.request({ t: 'float.set', paneId: b, mode: 'hide' })
    st = await app.waitState((s) => !s.floating.includes(b))
    expect(st.layout).toEqual(before)
  })

  it('flutuante: painel de arquivo flutuando não é podado pelo layout.save', async () => {
    const { app } = await boot()
    await app.client.request({ t: 'filepane.set', id: 'file:x', path: '/etc/hosts', mode: 'view' })
    await app.client.request({ t: 'float.set', paneId: 'file:x', mode: 'float' })
    await app.client.request({ t: 'layout.save', layout: { tabs: [], activeTabId: null } })
    const st = await app.client.request<{ filePanes: Record<string, unknown>; floating: string[] }>({ t: 'state.get' })
    expect(st.floating).toEqual(['file:x'])
    expect(st.filePanes['file:x']).toBeTruthy()
  })

  it('contratar: onde flutuante abre o dev numa flutuante, fora do layout', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await call('contratar_dev', { nome: 'dev-f', worktree: false, onde: 'flutuante' })
    const st = await app.waitState((s) => s.panes.some((p) => p.name === 'dev-f'))
    const id = st.panes.find((p) => p.name === 'dev-f')!.id
    await app.waitState((s) => s.floating.includes(id))
    expect(JSON.stringify((await app.client.request<{ layout: unknown }>({ t: 'state.get' })).layout)).not.toContain(id)
  })
  it('flutuante: painel esquecido (processo terminou e foi fechado) sai das flutuantes', async () => {
    const { app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: '/', accountId: null, cols: 80, rows: 24 })
    await app.client.request({ t: 'float.set', paneId, mode: 'float' })
    await app.waitState((s) => s.floating.includes(paneId))
    await app.client.request({ t: 'pane.forget', paneId })
    await app.waitState((s) => !s.floating.includes(paneId))
  })
})

describe('monitor da máquina', () => {
  const G = 1024 ** 3
  const fakeCpus = () => {
    let n = 0
    return () => {
      n++
      return [{ model: '', speed: 0, times: { user: n * 50, nice: 0, sys: 0, idle: n * 50, irq: 0 } }]
    }
  }
  const mem = (p: Record<string, unknown> = {}) => async () => ({ ramUsed: 10 * G, ramTotal: 24 * G, swapUsed: 0, swapTotal: 0, pressure: 'normal' as const, ...p })

  it('manda machine às janelas e a última leitura a quem conecta depois', async () => {
    const { o, app } = await boot({ machineMem: mem(), machineCpus: fakeCpus(), machineIntervalMs: 40 })
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    expect(app.machine()[0].machine).toMatchObject({ cpu: 50, level: 'ok', ram: { total: 24 * G } })
    expect(app.machine()[0].detail).toBeUndefined()
    const late = await connectApp(o.socketPath)
    await waitFor(() => (late.machine().length > 0 ? true : null), 3000)
  })

  it('watch traz o detalhe; unwatch e conexão fechada param o ps', async () => {
    let psCalls = 0
    const machinePs = async () => {
      psCalls++
      return [{ pid: 1, ppid: 0, rss: 1024, cpu: 1, etime: '01:00', args: '/sbin/launchd' }]
    }
    const { o, app } = await boot({ machineMem: mem(), machineCpus: fakeCpus(), machineIntervalMs: 40, machinePs })
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    expect(psCalls).toBe(0) // sem painel aberto, sem ps
    app.client.send({ t: 'machine.watch' })
    await waitFor(() => (app.machine().some((m) => m.detail) ? true : null), 3000)
    expect(app.machine().find((m) => m.detail)!.detail!.groups.map((g) => g.key)).toEqual(['colima', 'emulador'])
    app.client.send({ t: 'machine.unwatch' })
    await new Promise((r) => setTimeout(r, 100))
    const after = psCalls
    await new Promise((r) => setTimeout(r, 200))
    expect(psCalls).toBe(after)
    // janela fecha com o painel aberto: para também
    const other = await connectApp(o.socketPath)
    other.client.send({ t: 'machine.watch' })
    await waitFor(() => (other.machine().some((m) => m.detail) ? true : null), 3000)
    other.client.close()
    await new Promise((r) => setTimeout(r, 100))
    const closed = psCalls
    await new Promise((r) => setTimeout(r, 200))
    expect(psCalls).toBe(closed)
  })

  const critical = { machineMem: mem({ pressure: 'critica' }), machineCpus: fakeCpus(), machineIntervalMs: 40, machinePs: async () => [] }

  it('gate: máquina no vermelho recusa sem criar nada; forcar passa com aviso', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir, critical)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await waitFor(() => (app.machine().at(-1)?.machine.level === 'bad' ? true : null), 3000)
    await expect(call('contratar_dev', { nome: 'dev-1' })).rejects.toThrow(/Máquina sobrecarregada: pressão crítica .*forcar: true/)
    expect(fs.existsSync(path.join(repo.dir, '.claude', 'worktrees', 'dev-1'))).toBe(false)
    expect((await app.client.request<{ panes: unknown[] }>({ t: 'state.get' })).panes).toHaveLength(1)
    const r = await call('contratar_dev', { nome: 'dev-1', worktree: false, forcar: true })
    expect(r).toMatchObject({ nome: 'dev-1', aviso: 'contratado com a máquina sobrecarregada (pressão crítica)' })
  })

  it('gate: amarelo contrata com aviso; sem leitura contrata com aviso', async () => {
    repo = makeRepo()
    const warn = await leaderIn(repo.dir, { machineMem: mem({ pressure: 'alerta' }), machineCpus: fakeCpus(), machineIntervalMs: 40 })
    await warn.app.client.request({ t: 'pane.setLeader', paneId: warn.leader, leader: true })
    await waitFor(() => (warn.app.machine().length > 0 ? true : null), 3000)
    expect(await warn.call('contratar_dev', { nome: 'dev-1', worktree: false })).toMatchObject({ aviso: 'máquina no limite: pressão em alerta' })
    const blind = await leaderIn(repo.dir) // leitor padrão inerte: nunca há leitura
    await blind.app.client.request({ t: 'pane.setLeader', paneId: blind.leader, leader: true })
    expect(await blind.call('contratar_dev', { nome: 'dev-2', worktree: false })).toMatchObject({ aviso: 'não consegui medir a máquina' })
  })

  it('uso_da_maquina: qualquer sessão consulta (sem ser líder)', async () => {
    repo = makeRepo()
    const { app, call } = await leaderIn(repo.dir, critical)
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    expect(await call('uso_da_maquina', {})).toMatchObject({ nivel: 'bad', pressao: 'pressão crítica', ram: '10,0/24,0 GB' })
  })

  it('watch é um aluguel: sem renovar (janela recarregou), o ps para; renovando, continua', async () => {
    let psCalls = 0
    const machinePs = async () => {
      psCalls++
      return []
    }
    const { app } = await boot({ machineMem: mem(), machineCpus: fakeCpus(), machineIntervalMs: 40, machinePs })
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    const renew = setInterval(() => app.client.send({ t: 'machine.watch' }), 40)
    await new Promise((r) => setTimeout(r, 400))
    clearInterval(renew)
    const renewed = psCalls
    expect(renewed).toBeGreaterThan(4)
    // parou de renovar e nunca mandou unwatch
    await new Promise((r) => setTimeout(r, 400))
    const settled = psCalls
    await new Promise((r) => setTimeout(r, 300))
    expect(psCalls).toBe(settled)
  })

  it('limites novos nas preferências recalculam o nível', async () => {
    const { app } = await boot({ machineMem: mem({ swapUsed: 10 * G }), machineCpus: fakeCpus(), machineIntervalMs: 40 })
    await waitFor(() => (app.machine().at(-1)?.machine.level === 'warn' ? true : null), 3000)
    const s0 = (await app.client.request<{ settings: TerminalSettings }>({ t: 'state.get' })).settings
    await app.client.request({ t: 'settings.save', settings: { ...s0, machine: { ...s0.machine, swapWarn: 50, swapBad: 80 } } })
    await waitFor(() => (app.machine().at(-1)?.machine.level === 'ok' ? true : null), 3000)
  })
})
