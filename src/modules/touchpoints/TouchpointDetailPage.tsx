import { useState, useEffect } from 'react'
import GenericDetailPage from '../GenericDetailPage'
import touchpointConfig from './config'
import { apiClient } from '../../lib/api'

export default function TouchpointDetailPage() {
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    Promise.all([
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/contacts?page_size=100').then(r => setContacts(r.items || [])).catch(() => {}),
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100').then(r => setCompanies(r.items || [])).catch(() => {}),
    ])
  }, [])

  return (
    <GenericDetailPage
      config={touchpointConfig}
      extraData={{ contacts, companies }}
    />
  )
}
