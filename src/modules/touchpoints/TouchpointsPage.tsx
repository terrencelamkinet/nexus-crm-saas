import { useState, useEffect } from 'react'
import GenericListPage from '../GenericListPage'
import touchpointConfig from './config'
import { apiClient } from '../../lib/api'

export default function TouchpointsPage() {
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    Promise.all([
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/contacts?page_size=100').then(r => setContacts(r.items || [])).catch(() => {}),
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100').then(r => setCompanies(r.items || [])).catch(() => {}),
    ])
  }, [])

  return (
    <GenericListPage
      config={touchpointConfig}
      extraData={{ contacts, companies }}
    />
  )
}
