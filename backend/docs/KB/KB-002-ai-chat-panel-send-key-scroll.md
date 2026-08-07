# KB-002 — AI Chat Panel: Send 鍵走位 + 打字時背景 Scroll

## 📅 日期 / 🔴 Severity / 📍 系統
- **日期:** 2026-08-07
- **Severity:** 🟠 High — UI 明顯瑕疵（send 鍵跌落輸入框下面 + panel 開住時背景照 scroll），mobile 更勁
- **系統:** G08 NEXUS CRM frontend (React + Vite；production = `nexus-crm-preview` systemd 服務 serve `dist/` on :5173)

---

## 1. 症狀 (Symptom)

- **輸出鍵走位:** AI 助手 panel 個 send 按鈕（藍色 ↑ 鍵）跌落輸入框 border 下面 ~8px，同 textarea 底部唔對齊，肉眼明顯
- **打字控制背景 scroll:** 文字輸入時（尤其 mobile keyboard 彈出）background page 會向下 scroll — browser 自動 scroll document 去就返個 focused input
- **Panel 開住背景照 scroll:** 碌 `.cb-messages` 到邊緣會 chain 落 body（scroll chaining），desktop 亦係

**Signature:** send button bottom 比 textarea bottom 低 7-8px + `document.body.style.overflow` 係 `""`（panel 開住都冇 lock）

---

## 2. 問題 log (Error Log) — 實際摘錄

冇 JS error，純 DOM / computed style 實測：

```
.send-btn-hitarea computed:
  padding: 0px      ← inline style 覆蓋咗 CSS 嘅 8px
  margin: -8px      ← CSS rule 照樣生效
send button bottom = 454.4px
row content bottom = 447.4px   (row border bottom 453.4px - padding 6px)
差額 = 7-8px → button 溢出 input row border

body.style.overflow = ""       ← panel open 都冇 lock
body.scrollHeight 1757 > innerHeight 577  ← body 可 scroll
```

---

## 3. 成因 (Root Cause)

兩個獨立問題:

### 成因 A — Send 鍵 hit-area hack 半失效（走位）
- `ChatboxPanel.tsx` 個 global `<style>` 有 `.send-btn-hitarea { padding: 8px; margin: -8px; }` — 擴闊 tap target 用（button 30px → hit area 46×46，padding + negative margin 互相抵消，視覺位置唔郁）
- 但 `ChatInput.tsx` 個 span 有 **inline `padding: 0`** → inline style specificity 贏咗 CSS → padding 一半失效
- 淨返 `margin: -8px` 照樣生效 → 成個 span 連 button 被推低 8px，溢出輸入框 border
- 即係:擴闊 tap target 嘅 padding 冇咗,但抵消用嘅負 margin 留返低 → 淨低個 visual bug,仲要 hit area 都冇擴闊到

### 成因 B — ChatboxPanel 係全 app 唯一冇 body scroll lock 嘅 overlay
- `BottomSheet.tsx` / `SlideDrawer.tsx` / `ActionPreviewModal.tsx` / `MobileSearchSheet.tsx` **全部**有 `document.body.style.overflow = 'hidden'`（open 時 lock,close 時 restore）
- `ChatboxPanel.tsx` **冇** — 唯一 anomaly
- Mobile: keyboard 彈出 → visualViewport 縮細 → browser 自動 scroll document 去就 input → 背景 scroll（body 冇 lock 所以 scroll 到）
- Desktop: `.cb-messages` 冇 `overscroll-behavior: contain` → 碌到邊緣 chain 落 body

---

## 4. 解決過程 (Debug Process)

1. **Production 重現** — 開 AI 助手 panel，`browser_console` 量度 send button / textarea / composer row 嘅 getBoundingClientRect
2. **搵到 8px 差額** — button bottom (454.4) vs row content bottom (447.4)，溢出 border
3. **Computed style 對比** — span 顯示 `padding: 0px`（inline 贏）+ `margin: -8px`（CSS 生效）→ 確認 hit-area hack 衝突
4. **grep 全 app** — `document.body.style.overflow` 只有 4 個 component 有，ChatboxPanel 唔喺入面 → 確認 anomaly
5. **參考既有 pattern** — `BottomSheet.tsx` 嘅 body lock + visualViewport keyboard handling（照抄同一 pattern）
6. **雙平台驗證** — desktop browser_console + Playwright mobile viewport (390×844, isMobile + hasTouch)

