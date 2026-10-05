/** que janela é esta: a de um espaço (padrão), a tela de reabrir ou uma flutuante */
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
export const VIEW = q.get('view')
/** painel mostrado por esta janela flutuante (null fora dela) */
export const FLOAT_PANE = VIEW === 'float' ? q.get('pane') : null
