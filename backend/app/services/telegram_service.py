"""
Telegram Bot API client — validate token, send messages, manage webhooks.

Telegram is a user-configured connector: the user provides their own Bot
token + Chat ID at bind time (via @BotFather). The token is validated with
getMe() before storing; delivery uses Bot API sendMessage.

Bot token is a secret — stored in nexus_ai.ai_channel_credentials
(ChannelCredential, encrypted at app level), NOT in the mapping table.
"""
import httpx

BOT_API = "https://api.telegram.org/bot{token}/{method}"


async def get_me(token: str) -> dict:
    """Validate a bot token and return bot info: {ok, bot: {username, id}}."""
    url = BOT_API.format(token=token, method="getMe")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url)
        data = resp.json()
    if not data.get("ok"):
        return {"ok": False, "error": data.get("description", "Invalid bot token")}
    bot = data.get("result", {})
    return {"ok": True, "bot": {"username": bot.get("username"), "id": bot.get("id")}}


async def send_message(token: str, chat_id: str, text: str) -> dict:
    """Send a text message to a chat. Returns Telegram API response JSON."""
    url = BOT_API.format(token=token, method="sendMessage")
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)
        return resp.json()


async def set_webhook(token: str, webhook_url: str) -> dict:
    """Register a webhook URL for the bot (receiver side — reserved)."""
    url = BOT_API.format(token=token, method="setWebhook")
    payload = {"url": webhook_url}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)
        return resp.json()


async def delete_webhook(token: str) -> dict:
    """Remove webhook for the bot."""
    url = BOT_API.format(token=token, method="deleteWebhook")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url)
        return resp.json()


async def get_updates(token: str, offset: int | None = None, timeout: int = 30) -> dict:
    """Long-poll Telegram for new updates (inbound messages).

    offset: pass the highest processed update_id + 1 to confirm delivery.
    timeout: long-poll seconds (Telegram supports up to 50).
    """
    url = BOT_API.format(token=token, method="getUpdates")
    payload: dict = {"timeout": timeout, "allowed_updates": ["message", "edited_message"]}
    if offset is not None:
        payload["offset"] = offset
    async with httpx.AsyncClient(timeout=timeout + 15) as client:
        resp = await client.post(url, json=payload)
        return resp.json()