---

## 5. 解決方法 (Fix)

### Fix 1 — Send 鍵歸位 (ChatInput.tsx)
```tsx
// span inline style: padding: 0 → padding: 8, margin: -8
<span className="send-btn-hitarea" style={{ display: 'inline-flex', padding: 8, margin: -8, lineHeight: 0 }}>
```
- hit area 46×46 保留（HIG ≥44px），button 視覺位置歸位（同 textarea 底部對齊）

### Fix 2 — 移除 dead CSS rule (ChatboxPanel.tsx)
- 刪 `.send-btn-hitarea { padding: 8px; margin: -8px; }`（inline 已 carry，留低會再衝突）

### Fix 3 — Body scroll lock（全平台）
```tsx
useEffect(() => {
  if (!isOpen) return
  const prev = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  return () => { document.body.style.overflow = prev }
}, [isOpen])
```

### Fix 4 — Mobile keyboard 高度 (visualViewport)
```tsx
// kbHeight state: visualViewport resize → kh = innerHeight - vv.height (>80 threshold)
// mobile panel height: calc(92dvh - ${kbHeight}px) → composer 唔會被 keyboard 遮住
```

### Fix 5 — 斷開 scroll chaining (index.css)
```css
.cb-messages{...;overscroll-behavior:contain}
```

---

## 6. 成功 log (Success Log) — 修復後

```
Desktop (browser_console):
  sendBtnBottomVsTextareaBottom = 0px   ✓ 對齊
  body.style.overflow = "hidden"        ✓ 開 panel 時 lock
  window.scrollTo(0,400) → scrollY = 0  ✓ 背景 scroll 被封

Mobile 390×844 (Playwright):
  panelClass = "cb-panel cb-panel--mobile"
  body.style.overflow = "hidden"
  打字 104px textarea → sendBtnBottomVsTextareaBottom 仍然 0px, scrollY 保持 0
  關 panel → body.style.overflow restore ""
```

---

## 7. 驗證 (Verification)

1. `npm run build` + `npx tsc --noEmit` → 0 errors
2. Desktop browser_console: alignment 0px、body overflow hidden、scrollTo 被封
3. Playwright mobile 390×844: 開 panel → lock；打字 → scrollY 0；關 panel → restore
4. Production 已上線（v4.1, dist rebuild 即時生效 — vite preview 由 disk serve）

---

## 8. 預防 (Prevention)

1. **Hit-area 擴闊（padding + negative margin）必須同一處定義** — inline 定 CSS 二選一，唔可以一半一半。CSS rule + inline override 衝突時，負 margin 會單獨生效 → visual bug
2. **任何新 overlay/modal 必須跟 BottomSheet pattern:** body scroll lock + `overscroll-behavior: contain` + mobile 用 visualViewport 處理 keyboard
3. **Overlay 改動後必須 browser computed style 驗證** — build pass ≠ 視覺正確（參考 quality-check-output 2026-07-23 CSS verification 章節）
4. **grep 檢查清單:** 新 modal 落 code 前 `grep -rn "body.style.overflow" src/` 對比其他 component 有冇跟 pattern

---

## 9. 相關檔案 (Files Affected)

| 檔案 | 改動 |
|------|------|
| `src/components/ai/chat/ChatInput.tsx` | send-btn-hitarea inline style: padding 8 + margin -8 |
| `src/components/ai/chat/ChatboxPanel.tsx` | body scroll lock effect + visualViewport kbHeight + 移除 dead `.send-btn-hitarea` rule |
| `src/index.css` | `.cb-messages` 加 `overscroll-behavior: contain` |

---

## 10. 相關 Skill / Reference
- Skill: `mobile-ui-patterns` — BottomSheet body lock + visualViewport keyboard pattern（本次 fix 嘅參考來源）
- Skill: `quality-check-output` — CSS/visibility fix 必須 browser-verify 嘅子章節
- 相關: `nexus-version-workflow` — v4.1 三個 commit (637f242 / 38eecbc / cd06cee)
