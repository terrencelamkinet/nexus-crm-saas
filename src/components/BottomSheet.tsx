import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div className="bs-scrim" onClick={onClose} />
      {/* Sheet */}
      <div className="bs-sheet">
        <div className="bs-header">
          <span className="bs-handle" />
          <h3 className="bs-title">{title}</h3>
          <button className="bs-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="bs-body">
          {children}
        </div>
      </div>
    </>
  );
}
