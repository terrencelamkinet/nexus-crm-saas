import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../lib/api';

// ─────────────────────────────────────────────────────────────
// AI Secretary Settings — backend-backed (ai_secretary_settings)
// with localStorage fallback for offline resilience.
//
//   - mount: GET /api/v1/ai-secretary/settings
//   - change: PATCH backend; on failure keep local value (queued)
//   - migration: if localStorage holds non-default values on first
//     successful load, upload once then clear localStorage
// ─────────────────────────────────────────────────────────────

export interface SecretaryModule {
  id: string;
  icon: string;
  nameKey: string;
  descKey: string;
  default: boolean;
}

export const MODULES: SecretaryModule[] = [
  { id: 'weather', icon: '🌤️', nameKey: 'settings.aiApps.modWeather', descKey: 'settings.aiApps.modWeatherDesc', default: true },
  { id: 'today_tasks', icon: '✅', nameKey: 'settings.aiApps.modTasks', descKey: 'settings.aiApps.modTasksDesc', default: true },
  { id: 'meetings', icon: '📅', nameKey: 'settings.aiApps.modMeetings', descKey: 'settings.aiApps.modMeetingsDesc', default: true },
  { id: 'project_status', icon: '📊', nameKey: 'settings.aiApps.modProjects', descKey: 'settings.aiApps.modProjectsDesc', default: true },
  { id: 'hot_leads', icon: '🔥', nameKey: 'settings.aiApps.modHotLeads', descKey: 'settings.aiApps.modHotLeadsDesc', default: true },
  { id: 'stale_deals', icon: '⚠️', nameKey: 'settings.aiApps.modStaleDeals', descKey: 'settings.aiApps.modStaleDealsDesc', default: true },
  { id: 'overdue_followup', icon: '⏰', nameKey: 'settings.aiApps.modOverdue', descKey: 'settings.aiApps.modOverdueDesc', default: false },
  { id: 'unread_messages', icon: '💬', nameKey: 'settings.aiApps.modUnread', descKey: 'settings.aiApps.modUnreadDesc', default: false },
  { id: 'birthday_reminders', icon: '🎂', nameKey: 'settings.aiApps.modBirthday', descKey: 'settings.aiApps.modBirthdayDesc', default: false },
  { id: 'quote_tracking', icon: '💰', nameKey: 'settings.aiApps.modQuotes', descKey: 'settings.aiApps.modQuotesDesc', default: false },
  { id: 'invoice_reminders', icon: '🧾', nameKey: 'settings.aiApps.modInvoices', descKey: 'settings.aiApps.modInvoicesDesc', default: false },
  { id: 'team_updates', icon: '👥', nameKey: 'settings.aiApps.modTeam', descKey: 'settings.aiApps.modTeamDesc', default: false },
  { id: 'calendar_conflicts', icon: '🚨', nameKey: 'settings.aiApps.modConflicts', descKey: 'settings.aiApps.modConflictsDesc', default: false },
  { id: 'news_industry', icon: '📰', nameKey: 'settings.aiApps.modNews', descKey: 'settings.aiApps.modNewsDesc', default: false },
  { id: 'traffic_commute', icon: '🚗', nameKey: 'settings.aiApps.modTraffic', descKey: 'settings.aiApps.modTrafficDesc', default: false },
  { id: 'email_draft_review', icon: '✉️', nameKey: 'settings.aiApps.modDrafts', descKey: 'settings.aiApps.modDraftsDesc', default: false },
  { id: 'sales_kpi', icon: '🎯', nameKey: 'settings.aiApps.modKpi', descKey: 'settings.aiApps.modKpiDesc', default: false },
  { id: 'customer_sentiment', icon: '🙂', nameKey: 'settings.aiApps.modSentiment', descKey: 'settings.aiApps.modSentimentDesc', default: false },
  { id: 'expense_reminders', icon: '🧮', nameKey: 'settings.aiApps.modExpenses', descKey: 'settings.aiApps.modExpensesDesc', default: false },
  { id: 'personal_reminders', icon: '📌', nameKey: 'settings.aiApps.modPersonal', descKey: 'settings.aiApps.modPersonalDesc', default: false },
];

export const DEFAULT_MODULES = MODULES.filter(m => m.default).map(m => m.id);

export type ToneId = 'professional' | 'friendly' | 'direct' | 'encouraging' | 'formal';
export type LangPref = 'zh-HK' | 'zh-TW' | 'en';
export type DetailLevel = 1 | 2 | 3;
export type ChannelId = 'whatsapp' | 'telegram' | 'email' | 'sms';

