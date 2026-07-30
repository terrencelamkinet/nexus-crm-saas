import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import AuthGuard from './components/AuthGuard';
import LoginPage from './pages/LoginPage';
import DashboardNew from './pages/DashboardNew';
import ContactsPage from './modules/contacts/ContactsPage';
import ContactDetailPage from './modules/contacts/ContactDetailPage';
import ContactCalendarPage from './modules/contacts/ContactCalendarPage';
import CompaniesPage from './modules/companies/CompaniesPage';
import CompaniesDetailPage from './modules/companies/CompaniesDetailPage';
import ProjectsPage from './modules/projects/ProjectsPage';
import ProjectsDetailPage from './modules/projects/ProjectsDetailPage';
import DealsPage from './pages/DealsPage';
import TasksPage from './modules/tasks/TasksPage';
import TaskDetailPage from './modules/tasks/TaskDetailPage';
import TouchpointsPage from './modules/touchpoints/TouchpointsPage';
import TouchpointDetailPage from './modules/touchpoints/TouchpointDetailPage';
import MarketplacePage from './pages/MarketplacePage';
import IntegrationDetailPage from './pages/IntegrationDetailPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import NameCardsPage from './pages/NameCardsPage';
import SettingsPage from './pages/SettingsPage';
import NotificationsPage from './pages/NotificationsPage';
import SalesGate from './components/SalesGate';
import ProjectGate from './components/ProjectGate';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes — no auth needed */}
        <Route path="/sign-in" element={<LoginPage />} />

        {/* OAuth callback — standalone, no layout (runs in popup) */}
        <Route path="/marketplace/oauth/callback" element={<OAuthCallbackPage />} />

        {/* Protected routes — wrapped in AuthGuard */}
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardNew />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="contacts/calendar" element={<ContactCalendarPage />} />
          <Route path="contacts/:id" element={<ContactDetailPage />} />
          <Route path="companies" element={<CompaniesPage />} />
          <Route path="companies/:id" element={<CompaniesDetailPage />} />
          <Route path="projects" element={<ProjectGate><ProjectsPage /></ProjectGate>} />
          <Route path="projects/:id" element={<ProjectGate><ProjectsDetailPage /></ProjectGate>} />
          <Route path="deals" element={<SalesGate><DealsPage /></SalesGate>} />
          <Route path="shipping" element={
            <div className="p-8">
              <h1 className="text-2xl font-bold c-text">Shipping</h1>
              <p className="c-text-muted">Shipping module coming soon</p>
            </div>
          } />
          <Route path="touchpoints" element={<TouchpointsPage />} />
          <Route path="touchpoints/:id" element={<TouchpointDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="namecards" element={<NameCardsPage />} />
          <Route path="reports" element={
            <div className="p-8">
              <h1 className="text-2xl font-bold text-slate-900">Reports & Analytics</h1>
              <p className="text-slate-500 mt-2">Coming soon</p>
            </div>
          } />
          <Route path="marketplace" element={<MarketplacePage />} />
          <Route path="marketplace/:id" element={<IntegrationDetailPage />} />
          <Route path="team" element={
            <div className="p-8">
              <h1 className="text-2xl font-bold c-text">Team</h1>
              <p className="c-text-muted">Team management coming soon</p>
            </div>
          } />
          <Route path="ai-apps" element={
            <div className="p-8">
              <h1 className="text-2xl font-bold c-text">AI Apps</h1>
              <p className="c-text-muted">AI-powered applications coming soon</p>
            </div>
          } />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* Catch-all → redirect to dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
