/**
 * Integration API — per-user, per-tenant.
 * Every call carries the JWT via the apiClient wrapper.
 */
import { apiClient } from './api';

export interface IntegrationRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  provider_display: string;
  status: 'disconnected' | 'connecting' | 'active' | 'error';
  config: Record<string, unknown>;
  metadata_: Record<string, unknown>;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OAuthStartResponse {
  state: string;
  oauth_url: string;
  provider: string;
}

export async function fetchIntegrations(): Promise<IntegrationRecord[]> {
  return apiClient.get('/api/v1/integrations');
}

export async function getIntegration(id: string): Promise<IntegrationRecord> {
  return apiClient.get(`/api/v1/integrations/${id}`);
}

export async function startOAuth(provider: string): Promise<OAuthStartResponse> {
  return apiClient.post('/api/v1/integrations/oauth/start', { provider, origin: window.location.origin });
}

export async function completeOAuth(code: string, state: string): Promise<IntegrationRecord> {
  return apiClient.post('/api/v1/integrations/oauth/callback', { code, state });
}

export async function disconnectIntegration(id: string): Promise<void> {
  return apiClient.delete(`/api/v1/integrations/${id}`);
}
