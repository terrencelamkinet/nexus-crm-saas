# NEXUS CRM (G08) — 前端設計系統總覽 v2.6

> 用途：改 G08 style（背景顏色、字型、外框、icon 等）時嘅參照文檔。
> 前端代碼：`src/` 完整打包喺 `nexus-crm-frontend-src.tar.gz`（104 files：3 CSS + 60 TSX + i18n + lib）。
> **改 style 嘅黃金法則：只改 `src/index.css` 入面嘅 CSS variables（tokens），全站即時跟住變。** 次選：改特定 class 嘅值。

---

## 1. 檔案結構

| 檔案 | 內容 | 行數 |
|---|---|---|
| `src/index.css` | 全站 stylesheet（tokens + 所有頁面/組件樣式） | 2614 |
| `src/styles/dashboard.css` | Dashboard 專用（widget grid、KPI、drag-drop） | ~150 |
| `src/styles/todo.css` | Todo 專用 | ~120 |
| `src/pages/*.tsx` | Login、Dashboard、Contacts、Companies、Deals、Projects、Tasks、NameCards、Reports、Team、AI Apps、Notifications、Settings、Marketplace、IntegrationDetail、OAuthCallback | 16 |
| `src/modules/*.tsx` | GenericListPage、GenericDetailPage、Contacts/Companies/Projects/Tasks 模組、CalendarViews（8 files）、shared 組件 | ~18 |
| `src/components/*.tsx` | Sidebar、Header、ChatboxPanel、AIBriefingDrawer、SlideDrawer、MobileSearchSheet、ConnectDialog、MarkdownRenderer 等 | ~18 |
| `src/i18n/locales/` | `zh-TW.json` + `en.json`（所有 UI 文字） | 2 |

---

## 2. DESIGN TOKENS（核心 — 改呢度 = 全站換 style）

### 2a. Light Mode（`:root` / `[data-theme="light"]`，index.css L45-63）

| Token | 現值 | 用途 |
|---|---|---|
| `--color-primary` | `#0f6f6f`（teal） | 主色：按鈕、連結、active 狀態、focus ring |
| `--color-primary-hover` | `#0c5959` | 主色 hover |
| `--color-primary-active` | `#0a4646` | 主色 pressed |
| `--color-primary-highlight` | `#dbe8e7` | 主色淡背景（active tab、badge bg、focus ring bg） |
| `--color-bg` | `#f7f7f5` | 全站背景（最底層） |
| `--color-surface` | `#ffffff` | 卡片/面板/表格背景 |
| `--color-surface-2` | `#ffffff` | 第二層 surface |
| `--color-surface-offset` | `#f1f0ee` | hover 背景、toolbar 底、input 底 |
| `--color-surface-offset-2` | `#e9e7e4` | 再深一層 hover |
| `--color-surface-dynamic` | `#dfddd9` | 動態 surface |
| `--color-divider` | `#e7e5e2` | 分隔線（最淺） |
| `--color-border` | `#dcdad6` | 外框（input、card border） |
| `--color-text` | `#1f1e1c` | 主文字 |
| `--color-text-muted` | `#6f6d68` | 次要文字 |
| `--color-text-faint` | `#a5a29c` | 最淡文字（placeholder、meta） |
| `--color-text-inverse` | `#fafaf8` | 反白文字 |
| `--color-notification` | `#c23b4a` | 通知紅 |
| `--color-notification-highlight` | `#f6dcdf` | 通知淡紅底 |
| `--color-success` | `#387a3a` | 成功綠 |
| `--color-success-highlight` | `#dcebdc` | 成功淡綠底 |
| `--color-warning` | `#9a5b17` | 警告橙 |
| `--color-warning-highlight` | `#efdcc4` | 警告淡橙底 |
| `--color-blue` | `#1f6fb3` | 資訊藍 |
| `--color-blue-highlight` | `#d9e7f2` | 資訊淡藍底 |
| `--color-gold` | `#b8901a` | 金色 |
| `--color-gold-highlight` | `#f6ecd2` | 淡金底 |
| `--color-purple` | `#7141b0` | 紫色（AI 相關） |
| `--color-purple-highlight` | `#e5dcf1` | 淡紫底 |

### 2b. 形狀 / 間距 / 陰影 / 字型（L57-62）

