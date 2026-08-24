import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Heading1, Heading2, Heading3, ListOrdered, ListChecks, Quote, Minus, Table as TableIcon, Code2, FileText, ImageIcon, List, Sparkles } from 'lucide-react'

export interface SlashItem { id: string; label: string; sub: string; group: string }

const ICONS: Record<string, any> = {
  h1: Heading1, h2: Heading2, h3: Heading3, bullet: List, ordered: ListOrdered,
  task: ListChecks, quote: Quote, divider: Minus, table: TableIcon,
  image: ImageIcon, code: Code2, ai: Sparkles, 'ai-summarize': FileText,
}

interface SlashMenuProps { items: SlashItem[]; command: (item: SlashItem) => void }

const SlashMenu = forwardRef((props: SlashMenuProps, ref) => {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') { setSelected(s => (s + props.items.length - 1) % props.items.length); return true }
      if (event.key === 'ArrowDown') { setSelected(s => (s + 1) % props.items.length); return true }
      if (event.key === 'Enter') { props.command(props.items[selected]); return true }
      return false
    },
  }))

  const groups = Array.from(new Set(props.items.map(i => i.group)))

  if (!props.items.length) return <div className="nxe-slash-menu"><div className="nxe-slash-group-label">冇匹配結果</div></div>

  return (
    <div className="nxe-slash-menu">
      {groups.map(group => (
        <div key={group}>
          <div className="nxe-slash-group-label">{group}</div>
          {props.items.filter(i => i.group === group).map((item) => {
            const idx = props.items.indexOf(item)
            const Icon = ICONS[item.id] ?? FileText
            return (
              <div key={item.id} className={`nxe-slash-item ${idx === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(idx)} onClick={() => props.command(item)}>
                <span className="nxe-slash-icon"><Icon size={15} /></span>
                <div>
                  <div>{item.label}</div>
                  <div className="nxe-slash-sub">{item.sub}</div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
})

SlashMenu.displayName = 'SlashMenu'
export default SlashMenu
