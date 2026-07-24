import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Fix iOS keyboard pushing fixed-position sheet out of view
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current;
    if (!el) return;
    const update = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const kh = window.innerHeight - vv.height; // keyboard height
      if (kh > 80) {
        el.style.bottom = kh + 'px';
        el.style.maxHeight = Math.min(vv.height * 0.8, window.innerHeight - kh) + 'px';
      } else {
        el.style.bottom = '0px';
        el.style.maxHeight = '';
      }
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    return () => window.visualViewport?.removeEventListener('resize', update);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="bs-scrim" onClick={onClose} />
      <div className="bs-sheet" ref={sheetRef}>
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
