import { useState } from 'react'
import { Sparkles, Loader2, Check } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════
   AutofillButton — mirrors Notion AI Database Autofill: reads
   the current record's linked content (touchpoints, notes,
   emails) and generates a value for a single field on demand
   [cite:752][cite:758]. Attach next to any field label.
   ═══════════════════════════════════════════════════════════ */

export type AutofillMode = 'summary' | 'tags' | 'key_info' | 'custom'

export default function AutofillButton({ mode = 'summary', onRun }: {
  mode?: AutofillMode
  onRun: (mode: AutofillMode) => Promise<void>
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')

  const handleClick = async () => {
    setState('running')
    await onRun(mode)
    setState('done')
    setTimeout(() => setState('idle'), 1800)
  }

  return (
    <button className={`nca-autofill-btn ${state}`} onClick={handleClick} disabled={state === 'running'}>
      {state === 'idle' && <><Sparkles size={12} /> AI 填寫</>}
      {state === 'running' && <><Loader2 size={12} className="nca-spin" /> 生成中…</>}
      {state === 'done' && <><Check size={12} /> 已完成</>}
    </button>
  )
}
