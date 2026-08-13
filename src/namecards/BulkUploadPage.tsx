import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, X, Check, AlertTriangle, RotateCw, Tag as TagIcon, ArrowRight } from 'lucide-react'
import { apiClient } from '../lib/api'

/* ═══════════════════════════════════════════════════════════
   BulkUploadPage — 批量上載名片專屬頁面
   Features: multi-file queue with per-item progress, retry,
   pre-assign tags to whole batch, live OCR result preview,
   duplicate warnings surfaced inline, cancel/pause queue.
   ═══════════════════════════════════════════════════════════ */

type QueueStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error' | 'duplicate'

interface QueueItem {
  id: string
  file: File
  previewUrl: string
  status: QueueStatus
  progress: number
  errorMsg?: string
  parsed?: { name?: string; company?: string; title?: string }
  duplicateReason?: string
}

let idCounter = 0

export default function BulkUploadPage() {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [batchTags, setBatchTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const abortRef = useRef(false)

  const addFiles = useCallback((files: File[]) => {
    const items: QueueItem[] = files.map(f => ({
      id: `qi-${++idCounter}`,
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: 'queued',
      progress: 0,
    }))
    setQueue(q => [...q, ...items])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.heic'] },
    multiple: true,
    onDrop: addFiles,
  })

  const removeItem = (id: string) => setQueue(q => q.filter(it => it.id !== id))
  const retryItem = (id: string) => setQueue(q => q.map(it => it.id === id ? { ...it, status: 'queued', progress: 0, errorMsg: undefined } : it))

  const addBatchTag = () => {
    const v = tagInput.trim()
    if (v && !batchTags.includes(v)) setBatchTags(t => [...t, v])
    setTagInput('')
  }

  /* ═══ Core upload loop — processes queue sequentially with
     concurrency cap, so mobile connections don't choke ═══ */
  const startUpload = async () => {
    setIsProcessing(true)
    abortRef.current = false
    const CONCURRENCY = 3
    const pending = queue.filter(it => it.status === 'queued')
    let cursor = 0

    const worker = async () => {
      while (cursor < pending.length) {
        if (abortRef.current) return
        const item = pending[cursor++]
        await uploadOne(item)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setIsProcessing(false)
  }

  const uploadOne = async (item: QueueItem) => {
    setQueue(q => q.map(it => it.id === item.id ? { ...it, status: 'uploading', progress: 10 } : it))
    try {
      const formData = new FormData()
      formData.append('image', item.file)
      if (batchTags.length) formData.append('tags', JSON.stringify(batchTags))

      // Upload returns the OCR'd card synchronously (existing backend behaviour).
      // Per-item progress is simulated client-side since the upload API returns
      // after OCR completes; real XHR progress could be added later.
      const res = await apiClient.postForm('/api/v1/crm/name-cards/upload', formData)

      setQueue(q => q.map(it => it.id === item.id ? { ...it, status: 'processing', progress: 75 } : it))

      // Poll or receive synchronous OCR result from response
      const parsed = res.parsed_data || {}
      const isDup = !!res.duplicate_candidate

      setQueue(q => q.map(it => it.id === item.id ? {
        ...it,
        status: isDup ? 'duplicate' : 'done',
        progress: 100,
        parsed,
        duplicateReason: res.duplicate_candidate?.reason,
      } : it))
    } catch (e: any) {
      setQueue(q => q.map(it => it.id === item.id ? {
        ...it, status: 'error', progress: 0, errorMsg: e.detail || e.message || t('nameCard.uploadFailed', { defaultValue: '上載失敗' }),
      } : it))
    }
  }

  const cancelAll = () => { abortRef.current = true; setIsProcessing(false) }
  const clearDone = () => setQueue(q => q.filter(it => it.status !== 'done'))

  const stats = {
    total: queue.length,
    done: queue.filter(i => i.status === 'done').length,
    error: queue.filter(i => i.status === 'error').length,
    dup: queue.filter(i => i.status === 'duplicate').length,
    pending: queue.filter(i => i.status === 'queued' || i.status === 'uploading' || i.status === 'processing').length,
  }

  return (
    <div className="nc-bulk-page">
      <div className="nc-bulk-header">
        <h1 className="nc-title">{t('nameCard.bulkTitle', { defaultValue: '批量上載名片' })}</h1>
        <div className="nc-bulk-stats">
          <span className="nc-stat-pill">{t('nameCard.total', { defaultValue: '總數' })} {stats.total}</span>
          <span className="nc-stat-pill success">{t('nameCard.done', { defaultValue: '完成' })} {stats.done}</span>
          {stats.dup > 0 && <span className="nc-stat-pill warn">{t('nameCard.dupFound', { defaultValue: '疑似重複' })} {stats.dup}</span>}
          {stats.error > 0 && <span className="nc-stat-pill danger">{t('nameCard.failed', { defaultValue: '失敗' })} {stats.error}</span>}
        </div>
      </div>

      {/* ═══ Big dropzone for batch selection ═══ */}
      <div {...getRootProps()} className={`nc-bulk-dropzone ${isDragActive ? 'drag-active' : ''}`}>
        <input {...getInputProps()} />
        <div className="nc-dropzone-icon" style={{ width: 56, height: 56, margin: '0 auto 14px' }}>
          <UploadCloud size={26} />
        </div>
        <div className="nc-dropzone-title" style={{ fontSize: 15 }}>
          {t('nameCard.bulkDropHint', { defaultValue: '拖放多張名片圖片到此處，或點擊選擇' })}
        </div>
        <div className="nc-dropzone-sub">{t('nameCard.bulkDropSub', { defaultValue: '支援一次選取數十張圖片，最大單檔 15MB' })}</div>
      </div>

      {/* ═══ Batch tag pre-assignment ═══ */}
      <div className="nc-batch-tag-row">
        <span className="nc-batch-tag-label"><TagIcon size={13} /> {t('nameCard.applyTagsToAll', { defaultValue: '批量套用 Tag' })}</span>
        <div className="nc-detail-tags-edit" style={{ margin: 0 }}>
          {batchTags.map(tg => (
            <span className="nc-tag-editable" key={tg}>
              🏷 {tg} <span className="nc-tag-remove" onClick={() => setBatchTags(batchTags.filter(x => x !== tg))}>✕</span>
            </span>
          ))}
          <input
            className="nc-tag-add-input" placeholder={t('common.addTag', { defaultValue: '+ 新增' })}
            value={tagInput} onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBatchTag() }} onBlur={addBatchTag}
          />
        </div>
      </div>

      {/* ═══ Queue list ═══ */}
      {queue.length > 0 && (
        <div className="nc-bulk-queue">
          {queue.map(item => (
            <div className="nc-queue-row" key={item.id}>
              <img src={item.previewUrl} className="nc-queue-thumb" alt="" />
              <div className="nc-queue-info">
                <div className="nc-queue-name">
                  {item.parsed?.name || item.file.name}
                  {item.status === 'duplicate' && <span className="nc-queue-dup-tag"><AlertTriangle size={10} /> {t('nameCard.possibleDup', { defaultValue: '疑似重複' })}</span>}
                </div>
                <div className="nc-queue-meta">
                  {item.status === 'error'
                    ? <span style={{ color: 'var(--color-danger)' }}>{item.errorMsg}</span>
                    : item.status === 'duplicate'
                    ? <span style={{ color: '#f59e0b' }}>{item.duplicateReason || t('nameCard.dupWarning', { defaultValue: 'AI 發現可能重複' })}</span>
                    : [item.parsed?.company, item.parsed?.title].filter(Boolean).join(' · ') || statusLabel(item.status, t)}
                </div>
                {(item.status === 'uploading' || item.status === 'processing') && (
                  <div className="nc-queue-progress-track"><div className="nc-queue-progress-fill" style={{ width: `${item.progress}%` }} /></div>
                )}
              </div>
              <div className="nc-queue-status-icon">
                {item.status === 'done' && <Check size={16} color="var(--color-success)" />}
                {item.status === 'duplicate' && <AlertTriangle size={16} color="#f59e0b" />}
                {item.status === 'error' && (
                  <div className="nc-card-quick-btn" onClick={() => retryItem(item.id)} title="Retry"><RotateCw size={13} /></div>
                )}
                {(item.status === 'queued') && <div className="nc-queue-spinner-idle" />}
                {(item.status === 'uploading' || item.status === 'processing') && <div className="nc-queue-spinner" />}
              </div>
              <div className="nc-card-quick-btn" onClick={() => removeItem(item.id)}><X size={13} /></div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Action bar ═══ */}
      <div className="nc-bulk-actions">
        {queue.length > 0 && stats.done > 0 && (
          <button className="nx-btn nx-btn-secondary" onClick={clearDone}>{t('nameCard.clearDone', { defaultValue: '清除已完成' })}</button>
        )}
        {isProcessing ? (
          <button className="nx-btn nc-btn-danger-ghost" onClick={cancelAll}>{t('common.cancel', { defaultValue: '取消上載' })}</button>
        ) : (
          <button className="nx-btn nx-btn-primary" disabled={stats.pending === 0} onClick={startUpload}>
            <ArrowRight size={14} /> {t('nameCard.startUpload', { defaultValue: '開始上載' })} ({stats.pending})
          </button>
        )}
      </div>
    </div>
  )
}

function statusLabel(s: QueueStatus, t: any) {
  switch (s) {
    case 'queued': return t('nameCard.statusQueued', { defaultValue: '等待上載…' })
    case 'uploading': return t('nameCard.statusUploading', { defaultValue: '正在上載…' })
    case 'processing': return t('nameCard.statusProcessing', { defaultValue: 'AI 正在辨識…' })
    default: return ''
  }
}
