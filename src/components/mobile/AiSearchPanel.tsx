import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { apiClient, getStoredAuth } from '../../lib/api';
import FollowUpChips from '../ai/chat/core/FollowUpChips';
import MarkdownMessage from '../MarkdownRenderer';
import {
  Search, Plus, PencilLine, Trash2, CalendarClock, Camera, Mic, ArrowUp, X, Sparkles, Maximize2,
} from 'lucide-react';

/**
 * AI & Search dual panel — center nav button（v6.71）
 * Tab 1 問 AI：真 chat — sessions / streaming / citations / follow-ups
 *   （邏輯同 ChatboxPanel 一致，重用 /api/v1/ai/chat/stream + cb-* 樣式）
 * Tab 2 搜尋：真 global search（debounce /api/v1/crm/search → 導航）
 */

export interface SearchResult { id: string; type: string; title: string; subtitle?: string; icon: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onScanCard: () => void;
}

const TYPE_EMOJI: Record<string, string> = {
  contact: '👤', company: '🏢', task: '✅',
  project: '📁', touchpoint: '🔄', note: '📝', event: '📅',
};

/* ── Chat types（同 ChatboxPanel 一致）── */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: CitationSource[];
  followups?: string[];
}
interface CitationSource { id: string; type: string; title: string; snippet: string; updated_at?: string }
interface SessionItem { session_id: string; title: string; status?: string; is_pinned?: boolean; created_at?: string }

let msgCounter = 0;
function nextId() { msgCounter += 1; return `msg_${Date.now()}_${msgCounter}`; }
function userMessage(content: string): ChatMessage { return { id: nextId(), role: 'user', content, timestamp: Date.now() }; }
function assistantMessage(content: string): ChatMessage { return { id: nextId(), role: 'assistant', content, timestamp: Date.now() }; }

const GREETING = "Hi! I'm NEXUS AI. How can I help you today?";
const CAPABILITIES = [
  { icon: Plus,        title: '新增資料', desc: '「幫我新增一個聯絡人…」— AI 直接寫入你嘅 tenant 資料庫' },
  { icon: PencilLine,  title: '修改資料', desc: '「將 Kong API 專案到期日改成 9月20日」— AI 直接更新現有記錄' },
  { icon: Trash2,      title: '刪除資料', desc: '「刪除 XXX 呢個聯絡人」— AI 會先確認再執行刪除' },
  { icon: CalendarClock, title: '行事曆主動提問', desc: 'AI 自動掃描你嘅日程，細節不足嘅活動會主動問你補充' },
];
const QUICK_CHIPS = ['總結今日待辦', '幫我起草跟進 email', '分析專案風險'];

