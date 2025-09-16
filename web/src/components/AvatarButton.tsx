import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  name: string;
  email?: string | null;
  src?: string | null;
  onOpenProfile?: () => void;
  onLogout?: () => void;
};

/** get the first visible letter of a name */
function firstLetter(name?: string | null) {
  if (!name) return '?';
  const m = name.trim().match(/^[A-Za-zÀ-ÿ0-9]/);
  return (m ? m[0] : name.trim().charAt(0) || '?').toUpperCase();
}

function useClickAway<T extends HTMLElement>(ref: React.RefObject<T>, onAway: () => void, when = true) {
  useEffect(() => {
    if (!when) return;
function onDoc(e: MouseEvent) {
      if (!ref.current) return;
if (!ref.current.contains(e.target as Node)) onAway();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onAway();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [ref, onAway, when]);
}

export default function AvatarButton({ name, email, src, onOpenProfile, onLogout }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; w: number } | null>(null);

  function updateCoords() {
  const el = btnRef.current;
  if (!el) return;
const r = el.getBoundingClientRect();
  // Menu width: at least 220px or button width
  const menuW = Math.max(220, Math.round(r.width));
  // Prefer right aligned under the button
  let left = Math.round(r.right - menuW);
  // Clamp to viewport with 12px margins
  const margin = 12;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuW - margin));
  const top = Math.round(r.bottom + 10);
  setCoords({ left, top, w: menuW });
  }

  useLayoutEffect(() => { if (open) updateCoords(); }, [open]);
  useEffect(() => {
    if (!open) return;
function onResize() { updateCoords(); }
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  }, [open]);

  useClickAway(menuRef, () => setOpen(false), open);

  // theme helpers (visual mark only – user will wire real theme later)
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const t = (localStorage.getItem('theme-mode') as any) || 'system';
    return (t === 'light' || t === 'dark') ? t : 'system';
  });
  function pickTheme(t: 'system' | 'light' | 'dark') {
    setTheme(t);
    localStorage.setItem('theme-mode', t);
    setOpen(false);
    setThemeOpen(false);
  }

  return (
    <>
      <button ref={btnRef} className="avatar-btn" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar-wrap" aria-hidden="true">
          {src ? <img className="avatar-img" src={src} alt="" /> : <span className="avatar-fallback">{firstLetter(name)}</span>}
        </span>
      </button>

      {open && coords && createPortal(
        <div className="avatar-overlay">
          <div
            ref={menuRef}
            className="avatar-menu"
            role="menu"
            style={{ position: 'fixed', left: coords.left, top: coords.top, minWidth: Math.max(220, coords.w) }}
          >
            {!themeOpen ? (
              <>
                <div className="avatar-header">
                  <span className="avatar-wrap">
                    {src ? <img className="avatar-img" src={src} alt="" /> : <span className="avatar-fallback">{firstLetter(name)}</span>}
                  </span>
                  <div className="avatar-meta">
                    <strong className="name">{name || 'Usuário'}</strong>
                    {email ? <span className="email">{email}</span> : null}
                  </div>
                </div>

                <button className="avatar-item" onClick={() => { setOpen(false); onOpenProfile?.(); }}>
                  <span className="icon">⚙️</span> Configurações da Conta
                </button>

                <button className="avatar-item" onClick={() => setThemeOpen(true)}>
                  <span className="icon">🖥️</span> Tema
                </button>

                <div className="avatar-sep" />

                <button className="avatar-item" onClick={() => { setOpen(false); onLogout?.(); }}>
                  <span className="icon">🚪</span> Deslogar
                </button>
              </>
            ) : (
              <>
                <button className="avatar-back" onClick={() => setThemeOpen(false)}>← Voltar</button>
                <button className="avatar-item" aria-checked={theme==='system'} role="menuitemradio" onClick={() => pickTheme('system')}>
                  <span className="icon">⚙️</span> Sistema {theme==='system' ? '✓' : ''}
                </button>
                <button className="avatar-item" aria-checked={theme==='light'} role="menuitemradio" onClick={() => pickTheme('light')}>
                  <span className="icon">🌞</span> Claro {theme==='light' ? '✓' : ''}
                </button>
                <button className="avatar-item" aria-checked={theme==='dark'} role="menuitemradio" onClick={() => pickTheme('dark')}>
                  <span className="icon">🌙</span> Escuro {theme==='dark' ? '✓' : ''}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
