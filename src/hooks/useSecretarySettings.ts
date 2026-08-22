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

export interface ModuleOptionChoice {
  value: string;
  labelKey: string;   // i18n key
  icon?: string;
}

export interface ModuleOptionDef {
  key: string;                          // e.g. 'region', 'scope', 'time_of_day'
  type: 'single_select' | 'multi_select';
  labelKey: string;
  choices: ModuleOptionChoice[];        // 2–10 個
  default: string | string[];
}

export interface SecretaryModule {
  id: string;
  icon: string;
  nameKey: string;
  descKey: string;
  default: boolean;
  options?: ModuleOptionDef[];          // 深層選項定義（spec: BRIEFING-MODULES-DEEP-OPTIONS.md）
}

// ── 20 個現有 module + bible_reading（21 個）──
// 每個 module 2–10 個深層選項，default 等同舊行為（向後兼容）
export const MODULES: SecretaryModule[] = [
  {
    id: 'weather', icon: '🌤️', nameKey: 'settings.aiApps.modWeather', descKey: 'settings.aiApps.modWeatherDesc', default: true,
    options: [
      {
        key: 'region', type: 'multi_select', labelKey: 'settings.aiApps.weatherRegion',
        choices: [
          { value: 'hk_island', labelKey: 'settings.aiApps.weatherRegionHkIsland' },
          { value: 'kowloon', labelKey: 'settings.aiApps.weatherRegionKowloon' },
          { value: 'nt_east', labelKey: 'settings.aiApps.weatherRegionNtEast' },
          { value: 'nt_west', labelKey: 'settings.aiApps.weatherRegionNtWest' },
          { value: 'all_hk', labelKey: 'settings.aiApps.weatherRegionAllHk' },
        ],
        default: ['all_hk'],
      },
      {
        key: 'unit', type: 'single_select', labelKey: 'settings.aiApps.weatherUnit',
        choices: [
          { value: 'celsius', labelKey: 'settings.aiApps.unitCelsius' },
          { value: 'fahrenheit', labelKey: 'settings.aiApps.unitFahrenheit' },
        ],
        default: 'celsius',
      },
    ],
  },
  {
    id: 'today_tasks', icon: '✅', nameKey: 'settings.aiApps.modTasks', descKey: 'settings.aiApps.modTasksDesc', default: true,
    options: [
      {
        key: 'scope', type: 'single_select', labelKey: 'settings.aiApps.taskScope',
        choices: [
          { value: 'personal', labelKey: 'settings.aiApps.scopePersonal', icon: '🏠' },
          { value: 'work', labelKey: 'settings.aiApps.scopeWork', icon: '💼' },
          { value: 'both', labelKey: 'settings.aiApps.scopeBoth', icon: '🔄' },
        ],
        default: 'both',
      },
      {
        key: 'sort', type: 'single_select', labelKey: 'settings.aiApps.taskSort',
        choices: [
          { value: 'priority', labelKey: 'settings.aiApps.sortPriority' },
          { value: 'deadline', labelKey: 'settings.aiApps.sortDeadline' },
          { value: 'created_at', labelKey: 'settings.aiApps.sortCreatedAt' },
        ],
        default: 'priority',
      },
    ],
  },
  {
    id: 'meetings', icon: '📅', nameKey: 'settings.aiApps.modMeetings', descKey: 'settings.aiApps.modMeetingsDesc', default: true,
    options: [
      {
        key: 'range', type: 'single_select', labelKey: 'settings.aiApps.meetingRange',
        choices: [
          { value: 'today', labelKey: 'settings.aiApps.meetingRangeToday' },
          { value: 'today_tomorrow', labelKey: 'settings.aiApps.meetingRangeTodayTomorrow' },
          { value: 'week', labelKey: 'settings.aiApps.meetingRangeWeek' },
        ],
        default: 'today_tomorrow',
      },
      {
        key: 'type', type: 'single_select', labelKey: 'settings.aiApps.meetingType',
        choices: [
          { value: 'customer', labelKey: 'settings.aiApps.meetingTypeCustomer' },
          { value: 'internal', labelKey: 'settings.aiApps.meetingTypeInternal' },
          { value: 'all', labelKey: 'settings.aiApps.meetingTypeAll' },
        ],
        default: 'all',
      },
    ],
  },
  {
    id: 'project_status', icon: '📊', nameKey: 'settings.aiApps.modProjects', descKey: 'settings.aiApps.modProjectsDesc', default: true,
    options: [
      {
        key: 'ownership', type: 'single_select', labelKey: 'settings.aiApps.projectOwnership',
        choices: [
          { value: 'mine', labelKey: 'settings.aiApps.projectOwnershipMine' },
          { value: 'all', labelKey: 'settings.aiApps.projectOwnershipAll' },
        ],
        default: 'mine',
      },
      {
        key: 'count', type: 'single_select', labelKey: 'settings.aiApps.projectCount',
        choices: [
          { value: '3', labelKey: 'settings.aiApps.count3' },
          { value: '5', labelKey: 'settings.aiApps.count5' },
          { value: '8', labelKey: 'settings.aiApps.count8' },
          { value: '10', labelKey: 'settings.aiApps.count10' },
        ],
        default: '8',
      },
    ],
  },
  {
    id: 'hot_leads', icon: '🔥', nameKey: 'settings.aiApps.modHotLeads', descKey: 'settings.aiApps.modHotLeadsDesc', default: true,
    options: [
      {
        key: 'threshold', type: 'single_select', labelKey: 'settings.aiApps.leadThreshold',
        choices: [
          { value: '50', labelKey: 'settings.aiApps.threshold50' },
          { value: '70', labelKey: 'settings.aiApps.threshold70' },
          { value: '90', labelKey: 'settings.aiApps.threshold90' },
        ],
        default: '70',
      },
      {
        key: 'sort', type: 'single_select', labelKey: 'settings.aiApps.leadSort',
        choices: [
          { value: 'amount', labelKey: 'settings.aiApps.sortAmount' },
          { value: 'probability', labelKey: 'settings.aiApps.sortProbability' },
          { value: 'updated', labelKey: 'settings.aiApps.sortUpdated' },
        ],
        default: 'amount',
      },
    ],
  },
  {
    id: 'stale_deals', icon: '⚠️', nameKey: 'settings.aiApps.modStaleDeals', descKey: 'settings.aiApps.modStaleDealsDesc', default: true,
    options: [
      {
        key: 'days', type: 'single_select', labelKey: 'settings.aiApps.staleDays',
        choices: [
          { value: '7', labelKey: 'settings.aiApps.days7' },
          { value: '14', labelKey: 'settings.aiApps.days14' },
          { value: '30', labelKey: 'settings.aiApps.days30' },
        ],
        default: '14',
      },
      {
        key: 'sort', type: 'single_select', labelKey: 'settings.aiApps.staleSort',
        choices: [
          { value: 'amount', labelKey: 'settings.aiApps.sortAmount' },
          { value: 'staleness', labelKey: 'settings.aiApps.sortStaleness' },
        ],
        default: 'staleness',
      },
    ],
  },
  {
    id: 'overdue_followup', icon: '⏰', nameKey: 'settings.aiApps.modOverdue', descKey: 'settings.aiApps.modOverdueDesc', default: false,
    options: [
      {
        key: 'days', type: 'single_select', labelKey: 'settings.aiApps.overdueDays',
        choices: [
          { value: '3', labelKey: 'settings.aiApps.days3' },
          { value: '7', labelKey: 'settings.aiApps.days7' },
          { value: '14', labelKey: 'settings.aiApps.days14' },
        ],
        default: '7',
      },
      {
        key: 'contact_type', type: 'single_select', labelKey: 'settings.aiApps.contactType',
        choices: [
          { value: 'all', labelKey: 'settings.aiApps.contactTypeAll' },
          { value: 'vip', labelKey: 'settings.aiApps.contactTypeVip' },
          { value: 'lead', labelKey: 'settings.aiApps.contactTypeLead' },
        ],
        default: 'all',
      },
    ],
  },
  {
    id: 'unread_messages', icon: '💬', nameKey: 'settings.aiApps.modUnread', descKey: 'settings.aiApps.modUnreadDesc', default: false,
    options: [
      {
        key: 'sources', type: 'multi_select', labelKey: 'settings.aiApps.unreadSources',
        choices: [
          { value: 'gmail', labelKey: 'settings.aiApps.sourceGmail' },
          { value: 'outlook', labelKey: 'settings.aiApps.sourceOutlook' },
        ],
        default: ['gmail', 'outlook'],
      },
      {
        key: 'count', type: 'single_select', labelKey: 'settings.aiApps.unreadCount',
        choices: [
          { value: '3', labelKey: 'settings.aiApps.count3' },
          { value: '5', labelKey: 'settings.aiApps.count5' },
          { value: '8', labelKey: 'settings.aiApps.count8' },
        ],
        default: '8',
      },
    ],
  },
  {
    id: 'birthday_reminders', icon: '🎂', nameKey: 'settings.aiApps.modBirthday', descKey: 'settings.aiApps.modBirthdayDesc', default: false,
    options: [
      {
        key: 'range', type: 'single_select', labelKey: 'settings.aiApps.birthdayRange',
        choices: [
          { value: 'today', labelKey: 'settings.aiApps.birthdayRangeToday' },
          { value: 'week', labelKey: 'settings.aiApps.birthdayRangeWeek' },
          { value: 'month', labelKey: 'settings.aiApps.birthdayRangeMonth' },
        ],
        default: 'week',
      },
      {
        key: 'type', type: 'single_select', labelKey: 'settings.aiApps.birthdayType',
        choices: [
          { value: 'all', labelKey: 'settings.aiApps.contactTypeAll' },
          { value: 'customer', labelKey: 'settings.aiApps.birthdayTypeCustomer' },
          { value: 'colleague', labelKey: 'settings.aiApps.birthdayTypeColleague' },
        ],
        default: 'all',
      },
    ],
  },
  {
    id: 'quote_tracking', icon: '💰', nameKey: 'settings.aiApps.modQuotes', descKey: 'settings.aiApps.modQuotesDesc', default: false,
    options: [
      {
        key: 'statuses', type: 'multi_select', labelKey: 'settings.aiApps.quoteStatuses',
        choices: [
          { value: 'draft', labelKey: 'settings.aiApps.quoteStatusDraft' },
          { value: 'sent', labelKey: 'settings.aiApps.quoteStatusSent' },
          { value: 'expiring', labelKey: 'settings.aiApps.quoteStatusExpiring' },
        ],
        default: ['draft', 'sent', 'expiring'],
      },
      {
        key: 'sort', type: 'single_select', labelKey: 'settings.aiApps.quoteSort',
        choices: [
          { value: 'valid_until', labelKey: 'settings.aiApps.sortValidUntil' },
          { value: 'amount', labelKey: 'settings.aiApps.sortAmount' },
        ],
        default: 'valid_until',
      },
    ],
  },
  {
    id: 'invoice_reminders', icon: '🧾', nameKey: 'settings.aiApps.modInvoices', descKey: 'settings.aiApps.modInvoicesDesc', default: false,
    options: [
      {
        key: 'statuses', type: 'multi_select', labelKey: 'settings.aiApps.invoiceStatuses',
        choices: [
          { value: 'pending', labelKey: 'settings.aiApps.invoiceStatusPending' },
          { value: 'sent', labelKey: 'settings.aiApps.invoiceStatusSent' },
          { value: 'overdue', labelKey: 'settings.aiApps.invoiceStatusOverdue' },
          { value: 'all', labelKey: 'settings.aiApps.quoteStatusAll' },
        ],
        default: ['pending', 'sent', 'overdue'],
      },
    ],
  },
  {
    id: 'team_updates', icon: '👥', nameKey: 'settings.aiApps.modTeam', descKey: 'settings.aiApps.modTeamDesc', default: false,
    options: [
      {
        key: 'scope', type: 'single_select', labelKey: 'settings.aiApps.teamScope',
        choices: [
          { value: 'my_teams', labelKey: 'settings.aiApps.teamScopeMyTeams' },
          { value: 'all_company', labelKey: 'settings.aiApps.teamScopeAllCompany' },
        ],
        default: 'my_teams',
      },
      {
        key: 'task_status', type: 'single_select', labelKey: 'settings.aiApps.teamTaskStatus',
        choices: [
          { value: 'in_progress', labelKey: 'settings.aiApps.taskStatusInProgress' },
          { value: 'pending', labelKey: 'settings.aiApps.taskStatusPending' },
          { value: 'all', labelKey: 'settings.aiApps.taskStatusAll' },
        ],
        default: 'all',
      },
    ],
  },
  {
    id: 'calendar_conflicts', icon: '🚨', nameKey: 'settings.aiApps.modConflicts', descKey: 'settings.aiApps.modConflictsDesc', default: false,
    options: [
      {
        key: 'range', type: 'single_select', labelKey: 'settings.aiApps.conflictRange',
        choices: [
          { value: 'today', labelKey: 'settings.aiApps.conflictRangeToday' },
          { value: 'today_tomorrow', labelKey: 'settings.aiApps.conflictRangeTodayTomorrow' },
        ],
        default: 'today',
      },
    ],
  },
  {
    id: 'news_industry', icon: '📰', nameKey: 'settings.aiApps.modNews', descKey: 'settings.aiApps.modNewsDesc', default: false,
    options: [
      {
        key: 'topics', type: 'multi_select', labelKey: 'settings.aiApps.newsTopics',
        choices: [
          { value: 'tech', labelKey: 'settings.aiApps.topicTech' },
          { value: 'finance', labelKey: 'settings.aiApps.topicFinance' },
          { value: 'logistics', labelKey: 'settings.aiApps.topicLogistics' },
          { value: 'retail', labelKey: 'settings.aiApps.topicRetail' },
          { value: 'all', labelKey: 'settings.aiApps.topicAll' },
        ],
        default: ['tech', 'finance', 'logistics', 'retail'],
      },
      {
        key: 'lang', type: 'single_select', labelKey: 'settings.aiApps.newsLang',
        choices: [
          { value: 'zh', labelKey: 'settings.aiApps.langZh' },
          { value: 'en', labelKey: 'settings.aiApps.langEn' },
          { value: 'both', labelKey: 'settings.aiApps.langBoth' },
        ],
        default: 'both',
      },
    ],
  },
  {
    id: 'traffic_commute', icon: '🚗', nameKey: 'settings.aiApps.modTraffic', descKey: 'settings.aiApps.modTrafficDesc', default: false,
    options: [
      {
        key: 'route', type: 'single_select', labelKey: 'settings.aiApps.trafficRoute',
        choices: [
          { value: 'home_to_office', labelKey: 'settings.aiApps.routeHomeToOffice' },
          { value: 'office_to_home', labelKey: 'settings.aiApps.routeOfficeToHome' },
          { value: 'custom', labelKey: 'settings.aiApps.routeCustom' },
        ],
        default: 'home_to_office',
      },
      {
        key: 'mode', type: 'single_select', labelKey: 'settings.aiApps.trafficMode',
        choices: [
          { value: 'driving', labelKey: 'settings.aiApps.modeDriving' },
          { value: 'public', labelKey: 'settings.aiApps.modePublic' },
        ],
        default: 'public',
      },
    ],
  },
  {
    id: 'email_draft_review', icon: '✉️', nameKey: 'settings.aiApps.modDrafts', descKey: 'settings.aiApps.modDraftsDesc', default: false,
    options: [
      {
        key: 'status', type: 'single_select', labelKey: 'settings.aiApps.draftStatus',
        choices: [
          { value: 'pending_review', labelKey: 'settings.aiApps.draftStatusPending' },
          { value: 'approved', labelKey: 'settings.aiApps.draftStatusApproved' },
          { value: 'all', labelKey: 'settings.aiApps.draftStatusAll' },
        ],
        default: 'pending_review',
      },
    ],
  },
  {
    id: 'sales_kpi', icon: '🎯', nameKey: 'settings.aiApps.modKpi', descKey: 'settings.aiApps.modKpiDesc', default: false,
    options: [
      {
        key: 'period', type: 'single_select', labelKey: 'settings.aiApps.kpiPeriod',
        choices: [
          { value: 'week', labelKey: 'settings.aiApps.kpiPeriodWeek' },
          { value: 'month', labelKey: 'settings.aiApps.kpiPeriodMonth' },
          { value: 'quarter', labelKey: 'settings.aiApps.kpiPeriodQuarter' },
        ],
        default: 'month',
      },
    ],
  },
  {
    id: 'customer_sentiment', icon: '🙂', nameKey: 'settings.aiApps.modSentiment', descKey: 'settings.aiApps.modSentimentDesc', default: false,
    options: [
      {
        key: 'days', type: 'single_select', labelKey: 'settings.aiApps.sentimentDays',
        choices: [
          { value: '7', labelKey: 'settings.aiApps.days7' },
          { value: '14', labelKey: 'settings.aiApps.days14' },
          { value: '30', labelKey: 'settings.aiApps.days30' },
        ],
        default: '30',
      },
      {
        key: 'show', type: 'single_select', labelKey: 'settings.aiApps.sentimentShow',
        choices: [
          { value: 'all', labelKey: 'settings.aiApps.sentimentShowAll' },
          { value: 'negative_only', labelKey: 'settings.aiApps.sentimentShowNegative' },
        ],
        default: 'all',
      },
    ],
  },
  {
    id: 'expense_reminders', icon: '🧮', nameKey: 'settings.aiApps.modExpenses', descKey: 'settings.aiApps.modExpensesDesc', default: false,
    options: [
      {
        key: 'status', type: 'single_select', labelKey: 'settings.aiApps.expenseStatus',
        choices: [
          { value: 'pending', labelKey: 'settings.aiApps.expenseStatusPending' },
          { value: 'approved', labelKey: 'settings.aiApps.expenseStatusApproved' },
          { value: 'all', labelKey: 'settings.aiApps.expenseStatusAll' },
        ],
        default: 'pending',
      },
    ],
  },
  {
    id: 'personal_reminders', icon: '📌', nameKey: 'settings.aiApps.modPersonal', descKey: 'settings.aiApps.modPersonalDesc', default: false,
    options: [
      {
        key: 'range', type: 'single_select', labelKey: 'settings.aiApps.personalRange',
        choices: [
          { value: '1h', labelKey: 'settings.aiApps.personalRange1h' },
          { value: 'today', labelKey: 'settings.aiApps.personalRangeToday' },
          { value: 'week', labelKey: 'settings.aiApps.personalRangeWeek' },
        ],
        default: '1h',
      },
    ],
  },
  {
    id: 'bible_reading', icon: '📖', nameKey: 'settings.aiApps.modBible', descKey: 'settings.aiApps.modBibleDesc', default: false,
    options: [
      {
        key: 'book_selection', type: 'single_select', labelKey: 'settings.aiApps.bibleBooks',
        choices: [
          { value: 'ot_full', labelKey: 'settings.aiApps.bibleOtFull' },
          { value: 'nt_full', labelKey: 'settings.aiApps.bibleNtFull' },
          { value: 'ot_nt_mixed', labelKey: 'settings.aiApps.bibleOtNtMixed' },
          { value: 'psalms_proverbs', labelKey: 'settings.aiApps.biblePsalmsProverbs' },
          { value: 'gospels', labelKey: 'settings.aiApps.bibleGospels' },
          { value: 'pentateuch', labelKey: 'settings.aiApps.biblePentateuch' },
          { value: 'pauline_epistles', labelKey: 'settings.aiApps.biblePauline' },
          { value: 'custom', labelKey: 'settings.aiApps.bibleCustom' },
        ],
        default: 'ot_nt_mixed',
      },
      {
        key: 'plan', type: 'single_select', labelKey: 'settings.aiApps.biblePlan',
        choices: [
          { value: 'one_year', labelKey: 'settings.aiApps.biblePlanOneYear' },
          { value: 'ninety_days', labelKey: 'settings.aiApps.biblePlanNinetyDays' },
          { value: 'thirty_days_topical', labelKey: 'settings.aiApps.biblePlanThirtyDays' },
          { value: 'chronological', labelKey: 'settings.aiApps.biblePlanChronological' },
          { value: 'custom_pace', labelKey: 'settings.aiApps.biblePlanCustomPace' },
        ],
        default: 'one_year',
      },
      {
        key: 'chapters_per_push', type: 'single_select', labelKey: 'settings.aiApps.bibleChapters',
        choices: [
          { value: '1', labelKey: 'settings.aiApps.bibleChapters1' },
          { value: '2', labelKey: 'settings.aiApps.bibleChapters2' },
          { value: '3', labelKey: 'settings.aiApps.bibleChapters3' },
          { value: 'full_passage', labelKey: 'settings.aiApps.bibleChaptersFullPassage' },
        ],
        default: '1',
      },
      {
        key: 'time_of_day', type: 'single_select', labelKey: 'settings.aiApps.bibleTime',
        choices: [
          { value: 'morning', labelKey: 'settings.aiApps.slotMorning' },
          { value: 'noon', labelKey: 'settings.aiApps.slotNoon' },
          { value: 'evening', labelKey: 'settings.aiApps.slotEvening' },
          { value: 'night', labelKey: 'settings.aiApps.slotNight' },
        ],
        default: 'morning',
      },
      {
        key: 'translation', type: 'single_select', labelKey: 'settings.aiApps.bibleTranslation',
        choices: [
          { value: 'cuvmp', labelKey: 'settings.aiApps.bibleCuvmp' },
          { value: 'cnvs', labelKey: 'settings.aiApps.bibleCnvs' },
          { value: 'esv', labelKey: 'settings.aiApps.bibleEsv' },
          { value: 'niv', labelKey: 'settings.aiApps.bibleNiv' },
          { value: 'kjv', labelKey: 'settings.aiApps.bibleKjv' },
        ],
        default: 'cuvmp',
      },
      {
        key: 'reminder', type: 'single_select', labelKey: 'settings.aiApps.bibleReminder',
        choices: [
          { value: 'enabled', labelKey: 'settings.aiApps.reminderEnabled' },
          { value: 'silent', labelKey: 'settings.aiApps.reminderSilent' },
        ],
        default: 'enabled',
      },
    ],
  },
];

