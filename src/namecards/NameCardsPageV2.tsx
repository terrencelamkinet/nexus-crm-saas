import { useState, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDropzone } from 'react-dropzone'
import SvcIcon from '../components/SvcIcon'
import { apiClient } from '../lib/api'
import { NameCardDetailModal } from './NameCardDetailModal'
import type { NameCardRecord, NameCardTag } from './module-types'

/* ═══════════════════════════════════════════════════════════
   NameCardsPageV2 — Redesigned Name Card Gallery
   Features: quick upload (drag/camera/paste/bulk), tag filter,
   grid/list view toggle, hover quick-actions, bulk select bar,
   duplicate detection badge, unlinked-contact indicator.
   ═══════════════════════════════════════════════════════════ */

export default function NameCardsPageV2() {
  const { t } = useTranslation()
  const [cards, setCards] = useState<NameCardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailCard, setDetailCard] = useState<NameCardRecord | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const bulkInputRef = useRef<HTMLInputElement>(null)

  const allTags: NameCardTag[] = useMemo(() => {
    const seen = new Map<string, number>()
    cards.forEach(c => (c.tags || []).forEach(tg => seen.set(tg, (seen.get(tg) || 0) + 1)))
    return Array.from(seen.entries()).map(([label, count]) => ({ label, count }))
  }, [cards])

  const filteredCards = useMemo(() => {
    return cards.filter(c => {
      if (activeTag === 'unlinked' && c.contact_id) return false
      if (activeTag === 'unlinked') return matchesSearch(c, search)
      if (activeTag !== 'all' && !(c.tags || []).includes(activeTag)) return false
      return matchesSearch(c, search)
    })
  }, [cards, activeTag, search])

  function matchesSearch(c: NameCardRecord, q: string) {
    if (!q.trim()) return true
    const hay = `${c.parsed_data?.name || c.name || ''} ${c.parsed_data?.company || c.company || ''} ${c.parsed_data?.title || c.title || ''}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  }

  const fetchCards = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ items: NameCardRecord[] }>('/api/v1/crm/name-cards?page_size=200')
      setCards(res.items || [])
    } catch { /* noop */ }
    finally { setLoading(false) }
  }, [])

  useMemo(() => { fetchCards() }, [fetchCards])

  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('image', file)
        await apiClient.postForm('/api/v1/crm/name-cards/upload', formData)
      }
      await fetchCards()
    } catch (e: any) {
      setUploadError(e.detail || e.message || t('nameCard.uploadFailed', { defaultValue: '上載失敗' }))
    } finally {
      setUploading(false)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.heic'] },
    multiple: true,
    onDrop: (files) => { if (files.length) handleUpload(files) },
  })

  // Paste-to-upload support
  useMemo(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imgFiles: File[] = []
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) imgFiles.push(f)
        }
      }
      if (imgFiles.length) handleUpload(imgFiles)
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [])

  const toggleSelect = (id: string) => {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (!confirm(t('nameCard.confirmBulkDelete', { count: selected.size, defaultValue: '刪除已選 {{count}} 張名片？' }))) return
    await Promise.all(Array.from(selected).map(id => apiClient.delete(`/api/v1/crm/name-cards/${id}`)))
    setSelected(new Set())
    fetchCards()
  }

  const handleDuplicate = async (card: NameCardRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    await apiClient.post(`/api/v1/crm/name-cards/${card.id}/duplicate`, {})
    fetchCards()
  }

  const handleDelete = async (card: NameCardRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t('nameCard.confirmDelete', { defaultValue: '刪除呢張名片？' }))) return
    await apiClient.delete(`/api/v1/crm/name-cards/${card.id}`)
    fetchCards()
  }

  return (
    <div className="nc-page" {...getRootProps()} onClick={(e) => e.stopPropagation()}>
      <input {...getInputProps()} />

      <div className="nc-header">
        <div className="nc-header-top">
          <h1 className="nc-title">
            {t('nameCard.title', { defaultValue: '名片管理' })}
            <span className="nc-title-count">{t('nameCard.scannedCount', { count: cards.length, defaultValue: `${cards.length} 張名片` })}</span>
          </h1>
          <div className="nc-header-actions">
            <div className="nc-view-toggle">
              <div className={`nc-view-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')}><SvcIcon name="grid-3x3" size={16} /></div>
              <div className={`nc-view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}><SvcIcon name="list" size={16} /></div>
            </div>
            <button className="nx-btn nx-btn-primary" onClick={() => galleryInputRef.current?.click()}>
              <SvcIcon name="plus" size={14} /> {t('nameCard.addNew', { defaultValue: '新增名片' })}
            </button>
          </div>
        </div>

        {/* Quick upload dropzone */}
        <div className={`nc-dropzone ${isDragActive ? 'drag-active' : ''}`} style={{ marginBottom: 16 }}>
          <div className="nc-dropzone-icon">
            {uploading ? <span className="nx-spinner" /> : <SvcIcon name="upload-cloud" size={20} />}
          </div>
          <div className="nc-dropzone-title">
            {uploading
              ? t('nameCard.uploading', { defaultValue: '正在上載並辨識…' })
              : t('nameCard.dropHint', { defaultValue: '拖放圖片到此處，或點擊上載' })}
          </div>
          <div className="nc-dropzone-sub">{t('nameCard.dropSub', { defaultValue: '支援拍照、相簿選取、剪貼板貼上 · 上載後自動 OCR 辨識並偵測重複聯絡人' })}</div>
          {uploadError && <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 8 }}>{uploadError}</div>}
          <div className="nc-dropzone-methods">
            <div className="nc-quick-btn" title={t('nameCard.takePhoto', { defaultValue: '拍照上載' })} onClick={() => cameraInputRef.current?.click()}>
              <SvcIcon name="camera" size={14} /> <span className="nc-quick-label">{t('nameCard.takePhoto', { defaultValue: '拍照上載' })}</span>
            </div>
            <div className="nc-quick-btn" title={t('nameCard.pickGallery', { defaultValue: '相簿選取' })} onClick={() => galleryInputRef.current?.click()}>
              <SvcIcon name="image" size={14} /> <span className="nc-quick-label">{t('nameCard.pickGallery', { defaultValue: '相簿選取' })}</span>
            </div>
            <div className="nc-quick-btn" title={t('nameCard.pasteImage', { defaultValue: '貼上圖片 (Ctrl+V)' })}>
              <SvcIcon name="clipboard" size={14} /> <span className="nc-quick-label">{t('nameCard.pasteImage', { defaultValue: '貼上圖片 (Ctrl+V)' })}</span>
            </div>
            <div className="nc-quick-btn" title={t('nameCard.bulkUpload', { defaultValue: '批量上載' })} onClick={() => bulkInputRef.current?.click()}>
              <SvcIcon name="upload-cloud" size={14} /> <span className="nc-quick-label">{t('nameCard.bulkUpload', { defaultValue: '批量上載' })}</span>
            </div>
          </div>
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => e.target.files && handleUpload(e.target.files)} />
          <input ref={galleryInputRef} type="file" accept="image/*" hidden
            onChange={(e) => e.target.files && handleUpload(e.target.files)} />
          <input ref={bulkInputRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => e.target.files && handleUpload(e.target.files)} />
        </div>

        {/* Search + tag filter */}
        <div className="nc-filter-row">
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <SvcIcon name="search" size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--color-text-secondary)' }} />
            <input
              className="nc-search-input" style={{ paddingLeft: 34 }}
              placeholder={t('nameCard.searchPlaceholder', { defaultValue: '搜尋姓名、公司、職位…' })}
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="nc-tag-filter">
            <span className={`nc-tag-chip ${activeTag === 'all' ? 'active' : ''}`} onClick={() => setActiveTag('all')}>
              {t('nameCard.allTags', { defaultValue: '全部' })}
            </span>
            {allTags.map(tg => (
              <span key={tg.label} className={`nc-tag-chip ${activeTag === tg.label ? 'active' : ''}`} onClick={() => setActiveTag(tg.label)}>
                🏷 {tg.label}
              </span>
            ))}
            <span className={`nc-tag-chip ${activeTag === 'unlinked' ? 'active' : ''}`} onClick={() => setActiveTag('unlinked')}>
              <SvcIcon name="alert-triangle" size={11} /> {t('nameCard.unlinked', { defaultValue: '未連結' })}
            </span>
          </div>
        </div>
      </div>

      <div className="nc-gallery-body">
        {loading ? (
          <div className="nc-empty">{t('common.loading')}</div>
        ) : filteredCards.length === 0 ? (
          <div className="nc-empty">
            <div className="nc-empty-icon"><SvcIcon name="image" size={28} /></div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('nameCard.emptyTitle', { defaultValue: '暫無名片' })}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{t('nameCard.emptyDesc', { defaultValue: '上載第一張名片，AI 會自動辨識並建立聯絡人' })}</div>
          </div>
        ) : (
          <div className={`nc-gallery-grid ${view === 'list' ? 'list-view' : ''}`}>
            {filteredCards.map(card => {
              const pd = card.parsed_data || {}
              const isDup = !!card.duplicate_candidate
              return (
                <div className="nc-card" key={card.id} onClick={() => setDetailCard(card)}>
                  <input
                    type="checkbox" className="nc-card-checkbox"
                    checked={selected.has(card.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(card.id)}
                  />
                  <div className="nc-card-img-wrap">
                    {card.cropped_image_url || card.image_url ? (
                      <img className="nc-card-img" src={card.cropped_image_url || card.image_url} alt={pd.name || card.name} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 11 }}>
                        {t('nameCard.noImage', { defaultValue: '名片圖片' })}
                      </div>
                    )}
                    {isDup && <div className="nc-card-dup-badge"><SvcIcon name="alert-triangle" size={10} /> {t('nameCard.possibleDup', { defaultValue: '疑似重複' })}</div>}
                    <div className="nc-card-quick-actions">
                      <div className="nc-card-quick-btn" onClick={(e) => { e.stopPropagation(); setDetailCard(card) }}><SvcIcon name="pencil" size={13} /></div>
                      <div className="nc-card-quick-btn" onClick={(e) => handleDuplicate(card, e)}><SvcIcon name="copy" size={13} /></div>
                      <div className="nc-card-quick-btn" onClick={(e) => handleDelete(card, e)}><SvcIcon name="trash-2" size={13} /></div>
                    </div>
                  </div>
                  <div className="nc-card-body">
                    <div className="nc-card-name">{pd.name || card.name || t('nameCard.unrecognized', { defaultValue: '未辨識' })}</div>
                    <div className="nc-card-meta">{[pd.company || card.company, pd.title || card.title].filter(Boolean).join(' · ') || '—'}</div>
                    {(card.tags || []).length > 0 && (
                      <div className="nc-card-tags">{card.tags!.map(tg => <span className="nc-card-tag" key={tg}>{tg}</span>)}</div>
                    )}
                    {card.contact_id
                      ? <div className="nc-card-linked"><SvcIcon name="check" size={11} /> {t('nameCard.linked', { defaultValue: '已連結聯絡人' })}</div>
                      : <div className="nc-card-unlinked">○ {t('nameCard.notLinked', { defaultValue: '未連結' })}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="nc-bulk-bar">
          <span className="nc-bulk-count">{t('nameCard.selectedCount', { count: selected.size, defaultValue: `已選 ${selected.size} 張` })}</span>
          <button className="nx-btn nx-btn-secondary" style={{ height: 32 }}>{t('nameCard.addTagBulk', { defaultValue: '加 Tag' })}</button>
          <button className="nx-btn nc-btn-danger-ghost" style={{ height: 32, marginLeft: 'auto' }} onClick={handleBulkDelete}>
            <SvcIcon name="trash-2" size={13} /> {t('common.delete', { defaultValue: '刪除' })}
          </button>
        </div>
      )}

      {detailCard && (
        <NameCardDetailModal
          card={detailCard}
          onClose={() => setDetailCard(null)}
          onSaved={() => { setDetailCard(null); fetchCards() }}
          onDeleted={() => { setDetailCard(null); fetchCards() }}
        />
      )}
    </div>
  )
}
