import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Check, RotateCcw, Save } from 'lucide-react';
import {
  MODULES, useSecretarySettings, CONNECTED_FALLBACK,
  type ToneId, type LangPref, type DetailLevel, type ChannelId,
} from '../hooks/useSecretarySettings';

// ── Working-hours slider helpers ──
const toMins = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fromMins = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const clampMins = (mins: number): number => Math.max(0, Math.min(1439, mins));

const WORKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TONES: ToneId[] = ['professional', 'friendly', 'direct', 'encouraging', 'formal'];
const CHANNELS: { id: ChannelId; icon: string; nameKey: string; hintKey: string; comingSoon?: boolean }[] = [
  { id: 'whatsapp', icon: '💬', nameKey: 'settings.aiApps.chWhatsapp', hintKey: 'settings.aiApps.chWhatsappHint' },
  { id: 'telegram', icon: '✈️', nameKey: 'settings.aiApps.chTelegram', hintKey: 'settings.aiApps.chTelegramHint' },
  { id: 'email', icon: '📧', nameKey: 'settings.aiApps.chEmail', hintKey: 'settings.aiApps.chEmailHint' },
  { id: 'sms', icon: '💬', nameKey: 'settings.aiApps.chSms', hintKey: 'settings.aiApps.chSmsHint', comingSoon: true },
];

type SectionId = 'content' | 'hours' | 'tone' | 'channels' | 'detail';

