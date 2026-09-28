import fs from 'node:fs'
import { readClaude, realKeychain, type ClaudeDeps } from './claude'
import { readCodex } from './codex'
import type { Login, ReadResult } from './types'

/** leitor real (Keychain/arquivo + rede); só o main.ts do daemon usa */
export function makeUsageReader(o: { userHome: string }): (login: Login) => Promise<ReadResult> {
  const claude: ClaudeDeps = {
    platform: process.platform,
    userHome: o.userHome,
    now: Date.now,
    keychain: realKeychain,
    readFile: (p) => fs.promises.readFile(p, 'utf8').catch(() => null),
    fetch: globalThis.fetch,
  }
  return (login) => (login.agent === 'claude' ? readClaude(login, claude) : readCodex(login, { userHome: o.userHome }))
}
