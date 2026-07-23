import { useState, useEffect } from 'react'
import GenericDetailPage from '../GenericDetailPage'
import companyConfig from './config'
import {
  ContactsTab, DealsTab, ProjectsTab, ProductsTab,
  PartnersTab, TouchpointsTab, NotesTab, TimelineTab,
} from './CompanyDetailTabs'
import { apiClient } from '../../lib/api'
import type { ResourceConfig } from '../module-types'

export default function CompaniesDetailPage() {
  const [contactCounts, setContactCounts] = useState<Record<string, number>>({})

  // Load contact counts for tab badges
  useEffect(() => {
    apiClient.get<{ items: { id: string; company_id: string }[] }>('/api/v1/crm/contacts?page_size=500')
      .then(r => {
        const counts: Record<string, number> = {}
        ;(r.items || []).forEach(c => {
          if (c.company_id) counts[c.company_id] = (counts[c.company_id] || 0) + 1
        })
        setContactCounts(counts)
      })
      .catch(() => {})
  }, [])

  const patchedConfig: ResourceConfig = {
    ...companyConfig,
    detailTabs: (companyConfig.detailTabs || []).map(t => {
      if (t.id === 'details') return t
      if (t.id === 'contacts') {
        return {
          ...t,
          condition: (e: any) => (contactCounts[e.id] || 0) > 0,
        }
      }
      return t
    }),
  }

  return (
    <GenericDetailPage
      config={patchedConfig}
      tabRenderers={{
        contacts: ContactsTab,
        deals: DealsTab,
        projects: ProjectsTab,
        products: ProductsTab,
        partners: PartnersTab,
        touchpoints: TouchpointsTab,
        notes: NotesTab,
        timeline: TimelineTab,
      }}
    />
  )
}
