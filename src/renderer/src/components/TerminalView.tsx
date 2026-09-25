import { useEffect, useRef } from 'react'
import { terminals } from '../terminals'

export function TerminalView({ paneId }: { paneId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    terminals.mount(paneId, el)
    const ro = new ResizeObserver(() => terminals.fit(paneId))
    ro.observe(el)
    return () => {
      ro.disconnect()
      terminals.unmount(paneId, el)
    }
  }, [paneId])
  return <div className="term-container" ref={ref} />
}
