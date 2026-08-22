# G08 Secrets & Provider API Keys 管理

> 目的：**確保 provider API keys 永遠有跡可尋、唔會「唔見」**（2026-08-22 教訓：SiliconFlow key 曾只有 `.env` 空值 reference，導致 vision 功能失效）。

## 獨立 API key 儲存位置（Primary）

**`nexus_ai.provider_credentials`（PostgreSQL）** — G08 官方獨立 key 儲存：

- 加密 at rest：AES-256-GCM（`app/services/secret_crypto.py`），格式 `v1:base64(nonce||tag||ciphertext)`
- 加密 key 來源：`NEXUS_SECRET_KEY` env；dev 環境 fallback 到 `backend/keys/secret.key`（0600）
- Tenant-scoped（BYOK 設計），`status='active'` 先會被用
- 統一讀取：`app/services/provider_keys.py` → `load_provider_key(provider, tenant_id)`（DB decrypt → memory cache → env fallback）

支援 provider：`siliconflow`（vision/STT/名卡 crop）、可擴展 deepseek / perplexity 等。

## 備份位置（Secondary）

**`backend/.env`** — `SILICONFLOW_API_KEY=<真 key>`（0600, gitignored）。只係 fallback，`.env` 改完要 `sudo systemctl restart nexus-crm` 先生效。

> ⚠️ 2026-08-22 之前 `.env` 個值係空 — 以後唔准寫 reference 落 `.env`，要寫真 key（DB 先係 primary，`.env` 只做 backup）。

## 更新 API key 流程

```bash
cd /home/airoot/projects/nexus-crm-saas/backend
venv/bin/python - <<'EOF'
import asyncio, uuid
from sqlalchemy import select, update
from app.db import async_session
from app.models.ai.provider import ProviderCredential
from app.services.secret_crypto import encrypt_secret

NEW_KEY = "sk-xxxx"

async def main():
    async with async_session() as db:
        # 1. 舊 active row → inactive
        await db.execute(update(ProviderCredential)
            .where(ProviderCredential.provider == "siliconflow")
            .values(status="inactive"))
        # 2. 插入新 active row（tenant 用 00000000-...-0001）
        db.add(ProviderCredential(
            tenant_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            provider="siliconflow",
            encrypted_api_key=encrypt_secret(NEW_KEY),
            is_byok=False, status="active"))
        await db.commit()
        # 3. round-trip verify
        row = (await db.execute(select(ProviderCredential)
            .where(ProviderCredential.provider=="siliconflow",
                   ProviderCredential.status=="active"))).scalars().first()
        assert decrypt(row.encrypted_api_key) == NEW_KEY
asyncio.run(main())
EOF
```

之後：
1. `.env` 同步更新真 key + `chmod 600 .env`
2. `sudo systemctl restart nexus-crm`（清 provider_keys memory cache）
3. 實測：
   ```bash
   curl -s https://api.siliconflow.cn/v1/chat/completions \
     -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"model":"Qwen/Qwen3-VL-8B-Instruct","messages":[{"role":"user","content":"say OK"}],"max_tokens":10}'
   ```
   預期 HTTP 200 + `"content":"OK"`。

## 驗證（functional proof）

- Vision E2E：生成測試圖 → `_analyze_plain_image(path, tenant_id=...)`（`telegram_inbound.py`）→ 輸出必須包含圖片內文字（證明係真 vision，唔係 Tesseract fallback）
- SQL log 應見 `provider_credentials` query（證明走 DB key 路徑）

## 已知 model IDs（SiliconFlow）

- Vision（圖片描述/讀字）：`Qwen/Qwen3-VL-8B-Instruct`
- STT（語音轉錄）：`FunAudioLLM/SenseVoiceSmall`
