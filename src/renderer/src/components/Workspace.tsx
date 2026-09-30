import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type React from 'react'
import { useMemo, useState } from 'react'
import { tabAttention } from '../attention'
import type { Layout, LayoutNode } from '../../../shared/types'
import { activateTab, addTab, closeTab, renameTab, saveSizes } from '../actions'
import { leaves, moveTab, tabInsertIndex } from '../layout'

const TAB_MIME = 'application/x-gt-tab'

function tabMids(bar: HTMLElement): number[] {
  return [...bar.querySelectorAll<HTMLElement>(':scope > .tab')].map((el) => {
    const r = el.getBoundingClientRect()
    return r.left + r.width / 2
  })
}
import { tabMenu } from '../flows'
import { textOn } from '../header'
import { updateLayout, useUi } from '../store'
import { PaneFrame } from './PaneFrame'

const nodeKey = (n: LayoutNode): string => (n.type === 'leaf' ? n.paneId : `split:${leaves(n).join(',')}`)

function SplitNode({ node, tabId, path }: { node: LayoutNode; tabId: string; path: number[] }) {
  if (node.type === 'leaf') return <PaneFrame paneId={node.paneId} onAddProject={addProject} />
  return (
    <Allotment
      vertical={node.dir === 'column'}
      defaultSizes={node.sizes.length === node.children.length ? node.sizes : undefined}
      onChange={(sizes) => saveSizes(tabId, path, sizes)}
    >
      {node.children.map((c, i) => (
        <Allotment.Pane key={nodeKey(c)} minSize={160}>
          <SplitNode node={c} tabId={tabId} path={[...path, i]} />
        </Allotment.Pane>
      ))}
    </Allotment>
  )
}

function TabBar({ layout }: { layout: Layout }) {
  const panes = useUi((s) => s.app?.panes)
  const attn = useMemo(() => tabAttention(layout, panes ?? []), [layout, panes])
  const [editing, setEditing] = useState<string | null>(null)
  /** posição de inserção (0..n) enquanto uma aba é arrastada */
  const [dropAt, setDropAt] = useState<number | null>(null)
  return (
    <div
      className="tabbar"
      // o soltar é da barra inteira: vale também o espaço vazio depois da última aba e o botão +
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        e.preventDefault()
        setDropAt(tabInsertIndex(tabMids(e.currentTarget), e.clientX))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(TAB_MIME)
        setDropAt(null)
        if (!id) return
        e.preventDefault()
        const to = tabInsertIndex(tabMids(e.currentTarget), e.clientX)
        updateLayout((l) => moveTab(l, id, to))
      }}
    >
      {layout.tabs.map((t, i) => (
        <div
          key={t.id}
          className={`tab${t.id === layout.activeTabId ? ' active' : ''}${t.color ? ' colored' : ''}${dropAt === i ? ' drop-before' : ''}${dropAt === i + 1 && i === layout.tabs.length - 1 ? ' drop-after' : ''}`}
          draggable={editing !== t.id}
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_MIME, t.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDropAt(null)}
          style={t.color ? { background: t.color, color: textOn(t.color) } : undefined}
          onClick={() => activateTab(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            void tabMenu(t).then((r) => r === 'rename' && setEditing(t.id))
          }}
        >
          {editing === t.id ? (
            <input
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => {
                renameTab(t.id, e.target.value)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span>{t.name}</span>
          )}
          {attn[t.id] && <span className={`tab-dot ${attn[t.id]}`} title={attn[t.id] === 'needs-you' ? 'precisa de você' : 'sua vez'} />}
          {i < 9 && <span className="tab-key">⌘{i + 1}</span>}
          <button
            className="tab-close"
            title="Fechar aba (as sessões continuam rodando)"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="tab-add" title="Nova aba (⇧⌘T)" onClick={addTab}>
        +
      </button>
    </div>
  )
}

let addProject: ((dir: string) => void) | undefined

export function Workspace({ empty, onAddProject }: { empty?: React.ReactNode; onAddProject?: (dir: string) => void }) {
  addProject = onAddProject
  const layout = useUi((s) => s.app?.layout)
  if (!layout) return null
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)
  return (
    <div className="workspace">
      <TabBar layout={layout} />
      <div className="tab-body">
        {tab?.root ? (
          <SplitNode key={tab.id} node={tab.root} tabId={tab.id} path={[]} />
        ) : (
          (empty ?? <div className="empty">Nenhum painel aqui. ⌘T abre uma nova sessão; ⌘D abre um terminal.</div>)
        )}
      </div>
    </div>
  )
}
