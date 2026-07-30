"""
Integrations Router — per-user, tenant-isolated.

Endpoints:
  GET    /integrations              → list user's connected integrations
  POST   /integrations/oauth/start  → create OAuth state, return redirect URL
  POST   /integrations/oauth/callback → complete OAuth, store tokens
  PATCH  /integrations/{id}         → update status/config
  DELETE /integrations/{id}         → disconnect (remove integration)
"""

import uuid
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_tenant_session
from app.models.integration import Integration, OAuthState
from app.schemas.integration import IntegrationResponse, IntegrationUpdate, OAuthStateResponse

router = APIRouter(prefix="/api/v1")


def _tid(request: Request) -> UUID:
    tid = request.state.tenant_id
    if not tid:
        raise HTTPException(403, "Tenant not identified")
    return tid


def _uid(request: Request) -> UUID:
    uid = getattr(request.state, "user_id", None)
    if not uid:
        raise HTTPException(401, "User not authenticated")
    return uid


# ─── LIST user's integrations ─────────────────────────────────


@router.get("/integrations", response_model=list[IntegrationResponse])
async def list_integrations(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _tid(request)
    user_id = _uid(request)

    q = select(Integration).where(
        Integration.tenant_id == tenant_id,
        Integration.user_id == user_id,
    ).order_by(Integration.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return list(rows)


# ─── GET single integration ────────────────────────────────────


@router.get("/integrations/{integration_id}", response_model=IntegrationResponse)
async def get_integration(
    request: Request,
    integration_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _tid(request)
    user_id = _uid(request)

    q = select(Integration).where(
        Integration.id == integration_id,
        Integration.tenant_id == tenant_id,
        Integration.user_id == user_id,
    )
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Integration not found")
    return row


# ─── UPDATE ────────────────────────────────────────────────────


@router.patch("/integrations/{integration_id}", response_model=IntegrationResponse)
async def update_integration(
    request: Request,
    integration_id: UUID,
    body: IntegrationUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _tid(request)
    user_id = _uid(request)

    q = select(Integration).where(
        Integration.id == integration_id,
        Integration.tenant_id == tenant_id,
        Integration.user_id == user_id,
    )
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Integration not found")

    if body.status is not None:
        row.status = body.status
    if body.config is not None:
        row.config = body.config
    if body.metadata_ is not None:
        row.metadata_ = body.metadata_
    row.updated_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(row)
    return row


# ─── DELETE (disconnect) ───────────────────────────────────────


@router.delete("/integrations/{integration_id}", status_code=204)
async def delete_integration(
    request: Request,
    integration_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _tid(request)
    user_id = _uid(request)

    q = select(Integration).where(
        Integration.id == integration_id,
        Integration.tenant_id == tenant_id,
        Integration.user_id == user_id,
    )
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Integration not found")
    await db.delete(row)
    return None


# ─── OAuth: START flow ─────────────────────────────────────────


@router.post("/integrations/oauth/start")
async def oauth_start(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """
    Start OAuth flow for a provider.
    Body: { "provider": "google_calendar", "origin": "https://nexus-crm.kinet-poc.com" }
    The origin (frontend URL) is used as the OAuth redirect_uri so the
    provider sends the user back to a frontend page, not the backend.
    """
    body = await request.json()
    provider = body.get("provider", "")
    # Derive frontend origin from request Origin header or body.origin
    frontend_origin = body.get("origin", "") or request.headers.get("origin", "http://localhost:5173")

    if not provider:
        raise HTTPException(400, "provider is required")

    tenant_id = _tid(request)
    user_id = _uid(request)

    # Generate random state for CSRF protection
    state = secrets.token_urlsafe(32)

    oauth = OAuthState(
        tenant_id=tenant_id,
        user_id=user_id,
        provider=provider,
        state=state,
        redirect_uri=frontend_origin,  # store origin for callback context
    )
    db.add(oauth)
    await db.flush()

    # Build provider-specific OAuth URL — redirect_uri points to frontend
    oauth_url = _build_oauth_url(provider, state, frontend_origin)

    return {
        "state": state,
        "oauth_url": oauth_url,
        "provider": provider,
    }


# ─── OAuth: CALLBACK ───────────────────────────────────────────


@router.post("/integrations/oauth/callback")
async def oauth_callback(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """
    Complete OAuth flow.
    Body: { code, state } — provider is looked up from the OAuthState table.
    Called by the frontend OAuthCallbackPage after the provider redirects.
    """
    body = await request.json()
    code = body.get("code", "")
    state = body.get("state", "")

    if not code or not state:
        raise HTTPException(400, "Missing code or state")

    tenant_id = _tid(request)
    user_id = _uid(request)

    # Look up OAuthState by state to get provider
    q = select(OAuthState).where(
        OAuthState.state == state,
        OAuthState.tenant_id == tenant_id,
        OAuthState.user_id == user_id,
    )
    state_row = (await db.execute(q)).scalar_one_or_none()
    if not state_row:
        raise HTTPException(400, "Invalid or expired OAuth state")

    provider = state_row.provider

    # Exchange code for tokens (provider-specific)
    token_data = await _exchange_code(provider, code)

    # Upsert integration
    q2 = select(Integration).where(
        Integration.tenant_id == tenant_id,
        Integration.user_id == user_id,
        Integration.provider == provider,
    )
    existing = (await db.execute(q2)).scalar_one_or_none()

    if existing:
        existing.status = "active"
        existing.config = token_data
        existing.metadata_ = {
            **(existing.metadata_ or {}),
            "connected_at": datetime.now(timezone.utc).isoformat(),
        }
        existing.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(existing)
        result = existing
    else:
        integration = Integration(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            provider_display=_provider_display_name(provider),
            status="active",
            config=token_data,
            metadata_={"connected_at": datetime.now(timezone.utc).isoformat()},
        )
        db.add(integration)
        await db.flush()
        await db.refresh(integration)
        result = integration

    # Clean up OAuth state
    await db.delete(state_row)

    return IntegrationResponse.model_validate(result)


# ─── Helpers ───────────────────────────────────────────────────


OAUTH_URLS = {
    "google_calendar": "https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly+https://www.googleapis.com/auth/calendar.events.readonly&access_type=offline&state={state}",
    "outlook_calendar": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=Calendars.Read+offline_access&state={state}",
    "gmail": "https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=https://www.googleapis.com/auth/gmail.readonly+https://www.googleapis.com/auth/gmail.modify&access_type=offline&state={state}",
    "outlook_mail": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=Mail.Read+offline_access&state={state}",
    "slack": "https://slack.com/oauth/v2/authorize?client_id={client_id}&redirect_uri={redirect}&scope=channels:read,chat:write&state={state}",
    "zoom": "https://zoom.us/oauth/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=meeting:read&state={state}",
    "whatsapp": "https://www.facebook.com/v21.0/dialog/oauth?client_id={client_id}&redirect_uri={redirect}&scope=whatsapp_business_messaging&state={state}",
    "teams": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=OnlineMeetings.Read+Chat.Read+offline_access&state={state}",
    "google_drive": "https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=https://www.googleapis.com/auth/drive.readonly&access_type=offline&state={state}",
    "dropbox": "https://www.dropbox.com/oauth2/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&token_access_type=offline&state={state}",
    "onedrive": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=Flles.Read+offline_access&state={state}",
    "linkedin": "https://www.linkedin.com/oauth/v2/authorization?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=openid+profile+email&state={state}",
    "facebook": "https://www.facebook.com/v21.0/dialog/oauth?client_id={client_id}&redirect_uri={redirect}&scope=pages_manage_leads,pages_read_engagement&state={state}",
    "zapier": "",  # webhook-based, no OAuth
    "make": "",    # webhook-based, no OAuth
    "notion": "https://api.notion.com/v1/oauth/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&owner=user&state={state}",
    "stripe": "https://connect.stripe.com/oauth/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=read_write&state={state}",
    "quickbooks": "https://appcenter.intuit.com/connect/oauth2?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=com.intuit.quickbooks.accounting+openid+profile+email&state={state}",
    "mailchimp": "https://login.mailchimp.com/oauth2/authorize?client_id={client_id}&redirect_uri={redirect}&response_type=code&state={state}",
    "hubspot": "https://app.hubspot.com/oauth/authorize?client_id={client_id}&redirect_uri={redirect}&scope=crm.objects.contacts.read%20crm.objects.deals.read&state={state}",
}

PROVIDER_DISPLAY = {
    "google_calendar": "Google Calendar",
    "outlook_calendar": "Outlook Calendar",
    "gmail": "Gmail",
    "outlook_mail": "Outlook Mail",
    "slack": "Slack",
    "zoom": "Zoom",
    "whatsapp": "WhatsApp Business",
    "teams": "Microsoft Teams",
    "google_drive": "Google Drive",
    "dropbox": "Dropbox",
    "onedrive": "OneDrive",
    "linkedin": "LinkedIn",
    "facebook": "Facebook Pages",
    "zapier": "Zapier",
    "make": "Make",
    "notion": "Notion",
    "stripe": "Stripe",
    "quickbooks": "QuickBooks",
    "mailchimp": "Mailchimp",
    "hubspot": "HubSpot",
}


def _build_oauth_url(provider: str, state: str, frontend_origin: str = "") -> str:
    """Build OAuth authorization URL for a given provider.
    The redirect_uri points to the frontend OAuth callback page so the
    provider sends users back to our UI, not directly to the backend.
    """
    from app.config import settings

    template = OAUTH_URLS.get(provider, "")
    if not template:
        return ""

    callback_url = f"{frontend_origin or 'http://localhost:5173'}/marketplace/oauth/callback"
    client_id = settings.integration_client_ids.get(provider, "PLACEHOLDER")

    return template.format(
        client_id=client_id,
        redirect=callback_url,
        state=state,
    )


def _provider_display_name(provider: str) -> str:
    return PROVIDER_DISPLAY.get(provider, provider.replace("_", " ").title())


async def _exchange_code(provider: str, code: str) -> dict:
    """
    Exchange authorization code for tokens.
    In Phase 1, returns placeholder.
    Returns dict with at least {access_token, refresh_token, expires_at}.
    """
    # Phase 1: placeholder — real HTTP exchange in Phase 2
    return {
        "access_token": f"placeholder_{provider}_{code[:16]}",
        "refresh_token": f"refresh_{provider}_{uuid.uuid4().hex[:16]}",
        "expires_at": datetime.now(timezone.utc).timestamp() + 3600,
        "scope": "",
    }
