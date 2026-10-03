import { makeDaemonCall } from './daemon-call'
import { serveLines } from './protocol'

// roda com o binário do app (ELECTRON_RUN_AS_NODE=1), lançado pelo Claude via --mcp-config
serveLines(process.stdin, process.stdout, makeDaemonCall(process.env))