export const DEFAULT_MODULES = MODULES.filter(m => m.default).map(m => m.id);

// 每個 module 嘅 options 預設值（同後端 DEFAULT_MODULE_OPTIONS 一致）
export function defaultModuleOptions(): Record<string, Record<string, string | string[]>> {
  const out: Record<string, Record<string, string | string[]>> = {};
  for (const m of MODULES) {
    if (!m.options) continue;
    const opts: Record<string, string | string[]> = {};
    for (const o of m.options) opts[o.key] = o.default;
    out[m.id] = opts;
  }
  return out;
}

export type ToneId = 'professional' | 'friendly' | 'direct' | 'encouraging' | 'formal';
export type LangPref = 'zh-HK' | 'zh-TW' | 'en';
export type DetailLevel = 1 | 2 | 3;
export type ChannelId = 'whatsapp' | 'telegram' | 'email' | 'sms';

export interface SecretarySettings {
  modules: Record<string, Record<string, string | string[]>>;  // {module: {option: value}}
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

/** 向後兼容：modules 可能係舊 string[]（localStorage 舊 cache）或新 dict */
export function enabledModuleKeys(modules: SecretarySettings['modules'] | string[] | undefined): string[] {
  if (!modules) return [];
  if (Array.isArray(modules)) return modules;
  return Object.keys(modules);
}

export function moduleOptions(modules: SecretarySettings['modules'] | undefined, moduleId: string): Record<string, string | string[]> {
  if (!modules || Array.isArray(modules)) return {};
  return (modules[moduleId] as Record<string, string | string[]>) || {};
}

/** normalize 舊 string[] → dict（補 options 預設） */
export function normalizeModules(modules: SecretarySettings['modules'] | string[] | undefined): Record<string, Record<string, string | string[]>> {
  const defaults = defaultModuleOptions();
  if (!modules) return {};
  if (Array.isArray(modules)) {
    const out: Record<string, Record<string, string | string[]>> = {};
    for (const m of modules) out[m] = { ...(defaults[m] || {}) };
    return out;
  }
  const out: Record<string, Record<string, string | string[]>> = {};
  for (const [key, opts] of Object.entries(modules)) {
    out[key] = { ...(defaults[key] || {}), ...(opts || {}) };
  }
  return out;
}

export const DEFAULT_SETTINGS: SecretarySettings = {
  modules: normalizeModules(DEFAULT_MODULES),
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
    { key: 'morning', emoji: '🌅', start: '07:00' },
    { key: 'afternoon', emoji: '☀️', start: '12:00' },
    { key: 'evening', emoji: '🌆', start: '18:00' },
    { key: 'lateNight', emoji: '🌙', start: '00:00' },
  ],
};

