import { useState, useRef, useCallback, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

interface Props<T extends string> {
  items: T[];
  onChange: (items: T[]) => void;
  children: (id: T) => ReactNode;
}

export default function DnDSortableGroup<T extends string>({ items, onChange, children }: Props<T>) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    id: string;
    startY: number;
    startX: number;
    ghost: HTMLElement | null;
  } | null>(null);

  const commit = useCallback((fromIdx: number, toIdx: number, dragId: string) => {
    if (fromIdx === toIdx) return;
    const next = [...items];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragId as T);
    onChange(next);
  }, [items, onChange]);

  const getDropIndex = useCallback((clientX: number, clientY: number): number => {
    if (!containerRef.current) return -1;
    const children = containerRef.current.querySelectorAll<HTMLElement>('.dnd-item');
    let bestIdx = items.length - 1;
    let bestDist = Infinity;
    children.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - cx, clientY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
      // Also check if pointer is past the midpoint of the item
      const midY = rect.top + rect.height / 2;
      if (clientY > midY && i > bestIdx) {
        // bias toward next position if below midpoint
      }
    });
    // More precise: find which gap the pointer is closest to (between items or at edges)
    let closestGap = 0;
    const first = children[0];
    let closestGapDist = first ? Math.abs(clientY - first.getBoundingClientRect().top) : Infinity;
    for (let i = 0; i < items.length; i++) {
      const el = children[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const gapY = rect.top + rect.height;
      const dist = Math.abs(clientY - gapY);
      if (dist < closestGapDist) {
        closestGapDist = dist;
        closestGap = i + 1;
      }
    }
    // If closest to top edge of first item
    if (children[0]) {
      const topEdge = children[0].getBoundingClientRect().top;
      if (Math.abs(clientY - topEdge) < closestGapDist) {
        closestGap = 0;
      }
    }
    // Clamp
    return Math.max(0, Math.min(closestGap, items.length - 1));
  }, [items]);

  // ─── POINTER DRAG (works on desktop + mobile) ───
  const handlePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    const el = (e.target as HTMLElement).closest('.dnd-item') as HTMLElement;
    if (!el) return;

    // Create ghost element
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.8';
    ghost.style.width = `${el.offsetWidth}px`;
    ghost.style.transform = 'scale(1.02)';
    ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,.15)';
    ghost.style.borderRadius = 'var(--radius-lg)';
    ghost.style.overflow = 'hidden';
    document.body.appendChild(ghost);

    const rect = el.getBoundingClientRect();
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;

    dragState.current = {
      id,
      startY: e.clientY,
      startX: e.clientX,
      ghost,
    };
    setDragging(id);
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      dragState.current.ghost!.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;

      // Find drop index
      const idx = getDropIndex(ev.clientX, ev.clientY);
      setOverIdx(idx);
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (dragState.current) {
        document.body.removeChild(dragState.current.ghost!);
        const fromIdx = items.indexOf(dragState.current.id as T);
        const idx = getDropIndex(ev.clientX, ev.clientY);
        if (fromIdx !== -1) commit(fromIdx, idx, dragState.current.id);
        dragState.current = null;
      }
      setDragging(null);
      setOverIdx(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [items, commit, getDropIndex]);

  return (
    <div className="dnd-group" ref={containerRef}>
      {items.map((id, idx) => (
        <div
          key={id}
          className={`dnd-item${dragging === id ? ' dragging' : ''}${overIdx === idx ? ' drop-target' : ''}`}
        >
          <div
            className="dnd-handle"
            onPointerDown={e => handlePointerDown(e, id)}
          >
            <GripVertical size={14} />
          </div>
          <div className="dnd-body">
            {children(id)}
          </div>
        </div>
      ))}
    </div>
  );
}
