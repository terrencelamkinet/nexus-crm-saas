// ═══════════════════════════════════════════
//  NEXUS CRM — Module System Types (v2)
//  Config-driven CRUD module pattern
//  Aligned with Notion Database spec
//  ═══════════════════════════════════════════

export type FieldType =
  | 'title' | 'text' | 'rich_text' | 'number'
  | 'select' | 'status' | 'multi_select'
  | 'date' | 'person' | 'checkbox' | 'url' | 'email' | 'phone'
  | 'files' | 'relation' | 'rollup' | 'formula'
  | 'created_time' | 'last_edited_time' | 'created_by'
  | 'last_edited_by' | 'unique_id' | 'button'

export interface FieldOption {
  value: string
  label: string
  color?: string
}

export interface FieldRelation {
  resource: string
  multiple: boolean
  displayField: string
}

export interface FieldConfig {
  key: string
  label: string
  type: FieldType
  visibleByDefault?: boolean   // default true
  sortable?: boolean           // default true for most
  searchable?: boolean         // only title + text fields
  filterable?: boolean         // default true for select/status/date/person
  editable?: boolean           // default true
  required?: boolean           // default false
  bulkEditable?: boolean       // default false (only safe fields)
  options?: FieldOption[]
  relation?: FieldRelation
  format?: 'hkd' | 'percent' | 'hours' | 'date' | 'datetime'
  formula?: string             // documentation only; server computes
  permissions?: { read?: string[]; write?: string[] }
  gridColumn?: 'full'          // span full width in form
}

export interface SortRule {
  field: string
  direction: 'asc' | 'desc'
}

export interface FilterNode {
  type: 'condition' | 'group'
  field?: string
  operator?: string
  value?: unknown
  logic?: 'and' | 'or'
  children?: FilterNode[]
}

export type ViewType = 'table' | 'board' | 'calendar' | 'timeline' | 'gallery' | 'chart'

export type BulkActionType = 'update' | 'archive' | 'restore' | 'export'

export interface ModuleView {
  type: ViewType
  label: string
  groupBy?: string
  sortBy?: string
  filters?: FilterNode[]
}

export interface SavedView {
  id: string
  name: string
  layout?: ViewType
  filters?: FilterNode | null
  sorts?: SortRule[]
  visibleColumns?: string[]
  groupBy?: string
  isShared?: boolean
}

export interface TabConfig {
  id: string
  label: string
  /** Custom component for this tab */
  render?: React.ComponentType<{ entity: any; moduleConfig: ModuleConfig; refresh: () => void }>
  /** Field keys to show (default to all) */
  fields?: string[]
  /** Condition to show this tab */
  condition?: (entity: any) => boolean
}

export interface ResourceConfig {
  name: string
  label: string
  labelPlural: string
  icon: string
  apiPath: string
  primaryKey?: string        // default 'id'
  titleField?: string         // default first 'title' field
  routePrefix?: string        // override for route path (e.g. 'companies' for name='company')
  fields: FieldConfig[]
  listColumns: string[]       // default visible columns
  defaultSort?: SortRule[]
  defaultView?: ViewType
  allowedBulkActions?: BulkActionType[]
  views?: ModuleView[]
  detailTabs?: TabConfig[]
  savedViews?: SavedView[]
}

export type ModuleConfig = ResourceConfig

export interface ListMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ListResponse<T = any> {
  items: T[]
  meta?: ListMeta
  total?: number   // fallback when meta not present
}

export interface EntityRecord {
  id: string
  [key: string]: any
}

export const statusColors: Record<string, string> = {
  Active: 'tag-active', Warm: 'tag-warm', Cold: 'tag-cold',
  VIP: 'tag-vip', Inactive: 'tag-default',
  Done: 'tag-active', 'To Do': 'tag-default',
  'In Progress': 'tag-warm', Review: 'tag-vip', Blocked: 'tag-cold',
}

export const optionColorToClass: Record<string, string> = {
  green: 'tag-active', yellow: 'tag-warm', orange: 'tag-warm',
  blue: 'tag-cold', purple: 'tag-vip', gray: 'tag-default',
  red: 'tag-cold',
}

export const fieldTypeOperators: Record<string, string[]> = {
  title: ['equals', 'contains', 'starts_with', 'is_empty', 'is_not_empty'],
  text: ['equals', 'contains', 'starts_with', 'is_empty', 'is_not_empty'],
  email: ['equals', 'contains', 'is_empty', 'is_not_empty'],
  url: ['equals', 'contains', 'is_empty', 'is_not_empty'],
  number: ['equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'],
  select: ['equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  status: ['equals', 'in', 'not_in', 'is_empty'],
  person: ['equals', 'in', 'is_empty', 'is_not_empty'],
  date: ['on', 'before', 'after', 'between', 'within_next_days', 'is_empty'],
  checkbox: ['equals'],
}
