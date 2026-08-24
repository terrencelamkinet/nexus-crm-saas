import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import SvcIcon from '../../components/SvcIcon';
import { apiClient } from '../../lib/api';

/**
 * 拍卡片 → AI OCR → 自動入庫（v6.69）
 * - getUserMedia 開後置鏡頭 → canvas capture → FormData
 * - POST /api/v1/crm/name-cards/upload（既有 backend：OCR + 自動建立/連結 Contact）
 * - 顯示 OCR 結果；「儲存為聯絡人」= 關閉（backend 已寫入），「重拍」= 再影
 */

interface NameCardResult {
  status?: string;
  contact_id?: string | null;
  duplicate_candidate?: { contact_id?: string; reason?: string } | null;
  parsed_data?: Record<string, any> | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (label: string) => void;
}

export default function CameraScanSheet({ open, onClose, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NameCardResult | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setResult(null); setBusy(false);
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setError('無法開啟鏡頭 — 請檢查瀏覽器權限');
      }
    };
    start();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setTimeout(() => { setClosing(false); onClose(); }, 200);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setError('鏡頭未就緒，再試一次'); return; }
    setBusy(true); setError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('capture failed');
      const fd = new FormData();
      fd.append('file', blob, 'namecard.jpg');
      const data = await apiClient.postForm<NameCardResult>('/api/v1/crm/name-cards/upload', fd);
      setResult(data || {});
    } catch (e: any) {
      setError(e?.message || 'OCR 失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  /* v6.82: lock background scroll while camera sheet is open */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const parsed = result?.parsed_data || {};
  const personName =
    parsed?.name || parsed?.person_name || parsed?.full_name ||
    (result?.duplicate_candidate ? '重複聯絡人' : '已識別名片');

  const saveLabel = result?.duplicate_candidate
    ? `⚠️ 可能重複：${result.duplicate_candidate.reason || '同名/同 email'} — 已連結現有聯絡人`
    : '聯絡人已建立';

  return createPortal(
    <div className={`cam-overlay ${closing ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`cam-panel ${closing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="cam-handle" />
        <div className="cam-head">
          <h3>拍卡片 · AI 自動識別</h3>
          <button type="button" className="cam-close" onClick={handleClose} aria-label="Close"><SvcIcon name="x" /></button>
        </div>
        <div className="cam-body">
          {!result ? (
            <>
              <div className="cam-frame">
                <video ref={videoRef} playsInline muted />
                <div className="cam-card-outline"><div className="cam-scan-line" /></div>
              </div>
              {error && <div className="aisp-error">{error}</div>}
              <button type="button" className="cam-shutter" onClick={capture} disabled={busy}>
                {busy ? '識別中…（約 15 秒）' : '📸 拍攝名片'}
              </button>
            </>
          ) : (
            <>
              <div className="cam-result">
                <div className="cam-result-head">
                  <SvcIcon name="check-circle-2" /><span>{saveLabel}</span>
                </div>
                {[
                  ['姓名', parsed?.name || parsed?.person_name],
                  ['職位', parsed?.title || parsed?.position],
                  ['公司', parsed?.company || parsed?.organization],
                  ['電話', parsed?.phone || parsed?.mobile],
                  ['Email', parsed?.email],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k as string} className="cam-field">
                    <span>{k}</span><span>{v}</span>
                  </div>
                ))}
                {!Object.keys(parsed).length && (
                  <div className="cam-field"><span>OCR 原文</span><span>{(result as any).raw_ocr_text || '—'}</span></div>
                )}
              </div>
              <div className="cam-actions">
                <button type="button" className="retake" onClick={() => setResult(null)}><SvcIcon name="rotate-ccw" /> 重拍</button>
                <button type="button" className="save" onClick={() => { handleClose(); onSaved(personName); }}>儲存為聯絡人</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
