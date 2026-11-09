import { Allotment, type AllotmentHandle } from 'allotment'
import 'allotment/dist/style.css'
import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { animate, motion } from 'motion/react'
import { tabAttention } from '../attention'
import type { Layout, LayoutNode } from '../../../shared/types'
import { activateTab, addTab, closeTab, dockPaneAt, movePaneToNewTab, moveToTab, PANE_MIME, renameTab, saveSizes } from '../actions'
import { findTab, growDrag, leaves, minExtent, moveTab, setSizes, withSplitExtra, nodeKey, tabInsertIndex, type Side } from '../layout'

/** menor tamanho de um painel (com o respiro): abaixo disso a aba ganha rolagem em vez de espremer */
const MIN_PANE_W = 420
const MIN_PANE_H = 220

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
import { useMotionPreset } from '../use-motion'
import { shouldAnimateEnter } from '../pane-motion'
import { FilePane } from './FilePane'
import { isFilePane } from '../file-model'
import { isTeamPane } from '../team-model'
import { TeamPane } from './TeamPane'


/** painel novo entra crescendo de 96%; anima o painel (filho), não o slot: opacidade num ancestral cortaria o vidro (backdrop-filter) */
function PaneSlot({ tabId, paneId, children }: { tabId: string; paneId: string; children: React.ReactNode }) {
  const pr = useMotionPreset()
  const ref = useRef<HTMLDivElement>(null)
  const [enter] = useState(() => shouldAnimateEnter(tabId, paneId))
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild
    if (enter && el instanceof HTMLElement) void animate(el, { opacity: [0, 1], scale: [pr.reduced ? 1 : 0.96, 1] }, pr.enter)
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div ref={ref} className="pane-slot" data-pane-id={paneId}>
      {children}
    </div>
  )
}

/** layout provisório durante o arraste: só vai para o estado (e o disco) ao soltar */
interface LiveRoot {
  current(): { root: LayoutNode; extraAt(path: number[]): number | undefined }
  set(root: LayoutNode | null): void
}

function SplitNode({ node, tabId, path, live }: { node: LayoutNode; tabId: string; path: number[]; live: LiveRoot }) {
  // o slot dá o respiro entre painéis dos temas premium (no Padrão/Claro vale 0)
  if (node.type === 'leaf')
    return (
      <PaneSlot tabId={tabId} paneId={node.paneId}>
        {isFilePane(node.paneId) ? (
          <FilePane paneId={node.paneId} />
        ) : isTeamPane(node.paneId) ? (
          <TeamPane paneId={node.paneId} />
        ) : (
          <PaneFrame paneId={node.paneId} onAddProject={addProject} />
        )}
      </PaneSlot>
    )
  return <SplitBranch node={node} tabId={tabId} path={path} live={live} />
}

const axisMin = (n: LayoutNode, dir: 'row' | 'column') => {
  const e = minExtent(n, MIN_PANE_W, MIN_PANE_H)
  return dir === 'row' ? e.w : e.h
}

/** distância da borda da área visível em que o arraste passa a rolar a aba */
const EDGE = 28
const EDGE_STEP = 14

