import { Menu } from 'electron'
import { menuTemplate, type MenuOptions } from './menu-template'

export function buildMenu(o: MenuOptions): Menu {
  return Menu.buildFromTemplate(menuTemplate(o))
}
