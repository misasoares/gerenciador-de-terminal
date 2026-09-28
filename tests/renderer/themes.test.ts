import { describe, expect, it } from 'vitest'
import { THEMES } from '../../src/renderer/src/themes'
import { THEME_IDS } from '../../src/shared/settings'

const KEYS = ['background', 'foreground', 'cursor', 'selectionBackground', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const

describe('temas', () => {
  it('um tema completo para cada id', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort())
    for (const id of THEME_IDS) for (const k of KEYS) expect(THEMES[id].xterm[k], `${id}.${k}`).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
