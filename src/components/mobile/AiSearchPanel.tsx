import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { apiClient, getStoredAuth } from '../../lib/api';
import {
  Search, Plus, PencilLine, Trash2, CalendarClock, Camera, Mic, ArrowUp, X, History, Sparkles,
} from 'lucide-react';

/**
 * AI & Search dual panel — center nav button.
 * Tab 1: 問 AI（streaming reply via /api/v1/ai/chat/stream）
 * Tab 2: 搜尋（debounced global search via /api/v1/crm/search）
 * Capability list + 相機/咪高風 entry points per nexus-mobile-nav.html.
 */

export interface SearchResult { id: string; type: string; title: string; subtitle?: string; icon: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onScanCard: () => void;
}

const TYPE_EMOJI: Record<string, string> = {
  contact: '👤', company: '🏢', deal: '💰', task: '✅',
  project: '📁', touchpoint: '🔄', note: '📝', event: '📅',
};

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
  const [query, setQuery] = useState('');
  const [thinking, setThinking] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);

  // Reset on open / close
  useEffect(() => {
    if (open) {
      setClosing(false);
      setTimeout(() => inputRef.current?.focus(), 260);
    } else {
      setQuery(''); setAiReply(null); setAiError(null); setResults([]); setMode('ai');
    }
  }, [open]);

  // Load recent AI sessions (top 3 titles)
  useEffect(() => {
    if (!open) return;
    apiClient.get<{ sessions: { title?: string }[] }>('/api/v1/ai/sessions')
      .then(d => setRecent((d?.sessions || []).slice(0, 3).map(s => s.title || '未命名對話')))
      .catch(() => setRecent([]));
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (mode !== 'search' || !open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiClient.get<{ results: any[] }>(`/api/v1/crm/search?q=${encodeURIComponent(q)}&limit=10`);
        setResults((data?.results || []).map((r: any) => ({
          id: String(r.id), type: r.type, title: r.label, subtitle: r.sub,
          icon: TYPE_EMOJI[r.type] || '📄',
        })));
      } catch { setResults([]); }
      setSearching(false);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, mode, open]);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 200);
  };

  async function submitAi() {
    const q = query.trim();
    if (!q || thinking) return;
    setThinking(true); setAiReply(null); setAiError(null);
    try {
      const token = getStoredAuth()?.access_token || '';
      const resp = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: q }], session_id: null, agent_id: null }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail || `Request failed with status ${resp.status}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
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
            if (data.text !== undefined) full += data.text;
            if (data.message) setAiError(data.message);
          } catch { /* skip */ }
        }
      }
      if (full) setAiReply(full);
      else if (!aiError) setAiError('AI 冇回覆，再試一次？');
    } catch (e: any) {
      setAiError(e.message || '請求失敗');
    } finally {
      setThinking(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className={`aisp-overlay ${closing ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`aisp-panel ${closing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="aisp-handle" />
        <div className="aisp-head">
          <h3>AI 管家秘書</h3>
          <button type="button" className="aisp-close" onClick={handleClose} aria-label="Close"><X /></button>
        </div>

        <div className="aisp-tabs">
          <button type="button" className={`aisp-tab ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            <Sparkles className="aisp-tab-icon" /> 問 AI
          </button>
          <button type="button" className={`aisp-tab ${mode === 'search' ? 'active' : ''}`} onClick={() => setMode('search')}>
            <Search className="aisp-tab-icon" /> 搜尋
          </button>
        </div>

        <div className="aisp-input-row">
          <Search />
          <input
            ref={inputRef}
            className="aisp-input"
            placeholder={mode === 'ai' ? '問 AI 秘書任何事…' : '搜尋聯絡人、公司、專案、任務…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && mode === 'ai') submitAi(); }}
          />
          <button type="button" className="aisp-icon-btn cam" onClick={() => { handleClose(); onScanCard(); }} aria-label="拍卡片">
            <Camera />
          </button>
          {mode === 'ai' && (
            <button type="button" className="aisp-icon-btn mic" onClick={() => alert('語音輸入即將推出')} aria-label="語音輸入">
              <Mic />
            </button>
          )}
          {mode === 'ai' && (
            <button type="button" className="aisp-icon-btn send" onClick={submitAi} disabled={thinking || !query.trim()} aria-label="送出">
              <ArrowUp />
            </button>
          )}
        </div>

        {mode === 'ai' && (
          <div className="aisp-body">
            {!aiReply && !thinking && !aiError && (
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
                    <button key={chip} type="button" className="aisp-chip" onClick={() => setQuery(chip)}>
                      <Sparkles />{chip}
                    </button>
                  ))}
                </div>
                {recent.length > 0 && (
                  <>
                    <div className="aisp-label">最近</div>
                    {recent.map((title, i) => (
                      <div key={i} className="aisp-recent-item">
                        <History /><span>{title}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
            {thinking && (
              <div className="aisp-thinking"><span className="aisp-dot" /><span className="aisp-dot" /><span className="aisp-dot" /></div>
            )}
            {aiReply && <div className="aisp-reply">{aiReply}</div>}
            {aiError && <div className="aisp-error">{aiError}</div>}
          </div>
        )}

        {mode === 'search' && (
          <div className="aisp-body">
            {searching && results.length === 0 && <div className="aisp-empty">搜尋中…</div>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="aisp-empty">冇搜尋到相關結果</div>
            )}
            {results.map(r => (
              <button
                key={r.type + r.id}
                type="button"
                className="aisp-result-row"
                onClick={() => { handleClose(); navigate(`/${r.type === 'contact' ? 'contacts' : r.type === 'company' ? 'companies' : r.type === 'deal' ? 'deals' : r.type === 'task' ? 'tasks' : r.type === 'project' ? 'projects' : r.type === 'touchpoint' ? 'touchpoints' : 'dashboard'}/${r.id}`); }}
              >
                <span className="aisp-result-icon">{r.icon}</span>
                <span className="aisp-result-text">
                  <strong>{r.title}</strong>
                  {r.subtitle && <small>{r.subtitle}</small>}
                </span>
                <span className="aisp-result-type">{r.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
