from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class LoginRequest(BaseModel):
    email: str
    password: str
    device_token: Optional[str] = None

class MFAVerifyRequest(BaseModel):
    email: str
    otp_code: str
    trust_device: bool = False

class MFASendRequest(BaseModel):
    email: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str = ""
    mfa_required: bool = False
    email: str = ""
    device_token: Optional[str] = None

class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""

class RefreshRequest(BaseModel):
    refresh_token: str

class UserOut(BaseModel):
    id: UUID
    email: str
    display_name: str
    email_verified: bool
    mfa_enabled: bool
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}
