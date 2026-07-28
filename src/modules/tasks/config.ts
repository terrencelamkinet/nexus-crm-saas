// ═══════════════════════════════════════════
//  NEXUS CRM — Tasks Module Config
//  ═══════════════════════════════════════════

import type { ResourceConfig } from '../module-types'

const taskConfig: ResourceConfig = {
  name: 'task',
  label: 'Task',
  labelPlural: 'Tasks',
  icon: 'CheckSquare',
  apiPath: '/api/v1/crm/tasks',
  routePrefix: 'tasks',

  fields: [
    { key: 'title',          label: 'Title',        type: 'title',    required: true,  searchable: true, sortable: true, visibleByDefault: true },
    { key: 'description',    label: 'Description',  type: 'rich_text', gridColumn: 'full', visibleByDefault: false },
    { key: 'priority',       label: 'Priority',     type: 'select',   filterable: true, bulkEditable: true, visibleByDefault: true,
      options: [
        { value: 'P0',   label: 'Urgent',    color: 'red' },
        { value: 'P1',     label: 'High',      color: 'orange' },
        { value: 'P2',   label: 'Medium',    color: 'blue' },
        { value: 'P3',      label: 'Low',       color: 'gray' },
      ]},
    { key: 'status',         label: 'Status',       type: 'status',   sortable: true, filterable: true, bulkEditable: true, visibleByDefault: true,
      options: [
        { value: 'pending',     label: 'Pending',     color: 'yellow' },
        { value: 'in_progress', label: 'In Progress', color: 'blue' },
        { value: 'done',        label: 'Done',        color: 'green' },
        { value: 'cancelled',   label: 'Cancelled',   color: 'gray' },
      ]},
    { key: 'due_date',       label: 'Due Date',     type: 'date',     sortable: true, visibleByDefault: true },
    { key: 'contact_id',     label: 'Contact',      type: 'relation', sortable: false, filterable: true,
      relation: { resource: 'contacts', multiple: false, displayField: 'name' } },
    { key: 'company_id',     label: 'Company',      type: 'relation', sortable: false, filterable: true,
      relation: { resource: 'companies', multiple: false, displayField: 'name' } },
 { key: 'assignee_id',     label: 'Assignee',     type: 'text',     sortable: false, filterable: false, visibleByDefault: false, dependsOnModule: 'team' },
    { key: 'created_at',     label: 'Created',      type: 'created_time', sortable: true, visibleByDefault: true },
  ],

  listColumns: ['title', 'priority', 'status', 'due_date', 'contact_id', 'company_id'],
  defaultSort: [{ field: 'created_at', direction: 'desc' }],
  defaultView: 'table',
  allowedBulkActions: ['update', 'archive', 'export'],

  savedViews: [
    { id: 'all', name: 'All Tasks', layout: 'table' },
  ],

  detailTabs: [
    { id: 'details', label: 'Details', fields: [
      'title', 'description', 'priority', 'status',
      'due_date', 'contact_id', 'company_id', 'assignee_id', 'created_at',
    ]},
    { id: 'timeline', label: 'Timeline' },
  ],
  hideProfileCard: true,
}

export default taskConfig
