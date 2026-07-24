import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { apiClient } from '../lib/api';
import BottomSheet from './BottomSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

export default function QuickAddTask({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('/api/v1/crm/tasks', {
        title: title.trim(),
        priority,
        description: description.trim() || undefined,
        status: 'pending',
      });
      setDone(true);
      setTimeout(() => { setDone(false); setTitle(''); setPriority('P2'); setDescription(''); onClose(); onCreated(); }, 1200);
    } catch {}
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="New Task">
      {done ? (
        <div className="quick-success">
          <CheckCircle />
          <p>Task created!</p>
        </div>
      ) : (
        <>
          <div className="quick-field">
            <label>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
          </div>
          <div className="quick-field">
            <label>Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="quick-field">
            <label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Details…" rows={3} />
          </div>
          <button className="quick-submit" onClick={handleSubmit} disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create Task'}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
