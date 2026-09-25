import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

export interface SpawnOptions {
  id: string
  shell: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

export interface PtyHostEvents {
  data(id: string, data: string): void
  exit(id: string, code: number): void
}

interface Entry {
  proc: pty.IPty
  term: Terminal
  ser: SerializeAddon
}

const SCROLLBACK = 10_000

export class PtyHost {
  private entries = new Map<string, Entry>()

  constructor(private events: PtyHostEvents) {}

  spawn(o: SpawnOptions): number {
    if (this.entries.has(o.id)) throw new Error(`terminal ${o.id} já existe`)
    const proc = pty.spawn(o.shell, o.args, { name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: o.cwd, env: o.env })
    const term = new Terminal({ cols: o.cols, rows: o.rows, scrollback: SCROLLBACK, allowProposedApi: true })
    const ser = new SerializeAddon()
    term.loadAddon(ser)
    this.entries.set(o.id, { proc, term, ser })

    // só repassa depois que o espelho processou: serialize() == tudo que já foi emitido
    proc.onData((data) => term.write(data, () => this.events.data(o.id, data)))
    proc.onExit(({ exitCode }) => {
      term.write('', () => {
        this.entries.delete(o.id)
        term.dispose()
        this.events.exit(o.id, exitCode)
      })
    })
    return proc.pid
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  pid(id: string): number | undefined {
    return this.entries.get(id)?.proc.pid
  }

  write(id: string, data: string): void {
    this.entries.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.entries.get(id)
    if (!e) return
    const c = Math.max(2, Math.floor(cols))
    const r = Math.max(1, Math.floor(rows))
    if (c === e.term.cols && r === e.term.rows) return
    e.proc.resize(c, r)
    e.term.resize(c, r)
  }

  serialize(id: string): string {
    const e = this.entries.get(id)
    if (!e) throw new Error(`terminal ${id} não existe`)
    return e.ser.serialize({ scrollback: SCROLLBACK })
  }

  kill(id: string): void {
    try {
      this.entries.get(id)?.proc.kill()
    } catch {
      // já morreu
    }
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }
}
