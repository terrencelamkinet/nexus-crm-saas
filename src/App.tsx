import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
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
import NameCardModuleRouter from './namecards/NameCardModuleRouter';
import SettingsPage from './pages/SettingsPage';
import AIAppsPage from './pages/AIAppsPage';
import NotificationsPage from './pages/NotificationsPage';
import DeepLinkEventPage from './pages/DeepLinkEventPage';
import SalesGate from './components/SalesGate';
import ProjectGate from './components/ProjectGate';

function App() {
  return (
    <BrowserRouter>
      <ScrollReflow />
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
          {/* IM push deep links — WhatsApp briefing links resolve to real pages */}
          <Route path="l/dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="l/t/:id" element={<DeepLinkTask />} />
          <Route path="l/m/:id" element={<DeepLinkEventPage mode="prep" />} />
          <Route path="l/note/:id" element={<DeepLinkEventPage mode="note" />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="calendar" element={<ContactCalendarPage />} />
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
          <Route path="namecards/*" element={<NameCardModuleRouter />} />
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
          <Route path="ai-apps" element={<AIAppsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* Catch-all → redirect to dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Deep link /l/t/{id} → real task detail page (from WhatsApp briefing) */
function DeepLinkTask() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/tasks/${id}`} replace />;
}

/**
 * Global route-change reflow (iOS Safari URL-bar fix, Layer 3).
 * Forces the browser to re-measure layout on every navigation so the
 * collapsed/expanded URL bar never leaves a stale "dropped a layer" gap.
 */
function ScrollReflow() {
  const { pathname } = useLocation();
  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo(0, window.scrollY));
  }, [pathname]);
  return null;
}

export default App;
