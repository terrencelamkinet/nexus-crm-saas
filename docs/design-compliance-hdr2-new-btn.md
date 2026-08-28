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