export interface SecretarySettings {
  modules: string[];
  workdays: string[];
  weekend_mute: boolean;
  strict_silence: boolean;
  tone: ToneId;
  instructions: string;
  lang_pref: LangPref;
  detail_level: DetailLevel;
  channels: Record<ChannelId, { connected: boolean; enabled: boolean }>;
  work_start: string;
  work_end: string;
  greeting_slots: { key: string; emoji: string; start: string }[];
  connected_modules?: string[];
}

/** Modules currently greyed out (backend has no data source yet). */
export const CONNECTED_FALLBACK = ['today_tasks', 'meetings'];

export const DEFAULT_SETTINGS: SecretarySettings = {
  modules: DEFAULT_MODULES,
  workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekend_mute: true,
  strict_silence: true,
  tone: 'professional',
  instructions: '',
  lang_pref: 'zh-HK',
  detail_level: 2,
  channels: {
    whatsapp: { connected: false, enabled: false },
    telegram: { connected: false, enabled: false },
    email: { connected: false, enabled: false },
    sms: { connected: false, enabled: false },
  },
  work_start: '09:00',
  work_end: '18:00',
  greeting_slots: [
    { key: 'morning', emoji: '🌅', start: '05:00' },
    { key: 'afternoon', emoji: '☀️', start: '12:00' },
    { key: 'evening', emoji: '🌆', start: '18:00' },
    { key: 'lateNight', emoji: '🌙', start: '23:00' },
  ],
};

const LOCAL_KEY = 'nexus-secretary-settings';
const API = '/api/v1/ai-secretary/settings';

// ── localStorage (offline cache) ──
function readLocal(): SecretarySettings | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as SecretarySettings;
  } catch { return null; }
}

function writeLocal(s: SecretarySettings) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function clearLocal() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
}

/** True if local copy differs from defaults (i.e. worth migrating). */
function isNonDefault(s: SecretarySettings): boolean {
  return (
    s.tone !== DEFAULT_SETTINGS.tone ||
    s.detail_level !== DEFAULT_SETTINGS.detail_level ||
    s.work_start !== DEFAULT_SETTINGS.work_start ||
    s.work_end !== DEFAULT_SETTINGS.work_end ||
    s.instructions !== '' ||
    JSON.stringify(s.modules) !== JSON.stringify(DEFAULT_SETTINGS.modules) ||
    JSON.stringify(s.workdays) !== JSON.stringify(DEFAULT_SETTINGS.workdays)
  );
}

async function fetchSettings(): Promise<SecretarySettings> {
  return apiClient.get<SecretarySettings>(API);
}

async function patchSettings(patch: Partial<SecretarySettings>): Promise<SecretarySettings> {
  return apiClient.patch<SecretarySettings>(API, patch);
}

// ── Hook ──
export function useSecretarySettings() {
  const [settings, setSettings] = useState<SecretarySettings>(() => readLocal() || DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);   // backend sync done
  const [syncing, setSyncing] = useState(false); // PATCH in flight

  // Initial load: GET backend → merge → migrate localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readLocal();
      try {
        const remote = await fetchSettings();
        if (cancelled) return;
        setSettings(remote);
        writeLocal(remote);
        // one-time migration of pre-backend local values
        if (local && isNonDefault(local)) {
          try {
            const merged = await patchSettings(local);
            setSettings(merged);
            writeLocal(merged);
          } catch { /* keep remote */ }
        }
        clearLocal();
      } catch {
        if (cancelled) return;
        // backend unavailable — keep local copy
        if (local) setSettings(local);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback(async (patch: Partial<SecretarySettings>) => {
    // optimistic local update
    setSettings(prev => {
      const next = { ...prev, ...patch };
      writeLocal(next);
      return next;
    });
    setSyncing(true);
    try {
      const remote = await patchSettings(patch);
      setSettings(remote);
      writeLocal(remote);
    } catch {
      // offline — local value stays; will sync on next successful load
    } finally {
      setSyncing(false);
    }
  }, []);

  return { settings, loaded, syncing, update };
}

// ── Pure helpers (used by briefing gating) ──
/** True when `now` falls inside [start, end). Handles overnight windows. */
export function isInWorkingHours(now: Date, s: SecretarySettings): boolean {
  const toM = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const mins = now.getHours() * 60 + now.getMinutes();
  const st = toM(s.work_start);
  const en = toM(s.work_end);
  if (st === en) return false;
  return st < en ? mins >= st && mins < en : mins >= st || mins < en;
}

/** True when `now` (HKT) is inside the configured working days. */
export function isWorkingDay(now: Date, s: SecretarySettings): boolean {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return s.workdays.includes(days[now.getDay()]);
}
