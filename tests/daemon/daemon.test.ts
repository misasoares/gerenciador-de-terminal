import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Daemon, type DaemonOptions } from '../../src/daemon/daemon'
import { buildPaneEnv } from '../../src/daemon/panes'
import { connectApp } from '../helpers/app-client'
import { RpcClient } from '../../src/shared/rpc-client'
import { makeRepo, type TestRepo } from '../helpers/repo'
import { runWithInput } from '../helpers/run'

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
  return { o, d, app, home }
}

function hook(o: DaemonOptions, paneId: string, payload: Record<string, unknown>, configDir?: string) {
  return runWithInput('/bin/sh', [o.hookScriptPath], JSON.stringify(payload), {
    PATH: '/usr/bin:/bin', GT_PANE_ID: paneId, GT_SOCKET: o.socketPath, ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
  })
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
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.resumable[0]).toEqual({ paneId, cwd: repo.dir, accountId: 'misa', sessionId: 'abcd-1234' })
    expect(st.panes).toEqual([])

    await second.app.client.request({ t: 'pane.create', paneId, cwd: repo.dir, accountId: 'misa', resumeSessionId: 'abcd-1234', cols: 80, rows: 24 })
    const { snapshot } = await second.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    await second.app.waitState((s) => s.resumable.length === 0 && s.panes[0]?.id === paneId)
    await second.app.waitState(() => (snapshot + second.app.output(paneId)).includes('claude --resume abcd-1234'))
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
    await first.app.client.request({ t: 'settings.save', settings: { theme: 'dracula', fontFamily: 'JetBrains Mono', fontSize: 99, lineHeight: 1.3 } })
    await first.app.waitState((s) => s.settings.theme === 'dracula' && s.settings.fontSize === 24)
    await new Promise((r) => setTimeout(r, 400))
    first.app.client.close()
    await first.d.stop(true)
    daemons = []
    const second = await boot({}, first.home)
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.settings).toMatchObject({ theme: 'dracula', fontFamily: 'JetBrains Mono', fontSize: 24 })
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

  it('erros de requisição voltam como mensagem', async () => {
    const { app } = await boot()
    await expect(app.client.request({ t: 'pane.create', cwd: '/', accountId: 'nao-existe', cols: 80, rows: 24 })).rejects.toThrow('conta desconhecida')
    await expect(app.client.request({ t: 'project.add', path: '/' })).rejects.toThrow('não é um repositório git')
  })
})
