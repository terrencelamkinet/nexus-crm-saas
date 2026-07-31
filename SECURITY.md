# NEXUS CRM — Security Documentation

## Overview

NEXUS CRM v2 is designed with SOC 2 compliance as a foundational principle.
This document outlines the security controls implemented across the platform.

## Authentication & Authorization

| Control | Implementation |
|---------|---------------|
| JWT Algorithm | RS256 (asymmetric RSA key pair) |
| Key Storage | Private key: `keys/private.pem` (file permission 600) |
| Public key | `keys/public.pem` (used for token verification) |
| Token lifetime | Configurable via `JWT_EXPIRY_HOURS` (default: 24h) |
| Multi-tenant | Tenant ID embedded in JWT, enforced by RLS + app-level filter |

## API Security

- All endpoints except webhooks require Bearer JWT token
- Webhook endpoints protected by HMAC-SHA256 signature verification
- CORS restricted to platform domain
- Input validation on all POST/PUT/PATCH endpoints

## Data Protection

- **In transit**: TLS 1.3 via Cloudflare Tunnel
- **At rest**: PostgreSQL with schema-level tenant isolation
- **PII**: Phone numbers, emails marked for future encryption
- **Secrets**: Environment variables only (.env in .gitignore)

## WhatsApp Security

See `ARCHITECTURE.md` → ADR-001 for full details.

| Control | Status |
|---------|--------|
| Webhook signature verification | ✅ HMAC-SHA256 |
| Phone binding | ✅ OTP (6-digit, 5min expiry) |
| Message storage | ❌ Not stored (by design) |
| Rate limiting | ⬜ Pending |
| Permanent access token | ⬜ Upgrade needed |

## Compliance Roadmap

### Phase 1 (Current) — Foundation
- [x] JWT RS256 authentication
- [x] PostgreSQL RLS (38 policies)
- [x] Webhook signature verification
- [x] OTP-based phone binding
- [x] TLS encryption (Cloudflare)

### Phase 2 (Next Sprint) — Hardening
- [ ] OTP rate limiting (3 req/min per phone)
- [ ] Audit trail for all auth events
- [ ] WhatsApp mappings RLS (with webhook bypass)
- [ ] Access token rotation procedure

### Phase 3 — SOC 2 Ready
- [ ] Encryption at rest (pgcrypto for PII fields)
- [ ] Formal incident response plan
- [ ] Vulnerability scanning (dependency + code)
- [ ] Penetration testing
- [ ] Vendor security assessment (Meta)

## Contact

Security issues: report to Terrence Lam directly
