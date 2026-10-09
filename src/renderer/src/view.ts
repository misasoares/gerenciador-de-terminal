/** que janela é esta: a de um espaço (padrão), a tela de reabrir ou uma flutuante */
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
export const VIEW = q.get('view')
/** painel mostrado por esta janela flutuante (null fora dela) */
export const FLOAT_PANE = VIEW === 'float' ? q.get('pane') : null
/** flutuante no mac: fundo translúcido sobre o vidro do sistema (borrão do que está atrás) */
export const GLASS = FLOAT_PANE !== null && typeof window !== 'undefined' && window.gt?.platform === 'darwin'
/** janela de espaço criada transparente (fundo "mesa do macOS") */
export const WINDOW_DESKTOP = q.get('desktop') === '1'
/** composição por GPU disponível (sem ela, nada de desfoque animado — Linux sem aceleração) */
export const GPU_OK = q.get('gpu') !== '0'
/** janela aberta logo após atualizar para esta versão: retoma as sessões sozinha */
export const UPDATED_TO = q.get('updated')
