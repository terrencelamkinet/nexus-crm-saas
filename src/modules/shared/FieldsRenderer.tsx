import type { FieldConfig } from '../module-types'
import { optionColorToClass } from '../module-types'
import { formatDate, formatRelativeDate, formatAmount } from './field-utils'

interface Props {
  field: FieldConfig
  entity?: any
  form?: Record<string, any>
  onChange?: (key: string, value: any) => void
  editOpen?: boolean
  /** Extra lookup data for relation fields */
  relationData?: Record<string, { id: string; name: string }[]>
}

// ═══ TABLE CELL RENDERER ═══
export function CellRenderer({ value, field }: { value: any; field: FieldConfig }) {
  if (value == null) return <span className="text-faint">—</span>

  switch (field.type) {
    case 'select':
    case 'status': {
      const opt = field.options?.find(o => o.value === value || o.label === value)
      const cls = opt?.color ? (optionColorToClass[opt.color] || 'tag-default') : 'tag-default'
      return <span className={`select-tag ${cls}`}>{opt?.label || value}</span>
    }
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : []
      return (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {arr.map((v: string) => <span key={v} className="tag">{v}</span>)}
        </span>
      )
    }
    case 'person': {
      const name = typeof value === 'object' ? value.name || value.email : String(value)
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="avatar-sm">{name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}</span>
          {name}
        </span>
      )
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const d = formatDate(value)
      const rel = formatRelativeDate(value)
      const isOverdue = new Date(value).getTime() < Date.now() && field.key === 'deadline'
      return <span style={isOverdue ? { color: 'var(--color-notification)', fontWeight: 600 } : {}} title={rel}>{d}</span>
    }
    case 'number': {
      if (field.format === 'hkd') return <span style={{ fontWeight: 600 }}>{formatAmount(value)}</span>
      if (field.format === 'percent') return <span>{value}%</span>
      return <span>{value}</span>
    }
    case 'checkbox':
      return <span>{value ? '✅' : '⬜'}</span>
    case 'url':
    case 'email':
      return <a href={field.type === 'email' ? `mailto:${value}` : value} target="_blank" rel="noopener"
        style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
        onClick={e => e.stopPropagation()}>{value}</a>
    case 'relation': {
      if (typeof value === 'object' && value) {
        return <span className="badge badge-p3">{value.name || value.title || value.id}</span>
      }
      return <span className="text-faint">{String(value)}</span>
    }
    case 'files': {
      const arr = Array.isArray(value) ? value : []
      return <span>{arr.length} file{arr.length !== 1 ? 's' : ''}</span>
    }
    default:
      return <span>{String(value)}</span>
  }
}

// ═══ DETAIL / FORM FIELD RENDERER ═══
export function FieldsRenderer({ field, entity, form, onChange, editOpen, relationData }: Props) {
  const label = <div className="field-label">{field.label}{field.required ? ' *' : ''}</div>
  const isReadonly = !editOpen || field.editable === false
    || ['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(field.type)
  const value = form?.[field.key] ?? entity?.[field.key]
  const displayVal = entity?.[field.key]

  // Readonly display
  if (isReadonly) {
    return (
      <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        {label}
        <CellRenderer value={displayVal} field={field} />
      </div>
    )
  }

  // Editable form inputs
  if (['select', 'status'].includes(field.type)) {
    return (
      <div className="form-field">
        {label}
        <select value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)} className="input-field">
          <option value="">— Select —</option>
          {field.options?.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'multi_select') {
    const selected: string[] = value ?? []
    return (
      <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        {label}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {field.options?.filter(o => !selected.includes(o.value)).map(o => (
            <button key={o.value} type="button" className="tag" style={{ cursor: 'pointer' }}
              onClick={() => onChange?.(field.key, [...selected, o.value])}>
              +{o.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {selected.map(s => (
            <span key={s} className="badge badge-tag" style={{ cursor: 'pointer' }}
              onClick={() => onChange?.(field.key, selected.filter(x => x !== s))}>
              {s} ✕
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'date') {
    const dateVal = value ? String(value).slice(0, 10) : ''
    return (
      <div className="form-field">
        {label}
        <input type="date" value={dateVal} onChange={e => onChange?.(field.key, e.target.value)} className="input-field" />
      </div>
    )
  }

  if (field.type === 'person') {
    return (
      <div className="form-field">
        {label}
        <input type="text" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field" placeholder="Person name or email" />
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange?.(field.key, e.target.checked)}
          style={{ width: 18, height: 18 }} />
        {label}
      </div>
    )
  }

  if (field.type === 'relation') {
    const relData = relationData?.[field.relation?.resource || ''] || []
    return (
      <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        {label}
        <select value={(typeof value === 'object' ? value?.id : value) ?? ''}
          onChange={e => onChange?.(field.key, e.target.value)} className="input-field">
          <option value="">— Select —</option>
          {relData.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'email') {
    return (
      <div className="form-field">
        {label}
        <input type="email" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field" placeholder="email@example.com" />
      </div>
    )
  }

  if (field.type === 'url') {
    return (
      <div className="form-field">
        {label}
        <input type="text" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field" placeholder="https://..." />
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="form-field">
        {label}
        <input type="number" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.valueAsNumber ?? '')}
          className="input-field" placeholder="0" />
      </div>
    )
  }

  if (field.type === 'rich_text') {
    return (
      <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        {label}
        <textarea value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field" rows={3} />
      </div>
    )
  }

  // Default text input
  return (
    <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
      {label}
      <input type="text" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
        className="input-field" placeholder={field.label} />
    </div>
  )
}