| Token | 現值 | 用途 |
|---|---|---|
| `--radius-sm` | `.375rem` | 小圓角（input、tag） |
| `--radius-md` | `.5rem` | 中圓角（button、dropdown） |
| `--radius-lg` | `.75rem` | 大圓角（card、panel） |
| `--radius-xl` | `1rem` | 特大圓角（modal） |
| `--radius-full` | `9999px` | 圓形（avatar、badge） |
| `--shadow-sm` | `0 1px 2px oklch(0.2 0.01 80/.06)` | 輕陰影 |
| `--shadow-md` | `0 6px 20px oklch(0.2 0.01 80/.09)` | 中陰影（dropdown、drawer） |
| `--shadow-lg` | `0 20px 48px oklch(0.2 0.01 80/.16)` | 重陰影（modal） |
| `--transition-interactive` | `150ms cubic-bezier(.2,.8,.2,1)` | 互動過渡 |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | 動畫 easing |
| `--font-display` | `'Switzer','General Sans',sans-serif` | 標題字型（h1/h2、大數字） |
| `--font-body` | `'General Sans','Inter',sans-serif` | 正文字型 |
| `--sidebar-w` | `246px` | 側欄寬度 |
| `--topbar-h` | `56px` | 頂欄高度 |
| `--space-1..16` | `.25rem .. 4rem` | spacing scale |

### 2c. Dark Mode（`[data-theme="dark"]`，L66-80）

| Token | 現值 |
|---|---|
| `--color-bg` | `#151513` |
| `--color-surface` | `#1b1b19` |
| `--color-surface-2` | `#212120` |
| `--color-surface-offset` | `#212120` |
| `--color-surface-offset-2` | `#292927` |
| `--color-divider` | `#2a2a28` |
| `--color-border` | `#38372f` |
| `--color-text` | `#e9e8e4` |
| `--color-text-muted` | `#9c9a94` |
| `--color-text-faint` | `#5f5d57` |
| `--color-text-inverse` | `#1b1b19` |
| `--color-primary` | `#54a6a6` |
| `--color-primary-hover` | `#3f8f8f` |
| `--color-primary-active` | `#2e7373` |
| `--color-primary-highlight` | `#233332` |
| `--color-error` | `#dd7d8b` |
| `--color-notification` | `#e2707c` |
| `--color-notification-highlight` | `#3a2226` |
| `--color-success` | `#7fbf7f` |
| `--color-success-highlight` | `#28361f` |
| `--color-warning` | `#dba360` |
| `--color-warning-highlight` | `#3c3120` |
| `--color-blue` | `#68aae0` |
| `--color-blue-highlight` | `#212f3c` |
| `--color-purple` | `#a888de` |
| `--color-purple-highlight` | `#302a3c` |
| `--color-gold` | `#dba360` |
| `--shadow-*` | `rgba(0,0,0,.3/.36/.5)` |

> ⚠️ **Login 頁有自己獨立 palette**（`.login-page` L140-144，teal `#0e6b70` + Cabinet Grotesk 字型）— 改全站 tokens 唔會影響 login，要另外改。

> ⚠️ **Dashboard `.dash01-shell` 有自己 palette**（index.css ~L1400 區 + dashboard.css）— 部分顏色係 local override，改全站 token 未必 100% 跟。

---

## 3. 每個頁面 / 模組 → CSS 對應索引

