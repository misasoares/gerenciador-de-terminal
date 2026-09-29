import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { menuTemplate } from '../../src/main/menu-template'
import { resolveBindings } from '../../src/shared/keybindings'

function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])])
}
const build = (platform: 'mac' | 'linux', overrides = {}) =>
  flat(menuTemplate({ send: () => {}, quitAll: () => {}, platform, bindings: resolveBindings(platform, overrides) }))
const accelOf = (items: MenuItemConstructorOptions[], label: string) => items.find((i) => i.label === label)?.accelerator

describe('menuTemplate', () => {
  it('Mac: atalhos de hoje e editMenu padrão', () => {
    const m = build('mac')
    expect(accelOf(m, 'Dividir à direita')).toBe('Cmd+D')
    expect(accelOf(m, 'Aba 3')).toBe('Cmd+3')
    expect(m.some((i) => i.role === 'editMenu')).toBe(true)
  })
  it('Linux: nenhum Ctrl puro, editar em Ctrl+Shift', () => {
    const m = build('linux')
    const accels = m.map((i) => i.accelerator).filter(Boolean)
    for (const bad of ['Ctrl+C', 'Ctrl+V', 'Ctrl+D', 'Ctrl+W', 'Ctrl+T', 'Ctrl+K', 'Ctrl+B', 'Ctrl+J']) expect(accels).not.toContain(bad)
    expect(m.some((i) => i.role === 'editMenu')).toBe(false)
    expect(m.find((i) => i.role === 'copy')?.accelerator).toBe('Ctrl+Shift+C')
    expect(m.find((i) => i.role === 'paste')?.accelerator).toBe('Ctrl+Shift+V')
  })
  it('usa as alterações e deixa sem atalho quando null', () => {
    const m = build('linux', { 'split-right': 'Ctrl+Shift+R', palette: null })
    expect(accelOf(m, 'Dividir à direita')).toBe('Ctrl+Shift+R')
    expect(accelOf(m, 'Buscar…')).toBeUndefined()
  })
  it('clique manda o id da ação', () => {
    const sent: string[] = []
    const m = flat(menuTemplate({ send: (a) => sent.push(a), quitAll: () => {}, platform: 'linux', bindings: resolveBindings('linux', {}) }))
    ;(m.find((i) => i.label === 'Nova aba')?.click as () => void)()
    expect(sent).toEqual(['new-tab'])
  })
})
