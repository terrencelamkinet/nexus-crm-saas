# Design: Tri-Daily Briefing & IM Push Module (G08)

> Status: **DRAFT — pending user approval (Design-First Protocol)**
> Source: `AI_Personal_CRM_TriDaily_Strategy.md` (2026-07-31)
> Date: 2026-07-31

## 1. 定位

以 Task + Schedule 為主軸嘅個人生產力防護網。AI 對抗遺忘、減少 context switching，經 WhatsApp/Telegram 主動推送 + Deep Link 延伸至通訊軟件。

## 2. 三時段內容策略（跟 strategy doc 對齊）

### ☀️ Morning (08:00-10:00, HKT default) — Win the Day
| 關注點 | 提取邏輯 | AI 行動 |
|---|---|---|
| 今日會議全盤預覽 | 掃今日 Calendar，標記首次見面/高重要性 | 會議準備卡（相關 CRM 互動摘要）`/l/m/{eventId}` |
| 死線與高優先排程 | 昨日逾期 + 今日到期 tasks | 批次推遲至明日 / 標記完成 `/l/t/{taskId}` |

### ☕ Noon (13:00-14:00) — Keep the Momentum
| 關注點 | 提取邏輯 | AI 行動 |
|---|---|---|
| 突發改動/下午會議 | 臨時加插會議、1 小時內開始嘅重要行程 | 預覽 Agenda `/l/m/{eventId}` |
| 微型任務清理 | Quick-wins（細任務）+ 早上未完成關鍵任務 | AI 草擬回覆預覽 `/l/t/{taskId}` |

### 🌙 Evening (17:30-19:00) — Close & Reset
| 關注點 | 提取邏輯 | AI 行動 |
|---|---|---|
| 會議記錄補漏 (Data Hygiene) | 今日 Calendar events vs CRM notes 對比，搵「開咗會冇留底」 | 語音轉文字紀錄 `/l/note/{eventId}` |
| 清空大腦 + 明日預告 | 結算完成度、未完成自動過渡明日、預告明日重點 | 快速添加任務 `/l/note` + 明日預覽 |

## 3. 數據模型（nexus_crm schema，新增 2 表）

### `im_delivery_prefs`
| Column | Type | Notes |
|---|---|---|
| tenant_id | uuid PK | |
| user_id | uuid PK | |
| channel | text PK | `whatsapp` / `telegram` |
| enabled | bool | **Default ON** — 綁定成功時自動建 row |
| slots | jsonb | `{"morning":true,"noon":true,"evening":true}` |
| weekend_mute | bool | default `true`（週末不推送） |
| quiet_hours | jsonb | `{"start":"22:00","end":"08:00"}` |
| tz | text | default `Asia/Hong_Kong` |
| created_at / updated_at | timestamptz | |

### `push_log`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id / user_id / channel | | |
| slot | text | morning/noon/evening |
| status | text | sent / failed / skipped(quiet/weekend/muted) |
| error | text | |
| sent_at | timestamptz | |

## 4. Backend Endpoints

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET/PUT | `/api/v1/im-push/prefs` | JWT | 讀寫推送偏好 |
| POST | `/api/v1/im-push/briefing?slot=` | Cron-Api-Key | 三時段 compose + fan-out（核心） |
| POST | `/api/v1/im-push/test` | JWT | 測試推送 |
| GET/POST | `/api/v1/telegram/webhook` | signature/token | Telegram Bot 收訊 |
| POST | `/api/v1/telegram/bind` | JWT | `/start <token>` 綁定 |
| GET | `/api/v1/telegram/status` | JWT | 連接狀態 |
| POST | `/api/v1/telegram/disconnect` | JWT | 解除綁定 |

### `POST /im-push/briefing` compose 流程
1. Cron-Api-Key 驗證 → 查 `im_delivery_prefs` (enabled + slot on)
2. 逐 user 過濾：weekend_mute（今日係週末→skip）、quiet_hours（而家喺靜音時段→skip）
3. 按 slot 提取數據（重用現有 tool handlers）：
   - **morning**: `_get_upcoming_events(days_ahead=1)` 今日會議 + `_list_tasks` overdue/due-today
   - **noon**: 1 小時內會議（agenda 變動）+ pending quick-win tasks
   - **evening**: 今日 events vs touchpoints/notes 對比（gap 偵測）+ 今日完成 task 數
