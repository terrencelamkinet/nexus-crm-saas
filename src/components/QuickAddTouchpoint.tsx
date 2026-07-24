import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { apiClient } from '../lib/api';
import BottomSheet from './BottomSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const TYPES = ['meeting', 'call', 'email', 'demo', 'follow-up', 'quote', 'other'];

export default function QuickAddTouchpoint({ open, onClose, onCreated }: Props) {
  const [type, setType] = useState('meeting');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('/api/v1/crm/touchpoints', {
        type,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setDone(true);
      setTimeout(() => { setDone(false); setTitle(''); setDescription(''); setType('meeting'); onClose(); onCreated(); }, 1200);
    } catch {}
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="New Touchpoint">
      {done ? (
        <div className="quick-success">
          <CheckCircle />
          <p>Touchpoint created!</p>
        </div>
      ) : (
        <>
          <div className="quick-field">
            <label>Type</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="quick-field">
            <label>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Discovery call" autoFocus />
          </div>
          <div className="quick-field">
            <label>Notes</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief notes…" rows={3} />
          </div>
          <button className="quick-submit" onClick={handleSubmit} disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create Touchpoint'}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
