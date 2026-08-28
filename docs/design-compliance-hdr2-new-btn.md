# Design Compliance — hdr2-new-btn (Desktop 頂部 + 快速新增)

對照 `nexus-design-guide-2026`（skills/terrence/nexus-design-guide-2026）實測於
production `https://nexus-crm.kinet-poc.com/dashboard`（commit 8e9a187 之後，Playwright chromium，auth 注入）。

## 實測數值（Playwright geometry probe）

### 1. 觸控目標 / 尺寸（Guide §3 / §12 / §5）
- Desktop 1440×900：`.hdr2-new-btn` = **38×38px**，與旁邊 `.hdr2-icon-btn`（theme/notif）完全一致（都係 38×38，y=13 對齊，bottom=51）。
- **≥24×24px（WCAG 2.2 baseline）✅**；Desktop-only button（keyboard+mouse 為主），guide §12 桌面可用 24px 底線。
- **Mobile 390×844：`.hdr2-new-btn` 隱藏（w:0,h:0）** — mobile 用 MobileBottomNav + 唔同 header，所以 **§12 Mobile ≥44px 規則 N/A**（此按鈕唔出現喺 mobile）。

### 2. Input ≥16px（Guide §2.1）
- `.db-search input` font-size = **16px** ✅（Mobile Input ≥16px 免 iOS zoom）

### 3. 8px Grid（Guide §4）
- Button height 38px 唔喺 8-grid（38 % 8 = 6），但**成個 header 嘅 icon-btns 統一 38px**（一致優先），保持對齊；非單獨此按鈕問題。

### 4. Breakpoint（Guide §1）
- Desktop ≥1280px 顯示；≤1023px 唔顯示（mobile header 唔 render `.hdr2-new-btn`）✅

### 5. Dark Mode（Guide §7）
- light & dark（colorScheme dark）實測：icon color **`rgb(255,255,255)` 純白** ✅（`!important` 喺 dark 都起作用）

### 6. Overflow（Guide §12 / a11y）
- `document.documentElement.scrollWidth(1440) === window.innerWidth(1440)`，**冇 horizontal overflow** ✅

### 7. 對齊
- 新按鈕同相鄰 header 按鈕 y=13 / bottom=51 完美對齊 ✅

### 8. Hover / Focus（Guide §5 / §12）
- hover：`background rgb(27,59,75) → rgb(22,48,62)`（加深 8%）+ box-shadow 出現（`oklch 0.45 0px 4px 12px -2px`）✅
- focus-visible：`outline 2px solid var(--color-primary)` + `offset 2px`（≥2px WCAG 2.2）✅
- click：dropdown 開啟（opacity:1 / visible）✅

### 9. WCAG 對比（Guide §7）
- icon 純白 `#FFFFFF` 對 primary 藍底 `rgb(27,59,75)`：對比度 > 7:1（達 AAA 級）✅

## 結論
「+ icon 被藍底吞冇」根因（`.svc-icon` 全域 `color:var(--color-blue)`）已修復，符合 guide §7 對比度、§12 a11y、§5 按鈕狀態。其餘（38px height）與 header 一致，屬刻意保持對齊，符合桌面 WCAG baseline。

---

## 官方 audit-page.mjs 輸出（auth-injected，nexus-design-guide-2026/scripts/audit-page.mjs）

### Desktop 1440×900
- `inputsUnder16px: []` — 冇任何 input <16px ✅
- `hOverflow: false` — 冇 horizontal overflow ✅
- `bodyH: 900`（=viewport）— 內容喺 `.nx2-content` 內 scroll，冇 body 層 overflow ✅
- touchTargetsUnder44：只有 sidebar `sbv2-nav-item`（221×39，既有 sidebar 連結），**唔包 `.hdr2-new-btn`**
- dark flip：primary `rgb(27,59,75)`；icon 純白另以 `colorScheme:dark` 證實 ✅

### Mobile 390×844
- `inputsUnder16px: []` ✅ · `hOverflow: false` ✅
- touchTargetsUnder44：只有 dashboard `dv2-widget-action` / `dv2-list-row`（既有 widgets，非 header 按鈕）
- **`.hdr2-new-btn` 唔存在於 mobile**（Desktop-only，mobile header 用 MobileBottomNav，theme toggle 都隱藏）→ §12 mobile≥44 N/A ✅

### 結論
官方 audit 對口嘅 compliance 全數通過；被 flag 嘅 <44px touch targets 全部係既有 sidebar/dashboard 元素，同本 fix 無關，本 fix 冇引入新違規。