4. Compose 訊息（Emoji 層次 + deep links，見 §5）
5. Fan-out：channel=whatsapp → `send_text()`（24h window）/ `send_template()`（fallback）；channel=telegram → Bot API `sendMessage`
6. 寫 `push_log` + 同時寫一條 in-app `notifications` row（bell 同步可見）

## 5. 訊息範本（scannable + deep link）

### ☀️ Morning (WhatsApp/Telegram)
```
🤖 [AI 助理] 早晨 Briefing (8:30 AM)

📅 今日焦點行程：
• 14:00 - 季度回顧會議 (與 Alex) ⭐首次見面
📎 AI 會議準備卡：https://nexus-crm.kinet-poc.com/l/m/8a9b

✅ 待處理死線：
1. 提交 Q3 營銷預算 (昨日逾期)
👉 立即處理或推遲：https://nexus-crm.kinet-poc.com/l/t/3f2e
2. 確認新辦公室租約 (今日到期)
👉 立即查看：https://nexus-crm.kinet-poc.com/l/t/9x1c

🌐 完整簡報：https://nexus-crm.kinet-poc.com/l/dashboard
```

### 🌙 Evening
```
🤖 [AI 助理] 傍晚 Wrap-up (6:00 PM)

🎯 今日完成 5/7 個任務！剩餘已自動移至明日
⚠️ 溫馨提示：
• 14:00 與 Alex 嘅會議尚未輸入紀錄
🎙 趁記憶猶新，語音留底：https://nexus-crm.kinet-poc.com/l/note/8a9b

📝 腦中有未寫低嘅任務？
➕ 快速添加：https://nexus-crm.kinet-poc.com/l/note
```

## 6. Deep Link（SPA Route）

`https://nexus-crm.kinet-poc.com/l/{kind}/{id}` → `DeepLinkHandler` 組件：
- 檢查 auth（無 token → 去 login，完成後 return 返原 link）
- kind 對應：
  - `t/{taskId}` → Tasks 頁 + **任務 drawer**：`[✅ 標記完成]` `[⏰ 推遲至明天]` `[📋 詳情]`（單手大按鈕）
  - `m/{eventId}` → **會議準備卡** modal：會議資料 + 相關聯絡人 + 最近互動摘要（Gmail email 摘要 = Phase D+，見 §9 決策 4）
  - `note/{eventId?}` → **快速記事 modal**：文字輸入（+ 語音 Phase D）
  - `dashboard` → 直接去 dashboard
- Quick action 直接 call 現有 API：`PATCH /tasks/{id}`（status/due_date）

## 7. 設定 UI（Settings → AI tab → 通知與整合）

- 全域開關：「允許 AI 透過 WhatsApp/Telegram 發送每日簡報」
- 時段勾選：☀️ 早晨 / ☕ 午間 / 🌙 傍晚
- 週末不推送 toggle（default ON）+ 靜音時段 (22:00-08:00)
- 頻道狀態卡：WhatsApp ✓ / Telegram ✓ + `[測試推送]`
- Marketplace 加 Telegram connector 卡（bind 流程：bot `/start <code>`）

## 8. 執行順序

- **Phase A**：`im_delivery_prefs` + `push_log` models → prefs API → `im-push/briefing` cron endpoint + compose（morning 先行）→ WhatsApp fan-out → 設定 UI
- **Phase B**：Deep link route + 任務 drawer quick actions（完成/推遲）
- **Phase C**：Telegram bot（webhook + bind + sendMessage）+ Marketplace 卡
- **Phase D**：noon/evening 完整策略（gap 偵測、quick wins、rollover）+ 語音記事（STT）+ Meta template

Cron（Hermes，HKT）：`0 8 * * 1-5` morning / `0 13 * * 1-5` noon / `0 18 * * 1-5` evening（weekend 由 weekend_mute 控制）

## 9. 需要用戶決定

1. **網域**：用 `nexus-crm.kinet-poc.com/l/...`（strategy doc 寫 `crm.link` — 我哋冇呢個 domain；可之後買短網域 + 301）
2. **Meta template**：WhatsApp 24h window 外需要 approve `daily_briefing` template；MVP 可先靠 24h window（user 有同 bot 互動就 open）
3. **Telegram bot token**：用戶去 @BotFather 開 bot 提供 token
4. **Email 摘要**（早晨準備卡「上週 2 封 Email」）：而家冇 Gmail API connector — Phase A 先用 CRM 最近互動（touchpoints/notes）頂住，Gmail 摘要列 Phase D+？
5. **語音記事**：backend 未有 STT — Phase D 加（SiliconFlow/Whisper），Phase A-C 文字記事先？
