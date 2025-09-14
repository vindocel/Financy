import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';

type Tag = { id: string; name: string; color?: string; is_builtin?: boolean };
type Props = { familyId: string; value: string[]; onChange: (ids: string[]) => void; placeholder?: string };

export default function TagMultiSelect({ familyId, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    (async () => {
      if (!familyId) return;
      try { setTags(await api.listTags()); } catch {}
    })();
  }, [familyId]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return !qq ? tags : tags.filter(t => t.name.toLowerCase().includes(qq));
  }, [q, tags]);

  function toggle(id: string) {
    const set = new Set(value);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange(Array.from(set));
  }
  function clear() { onChange([]); }

  useEffect(() => {
    function update() {
      if (!listRef.current) return;
      const r = listRef.current.getBoundingClientRect();
      setCoords({ left: Math.round(r.left), top: Math.round(r.bottom + 6), width: Math.round(r.width) });
    }
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (listRef.current?.contains(t)) return;
      if (portalRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) {
      update();
      window.addEventListener('resize', update);
      window.addEventListener('scroll', update, true);
      document.addEventListener('mousedown', onDoc);
      return () => {
        window.removeEventListener('resize', update);
        window.removeEventListener('scroll', update, true);
        document.removeEventListener('mousedown', onDoc);
      };
    }
  }, [open]);

  const selected = value.map(id => tags.find(t => t.id === id)).filter(Boolean) as Tag[];
  function tagStyle(color?: string): React.CSSProperties {
    return color ? ({ ['--tag' as any]: color } as React.CSSProperties) : ({} as React.CSSProperties);
  }

  // Measure if a text fits inside the label span
  function fits(text: string) {
    if (!labelRef.current) return false;
    const measurer = document.createElement('span');
    measurer.style.visibility = 'hidden';
    measurer.style.whiteSpace = 'nowrap';
    measurer.style.position = 'absolute';
    measurer.style.left = '-99999px';
    measurer.textContent = text;
    document.body.appendChild(measurer);
    const w = measurer.getBoundingClientRect().width;
    document.body.removeChild(measurer);
    return w <= labelRef.current.clientWidth;
  }

  function computeLabel() {
    if (selected.length === 0) return placeholder || 'Selecione tags';
    if (selected.length === 1) return selected[0].name;
    const names = selected.map(t => t.name);
    const joined = names.join(', ');
    return fits(joined) ? joined : `${names[0]} +${names.length - 1}`;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); }
  }

  return (
    <div className="dropdown selector" style={{ width: '100%' }} ref={listRef}>
      <button
        type="button"
        className="selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (!open && listRef.current) { const r = listRef.current.getBoundingClientRect(); setCoords({ left: Math.round(r.left), top: Math.round(r.bottom + 6), width: Math.round(r.width) }); } setOpen(v => !v); }}
        onKeyDown={onKeyDown}
        style={{ width: '100%', justifyContent: 'space-between' }}
        ref={triggerRef}
      >
        <div className="row" style={{ flex:1, flexWrap:'nowrap', gap:6, overflow:'hidden', minWidth:0 }}>
          {selected.length > 0 ? (
            selected.map(t => (
              <span key={t.id} className="tag-pill selected" style={tagStyle(t.color)}>
                {t.name}
                <button
                  type="button"
                  className="x"
                  onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
                  aria-label={`Remover ${t.name}`}
                >×</button>
              </span>
            ))
          ) : (
            <span ref={labelRef} className="selector-value">{placeholder || 'Filtrar por tags…'}</span>
          )}
        </div>
        <span aria-hidden>▾</span>
      </button>

      {open && (
        coords
          ? createPortal(
              <div
                ref={portalRef}
                className="dropdown-panel"
                role="listbox"
                aria-multiselectable={true}
                style={{ position: 'fixed', left: coords.left, top: coords.top, width: coords.width, right: 'auto', zIndex: 3000, minWidth: 0, maxWidth: 'none' }}
              >

                <div className="tags-grid" style={{ marginTop: '.5rem', maxHeight: 240, overflowY: 'auto', display:'flex', flexWrap:'wrap', gap: 8, padding: '0 8px 8px' }}>
                  {filtered.length === 0 ? (
                    <div className="muted" style={{ padding: 8 }}>Sem resultados</div>
                  ) : (
                    filtered.map(t => {
                      const selected = value.includes(t.id);
                      const color = t.color || 'var(--primary)';
                      const style = selected
                        ? { background: color, borderColor: '#fff', color: '#fff', borderWidth: 2 }
                        : { background: color, borderColor: 'transparent', color: '#fff' };
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={"tag-pill" + (selected ? " selected" : "")}
                          onClick={() => toggle(t.id)}
                          style={style as React.CSSProperties}
                        >
                          {t.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>,
              document.body
            )
          : (
            <div className="dropdown-panel" role="listbox" aria-multiselectable={true}>

              <div className="col" style={{ marginTop: '.5rem', maxHeight: 240, overflowY: 'auto' }}>
                {filtered.length === 0 ? (
                  <div className="muted" style={{ padding: 8 }}>Sem resultados</div>
                ) : (
                  filtered.map(t => (
                    <label key={t.id} className="row" style={{ gap: '.5rem', justifyContent: 'space-between' }}>
                      <span className="row" style={{ gap: '.5rem' }}>
                        <input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} />
                        <span>{t.name}</span>
                      </span>
                      <span className="dot" style={{ width:14, height:14, borderRadius: 999, background: t.color || 'var(--border)' }} />
                    </label>
                  ))
                )}
              </div>
            </div>
          )
      )}
    </div>
  );
}