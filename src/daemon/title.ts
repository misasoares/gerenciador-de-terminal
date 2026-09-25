import fs from 'node:fs'
import readline from 'node:readline'

export async function readTitle(transcriptPath: string): Promise<string | null> {
  let custom: string | null = null
  let ai: string | null = null
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of rl) {
      if (line.includes('"type":"custom-title"')) {
        try {
          const o = JSON.parse(line) as { customTitle?: unknown }
          if (typeof o.customTitle === 'string') custom = o.customTitle
        } catch {
          // linha quebrada
        }
      } else if (line.includes('"type":"ai-title"')) {
        try {
          const o = JSON.parse(line) as { aiTitle?: unknown }
          if (typeof o.aiTitle === 'string') ai = o.aiTitle
        } catch {
          // linha quebrada
        }
      }
    }
  } catch {
    return null
  }
  return custom ?? ai
}
