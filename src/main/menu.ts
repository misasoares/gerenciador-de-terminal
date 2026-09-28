import { Menu, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(o: { send(action: string): void; quitAll(): void }): Menu {
  const item = (label: string, accelerator: string, action: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => o.send(action),
  })
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Gerenciador de Terminal',
      submenu: [
        { role: 'about', label: 'Sobre' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { type: 'separator' },
        { label: 'Encerrar tudo (inclusive as sessões)…', click: () => o.quitAll() },
        { role: 'quit', label: 'Sair (as sessões continuam rodando)' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Sessão',
      submenu: [
        item('Nova sessão…', 'CmdOrCtrl+T', 'new-session'),
        item('Dividir à direita', 'CmdOrCtrl+D', 'split-right'),
        item('Dividir abaixo', 'CmdOrCtrl+Shift+D', 'split-down'),
        item('Esconder painel', 'CmdOrCtrl+W', 'hide-pane'),
        item('Próxima que precisa de mim', 'CmdOrCtrl+J', 'next-attention'),
        { type: 'separator' },
        item('Foco à esquerda', 'Alt+CmdOrCtrl+Left', 'focus-left'),
        item('Foco à direita', 'Alt+CmdOrCtrl+Right', 'focus-right'),
        item('Foco acima', 'Alt+CmdOrCtrl+Up', 'focus-up'),
        item('Foco abaixo', 'Alt+CmdOrCtrl+Down', 'focus-down'),
      ],
    },
    {
      label: 'Abas',
      submenu: [
        item('Nova aba', 'CmdOrCtrl+Shift+T', 'new-tab'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => item(`Aba ${i + 1}`, `CmdOrCtrl+${i + 1}`, `tab-${i + 1}`)),
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        item('Mostrar/recolher sidebar', 'CmdOrCtrl+B', 'toggle-sidebar'),
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
  return Menu.buildFromTemplate(template)
}
