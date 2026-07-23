import { useState, useEffect } from 'react'
import GenericDetailPage from '../GenericDetailPage'
import contactConfig from './config'
import { TimelineTab, DealsTab, TouchpointsTab, NotesTab, ProjectsTab } from './ContactDetailTabs'
import { apiClient } from '../../lib/api'
import { useModuleSettings } from '../../lib/useModules'
import type { ResourceConfig } from '../module-types'

export default function ContactDetailPage() {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const modules = useModuleSettings()
  const salesOn = modules['sales'] !== false

  useEffect(() => {
    apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100')
      .then(r => setCompanies(r.items || []))
      .catch(() => {})
  }, [])

  // Patch Deals tab condition with sales module state
  const patchedConfig: ResourceConfig = {
    ...contactConfig,
    detailTabs: (contactConfig.detailTabs || []).map(t => {
      if (t.id === 'deals') {
        return { ...t, condition: () => salesOn }
      }
      if (t.id === 'details') {
        return { ...t, fields: [
          'name', 'chinese_name', 'nick_name', 'job_title', 'department',
          'contact_type', 'grade', 'tags', 'numbers',
          'email', 'phone', 'office_phone', 'linkedin_url', 'address',
          'notes', 'namecard_path', 'company',
        ]}
      }
      return t
    }),
  }

  return (
    <GenericDetailPage
      config={patchedConfig}
      extraData={{ companies }}
      tabRenderers={{
        timeline: TimelineTab,
        deals: DealsTab,
        touchpoints: TouchpointsTab,
        notes: NotesTab,
        projects: ProjectsTab,
      }}
    />
  )
}
