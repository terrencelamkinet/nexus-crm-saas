import { Routes, Route, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Images, UploadCloud, Tags } from 'lucide-react'
import NameCardsPageV2 from './NameCardsPageV2'
import BulkUploadPage from './BulkUploadPage'
import TagManagementPage from './TagManagementPage'

/* ═══════════════════════════════════════════════════════════
   NameCardModuleRouter — Entry point wiring the 3 pages together.
   Mount this at /namecards/* in your app's main router.
   Example (App.tsx):
     <Route path="/namecards/*" element={<NameCardModuleRouter />} />
   ═══════════════════════════════════════════════════════════ */

export default function NameCardModuleRouter() {
  const { t } = useTranslation()
  return (
    <div className="nc-module-shell">
      <nav className="nc-module-nav">
        <NavLink to="" end className="nc-module-tab">
          <Images size={15} /> {t('nameCard.navGallery', { defaultValue: '名片庫' })}
        </NavLink>
        <NavLink to="upload" className="nc-module-tab">
          <UploadCloud size={15} /> {t('nameCard.navBulkUpload', { defaultValue: '批量上載' })}
        </NavLink>
        <NavLink to="tags" className="nc-module-tab">
          <Tags size={15} /> {t('nameCard.navTags', { defaultValue: 'Tag 管理' })}
        </NavLink>
      </nav>
      <div className="nc-module-body">
        <Routes>
          <Route index element={<NameCardsPageV2 />} />
          <Route path="upload" element={<BulkUploadPage />} />
          <Route path="tags" element={<TagManagementPage />} />
        </Routes>
      </div>
    </div>
  )
}
