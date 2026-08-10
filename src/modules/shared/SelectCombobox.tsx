// ═══════════════════════════════════════════════════════
// SelectCombobox.tsx
// Searchable combobox for select / status fields（industry / category / status）
// Behavior:
//   1. Input 顯示 current value（match 到 option 顯示 label，否則顯示 raw value）
//   2. Focus / 打字 → 開 dropdown，filter options（case-insensitive substring on label）
//   3. Query 冇 exact match + 非空 → 顯示「＋ Create 『query』」option（custom value）
//   4. Click option → onChange(value) + 關 dropdown
//   5. 有 value 時顯示清除（×）button
//   6. Keyboard：Enter 揀 highlighted / 第一個，Escape 關閉
//   7. Click outside → 關閉
// ═══════════════════════════════════════════════════════
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { X, Check } from 'lucide-react'

export interface ComboboxOption { value: string; label: string }

interface Props {
  value: string
  options: ComboboxOption[]
  onChange: (value: string) => void
  placeholder?: string
  /** optional i18n label prefix for the floating label; exact label rendered by parent */
}

export default function SelectCombobox({ value, options, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // current option match（label 或 value 等於 value）
  const currentOpt = useMemo(
    () => options.find(o => o.value === value || o.label === value),
    [options, value]
  )

  // 輸入框顯示：有 query 顯示 query；否則 match 到 option 顯示 label，否則 raw value
  const inputText = open ? query : (currentOpt?.label ?? value ?? '')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [query, options])

  const hasExact = useMemo(
    () => filtered.some(o => o.label.toLowerCase() === query.trim().toLowerCase() && query.trim() !== ''),
    [filtered, query]
  )

  const showCreate = query.trim() !== '' && !hasExact

  // click outside → close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // reset highlight + query when opened
  useEffect(() => {
    if (open) { setHighlight(0); setQuery('') }
  }, [open])

  const pick = useCallback((v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }, [onChange])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const total = filtered.length + (showCreate ? 1 : 0)
      if (total === 0) return
      if (highlight >= filtered.length) {
        // highlight 落喺 create option
        pick(query.trim())
      } else if (filtered[highlight]) {
        pick(filtered[highlight].value)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const total = filtered.length + (showCreate ? 1 : 0)
      setHighlight(h => (h + 1) % Math.max(total, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const total = filtered.length + (showCreate ? 1 : 0)
      setHighlight(h => (h - 1 + Math.max(total, 1)) % Math.max(total, 1))
    }
  }

  return (
    <div className="floating-field" ref={wrapRef}>
      <input
        ref={inputRef}
        className="input-field floating-input"
        placeholder={placeholder || " "}
        value={inputText}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      {value !== '' && value != null && !open && (
        <button
          type="button"
          className="select-clear"
          aria-label="clear"
          onClick={e => { e.stopPropagation(); onChange(''); setQuery('') }}
        ><X size={14} /></button>
      )}
      {open && (
        <div className="select-dropdown">
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.value}
              className={`select-item ${i === highlight ? 'active' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(o.value)}
            >
              <span className="select-item-label">{o.label}</span>
              {o.value === value && <Check size={14} className="select-item-check" />}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className={`select-item create ${highlight >= filtered.length ? 'active' : ''}`}
              onMouseEnter={() => setHighlight(filtered.length)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(query.trim())}
            >
              <span className="select-item-label">{`＋ Create 「${query.trim()}」`}</span>
            </button>
          )}
          {filtered.length === 0 && !showCreate && (
            <div className="select-empty">{'No options'}</div>
          )}
        </div>
      )}
    </div>
  )
}
