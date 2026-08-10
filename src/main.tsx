import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './lib/AuthContext'
import './index.css'
import './styles/dashboard.css'
import './styles/todo.css'
import './styles/design4-overrides.css'
import './styles/design4-v2-patch.css'
import './styles/nexus-modal-tokens.css'
import './styles/nexus-detail-v2.css'
import './i18n/config'; // i18n init — must be before App
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
