import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';

type Tag = { id: string; name: string; color?: string };
type Props = {
  familyId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
};

function styleFor(color?: string): React.CSSProperties {
  return color ? ({ ['--tag' as any]: color } as React.CSSProperties) : {};
}

export default function TagMultiSelect({ familyId, value, onChange, placeholder }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const list = await api.listTags();
        if (ok) setTags(list || []);
      } catch {}
    })();
    return () => { ok = false; };
  }, [familyId]);

  const selected = useMemo(() => new Set(value || []), [value]);
  const selectedTags = useMemo(
    () => tags.filter(t => selected.has(t.id)),
    [tags, selected]
  );

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(Array.from(next));
  }

  function computeCoords() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ left: Math.round(r.left), top: Math.round(r.bottom + 6), width: Math.round(r.width) });
  }

  useLayoutEffect(() => { if (open) computeCoords(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const fn = () => computeCoords();
    window.addEventListener('resize', fn);
    window.addEventListener('scroll', fn, true);
    return () => { window.removeEventListener('resize', fn); window.removeEventListener('scroll', fn, true); };
  }, [open]);

  // fechar fora/ESC
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const menu = document.getElementById('tagms-popover');
      if (!menu || !triggerRef.current) return;
      if (e.target instanceof Node && !menu.contains(e.target) && !triggerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="tagms">
      <button
        ref={triggerRef}
        type="button"
        className="selector selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="selector-value tagchips-inline">
          {selectedTags.length === 0 ? (
            <span className="placeholder">{placeholder || 'Filtrar por tags…'}</span>
          ) : (
            selectedTags.map(t => (
              <span key={t.id} className="tag-chip-mini" style={styleFor(t.color)} title={t.name}>
                {t.name}
              </span>
            ))
          )}
        </span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>

      {open && coords && createPortal(
        <div
          id="tagms-popover"
          className="tagms-popover"
          style={{ left: coords.left, top: coords.top, minWidth: coords.width }}
        >
          <div className="dropdown-panel">
            <div className="tagms-badges" role="listbox" aria-multiselectable="true">
              {tags.length === 0 ? (
                <div className="muted" style={{ padding: 8 }}>Nenhuma tag.</div>
              ) : tags.map(t => {
                const isSel = selected.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={`tag-badge${isSel ? ' selected' : ''}`}
                    style={styleFor(t.color)}
                    onClick={() => toggle(t.id)}
                    title={t.name}
                  >
                    <span className="label">{t.name}</span>
                    {isSel && <span className="x" aria-hidden>×</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
