import { useRef, useState } from 'react';
import { ChevronRight, Upload, X, Loader2, Link2, UserPlus, FileWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApi, CardSkeleton, ErrorBox } from '../lib/useApi';
import { uploadFile, apiClient } from '../lib/api';

interface NameCard {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  image_url: string | null;
  raw_ocr_text: string | null;
  parsed_data: Record<string, any> | null;
  status: string; // pending | matched | created
  contact_id: string | null;
  created_at: string;
}

interface NameCardListResponse {
  items: NameCard[];
  total: number;
}

const STATUS_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  created: { icon: <UserPlus size={13} />, label: '已建立聯絡人', color: 'var(--color-success)' },
  matched: { icon: <Link2 size={13} />, label: '已連結聯絡人', color: 'var(--color-primary)' },
  pending: { icon: <FileWarning size={13} />, label: '待處理', color: 'var(--color-warning, #b58a2a)' },
};

export default function NameCardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useApi<NameCardListResponse>('/api/v1/crm/name-cards?page=1&page_size=100');

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selected, setSelected] = useState<NameCard | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      await uploadFile<NameCard>('/api/v1/crm/name-cards/upload', file);
      setUploadOpen(false);
      refresh();
    } catch (e: any) {
      const detail = e?.detail || e?.message || '上載失敗';
      setUploadError(typeof detail === 'string' ? detail : JSON.stringify(detail));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openCard = async (card: NameCard) => {
    // Fetch fresh detail (includes contact link state)
    try {
      const detail = await apiClient.get<NameCard>(`/api/v1/crm/name-cards/${card.id}`);
      setSelected(detail);
    } catch {
      setSelected(card);
    }
  };

  return (
    <div className="page-content">
      <div className="breadcrumb">
        <span className="breadcrumb-link" onClick={() => navigate('/dashboard')}>Home</span>
        <ChevronRight />
        <span className="breadcrumb-current">Name Cards</span>
      </div>

      <div className="page-header">
        <div>
          <h1>{t('nameCard.scannerTitle')}</h1>
          <p>{t('nameCard.scannedCount', { count: total })}</p>
        </div>
        <button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setUploadOpen(true)}>
          <Upload size={15} /> 新增卡片
        </button>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="modal-overlay" onClick={() => !uploading && setUploadOpen(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>上載名片</h2>
              <button className="modal-x" onClick={() => setUploadOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="hint" style={{ marginTop: 0 }}>
                上載卡片圖片後會自動 OCR 提取資料，並建立或連結對應聯絡人。
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={e => handleFile(e.target.files?.[0])}
                disabled={uploading}
                style={{ width: '100%', padding: '10px 0' }}
              />
              {uploading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: 13 }}>
                  <Loader2 size={15} className="spin" /> OCR 辨識中...
                </div>
              )}
              {uploadError && <p className="asec-error" style={{ color: 'var(--color-error, #ab4b59)' }}>{uploadError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>{selected.parsed_data?.name || selected.name || '名片詳情'}</h2>
              <button className="modal-x" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="modal-body">
              {selected.image_url && (
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <img
                    src={selected.image_url}
                    alt="namecard"
                    style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, border: '1px solid var(--color-divider)' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {(() => {
                  const meta = STATUS_META[selected.status] || STATUS_META.pending;
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: meta.color }}>
                      {meta.icon} {meta.label}
                    </span>
                  );
                })()}
                {selected.contact_id && (
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '3px 10px' }}
                    onClick={() => navigate(`/contacts/${selected.contact_id}`)}
                  >
                    開啟聯絡人 →
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 13.5 }}>
                {[
                  ['職稱', selected.parsed_data?.title || selected.title],
                  ['公司', selected.parsed_data?.company || selected.company],
                  ['電話', selected.parsed_data?.phone || selected.phone],
                  ['電郵', selected.parsed_data?.email || selected.email],
                  ['網站', selected.parsed_data?.website],
                  ['LinkedIn', selected.parsed_data?.linkedin],
                  ['中文名', selected.parsed_data?.chinese_name],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k as string} style={{ display: 'contents' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{k}</span>
                    <span style={{ wordBreak: 'break-all' }}>{v as string}</span>
                  </div>
                ))}
              </div>
              {selected.raw_ocr_text && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 12.5, cursor: 'pointer', color: 'var(--color-text-muted)' }}>OCR 原文</summary>
                  <pre style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', background: 'var(--color-surface-offset)', padding: 10, borderRadius: 6, marginTop: 6, maxHeight: 180, overflow: 'auto' }}>{selected.raw_ocr_text}</pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <CardSkeleton count={6} />
      ) : error ? (
        <ErrorBox message={error} onRetry={refresh} />
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm c-text-faint">
          {t('nameCard.empty')}
          <div style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={() => setUploadOpen(true)}>上載第一張名片</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((card) => {
            const meta = STATUS_META[card.status] || STATUS_META.pending;
            return (
              <div key={card.id} className="panel" style={{ cursor: 'pointer', overflow: 'hidden' }} onClick={() => openCard(card)}>
                <div style={{ height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface-dynamic)', position: 'relative' }}>
                  {card.image_url ? (
                    <img
                      src={card.image_url}
                      alt={card.name}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      loading="lazy"
                    />
                  ) : (
                    <span style={{ fontSize: 32 }}>📇</span>
                  )}
                  <span style={{ position: 'absolute', top: 8, right: 8, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: '#fff', background: meta.color, borderRadius: 999, padding: '2px 8px' }}>
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <div className="p-3 space-y-1">
                  <p className="list-title" style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.parsed_data?.name || card.name || '未辨識'}
                  </p>
                  <p className="list-sub" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.parsed_data?.title || card.title || '—'}
                  </p>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.parsed_data?.company || card.company || '—'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