| 頁面 / 模組 | 主要 TSX | CSS 位置（index.css） | 關鍵 class 前綴 |
|---|---|---|---|
| Login | `pages/LoginPage.tsx` | L136-230 | `.login-page` |
| App shell（sidebar/topbar/layout） | `components/Sidebar.tsx`、`Header.tsx`、`App.tsx` | L232-770 | `.sidebar`、`.sb-*`、`.topbar`、`.tb-*`、`.main-content`、`.app-shell` |
| 通知 badge/dropdown | Header | L311-340 | `.ntf-*` |
| Breadcrumb | GenericListPage | L340-346 | `.breadcrumb` |
| 表格 toolbar（DB Toolbar） | GenericListPage | L346-377 | `.db-*` |
| Bulk action bar | GenericListPage | L377-383 | `.bulk-*` |
| 表格（data-table） | GenericListPage | L438-546 | `.data-table`、`.table-scroll`、`.row-name` |
| Status tags | GenericListPage | L484-504 | `.tag`、`.status-tag` |
| Three-dot menu | GenericListPage | L404-438 | `.td-*` |
| 表單（form controls、floating label） | GenericDetailPage、FieldsRenderer | L771-900 | `.form-*`、`.fl-*`、`.detail-grid`、`.panel-detail` |
| Detail 頁 | GenericDetailPage、ContactDetailPage、TaskDetailPage | L859-1010 | `.detail-*`、`.panel-detail`、`.avatar` |
| Dashboard | `pages/DashboardNew.tsx` | dashboard.css + L1251-1302 | `.dash01-shell`、`.widget`、`.kpi-*`、`.top-row`、`.dash-grid` |
| Calendar（month/week/day/deadline/gantt） | `modules/projects/CalendarViews/*` | L1127-1250 + 檔案尾部 | `.month-*`、`.week-*`、`.day-*`、`.deadline-*`、`.gantt-*`、`.cv-view-*`、`.er-*` |
| Mobile agenda | CalendarViews/MobileAgendaView | L1973 附近 | `.ma-*`、`.mobile-agenda-*` |
| Bottom sheet / mobile search sheet | MobileSearchSheet、BottomSheet | L1308-1352 | `.bs-*`、`.ms-*` |
| AI Apps / Secretary settings | `pages/AIAppsPage.tsx` | L1352-1496 | `.asec-*`、`.ai-apps-*` |
| SlideDrawer（右側 detail drawer） | SlideDrawer、DetailDrawerContent | L1518-1628 | `.sd-*`、`.drawer-*` |
| AI Chat panel | `components/ChatboxPanel.tsx`、`ai/chat/*` | L1890-2068 + L2367-2505 | `.cb-*`、`.chat-*`、`.msg-*`、`#ai-fab` |
| AI Briefing drawer | `components/AIBriefingDrawer.tsx`、DailyBriefingCard | L2197-2367 | `.ab-*`、`.insight-*` |
| Connect Dialog（marketplace OAuth） | `components/ConnectDialog.tsx` | L2068-2132 | `.cd-*`、`.connect-*` |
| GenericListPage 專用（glp-） | GenericListPage | 檔案尾部 | `.glp-*` |
| Todo | `modules/tasks/TodoPage.tsx` | todo.css | `.todo-*` |

---

## 4. 修改指引（常見改法）

| 想改咩 | 改邊度 |
|---|---|
| 全站主色（而家 teal） | `:root` `--color-primary` + `--color-primary-hover/active/highlight`（light L50、dark L71） |
| 背景色 | `--color-bg`（L46 light / L67 dark） |
| 卡片/面板底色 | `--color-surface` |
| 字型 | `--font-display` + `--font-body`（L60；Tailwind `@theme` L38-39 都要改） |
| 外框/分隔線粗幼顏色 | `--color-border`（外框）、`--color-divider`（分隔線） |
| 圓角 | `--radius-*`（L57） |
| 陰影 | `--shadow-*`（L59） |
| 側欄寬度 | `--sidebar-w`（L61） |
| Icon 尺寸 | `lucide-react` 組件用 `w-3.5 h-3.5` 等 Tailwind class — 逐個組件改 |
| 某頁專屬 | 直接改該頁 class（見上表 CSS 位置） |

---

## 5. 注意事項（改 style 前必讀）

1. **只用 `src/index.css` 一個 stylesheet** — 全部頁面共用，冇分 module css（除咗 dashboard.css + todo.css）
2. **Dark mode 一定要同步改**（L66-80）— 唔改 dark tokens 會「半光半暗」
3. **Login 頁獨立 palette**（`.login-page` L140）— 全站 token 唔覆蓋佢
4. **Dashboard 部分顏色係 local override**（`.dash01-shell` 自己有 `--color-border` 等）— 全站 token 改完要 check dashboard
5. **Tailwind `@theme`（L10-40）同 `:root` tokens 有重複定義** — 兩邊都要改，否則 utility class 同 CSS variable 顏色唔一致
6. **Mobile 有 dual media query trap**（`@media(max-width:768px)` 同 `480px` 都會 match 390px 屏幕，後者贏）— 改 mobile 樣式要兩處都改
7. **iOS Safari 自動 zoom**：mobile input `font-size` 必須 ≥16px
8. **New style 套用**：攞 `nexus-crm-frontend-src.tar.gz` 解壓 → 直接改 `src/index.css` 嘅 tokens/classes → `npx vite build` → 完成。唔使改 TSX（除非要換 icon 或改結構）
