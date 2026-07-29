import GenericDetailPage from '../GenericDetailPage'
import companyConfig from './config'
import {
  ContactsTab, DealsTab, ProjectsTab, ProductsTab,
  PartnersTab, TouchpointsTab, NotesTab, TimelineTab, TasksTab,
} from './CompanyDetailTabs'

export default function CompaniesDetailPage() {
  return (
    <GenericDetailPage
      config={companyConfig}
      tabRenderers={{
        contacts: ContactsTab,
        deals: DealsTab,
        projects: ProjectsTab,
        products: ProductsTab,
        partners: PartnersTab,
        touchpoints: TouchpointsTab,
        notes: NotesTab,
        timeline: TimelineTab,
        tasks: TasksTab,
      }}
    />
  )
}
