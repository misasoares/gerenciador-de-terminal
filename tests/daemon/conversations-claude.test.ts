import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeFilesFor, findClaudeFile, readClaudeConversation } from '../../src/daemon/conversations/claude'
import { jsonLines, pool, projectDirName } from '../../src/daemon/conversations/files'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cv-')))
const line = (o: unknown) => JSON.stringify(o)
const user = (text: unknown, extra: Record<string, unknown> = {}) => line({ type: 'user', message: { role: 'user', content: text }, cwd: '/r/api', gitBranch: 'feat/x', timestamp: '2026-10-01T10:00:00Z', ...extra })

function writeConv(profile: string, cwd: string, id: string, lines: string[]): string {
  const f = path.join(profile, 'projects', projectDirName(cwd), `${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, lines.join('\n') + '\n')
  return f
}

describe('arquivos de conversa', () => {
  it('projectDirName troca tudo fora de [A-Za-z0-9-] por -', () => {
    expect(projectDirName('/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal')).toBe('-Volumes-SSD-MISA-apps-misa-gerenciador-de-terminal')
    expect(projectDirName('/r/api/.claude/worktrees/feat_x')).toBe('-r-api--claude-worktrees-feat-x')
  })

  it.skipIf(!fs.existsSync(path.join(os.homedir(), '.claude', 'projects')))('confere a regra contra pastas reais de ~/.claude/projects', () => {
    const root = path.join(os.homedir(), '.claude', 'projects')
    let checked = 0
    let matched = 0
    for (const dir of fs.readdirSync(root).slice(0, 60)) {
      const files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.jsonl'))
      if (!files.length) continue
      const first = jsonLines(fs.readFileSync(path.join(root, dir, files[0]), 'utf8').slice(0, 65536)).find((o) => typeof o.cwd === 'string')
      if (!first) continue
      checked++
      // a pasta é a do início da sessão: algum cwd do arquivo bate com a regra
      const cwds = jsonLines(fs.readFileSync(path.join(root, dir, files[0]), 'utf8').slice(0, 65536)).map((o) => o.cwd).filter((c): c is string => typeof c === 'string')
      // sessões iniciadas numa worktree ficam na pasta da worktree mesmo com cwd da principal: a regra vale para a maioria
      if (cwds.map(projectDirName).includes(dir)) matched++
    }
    expect(checked).toBeGreaterThan(0)
    expect(matched / checked).toBeGreaterThan(0.8)
  })

  it('jsonLines ignora linha cortada e lixo; pool respeita o limite', async () => {
    expect(jsonLines('{"a":1}\nlixo\n{"b":2}\n{"c":')).toEqual([{ a: 1 }, { b: 2 }])
    let active = 0
    let max = 0
    const out = await pool([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(max).toBe(2)
  })
})

describe('conversas do Claude', () => {
  it('lê 1ª mensagem (ignorando sistema), branch, cwd de início, título e mensagens', async () => {
    const p = tmp()
    const f = writeConv(p, '/r/api', 's1', [
      user('<command-name>/clear</command-name>'),
      user('<local-command-stdout>x</local-command-stdout>', { isMeta: true }),
      user([{ type: 'text', text: 'Refatore o login' }]),
      line({ type: 'assistant', message: { role: 'assistant', content: 'ok' } }),
      line({ type: 'ai-title', aiTitle: 'Refatorar login' }),
      user('mais uma', { cwd: '/r/api/.claude/worktrees/x' }),
      line({ type: 'custom-title', customTitle: 'auth' }),
      '{"type":"user","message":',
    ])
    const c = await readClaudeConversation(f, p)
    expect(c).toMatchObject({ agent: 'claude', sessionId: 's1', profile: p, startCwd: '/r/api', firstPrompt: 'Refatore o login', title: 'auth', branch: 'feat/x', messages: 2 })
    expect(c!.lastActivity).toBe(fs.statSync(f).mtimeMs)
  })

  it('sem título usa ai-title; sem mensagem nem título não lista', async () => {
    const p = tmp()
    const a = writeConv(p, '/r/api', 'a', [user('oi'), line({ type: 'ai-title', aiTitle: 'Saudação' })])
    expect((await readClaudeConversation(a, p))?.title).toBe('Saudação')
    const b = writeConv(p, '/r/api', 'b', [line({ type: 'summary', summary: 'x' })])
    expect(await readClaudeConversation(b, p)).toBeNull()
    const vazio = writeConv(p, '/r/api', 'c', [])
    expect(await readClaudeConversation(vazio, p)).toBeNull()
  })

  it('claudeFilesFor lista os .jsonl da pasta; findClaudeFile acha pelo id em qualquer perfil', async () => {
    const p1 = tmp()
    const p2 = tmp()
    writeConv(p1, '/r/api', 'a', [user('oi')])
    const b = writeConv(p2, '/r/outra', 'b', [user('oi')])
    expect((await claudeFilesFor(p1, '/r/api')).map((f) => path.basename(f))).toEqual(['a.jsonl'])
    expect(await claudeFilesFor(p1, '/r/nada')).toEqual([])
    expect(await claudeFilesFor('/nao/existe', '/r/api')).toEqual([])
    expect(await findClaudeFile([p1, p2], 'b')).toEqual({ file: b, profile: p2 })
    expect(await findClaudeFile([p1, p2], 'zzz')).toBeNull()
  })
})
