import type { FieldConfig } from '../module-types'
import { optionColorToClass } from '../module-types'
import { formatDate, formatRelativeDate, formatAmount } from './field-utils'
import EntitySearch from './EntitySearch'
import { isModuleEnabled } from '../enabled-modules'
import { useTranslation } from 'react-i18next'
import { localizeFieldLabel } from './labels'

const RELATION_ROUTES: Record<string, string> = {
  contacts: '/contacts',
  companies: '/companies',
  projects: '/projects',
  tasks: '/tasks',
  touchpoints: '/touchpoints',
}

interface Props {
  field: FieldConfig
  entity?: any
  form?: Record<string, any>
  onChange?: (key: string, value: any) => void
  editOpen?: boolean
  /** Extra lookup data for relation fields */
  relationData?: Record<string, { id: string; name: string }[]>
  /** Callback when a relation link is clicked — navigates to detail page */
  onNavigate?: (url: string) => void
}

// ═══ TABLE CELL RENDERER ═══
export function CellRenderer({ value, field, onNavigate }: { value: any; field: FieldConfig; onNavigate?: (url: string) => void }) {
  const { t } = useTranslation()
  if (field.dependsOnModule && !isModuleEnabled(field.dependsOnModule)) return null
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
      // Overdue deadline = status highlight via COLOR only (keeps cells normal-weight;
      // only the name column is bold per table style rule). No font-weight bold here.
      return <span style={isOverdue ? { color: 'var(--color-notification)' } : {}} title={rel}>{d}</span>
    }
    case 'number': {
      if (field.format === 'hkd') return <span>{formatAmount(value)}</span>  // normal weight
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
        const resource = field.relation?.resource || ''
        const route = RELATION_ROUTES[resource]
        const href = route ? `${route}/${value.id}` : ''
        if (href && onNavigate) {
          return (
            <a href={href} onClick={e => { e.preventDefault(); onNavigate(href) }}
              className="badge badge-p3"
              style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'none' }}>
              {value.name || value.title || value.id}
            </a>
          )
        }
        return <span className="badge badge-p3">{value.name || value.title || value.id}</span>
      }
      return <span className="text-faint">{String(value)}</span>
    }
    case 'files': {
      const arr = Array.isArray(value) ? value : []
      return <span>{t('common.fileCount', { count: arr.length })}</span>
    }
    default:
      return <span>{String(value)}</span>
  }
}

// ═══ DETAIL / FORM FIELD RENDERER ═══
export function FieldsRenderer({ field, entity, form, onChange, editOpen, onNavigate }: Props) {
  const { t } = useTranslation()
  const label = <div className="field-label">{localizeFieldLabel(field, t)}{field.required ? ' *' : ''}</div>
  const isReadonly = !editOpen || field.editable === false
    || ['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(field.type)
  const value = form?.[field.key] ?? entity?.[field.key]
  const displayVal = entity?.[field.key]

  // Readonly display
  if (isReadonly) {
    return (
      <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        {label}
        <CellRenderer value={displayVal} field={field} onNavigate={onNavigate} />
      </div>
    )
  }

  // Editable form inputs
  if (['select', 'status'].includes(field.type)) {
    return (
      <div className="floating-field">
        <select value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)} className="input-field floating-select">
          <option value=""></option>
          {field.options?.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label className="floating-label">{localizeFieldLabel(field, t)}{field.required ? ' *' : ''}</label>
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
      <div className="floating-field">
        <input type="date" value={dateVal} onChange={e => onChange?.(field.key, e.target.value)} className="input-field floating-input" placeholder={localizeFieldLabel(field, t)} />
        <label className="floating-label">{localizeFieldLabel(field, t)}</label>
      </div>
    )
  }

  if (field.type === 'person') {
    return (
      <div className="floating-field">
        <input type="text" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field floating-input" placeholder={field.label} />
        <label className="floating-label">{field.label}</label>
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
    const resource = field.relation?.resource || ''
    const searchUrl = `/api/v1/crm/${resource}`
    const currentVal = (typeof value === 'object' ? value?.id : value) ?? ''
    const titleFields = ['tasks', 'touchpoints', 'notes', 'projects']
    const createTitleField = titleFields.includes(resource) ? 'title' : 'name'
    const createLabelMap: Record<string, string> = {
      companies: 'Company', contacts: 'Contact', tasks: 'Task',
      touchpoints: 'Touchpoint', notes: 'Note', projects: 'Project',
    }
    return (
      <div className="form-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        <EntitySearch
          searchUrl={searchUrl}
          value={currentVal}
          onChange={(id) => onChange?.(field.key, id)}
          placeholder={t('common.searchResource', { resource })}
          label={field.label}
          required={field.required}
          displayField={field.relation?.displayField || 'name'}
          createLabel={createLabelMap[resource] || 'Company'}
          createTitleField={createTitleField}
        />
      </div>
    )
  }

  if (field.type === 'email') {
    return (
      <div className="floating-field">
        <input type="email" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field floating-input" placeholder={field.label} />
        <label className="floating-label">{field.label}</label>
      </div>
    )
  }

  if (field.type === 'url') {
    return (
      <div className="floating-field">
        <input type="text" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field floating-input" placeholder={field.label} />
        <label className="floating-label">{field.label}</label>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="floating-field">
        <input type="number" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.valueAsNumber ?? '')}
          className="input-field floating-input" placeholder={field.label} />
        <label className="floating-label">{field.label}</label>
      </div>
    )
  }

  if (field.type === 'rich_text') {
    return (
      <div className="floating-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
        <textarea value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
          className="input-field floating-input" rows={3} placeholder={field.label} />
        <label className="floating-label">{field.label}</label>
      </div>
    )
  }

  // Default text input
  return (
    <div className="floating-field" style={field.gridColumn === 'full' ? { gridColumn: '1 / -1' } : {}}>
      <input type="text" value={value ?? ''} onChange={e => onChange?.(field.key, e.target.value)}
        className="input-field floating-input" placeholder={field.label} />
      <label className="floating-label">{field.label}{field.required ? ' *' : ''}</label>
    </div>
  )
}
