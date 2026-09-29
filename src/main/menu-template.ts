import type { MenuItemConstructorOptions } from 'electron'
import { ACTIONS, LINUX_EDIT, type Bindings, type Platform } from '../shared/keybindings'

export interface MenuOptions {
  send(action: string): void
  quitAll(): void
  platform: Platform
  bindings: Bindings
}

/** template do menu (sem Electron em tempo de execução: testável) */
export function menuTemplate(o: MenuOptions): MenuItemConstructorOptions[] {
  const item = (action: string): MenuItemConstructorOptions => ({
    label: ACTIONS.find((a) => a.id === action)?.label ?? action,
    accelerator: o.bindings[action] ?? undefined,
    click: () => o.send(action),
  })
  // no Linux o Ctrl puro é do shell: copiar/colar vão para Ctrl+Shift, como nos terminais de lá
  const edit: MenuItemConstructorOptions =
    o.platform === 'mac'
      ? { role: 'editMenu' }
      : {
          label: 'Editar',
          submenu: [
            { role: 'copy', label: 'Copiar', accelerator: LINUX_EDIT.copy },
            { role: 'paste', label: 'Colar', accelerator: LINUX_EDIT.paste },
            { role: 'selectAll', label: 'Selecionar tudo', accelerator: LINUX_EDIT.selectAll },
          ],
        }
  return [
    {
      label: 'Gerenciador de Terminal',
      submenu: [
        { role: 'about', label: 'Sobre' },
        { type: 'separator' },
        item('preferences'),
        { label: 'Configurar agentes…', click: () => o.send('setup') },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { type: 'separator' },
        { label: 'Encerrar tudo (inclusive as sessões)…', click: () => o.quitAll() },
        { role: 'quit', label: 'Sair (as sessões continuam rodando)' },
      ],
    },
    edit,
    {
      label: 'Sessão',
      submenu: [
        item('new-session'),
        item('split-right'),
        item('split-down'),
        item('hide-pane'),
        item('next-attention'),
        item('palette'),
        { type: 'separator' },
        item('focus-left'),
        item('focus-right'),
        item('focus-up'),
        item('focus-down'),
      ],
    },
    {
      label: 'Abas',
      submenu: [item('new-tab'), { type: 'separator' }, ...Array.from({ length: 9 }, (_, i) => item(`tab-${i + 1}`))],
    },
    {
      label: 'Exibir',
      submenu: [
        item('toggle-sidebar'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Janela',
      submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ]
}
