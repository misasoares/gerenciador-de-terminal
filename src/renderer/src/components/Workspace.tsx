import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type React from 'react'
import { useState } from 'react'
import type { Layout, LayoutNode } from '../../../shared/types'
import { addTab, closeTab, renameTab, saveSizes } from '../actions'
import { leaves } from '../layout'
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
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="tabbar">
      {layout.tabs.map((t, i) => (
        <div
          key={t.id}
          className={`tab${t.id === layout.activeTabId ? ' active' : ''}`}
          onClick={() => updateLayout((l) => ({ ...l, activeTabId: t.id }))}
          onDoubleClick={() => setEditing(t.id)}
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