const LOCAL_KEY = 'nexus-secretary-settings';
const API = '/api/v1/ai-secretary/settings';

// ── localStorage (offline cache) ──
function readLocal(): SecretarySettings | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 向後兼容舊 cache：modules 係 array → normalize
    return { ...DEFAULT_SETTINGS, ...parsed, modules: normalizeModules(parsed.modules) } as SecretarySettings;
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
/** HKT wall-clock minutes-of-day — timezone-independent of the browser. */
function hktMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong',
  }).formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value || '0')
  const m = Number(parts.find(p => p.type === 'minute')?.value || '0')
  return h * 60 + m
}

/** True when `now` falls inside [start, end). Handles overnight windows. */
export function isInWorkingHours(now: Date, s: SecretarySettings): boolean {
  const toM = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const mins = hktMinutesOfDay(now);
  const st = toM(s.work_start);
  const en = toM(s.work_end);
  if (st === en) return false;
  return st < en ? mins >= st && mins < en : mins >= st || mins < en;
}

/** True when `now` (HKT) is inside the configured working days. */
export function isWorkingDay(now: Date, s: SecretarySettings): boolean {
  const dow = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', timeZone: 'Asia/Hong_Kong',
  }).format(now).toLowerCase();
  return s.workdays.includes(dow.slice(0, 3));
}