export default function AiSearchPanel({ open, onClose, onScanCard }: Props) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'ai' | 'search'>('ai');
  const [closing, setClosing] = useState(false);

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionItem[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchType, setSearchType] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SEARCH_FILTERS = [
    { key: '', label: '全部' },
    { key: 'contact', label: '聯絡人' },
    { key: 'company', label: '公司' },
    { key: 'task', label: '任務' },
    { key: 'project', label: '專案' },
    { key: 'touchpoint', label: '互動' },
    { key: 'note', label: '筆記' },
  ];

  /* ── Sessions ── */
  const switchSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    setLoadingSession(true);
    setMessages([]);
    try {
      const resp = await apiClient.get<{ messages: any[] }>(`/api/v1/ai/sessions/${sid}/messages`);
      const msgs = resp?.messages || [];
      setMessages(msgs.length
        ? msgs.map((m: any) => ({ id: m.id, role: m.role, content: m.content, timestamp: new Date(m.created_at || Date.now()).getTime() }))
        : [assistantMessage(GREETING)]);
    } catch {
      setMessages([assistantMessage(GREETING)]);
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setLoadingSession(true);
    try {
      const resp = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions');
      const list = resp?.sessions || [];
      setSessionList(list);
      // v6.90: 每次開 panel 都係新對話 — 唔好自動 switch 去舊 session。
      // 之前自動 load active/first session → AI 帶住舊 context 答非所問
      // （「佢有佢講」）。舊對話留喺 session chips 俾用戶自己揀。
      setSessionId(null);
      setMessages([assistantMessage(GREETING)]);
    } catch {
      setMessages([assistantMessage(GREETING)]);
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const createNewSession = () => {
    abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setError(null);
  };

  /* ── Streaming（同 ChatboxPanel doStream 一致）── */
  const doStream = useCallback(async (text: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setIsStreaming(true);
    setError(null);
    try {
      const resp = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredAuth()?.access_token || ''}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: text }], session_id: sessionId || null, agent_id: null }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(errBody.detail || `Request failed with status ${resp.status}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      let fullReply = '';
      let newSessionId: string | null = null;
      const msgCitations: CitationSource[] = [];
      let msgFollowups: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n').map(l => l.replace('\r', ''));
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text !== undefined) { fullReply += data.text; setStreamingContent(fullReply); }
            if (data.session_id) newSessionId = data.session_id;
            if (data.citations && Array.isArray(data.citations)) {
              const existingIds = new Set(msgCitations.map(c => c.id));
              for (const cit of data.citations) {
                if (!existingIds.has(cit.id)) { msgCitations.push(cit as CitationSource); existingIds.add(cit.id); }
              }
            }
            if (data.followups && Array.isArray(data.followups)) msgFollowups = data.followups.map(String).slice(0, 3);
            if (data.message) setError(data.message);
          } catch { /* skip */ }
        }
      }
      if (fullReply) {
        const reply: ChatMessage = {
          ...assistantMessage(fullReply),
          citations: msgCitations.length ? msgCitations : undefined,
          followups: msgFollowups.length ? msgFollowups : undefined,
        };
        setMessages(prev => [...prev, reply]);
      }
      if (newSessionId && newSessionId !== sessionId) setSessionId(newSessionId);
      setStreamingContent('');
      const resp2 = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions').catch(() => null);
      if (resp2?.sessions) setSessionList(resp2.sessions);
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e?.message || '請求失敗，請再試');
    } finally {
      setIsStreaming(false);
      setIsLoading(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  }, [sessionId]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading || isStreaming) return;
    setMessages(prev => [...prev, userMessage(content)]);
    setInput('');
    await doStream(content);
  }, [input, isLoading, isStreaming, doStream]);

  /* ── Open/close reset ── */
  useEffect(() => {
    if (open) {
      setClosing(false);
      setMode('ai');
      loadSessions();
      setTimeout(() => document.querySelector<HTMLInputElement>('.aisp-input')?.focus(), 300);
    } else {
      abortRef.current?.abort();
      setQuery(''); setResults([]);
    }
  }, [open, loadSessions]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, isStreaming, streamingContent, isLoading]);

  /* ── Debounced search ── */
  useEffect(() => {
    if (mode !== 'search' || !open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const typesParam = searchType ? `&types=${encodeURIComponent(searchType)}` : '';
        const data = await apiClient.get<{ results: any[] }>(`/api/v1/crm/search?q=${encodeURIComponent(q)}&limit=10${typesParam}`);
        setResults((data?.results || []).filter((r: any) => r.type !== 'deal').map((r: any) => ({
          id: String(r.id), type: r.type, title: r.label, subtitle: r.sub,
          icon: TYPE_EMOJI[r.type] || '📄',
        })));
      } catch { setResults([]); }
      setSearching(false);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, mode, open, searchType]);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    abortRef.current?.abort();
    setTimeout(() => {
      // Reset closing BEFORE onClose — otherwise a quick reopen renders one
      // frame with the .closing class (opacity 0) = open flash/flicker.
      setClosing(false);
      onClose();
    }, 200);
  };

  const openFullscreen = () => {
    handleClose();
    // v6.76: 跟當前 tab — AI tab 去 AI 頁面，搜尋 tab 去搜尋頁面
    navigate(mode === 'ai' ? '/ai' : '/search');
  };

  /* v6.82: lock background scroll while panel is open */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const goResult = (r: SearchResult) => {
    const map: Record<string, string> = { contact: 'contacts', company: 'companies', task: 'tasks', project: 'projects', touchpoint: 'touchpoints' };
    handleClose();
    navigate(`/${map[r.type] || 'dashboard'}/${r.id}`);
  };

  const emptyChat = messages.length === 0 && !loadingSession && !isStreaming;

  return createPortal(
    <div className={`aisp-overlay ${closing ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`aisp-panel ${closing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="aisp-handle" />
        <div className="aisp-head">
          <h3>AI 管家秘書</h3>
          {/* v6.87: tabs 搬入標題行 — 慳返成條 tab 欄，button 收窄做 pills */}
          <div className="aisp-tabs">
            <button type="button" className={`aisp-tab ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
              <Sparkles className="aisp-tab-icon" /> 問 AI
            </button>
            <button type="button" className={`aisp-tab ${mode === 'search' ? 'active' : ''}`} onClick={() => setMode('search')}>
              <Search className="aisp-tab-icon" /> 搜尋
            </button>
          </div>
          <div className="aisp-head-actions">
            <button type="button" className="aisp-close" onClick={openFullscreen} aria-label="全螢幕搜尋"><Maximize2 /></button>
            <button type="button" className="aisp-close" onClick={handleClose} aria-label="Close"><X /></button>
          </div>
        </div>

        {mode === 'ai' && (
          <div className="aisp-chat">
            {/* Session bar */}
            <div className="aisp-session-bar">
              <button type="button" className={`aisp-session-chip ${!sessionId ? 'active' : ''}`} onClick={createNewSession}>
                <Plus /> 新對話
              </button>
              {sessionList.slice(0, 8).map(s => (
                <button
                  key={s.session_id}
                  type="button"
                  className={`aisp-session-chip ${sessionId === s.session_id ? 'active' : ''}`}
                  onClick={() => switchSession(s.session_id)}
                  title={s.title}
                >
                  {s.title || '未命名對話'}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div className="aisp-msg-area" ref={scrollRef}>
              {loadingSession && <div className="aisp-empty">載入對話…</div>}
              {emptyChat && (
                <>
                  <div className="aisp-label">AI 可以幫你</div>
                  {CAPABILITIES.map(c => (
                    <div key={c.title} className="aisp-capability">
                      <span className="icn"><c.icon /></span>
                      <div><strong>{c.title}</strong><span>{c.desc}</span></div>
                    </div>
                  ))}
                  <div className="aisp-label" style={{ marginTop: 16 }}>快速指令</div>
                  <div className="aisp-chip-row">
                    {QUICK_CHIPS.map(chip => (
                      <button key={chip} type="button" className="aisp-chip" onClick={() => setInput(chip)}>
                        <Sparkles />{chip}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {messages.map((m) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="cb-msg-user">
                      <div className="cb-msg-user-bubble">{m.content}</div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="cb-msg-ai-row">
                    <div className="cb-msg-ai-body ai-card">
                      {/* v6.88: 對話者名 — NEXUS AI（唔用框，用 meta 標示） */}
                      <div className="cb-msg-ai-meta">
                        <span className="cb-msg-time">NEXUS AI</span>
                      </div>
                      <div className="msg-ai-content cb-msg-ai-content">
                        <MarkdownMessage content={m.content} />
                      </div>
                      {m.citations && m.citations.length > 0 && (
                        <div className="cb-citation-wrap">
                          <div className="cb-citation-chip">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            Source: {m.citations.length} record{m.citations.length > 1 ? 's' : ''}
                          </div>
                        </div>
                      )}
                      {m.followups && m.followups.length > 0 && (
                        <FollowUpChips suggestions={m.followups} onSelect={q => sendMessage(q)} />
                      )}
                    </div>
                  </div>
                );
              })}
              {isStreaming && streamingContent && (
                <div className="cb-msg-ai-row">
                  <div className="cb-msg-ai-body ai-card is-thinking">
                    <div className="msg-ai-content cb-msg-ai-content">
                      <MarkdownMessage content={streamingContent} streaming />
                    </div>
                  </div>
                </div>
              )}
              {isLoading && !streamingContent && (
                <div className="aisp-thinking"><span className="aisp-dot" /><span className="aisp-dot" /><span className="aisp-dot" /></div>
              )}
              {error && <div className="aisp-error">{error}</div>}
            </div>

            {/* Composer（design 嘅 input row，置底） */}
            <div className="aisp-input-row">
              <input
                className="aisp-input"
                placeholder="問 AI 秘書任何事…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
              />
              <button type="button" className="aisp-icon-btn cam" onClick={() => { handleClose(); onScanCard(); }} aria-label="拍卡片">
                <Camera />
              </button>
              <button type="button" className="aisp-icon-btn mic" onClick={() => setInput(prev => prev + '（語音輸入即將推出）')} aria-label="語音輸入">
                <Mic />
              </button>
              <button type="button" className="aisp-icon-btn send" onClick={() => sendMessage()} disabled={isLoading || isStreaming || !input.trim()} aria-label="送出">
                <ArrowUp />
              </button>
            </div>
          </div>
        )}

        {mode === 'search' && (
          <div className="aisp-search-col">
            <div className="aisp-input-row">
              <Search />
              <input
                className="aisp-input"
                placeholder="搜尋聯絡人、公司、專案、任務…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <div className="aisp-filters">
              {SEARCH_FILTERS.map(f => (
                <button
                  key={f.key || 'all'}
                  type="button"
                  className={`aisp-filter-chip ${searchType === f.key ? 'active' : ''}`}
                  onClick={() => setSearchType(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="aisp-body">
              {searching && results.length === 0 && <div className="aisp-empty">搜尋中…</div>}
              {!searching && query.trim().length >= 2 && results.length === 0 && <div className="aisp-empty">冇搜尋到相關結果</div>}
              {results.map(r => (
                <button key={r.type + r.id} type="button" className="aisp-result-row" onClick={() => goResult(r)}>
                  <span className="aisp-result-icon">{r.icon}</span>
                  <span className="aisp-result-text">
                    <strong>{r.title}</strong>
                    {r.subtitle && <small>{r.subtitle}</small>}
                  </span>
                  <span className="aisp-result-type">{r.type}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
