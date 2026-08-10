// ═══════════════════════════════════════════
//  ActionPreviewModal — Draft → Confirm → Execute
//  Full-screen modal overlay showing AI action
//  details with Confirm/Cancel buttons.
// ═══════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X, Loader2, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react'

interface PreviewData {
  tool_key: string
  params: Record<string, unknown>
  action_id?: string
}

interface ActionPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  preview: PreviewData | null
  onConfirm?: (action_id: string) => Promise<void>
  onReject?: (action_id: string) => Promise<void>
}

type ExecutionStatus = 'idle' | 'executing' | 'success' | 'error'

/** Pretty-print a param value for display */
function formatParamValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? t('actionPreview.yes') : t('actionPreview.no')
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 1)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Human-readable tool label derived from tool_key */
function toolLabel(toolKey: string): string {
  return toolKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export default function ActionPreviewModal({
  isOpen,
  onClose,
  preview,
  onConfirm,
  onReject,
}: ActionPreviewModalProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ExecutionStatus>('idle')
  const [feedback, setFeedback] = useState<string>('')

  // ── Reset state when modal opens with new preview ──
  useEffect(() => {
    if (isOpen) {
      setStatus('idle')
      setFeedback('')
    }
  }, [isOpen])

  // ── Escape key ──
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, status])

  // ── Lock body scroll when open ──
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // ── Backdrop click ──
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && status !== 'executing') {
        handleClose()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status]
  )

  const handleClose = useCallback(() => {
    if (status === 'executing') return // prevent close while executing
    onClose()
  }, [status, onClose])

  // ── Confirm / Execute ──
  const handleExecute = useCallback(async () => {
    if (!preview?.action_id || !onConfirm) return
    setStatus('executing')
    setFeedback('')
    try {
      await onConfirm(preview.action_id)
      setStatus('success')
      setFeedback('Action executed successfully.')
      // Auto-close after success
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err: unknown) {
      setStatus('error')
      setFeedback(
        err instanceof Error ? err.message : 'Failed to execute action.'
      )
    }
  }, [preview?.action_id, onConfirm, onClose])

  // ── Reject / Cancel ──
  const handleReject = useCallback(async () => {
    if (!preview?.action_id || !onReject) {
      handleClose()
      return
    }
    try {
      await onReject(preview.action_id)
    } catch {
      // silent — rejection is advisory
    }
    onClose()
  }, [preview?.action_id, onReject, handleClose, onClose])

  if (!isOpen || !preview) return null

  const { tool_key, params } = preview
  const paramEntries = Object.entries(params || {})

  return createPortal(
    <div className="modal-overlay" onClick={handleBackdropClick} style={{ zIndex: 1100 }}>
      <div
        className="modal !max-w-[540px]"
        onClick={e => e.stopPropagation()}
      >
        {/* ═══ Header ═══ */}
        <div className="modal-head">
          <h2 className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary inline-block" />
            {t('actionPreview.title')}
          </h2>
          <button
            className="modal-x"
            onClick={handleClose}
            disabled={status === 'executing'}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ═══ Body ═══ */}
        <div className="modal-body">
          {/* Tool name card */}
          <div
            className="rounded-xl border p-4 mb-5"
            style={{
              background: 'var(--color-surface-offset)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider mb-1"
              style={{ color: 'var(--color-text-faint)' }}>
              {t('actionPreview.tool')}
            </div>
            <div className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {toolLabel(tool_key)}
            </div>
          </div>

          {/* Parameters */}
          {paramEntries.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--color-text-faint)' }}>
                {t('actionPreview.parameters')}
              </div>
              <div className="grid gap-3">
                {paramEntries.map(([key, value]) => {
                  const formatted = formatParamValue(value, t)
                  const isLong = formatted.length > 80
                  return (
                    <div
                      key={key}
                      className="rounded-lg border px-4 py-3"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                      }}
                    >
                      <div
                        className="text-xs font-medium mb-1"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {key
                          .replace(/_/g, ' ')
                          .replace(/\b\w/g, c => c.toUpperCase())}
                      </div>
                      <div
                        className={`text-sm leading-relaxed ${
                          isLong ? 'max-h-28 overflow-y-auto whitespace-pre-wrap' : ''
                        }`}
                        style={{ color: 'var(--color-text)' }}
                      >
                        {formatted}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm py-4 text-center"
              style={{ color: 'var(--color-text-faint)' }}>
              {t('actionPreview.noParams')}
            </div>
          )}

          {/* ── Feedback banner ── */}
          {(status === 'success' || status === 'error') && feedback && (
            <div
              className={`mt-4 flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-medium animate-in ${
                status === 'success' ? 'text-success' : 'text-notification'
              }`}
              style={{
                background:
                  status === 'success'
                    ? 'var(--color-success-highlight)'
                    : 'var(--color-notification-highlight)',
              }}
            >
              {status === 'success' ? (
                <CheckCircle className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback}</span>
            </div>
          )}
        </div>

        {/* ═══ Footer ═══ */}
        <div className="modal-foot">
          <button
            className="btn-secondary"
            onClick={handleReject}
            disabled={status === 'executing'}
          >
            {t('actionPreview.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handleExecute}
            disabled={status === 'executing' || !preview.action_id}
          >
            {status === 'executing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('actionPreview.executing')}
              </>
            ) : (
              <>
                {t('actionPreview.execute')}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