export default function AIAppsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settings, syncing, update } = useSecretarySettings();
  const [section, setSection] = useState<SectionId>('content');
  const [saved, setSaved] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Auto-save indicator — debounced
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(timer);
  }, [saved]);

  const flashSaved = () => {
    setSavedAt(new Date());
    setSaved(true);
  };

  // ── Working hours (backed by settings.work_start / work_end) ──
  const startMins = toMins(settings.work_start);
  const endMins = toMins(settings.work_end);

  const setStartMins = (mins: number) => {
    const v = clampMins(mins);
    const end = toMins(settings.work_end);
    update({ work_start: fromMins(Math.min(v, Math.max(end - 30, 0))) });
  };
  const setEndMins = (mins: number) => {
    const v = clampMins(mins);
    const start = toMins(settings.work_start);
    update({ work_end: fromMins(Math.max(v, Math.min(start + 30, 1439))) });
  };
  const saveHours = () => {
    update({ work_start: settings.work_start, work_end: settings.work_end });
    flashSaved();
  };
  const resetHours = () => {
    update({ work_start: '09:00', work_end: '18:00' });
    flashSaved();
  };

  // ── Modules multi-select ──
  const connectedSet = useMemo(
    () => new Set(settings.connected_modules ?? CONNECTED_FALLBACK),
    [settings.connected_modules],
  );
  const toggleModule = (id: string) => {
    if (!connectedSet.has(id)) return; // greyed out — not connected yet
    const has = settings.modules.includes(id);
    const next = has ? settings.modules.filter(m => m !== id) : [...settings.modules, id];
    update({ modules: next });
    flashSaved();
  };

  // ── Workdays ──
  const toggleWorkday = (day: string) => {
    const has = settings.workdays.includes(day);
    const next = has ? settings.workdays.filter(d => d !== day) : [...settings.workdays, day];
    update({ workdays: next });
    flashSaved();
  };

  // ── Detail preview ──
  const detailPreview = useMemo(() => {
    const lvl = settings.detail_level;
    if (lvl === 1) return t('settings.aiApps.detailPreview1');
    if (lvl === 3) return t('settings.aiApps.detailPreview3');
    return t('settings.aiApps.detailPreview2');
  }, [settings.detail_level, t]);

  const nav: { id: SectionId; icon: string; labelKey: string }[] = [
    { id: 'content', icon: '📋', labelKey: 'settings.aiApps.navContent' },
    { id: 'hours', icon: '🕐', labelKey: 'settings.aiApps.navHours' },
    { id: 'tone', icon: '💬', labelKey: 'settings.aiApps.navTone' },
    { id: 'channels', icon: '🔗', labelKey: 'settings.aiApps.navChannels' },
    { id: 'detail', icon: '🔎', labelKey: 'settings.aiApps.navDetail' },
  ];

  return (
    <div className="stg-page">
      <div className="breadcrumb">
        <span className="breadcrumb-link" onClick={() => navigate('/dashboard')}>Home</span>
        <ChevronRight />
        <span className="breadcrumb-current">{t('settings.aiApps.title')}</span>
      </div>

      <div className="asec-header">
        <div>
          <h1>{t('settings.aiApps.title')}</h1>
          <p className="asec-subtitle">{t('settings.aiApps.subtitle')}</p>
        </div>
        <span className={`asec-save-indicator${saved ? ' active' : ''}`}>
          {saved ? <><Check size={12} /> {t('settings.aiApps.autoSaved')}</>
            : syncing ? t('settings.aiApps.saving') ?? '…'
            : savedAt ? t('settings.aiApps.savedAt') : t('settings.aiApps.allSaved')}
        </span>
      </div>

      <div className="asec-shell">
        {/* ── Sidebar nav (desktop) / tab bar (mobile) ── */}
        <nav className="asec-nav">
          {nav.map(n => (
            <button
              key={n.id}
              className={`asec-nav-item${section === n.id ? ' active' : ''}`}
              onClick={() => setSection(n.id)}
            >
              <span className="asec-nav-icon">{n.icon}</span>
              {t(n.labelKey)}
            </button>
          ))}
        </nav>

        <main className="asec-content">
          {/* ══ SECTION 1: 簡報內容 ── */}
          {section === 'content' && (
            <section className="asec-section">
              <div className="asec-section-title">
                <h2>{t('settings.aiApps.sectionContent')}</h2>
                <p>{t('settings.aiApps.sectionContentDesc')}</p>
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.modulesTitle')}</h3>
                <p className="asec-card-hint">{t('settings.aiApps.modulesHint')}</p>
                <div className="asec-module-grid">
                  {MODULES.map(m => {
                    const selected = settings.modules.includes(m.id);
                    const connected = connectedSet.has(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`asec-module-card${selected ? ' selected' : ''}${connected ? '' : ' disabled'}`}
                        onClick={() => connected && toggleModule(m.id)}
                        role="button"
                        tabIndex={connected ? 0 : -1}
                        aria-disabled={!connected}
                        onKeyDown={e => { if (connected && (e.key === 'Enter' || e.key === ' ')) toggleModule(m.id) }}
                      >
                        <span className="asec-module-icon">{m.icon}</span>
                        <div className="asec-module-info">
                          <strong>{t(m.nameKey)}</strong>
                          <p>{t(m.descKey)}</p>
                        </div>
                        {!connected && <span className="asec-module-tag">{t('settings.aiApps.soon')}</span>}
                        <span className={`asec-module-check${selected ? ' checked' : ''}`}>
                          {selected && <Check size={11} />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ══ SECTION 2: 工作時間 ── */}
          {section === 'hours' && (
            <section className="asec-section">
              <div className="asec-section-title">
                <h2>{t('settings.aiApps.sectionHours')}</h2>
                <p>{t('settings.aiApps.sectionHoursDesc')}</p>
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.activeHours')}</h3>
                <div className="stg-hours-slider">
                  <div className="stg-hours-track">
                    <div className="stg-hours-fill" style={{ left: `${(startMins / 1440) * 100}%`, width: `${((endMins - startMins) / 1440) * 100}%` }} />
                    <input type="range" min={0} max={1439} step={30} value={startMins} onChange={e => setStartMins(Number(e.target.value))} className="stg-range stg-range-start" aria-label={t('settings.aiApps.workingStart')} />
                    <input type="range" min={0} max={1439} step={30} value={endMins} onChange={e => setEndMins(Number(e.target.value))} className="stg-range stg-range-end" aria-label={t('settings.aiApps.workingEnd')} />
                  </div>
                  <div className="stg-hours-labels">
                    <span className="stg-hours-value">{t('settings.aiApps.workingStart')}: <strong>{settings.work_start}</strong></span>
                    <span className="stg-hours-value">{t('settings.aiApps.workingEnd')}: <strong>{settings.work_end}</strong></span>
                  </div>
                </div>
                <div className="asec-actions">
                  <button className="btn-ghost" onClick={resetHours} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <RotateCcw size={14} /> {t('settings.aiApps.resetDefault')}
                  </button>
                  <button className="btn-primary" onClick={saveHours} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Save size={14} /> {t('settings.aiApps.saveHours')}
                  </button>
                </div>
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.greetingSchedule')}</h3>
                <p className="asec-card-hint">{t('settings.aiApps.greetingDesc')}</p>
                <div className="stg-greeting-list">
                  {(settings.greeting_slots?.length ? settings.greeting_slots : [
                    { key: 'morning', emoji: '🌅', start: '05:00' },
                    { key: 'afternoon', emoji: '☀️', start: '12:00' },
                    { key: 'evening', emoji: '🌆', start: '18:00' },
                    { key: 'lateNight', emoji: '🌙', start: '23:00' },
                  ]).map(slot => (
                    <div key={slot.key} className="stg-greeting-row">
                      <span className="stg-greeting-emoji">{slot.emoji}</span>
                      <span className="stg-greeting-name">{t('settings.aiApps.' + slot.key)}</span>
                      <span className="stg-greeting-time">{slot.start}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.workdays')}</h3>
                <div className="asec-day-row">
                  {WORKDAYS.map(day => (
                    <button
                      key={day}
                      className={`asec-day-chip${settings.workdays.includes(day) ? ' active' : ''}`}
                      onClick={() => toggleWorkday(day)}
                    >
                      {t('settings.aiApps.day' + day.charAt(0).toUpperCase() + day.slice(1))}
                    </button>
                  ))}
                </div>
              </div>

              <div className="asec-card">
                <div className="asec-toggle-row">
                  <div>
                    <strong>{t('settings.aiApps.weekendMute')}</strong>
                    <p className="hint">{t('settings.aiApps.weekendMuteHint')}</p>
                  </div>
                  <label className="asec-switch">
                    <input type="checkbox" checked={settings.weekend_mute} onChange={e => { update({ weekend_mute: e.target.checked }); flashSaved(); }} />
                    <span className="asec-slider" />
                  </label>
                </div>
                <div className="asec-toggle-row">
                  <div>
                    <strong>{t('settings.aiApps.strictSilence')}</strong>
                    <p className="hint">{t('settings.aiApps.strictSilenceHint')}</p>
                  </div>
                  <label className="asec-switch">
                    <input type="checkbox" checked={settings.strict_silence} onChange={e => { update({ strict_silence: e.target.checked }); flashSaved(); }} />
                    <span className="asec-slider" />
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* ══ SECTION 3: 語氣指令 ── */}
          {section === 'tone' && (
            <section className="asec-section">
              <div className="asec-section-title">
                <h2>{t('settings.aiApps.sectionTone')}</h2>
                <p>{t('settings.aiApps.sectionToneDesc')}</p>
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.toneStyle')}</h3>
                <div className="asec-tone-row">
                  {TONES.map(tone => (
                    <button
                      key={tone}
                      className={`asec-tone-chip${settings.tone === tone ? ' active' : ''}`}
                      onClick={() => { update({ tone: tone as ToneId }); flashSaved(); }}
                    >
                      {t('settings.aiApps.tone' + tone.charAt(0).toUpperCase() + tone.slice(1))}
                    </button>
                  ))}
                </div>
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.customInstructions')}</h3>
                <textarea
                  rows={5}
                  value={settings.instructions}
                  placeholder={t('settings.aiApps.customInstructionsPlaceholder')}
                  onChange={e => { update({ instructions: e.target.value }); flashSaved(); }}
                  className="asec-textarea"
                />
              </div>

              <div className="asec-card">
                <h3>{t('settings.aiApps.langPref')}</h3>
                <div className="asec-radio-row">
                  {(['zh-HK', 'zh-TW', 'en'] as LangPref[]).map(lang => (
                    <label key={lang} className="asec-radio">
                      <input
                        type="radio"
                        name="langPref"
                        checked={settings.lang_pref === lang}
                        onChange={() => { update({ lang_pref: lang }); flashSaved(); }}
                      />
                      {t('settings.aiApps.lang' + lang)}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ══ SECTION 4: 通訊整合 ── */}
          {section === 'channels' && (
            <section className="asec-section">
              <div className="asec-section-title">
                <h2>{t('settings.aiApps.sectionChannels')}</h2>
                <p>{t('settings.aiApps.sectionChannelsDesc')}</p>
              </div>

              <div className="asec-channel-list">
                {CHANNELS.map(ch => {
                  const state = settings.channels[ch.id] || { connected: false, enabled: false };
                  return (
                    <div key={ch.id} className={`asec-channel-card${state.connected ? ' connected' : ''}${ch.comingSoon ? ' disabled' : ''}`}>
                      <div className="asec-channel-info">
                        <span className="asec-channel-icon">{ch.icon}</span>
                        <div>
                          <strong>{t(ch.nameKey)}</strong>
                          <p className="hint">
                            {ch.comingSoon
                              ? t('settings.aiApps.comingSoon')
                              : state.connected
                                ? t('settings.aiApps.chConnected')
                                : t('settings.aiApps.chNotConnected')}
                          </p>
                        </div>
                      </div>
                      {ch.comingSoon ? (
                        <button className="btn-ghost" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>{t('settings.aiApps.comingSoon')}</button>
                      ) : state.connected ? (
                        <label className="asec-switch">
                          <input type="checkbox" checked={state.enabled} onChange={e => { update({ channels: { ...settings.channels, [ch.id]: { ...state, enabled: e.target.checked } } }); flashSaved(); }} />
                          <span className="asec-slider" />
                        </label>
                      ) : (
                        <button className="btn-primary" onClick={() => { update({ channels: { ...settings.channels, [ch.id]: { connected: true, enabled: true } } }); flashSaved(); }}>
                          {t('settings.aiApps.chConnect')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ══ SECTION 5: 資料詳細度 ── */}
          {section === 'detail' && (
            <section className="asec-section">
              <div className="asec-section-title">
                <h2>{t('settings.aiApps.sectionDetail')}</h2>
                <p>{t('settings.aiApps.sectionDetailDesc')}</p>
              </div>

              <div className="asec-card">
                <div className="asec-detail-wrap">
                  <input
                    type="range" min={1} max={3} step={1} value={settings.detail_level}
                    onChange={e => { update({ detail_level: Number(e.target.value) as DetailLevel }); flashSaved(); }}
                    className="asec-detail-slider"
                  />
                  <div className="asec-detail-labels">
                    <span className={settings.detail_level === 1 ? 'active' : ''}>{t('settings.aiApps.detailBrief')}</span>
                    <span className={settings.detail_level === 2 ? 'active' : ''}>{t('settings.aiApps.detailStandard')}</span>
                    <span className={settings.detail_level === 3 ? 'active' : ''}>{t('settings.aiApps.detailFull')}</span>
                  </div>
                </div>
                <div className="asec-detail-preview">{detailPreview}</div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
