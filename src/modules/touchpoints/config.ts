// ═══════════════════════════════════════════
//  NEXUS CRM — Touchpoints Module Config
//  ═══════════════════════════════════════════

import type { ResourceConfig } from '../module-types'

const touchpointConfig: ResourceConfig = {
  name: 'touchpoint',
  label: 'Touchpoint',
  labelPlural: 'Touchpoints',
  icon: 'Activity',
  apiPath: '/api/v1/crm/touchpoints',
  routePrefix: 'touchpoints',

  fields: [
    { key: 'title',          label: 'Title',        type: 'title',    required: true,  searchable: true, sortable: true, visibleByDefault: true },
    { key: 'type',           label: 'Type',         type: 'select',   filterable: true, bulkEditable: true, visibleByDefault: true,
      options: [
        { value: 'meeting',  label: 'Meeting',   color: 'blue' },
        { value: 'call',     label: 'Call',      color: 'green' },
        { value: 'email',    label: 'Email',     color: 'purple' },
        { value: 'note',     label: 'Note',      color: 'yellow' },
        { value: 'social',   label: 'Social',    color: 'pink' },
        { value: 'lunch',    label: 'Lunch',     color: 'orange' },
        { value: 'other',    label: 'Other',     color: 'gray' },
      ]},
    { key: 'description',    label: 'Description',  type: 'rich_text', gridColumn: 'full', visibleByDefault: false },
    { key: 'date',           label: 'Date',         type: 'date',     sortable: true, visibleByDefault: true },
    { key: 'duration_minutes', label: 'Duration',   type: 'number',   format: 'hours', visibleByDefault: false },
    { key: 'location',       label: 'Location',     type: 'text',     visibleByDefault: false },
    { key: 'contact_id',     label: 'Contact',      type: 'relation', sortable: false, filterable: true,
      relation: { resource: 'contacts', multiple: false, displayField: 'name' } },
    { key: 'company_id',     label: 'Company',      type: 'relation', sortable: false, filterable: true,
      relation: { resource: 'companies', multiple: false, displayField: 'name' } },
    { key: 'created_at',     label: 'Created',      type: 'created_time', sortable: true, visibleByDefault: true },
  ],

  listColumns: ['title', 'type', 'date', 'contact_id', 'company_id', 'created_at'],
  defaultSort: [{ field: 'date', direction: 'desc' }],
  defaultView: 'table',
  allowedBulkActions: ['update', 'archive', 'export'],

  savedViews: [
    { id: 'all', name: 'All Touchpoints', layout: 'table' },
  ],

  detailTabs: [
    { id: 'details', label: 'Details', fields: [
      'title', 'type', 'description', 'date', 'duration_minutes',
      'location', 'contact_id', 'company_id', 'created_at',
    ]},
    { id: 'timeline', label: 'Timeline' },
  ],
}

export default touchpointConfig