/** divisão: o arraste do divisor é nosso, porque o do Allotment não passa do tamanho atual da aba */
function SplitBranch({ node, tabId, path, live }: { node: Extract<LayoutNode, { type: 'split' }>; tabId: string; path: number[]; live: LiveRoot }) {
  const wrap = useRef<HTMLDivElement>(null)
  const handle = useRef<AllotmentHandle>(null)
  const cells = useRef<(HTMLDivElement | null)[]>([])
  const pending = useRef<number[] | null>(null)
  const horizontal = node.dir === 'row'

  // aplica os tamanhos quando a divisão já tem o total certo: se a aba mudou, isso só acontece depois do layout do Allotment
  const applyPending = () => {
    const el = wrap.current
    if (!el || !pending.current) return
    const size = horizontal ? el.clientWidth : el.clientHeight
    if (Math.abs(pending.current.reduce((a, b) => a + b, 0) - size) > 1) return
    handle.current?.resize(pending.current)
    pending.current = null
  }
  const apply = useRef(applyPending)
  apply.current = applyPending
  // criado depois do observador do Allotment (efeito do filho roda antes): roda logo após o layout dele, no mesmo quadro
  useEffect(() => {
    const ro = new ResizeObserver(() => apply.current())
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const sash = (e.target as HTMLElement).closest<HTMLElement>('[data-testid="sash"]')
    if (!sash || e.button !== 0 || sash.closest('.split-owner') !== wrap.current) return
    const scroller = wrap.current?.closest<HTMLElement>('.tab-scroll')
    const rects = node.children.map((_, i) => cells.current[i]?.getBoundingClientRect())
    if (!scroller || rects.some((r) => !r)) return
    e.preventDefault()
    e.stopPropagation()
    const sr = sash.getBoundingClientRect()
    const at = horizontal ? sr.left + sr.width / 2 : sr.top + sr.height / 2
    const ends = rects.map((r) => (horizontal ? r!.right : r!.bottom)).slice(0, -1)
    const index = ends.indexOf(ends.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a)))
    const base = {
      sizes: rects.map((r) => (horizontal ? r!.width : r!.height)),
      mins: node.children.map((c) => axisMin(c, node.dir)),
      index,
      extra: node.extra ?? 0,
      overflow: horizontal ? scroller.scrollWidth - scroller.clientWidth : scroller.scrollHeight - scroller.clientHeight,
    }
    const startPos = horizontal ? e.clientX : e.clientY
    let pos = startPos
    let push = 0
    let last = { sizes: base.sizes, extra: base.extra }
    const step = () => {
      const r = growDrag({ ...base, delta: pos - startPos + push })
      if (r.extra === last.extra && r.sizes.every((s, i) => s === last.sizes[i])) return
      last = r
      pending.current = r.sizes
      if (r.extra !== (live.current().extraAt(path) ?? 0)) live.set(withSplitExtra(live.current().root, path, r.extra))
      apply.current()
    }
    // cursor encostado na borda: a aba rola e o painel continua crescendo
    let raf = requestAnimationFrame(function tick() {
      const box = scroller.getBoundingClientRect()
      const [lo, hi] = horizontal ? [box.left, box.right] : [box.top, box.bottom]
      const dir = pos > hi - EDGE ? 1 : pos < lo + EDGE && (horizontal ? scroller.scrollLeft : scroller.scrollTop) > 0 ? -1 : 0
      if (dir) {
        push += dir * EDGE_STEP
        scroller.scrollBy(horizontal ? { left: dir * EDGE_STEP } : { top: dir * EDGE_STEP })
        step()
      }
      raf = requestAnimationFrame(tick)
    })
    const move = (ev: PointerEvent) => {
      pos = horizontal ? ev.clientX : ev.clientY
      step()
    }
    const end = () => {
      cancelAnimationFrame(raf)
      sash.removeEventListener('pointermove', move)
      sash.removeEventListener('pointerup', end)
      sash.removeEventListener('pointercancel', end)
      sash.classList.remove('sash-active')
      updateLayout((l) => ({
        ...l,
        tabs: l.tabs.map((t) => (t.id === tabId && t.root ? { ...t, root: withSplitExtra(setSizes(t.root, path, last.sizes), path, last.extra) } : t)),
      }))
      live.set(null)
    }
    sash.setPointerCapture(e.pointerId)
    sash.classList.add('sash-active')
    sash.addEventListener('pointermove', move)
    sash.addEventListener('pointerup', end)
    sash.addEventListener('pointercancel', end)
  }

  return (
    <div ref={wrap} className="split-wrap split-owner" onPointerDownCapture={startDrag}>
      <Allotment
        ref={handle}
        vertical={node.dir === 'column'}
        defaultSizes={node.sizes.length === node.children.length ? node.sizes : undefined}
        onChange={(sizes) => saveSizes(tabId, path, sizes)}
      >
        {node.children.map((c, i) => (
          <Allotment.Pane key={nodeKey(c)} minSize={axisMin(c, node.dir)}>
            {/* o Allotment troca a ref do Pane pela dele: a medida vem deste div */}
            <div
              className="split-wrap"
              ref={(el) => {
                cells.current[i] = el
              }}
            >
              <SplitNode node={c} tabId={tabId} path={[...path, i]} live={live} />
            </div>
          </Allotment.Pane>
        ))}
      </Allotment>
    </div>
  )
}

