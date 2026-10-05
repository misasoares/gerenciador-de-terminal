import type { AppState } from '../../shared/types'

/** revelar um painel flutuante foca a janela dele; nunca o põe de volta na grade */
export function revealTarget(app: Pick<AppState, 'floating'>, paneId: string): 'float' | 'grid' {
  return app.floating.includes(paneId) ? 'float' : 'grid'
}
