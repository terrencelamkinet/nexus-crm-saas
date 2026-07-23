from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db import get_db
from app.models import User, Session, Tenant, TenantMember
from app.schemas import LoginRequest, RegisterRequest, MFAVerifyRequest, TokenResponse, RefreshRequest, UserOut
from app.services.auth_service import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, generate_otp, generate_session_token
)
from app.services.email_service import send_otp_email
from app.services.redis_service import store_otp, verify_otp, store_refresh_blacklist, check_device_trust, store_device_trust, get_redis
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(req: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    # Create personal tenant
    safe_name = req.display_name.strip() or req.email.split("@")[0]
    subdomain = f"p-{uuid.uuid4().hex[:12]}"
    tenant = Tenant(name=safe_name, subdomain=subdomain)
    db.add(tenant)
    await db.flush()

    # Create user
    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        display_name=req.display_name or safe_name,
        email_verified=True,  # Skip email verification for now
        mfa_enabled=False,    # MFA optional
        role="member",
    )
    db.add(user)
    await db.flush()

    # Link to tenant
    tm = TenantMember(tenant_id=tenant.id, user_id=user.id, role="owner")
    db.add(tm)
    await db.flush()

    # Issue tokens
    tenant_id = str(tenant.id)
    access_token = create_access_token(str(user.id), user.email, user.role, tenant_id)
    refresh_token_str, expires_at = create_refresh_token(str(user.id))

    db_session = Session(
        user_id=user.id,
        refresh_token=refresh_token_str,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=request.client.host if request.client else "unknown",
        expires_at=expires_at,
    )
    db.add(db_session)
    await db.flush()

    return TokenResponse(
        access_token=access_token,
        mfa_required=False,
        email=user.email,
        refresh_token=refresh_token_str,
    )

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Find user
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check device trust — skip MFA if device token is valid
    if req.device_token:
        trusted = await check_device_trust(str(user.id), req.device_token)
        if trusted:
            # Resolve tenant
            tm = await db.execute(
                select(TenantMember).where(TenantMember.user_id == user.id).limit(1)
            )
            tm_row = tm.scalar_one_or_none()
            tenant_id = str(tm_row.tenant_id) if tm_row else ""

            access_token = create_access_token(str(user.id), user.email, user.role, tenant_id)
            refresh_token_str, expires_at = create_refresh_token(str(user.id))
            db_session = Session(
                user_id=user.id, refresh_token=refresh_token_str,
                user_agent=request.headers.get("user-agent", ""),
                ip_address=request.client.host if request.client else "unknown",
                expires_at=expires_at
            )
            db.add(db_session)
            await db.flush()
            return TokenResponse(
                access_token=access_token, mfa_required=False,
                email=user.email, device_token=req.device_token,
                refresh_token=refresh_token_str,
            )

    # Generate and send OTP
    otp = generate_otp()
    await store_otp(req.email, otp)
    await send_otp_email(req.email, otp)

    return TokenResponse(
        access_token="",
        mfa_required=True,
        email=req.email
    )

@router.post("/send-mfa", response_model=dict)
async def send_mfa(req: dict, db: AsyncSession = Depends(get_db)):
    email = req.get("email", "")
    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    otp = generate_otp()
    await store_otp(email, otp)
    await send_otp_email(email, otp)
    return {"message": "MFA code sent", "email": email}

@router.post("/verify-mfa", response_model=TokenResponse)
async def verify_mfa(req: MFAVerifyRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Verify OTP
    valid = await verify_otp(req.email, req.otp_code)
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid or expired OTP code")

    # Get user
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.email_verified:
        user.email_verified = True
        await db.flush()

    # Create tokens with tenant context
    tm = await db.execute(
        select(TenantMember).where(TenantMember.user_id == user.id).limit(1)
    )
    tm_row = tm.scalar_one_or_none()
    tenant_id = str(tm_row.tenant_id) if tm_row else ""

    access_token = create_access_token(str(user.id), user.email, user.role, tenant_id)
    refresh_token_str, expires_at = create_refresh_token(str(user.id))

    # Store session
    db_session = Session(
        user_id=user.id,
        refresh_token=refresh_token_str,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=request.client.host if request.client else "unknown",
        expires_at=expires_at
    )
    db.add(db_session)
    await db.flush()

    # Generate device trust token if requested
    device_token = None
    if req.trust_device:
        from app.services.auth_service import generate_device_token
        device_token = generate_device_token()
        await store_device_trust(str(user.id), device_token, ttl_days=30)

    return TokenResponse(
        access_token=access_token,
        mfa_required=False,
        email=user.email,
        device_token=device_token,
        refresh_token=refresh_token_str,
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    # Check blacklist
    r = await get_redis()
    blacklisted = await r.get(f"refresh_blacklist:{payload.get('jti')}")
    if blacklisted:
        raise HTTPException(status_code=401, detail="Token revoked")

    # Find session
    result = await db.execute(
        select(Session).where(
            Session.refresh_token == req.refresh_token,
            Session.revoked == False
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")

    # Get user
    user = await db.get(User, session.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Revoke old session
    session.revoked = True
    await store_refresh_blacklist(payload.get("jti"), datetime.now(timezone.utc))

    # Resolve tenant context
    tm = await db.execute(
        select(TenantMember).where(TenantMember.user_id == user.id).limit(1)
    )
    tm_row = tm.scalar_one_or_none()
    tenant_id = str(tm_row.tenant_id) if tm_row else ""

    # Issue new tokens WITH tenant_id
    new_access = create_access_token(str(user.id), user.email, user.role, tenant_id)
    new_refresh, new_expires = create_refresh_token(str(user.id))

    new_session = Session(
        user_id=user.id,
        refresh_token=new_refresh,
        expires_at=new_expires
    )
    db.add(new_session)
    await db.flush()

    return TokenResponse(access_token=new_access, mfa_required=False, email=user.email)

@router.post("/logout")
async def logout(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if payload and payload.get("jti"):
        expires = datetime.fromtimestamp(payload.get("exp", 0), tz=timezone.utc)
        await store_refresh_blacklist(payload["jti"], expires)

    result = await db.execute(
        select(Session).where(Session.refresh_token == req.refresh_token)
    )
    session = result.scalar_one_or_none()
    if session:
        session.revoked = True
        await db.flush()

    return {"message": "Logged out"}

@router.get("/me", response_model=UserOut)
async def get_me(request: Request, db: AsyncSession = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth.split(" ")[1]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.get(User, payload.get("sub"))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