function TabBar({ layout }: { layout: Layout }) {
  const panes = useUi((s) => s.app?.panes)
  const attn = useMemo(() => tabAttention(layout, panes ?? []), [layout, panes])
  const [editing, setEditing] = useState<string | null>(null)
  const pr = useMotionPreset()
  /** posição de inserção (0..n) enquanto uma aba é arrastada */
  const [dropAt, setDropAt] = useState<number | null>(null)
  /** painel arrastado sobre a barra: a aba alvo, ou 'new' (espaço vazio / +) */
  const [paneOver, setPaneOver] = useState<string | null>(null)
  const openTimer = useRef<{ tab: string; t: ReturnType<typeof setTimeout> } | null>(null)
  const clearPaneOver = () => {
    if (openTimer.current) clearTimeout(openTimer.current.t)
    openTimer.current = null
    setPaneOver(null)
  }
  const barRef = useRef<HTMLDivElement>(null)
  // a aba ativa (inclusive por ⌘1…9) sempre entra na área visível da barra
  useEffect(() => {
    barRef.current?.querySelector<HTMLElement>(`.tab[data-tab-id="${layout.activeTabId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [layout.activeTabId, layout.tabs.length])
  const tabUnder = (target: EventTarget) => (target as HTMLElement).closest<HTMLElement>('.tab')?.dataset.tabId ?? null
  return (
    <div
      ref={barRef}
      onWheel={(e) => {
        // roda vertical do mouse também rola a barra quando as abas não cabem
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
      }}
      className="tabbar"
      // o soltar é da barra inteira: vale também o espaço vazio depois da última aba e o botão +
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PANE_MIME)) {
          // painel sobre a barra: em cima de uma aba move para ela (segurar abre a aba); no vazio ou no + cria aba nova
          e.preventDefault()
          const over = tabUnder(e.target) ?? 'new'
          if (over !== paneOver) {
            clearPaneOver()
            setPaneOver(over)
            if (over !== 'new' && over !== layout.activeTabId) openTimer.current = { tab: over, t: setTimeout(() => activateTab(over), 600) }
          }
          return
        }
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        e.preventDefault()
        setDropAt(tabInsertIndex(tabMids(e.currentTarget), e.clientX))
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDropAt(null)
        clearPaneOver()
      }}
      onDrop={(e) => {
        const pane = e.dataTransfer.getData(PANE_MIME)
        if (pane) {
          e.preventDefault()
          const over = tabUnder(e.target)
          clearPaneOver()
          if (!over) movePaneToNewTab(pane)
          else if (findTab(layout, pane)?.id !== over) moveToTab(pane, over)
          return
        }
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
          className={`tab${t.id === layout.activeTabId ? ' active' : ''}${t.color ? ' colored' : ''}${dropAt === i ? ' drop-before' : ''}${dropAt === i + 1 && i === layout.tabs.length - 1 ? ' drop-after' : ''}${paneOver === t.id ? ' pane-over' : ''}`}
          data-tab-id={t.id}
          draggable={editing !== t.id}
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_MIME, t.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDropAt(null)}
          // a cor da aba vai como variável: a ativa usa cheia (na pílula), as outras em tom leve
          style={t.color ? ({ '--tab-color': t.color, ...(t.id === layout.activeTabId ? { color: textOn(t.color) } : {}) } as React.CSSProperties) : undefined}
          onClick={() => activateTab(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            void tabMenu(t).then((r) => r === 'rename' && setEditing(t.id))
          }}
        >
          {t.id === layout.activeTabId && <motion.span layoutId="tab-pill" className="tab-pill" transition={pr.reduced ? { duration: 0 } : pr.enter} />}
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
            <>
              {t.color && t.id !== layout.activeTabId && <span className="tab-swatch" />}
              <span>{t.name}</span>
            </>
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
      <button className={`tab-add${paneOver === 'new' ? ' pane-over' : ''}`} title="Nova aba (⇧⌘T) — solte uma sessão aqui para levá-la a uma aba nova" onClick={addTab}>
        +
      </button>
    </div>
  )
}

let addProject: ((dir: string) => void) | undefined

const SIDES: Side[] = ['top', 'bottom', 'left', 'right']

/** faixas nas bordas da área inteira, só enquanto um painel é arrastado: soltar ali põe a sessão abaixo/acima/ao lado de todas */
function DockEdges({ tabId }: { tabId: string }) {
  const [dragging, setDragging] = useState(false)
  const [side, setSide] = useState<Side | null>(null)
  useEffect(() => {
    const start = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(PANE_MIME)) setDragging(true)
    }
    const end = () => {
      setDragging(false)
      setSide(null)
    }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])
  if (!dragging) return null
  return (
    <>
      {side && <div className={`dock-preview dock-preview-${side}`} />}
      {SIDES.map((s) => (
        <div
          key={s}
          className={`dock-edge dock-edge-${s}`}
          title="Solte aqui para ocupar a borda inteira"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PANE_MIME)) return
            e.preventDefault()
            setSide(s)
          }}
          onDragLeave={() => setSide(null)}
          onDrop={(e) => {
            const pane = e.dataTransfer.getData(PANE_MIME)
            setSide(null)
            if (!pane) return
            e.preventDefault()
            e.stopPropagation()
            dockPaneAt(pane, tabId, s)
          }}
        />
      ))}
    </>
  )
}

export function Workspace({ empty, onAddProject }: { empty?: React.ReactNode; onAddProject?: (dir: string) => void }) {
  addProject = onAddProject
  const layout = useUi((s) => s.app?.layout)
  const [emptyOver, setEmptyOver] = useState(false)
  const [liveRoot, setLiveRoot] = useState<LayoutNode | null>(null)
  const liveRef = useRef<LayoutNode | null>(null)
  const rootRef = useRef<LayoutNode | null>(null)
  const pr = useMotionPreset()
  const body = useRef<HTMLDivElement>(null)
  const shown = useRef<string | null>(null)
  const activeId = layout?.activeTabId ?? null
  // trocar de aba: os painéis novos chegam com um esmaecimento curto (sem mexer em tamanho);
  // anima cada painel, não o contêiner: opacidade num ancestral cortaria o vidro (backdrop-filter) deles
  useEffect(() => {
    if (shown.current && activeId && shown.current !== activeId && body.current)
      for (const el of body.current.querySelectorAll<HTMLElement>('.pane-slot > *')) void animate(el, { opacity: [0.6, 1] }, pr.enter)
    shown.current = activeId
  }, [activeId, pr.enter])
  // painel focado (clique, ⌘+setas) que esteja fora da área visível entra na tela
  const focusedId = useUi((s) => s.focusedPaneId)
  useEffect(() => {
    if (focusedId) body.current?.querySelector(`.pane-slot[data-pane-id="${CSS.escape(focusedId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [focusedId, activeId])
  if (!layout) return null
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)
  const root = liveRoot ?? tab?.root ?? null
  const ext = root ? minExtent(root, MIN_PANE_W, MIN_PANE_H) : null
  const live: LiveRoot = {
    current: () => {
      const r = liveRef.current ?? rootRef.current!
      return {
        root: r,
        extraAt: (p) => {
          let n: LayoutNode | undefined = r
          for (const i of p) n = n?.type === 'split' ? n.children[i] : undefined
          return n?.type === 'split' ? n.extra : undefined
        },
      }
    },
    set: (r) => {
      liveRef.current = r
      setLiveRoot(r)
    },
  }
  rootRef.current = tab?.root ?? null
  return (
    <div className="workspace">
      <TabBar layout={layout} />
      <div
        ref={body}
        className={`tab-body${emptyOver ? ' drop-empty' : ''}`}
        // aba vazia: a área inteira aceita a sessão arrastada (não há painel nem faixa para receber)
        onDragOver={(e) => {
          if (tab?.root || !e.dataTransfer.types.includes(PANE_MIME)) return
          e.preventDefault()
          setEmptyOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEmptyOver(false)
        }}
        onDrop={(e) => {
          setEmptyOver(false)
          const pane = e.dataTransfer.getData(PANE_MIME)
          if (!tab || tab.root || !pane) return
          e.preventDefault()
          dockPaneAt(pane, tab.id, 'right')
        }}
      >
        {tab?.root && root && ext ? (
          // muitos painéis: a tela interna para no tamanho mínimo e a aba rola nos dois eixos
          <div className="tab-scroll">
            <div className="tab-canvas" style={{ minWidth: `calc(${ext.w}px + var(--pane-gap))`, minHeight: `calc(${ext.h}px + var(--pane-gap))` }}>
              <SplitNode key={`${tab.id}:${tab.root.type === 'split' ? tab.root.dir : 'leaf'}`} node={root} tabId={tab.id} path={[]} live={live} />
            </div>
          </div>
        ) : (
          (empty ?? <div className="empty">Nenhum painel aqui. ⌘T abre uma nova sessão; ⌘D abre um terminal.</div>)
        )}
        {tab && <DockEdges tabId={tab.id} />}
      </div>
    </div>
  )
}
