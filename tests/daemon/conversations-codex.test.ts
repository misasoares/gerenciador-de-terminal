import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexFiles, findCodexFile, readCodexConversation } from '../../src/daemon/conversations/codex'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cx-')))
const meta = (id: string, cwd: string, extra: Record<string, unknown> = {}) => JSON.stringify({ timestamp: '2026-10-01T10:00:00Z', type: 'session_meta', payload: { id, cwd, git: { branch: 'main' }, base_instructions: 'x', ...extra } })
const userMsg = (text: string) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })

function writeRollout(home: string, id: string, lines: string[]): string {
  const f = path.join(home, 'sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, lines.join('\n') + '\n')
  return f
}

describe('conversas do Codex', () => {
  it('lê id, cwd, branch e a 1ª mensagem real (ignora contexto entre <>)', async () => {
    const h = tmp()
    const f = writeRollout(h, 'abc', [meta('abc', '/r/api'), userMsg('<environment_context>x</environment_context>'), userMsg('Corrija o build'), userMsg('e os testes')])
    expect(await readCodexConversation(f, h)).toMatchObject({ agent: 'codex', sessionId: 'abc', profile: h, startCwd: '/r/api', firstPrompt: 'Corrija o build', title: null, branch: 'main', messages: 2 })
  })

  it('sem mensagem do usuário, sem session_meta ou 1ª linha maior que a janela: não lista, sem erro', async () => {
    const h = tmp()
    expect(await readCodexConversation(writeRollout(h, 'a', [meta('a', '/r/api')]), h)).toBeNull()
    expect(await readCodexConversation(writeRollout(h, 'b', [userMsg('oi')]), h)).toBeNull()
    const enorme = writeRollout(h, 'c', [meta('c', '/r/api', { base_instructions: 'x'.repeat(300_000) }), userMsg('oi')])
    expect(await readCodexConversation(enorme, h)).toBeNull()
  })

  it('codexFiles lista os rollouts; findCodexFile acha pelo id no nome', async () => {
    const h = tmp()
    const f = writeRollout(h, 'abc-123', [meta('abc-123', '/r/api'), userMsg('oi')])
    fs.writeFileSync(path.join(path.dirname(f), 'outro.txt'), '')
    expect(await codexFiles(h)).toEqual([f])
    expect(await codexFiles('/nao/existe')).toEqual([])
    expect(await findCodexFile(['/nao/existe', h], 'abc-123')).toEqual({ file: f, profile: h })
    expect(await findCodexFile([h], 'zzz')).toBeNull()
  })
})
