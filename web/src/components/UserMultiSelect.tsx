import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import pt from '@/i18n/pt.json';

type Member = { id: string; display_name: string; role: string; is_active: boolean };
type Props = { familyId: string; value: string[]; onChange: (ids: string[]) => void; onModeChange?: (mode: { allActiveSelected: boolean; excludedIds: string[] }) => void };

export default function UserMultiSelect({ familyId, value, onChange, onModeChange }: Props) {
  const t = pt.selector;
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [special, setSpecial] = useState<{ deactivated_user_id: string | null; has_purchases: boolean } | null>(null);
  const [q, setQ] = useState('');
  const [allActiveSelected, setAllActiveSelected] = useState(false);
  const [excludedIds, setExcluded] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const labelRef = useRef<HTMLSpanElement>(null);
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

  const activeIds = useMemo(() => members.filter(m => m.is_active).map(m => m.id), [members]);
  const showDeactivated = !!(special && special.deactivated_user_id && special.has_purchases);
  const filteredMembers = useMemo(() => {
    // Sorted and filtered by name; keeps UI alinhada
    const qn = q.trim().toLowerCase();
    const list = members
      .slice()
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      .filter(m => (m.display_name || '').toLowerCase().includes(qn));
    return list;
  }, [members, q]);

  useEffect(() => { (async () => { try { setMembers(await api.listMembers(familyId, true)); setSpecial(await api.specialUsers(familyId)); } catch {} })(); }, [familyId]);

  function computeLabel() {
  // mantém o comportamento do modo "Todos menos N", se existir no seu componente
      if (allActiveSelected) {
        const n = excludedIds.size;
        return n === 0 ? t.all : t.all_minus.replace('{n}', String(n));
      }

      // value = ids selecionados; members = vindos da API
      const selectedNames = value
        .map(id => members.find(m => m.id === id)?.display_name || '')
        .filter(Boolean);

      if (selectedNames.length === 0) return 'Usuários';       // placeholder
      if (selectedNames.length === 1) return selectedNames[0]; // 1 nome

      const joined = selectedNames.join(' ');
      return fits(joined) ? joined : (selectedNames[0] + ' +'); // 2+ nomes
    }



  function toggleAll() {
    if (allActiveSelected && excludedIds.size === 0) {
      setAllActiveSelected(false); onChange([]); onModeChange?.({ allActiveSelected: false, excludedIds: [] });
    } else {
      setAllActiveSelected(true); setExcluded(new Set()); onChange(activeIds.slice()); onModeChange?.({ allActiveSelected: true, excludedIds: [] });
    }
  }
  function clearAll() { setAllActiveSelected(false); setExcluded(new Set()); onChange([]); onModeChange?.({ allActiveSelected: false, excludedIds: [] }); }
  function invert() {
    if (allActiveSelected) {
      const next = new Set<string>();
      activeIds.forEach((id) => { if (!excludedIds.has(id)) next.add(id); });
      setAllActiveSelected(false); setExcluded(new Set()); onChange(Array.from(next)); onModeChange?.({ allActiveSelected: false, excludedIds: [] });
    } else {
      const next = new Set(activeIds);
      value.forEach((id) => next.delete(id));
      setAllActiveSelected(true); setExcluded(next); onChange(activeIds.filter((id) => !next.has(id))); onModeChange?.({ allActiveSelected: true, excludedIds: Array.from(next) });
    }
  }

  function onToggle(id: string) {
    if (allActiveSelected) {
      const ex = new Set(excludedIds);
      if (ex.has(id)) ex.delete(id); else ex.add(id);
      setExcluded(ex);
      onChange(activeIds.filter((x) => !ex.has(x))); onModeChange?.({ allActiveSelected: true, excludedIds: Array.from(ex) });
    } else {
      const set = new Set(value);
      if (set.has(id)) set.delete(id); else set.add(id);
      onChange(Array.from(set)); onModeChange?.({ allActiveSelected: false, excludedIds: [] });
    }
  }

  // keyboard navigation basics
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); }
  }

  // Simple virtualization for large lists
  const [scrollTop, setScrollTop] = useState(0);
  const rowH = 36; // px
  const virtEnabled = filteredMembers.length > 200;
  const viewportH = 280;
  const start = virtEnabled ? Math.max(0, Math.floor(scrollTop / rowH) - 5) : 0;
  const end = virtEnabled ? Math.min(filteredMembers.length, start + Math.ceil(viewportH / rowH) + 10) : filteredMembers.length;
  const visible = filteredMembers.slice(start, end);
  const beforePad = virtEnabled ? start * rowH : 0;
  const afterPad = virtEnabled ? (filteredMembers.length - end) * rowH : 0;

  return (
    <div className="dropdown selector" style={{ width: '100%' }}>
       <button className="selector-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onKeyDown={onKeyDown}
          onClick={() => setOpen(v => !v)}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '.5rem',
            flexWrap: 'nowrap', // mantém uma linha
          }}
        >
          <span
            ref={labelRef}
            className="selector-value"
            style={{ flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {computeLabel()}
          </span>
          <span aria-hidden>▾</span>
        </button>


      {open && (
        <div className="dropdown-panel" role="listbox" aria-multiselectable={true} ref={listRef} onScroll={(e)=> setScrollTop((e.target as HTMLDivElement).scrollTop)} style={virtEnabled ? { maxHeight: viewportH } : undefined}>
          {/* Busca opcional (mantida oculta por padrão) */}
          <div className="field" style={{ display:'none' }}><label htmlFor="usr-q" className="sr-only">{t.search}</label><input id="usr-q" placeholder={t.search} value={q} onChange={(e)=>setQ(e.target.value)} autoFocus /></div>

          {/* Pills */}
          <div className="tags-grid" style={{ marginTop: '.5rem', display:'flex', flexWrap:'wrap', gap: 8, padding: '0 8px 8px' }}>
            {/* Todos */}
            <button
              type="button"
              className={"tag-pill" + ((allActiveSelected && excludedIds.size === 0) ? ' selected' : '')}
              onClick={toggleAll}
            >
              {t.all}
            </button>

            {/* membros visíveis (virtualizados) */}
            {visible.map((m) => {
              const selected = allActiveSelected ? !excludedIds.has(m.id) : value.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={"tag-pill" + (selected ? ' selected' : '')}
                  onClick={() => onToggle(m.id)}
                >
                  {m.display_name}
                </button>
              );
            })}

            {/* Usuário desativado (se existir e tiver compras) */}
            {showDeactivated && special?.deactivated_user_id && (
              <button
                type="button"
                className={"tag-pill" + (value.includes(String(special.deactivated_user_id)) ? ' selected' : '')}
                onClick={() => onToggle(String(special.deactivated_user_id))}
              >
                {t.deactivated}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
