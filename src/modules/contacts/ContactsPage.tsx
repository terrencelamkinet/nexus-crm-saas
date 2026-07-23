import { useState, useEffect } from 'react'
import GenericListPage from '../GenericListPage'
import contactConfig from './config'
import { apiClient } from '../../lib/api'

export default function ContactsPage() {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100')
      .then(r => setCompanies(r.items || []))
      .catch(() => {})
  }, [])

  return (
    <GenericListPage
      config={contactConfig}
      extraData={{ companies }}
    />
  )
}
