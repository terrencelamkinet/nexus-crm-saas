import { Sparkles } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════
   FollowUpChips — Perplexity-style "related questions" strip
   shown beneath every AI answer, encouraging deeper multi-turn
   exploration without retyping[cite:750][cite:761].
   ═══════════════════════════════════════════════════════════ */

export default function FollowUpChips({ suggestions, onSelect }: {
  suggestions: string[]; onSelect: (question: string) => void
}) {
  if (!suggestions.length) return null
  return (
    <div className="nca-followups">
      <span className="nca-followups-label"><Sparkles size={11} /> 你可能想問</span>
      <div className="nca-followups-chips">
        {suggestions.map((q, i) => (
          <button key={i} className="nca-followup-chip" onClick={() => onSelect(q)}>{q}</button>
        ))}
      </div>
    </div>
  )
}
