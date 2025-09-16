import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import pt from '@/i18n/pt.json';
import { api, buildUsersQueryParam } from '@/lib/api';
import { lsGet, lsSet } from '@/lib/storage';
import { useAuth } from '@/lib/auth';
import UserMultiSelect from '@/components/UserMultiSelect';
import NotificationsBell from '@/components/NotificationsBell';
import { MTP_OPTIONS } from '@/constants/mtp';
import TagMultiSelect from '@/components/TagMultiSelect';
import MemberExitModal from '@/components/MemberExitModal';

// Avatar
import AvatarButton from '@/components/AvatarButton';
import AvatarUploader from '@/components/AvatarUploader';

type Filters = {
  month: string;
  tags: string[];
  mtp?: string;
  users: string[];
  allActiveSelected: boolean;
  excludedIds: string[];
};

type PurchaseItem = { name: string; qty: string | number; total: string | number };

type PurchaseForm = {
  estabelecimento: string;
  emissao: string;
  total: string;
  discount: string;
  items: PurchaseItem[];
  tags: string[];
  mtp: string;
  // ==== PATCH: campos de pagamento ====
  pagamento_tipo: 'avista' | 'parcelado';
  pagamento_parcelas: number;
};

type AnyObj = Record<string, any>;

function brl(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  const val = isNaN(v as number) ? 0 : (v as number);
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dmy(d: string | Date | undefined | null) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
const normalize = (s: any) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const parseMoney = (s:any) => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s).trim();
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && !hasDot) return Number(str.replace(/\./g,'').replace(',','.')) || 0;
  if (hasDot && !hasComma) return Number(str) || 0;
  return Number(str.replace(/\./g,'').replace(',','.')) || 0;
};
const round2 = (n:number) => Math.round(n*100)/100;
const parseQty = (s:any) => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const n = String(s).replace(',', '.');
  const v = Number(n);
  return isNaN(v) ? 0 : v;
};

function tagStyle(color?: string): React.CSSProperties {
  return color ? ({ ['--tag' as any]: color } as React.CSSProperties) : {};
}
const MTP_COLOR: Record<string, string> = {
  credito:  '#1d4ed8',
  debito:   '#0f766e',
  dinheiro: '#065f46',
  pix:      '#365314',
  ticket:   '#7c2d12',
};
const mtpColor = (v?: string) =>
  MTP_COLOR[normalize(v||'')] || '#4b5563';

export default function Panel() {
  const t = pt.panel; const nav = useNavigate();
  const { user, logout } = useAuth();

  const [family, setFamily] = useState<{ id: string; slug: string; name: string; role?: string } | null>(null);

  const [filters, setFilters] = useState<Filters>(() =>
    lsGet<Filters>('filters:__tmp__', {
      month: new Date().toISOString().slice(0,7),
      tags: [] as string[],
      mtp: 'all',
      users: [],
      allActiveSelected: true,
      excludedIds: []
    })
  );

  const [purchasesParcelas, setPurchasesParcelas] = useState<any[]>([]);
  const [purchasesCompras, setPurchasesCompras] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [gate, setGate] = useState<
    | { mode: 'none' }
    | { mode: 'create_or_join' }
    | { mode: 'pending_admin'; familyId: string; name?: string }
    | { mode: 'pending_owner'; joinId: string; familyId: string; name?: string }
  >({ mode: 'create_or_join' });

  // criação
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<PurchaseForm>({
    estabelecimento: '',
    emissao: new Date().toISOString().slice(0,16),
    total: '',
    discount: '',
    items: [{ name: '', qty: '1', total: '' }],
    tags: [] as string[],
    mtp: 'Dinheiro',
    // ==== PATCH: estado inicial dos campos de pagamento ====
    pagamento_tipo: 'avista',
    pagamento_parcelas: 1,
  });
  const [touchedTotal, setTouchedTotal] = useState(false);

  useEffect(() => {
    if (!touchedTotal) {
      const sumItems = (form.items || []).reduce((acc:any, it:any)=> acc + parseMoney(it.total||0), 0);
      const total = round2(sumItems - parseMoney(form.discount||0));
      if (!isNaN(total)) setForm(f=>({...f, total: String(total)}));
    }
  }, [JSON.stringify(form.items), form.discount, touchedTotal]);

  // ==== PATCH: normalizar quando MTP mudar (se não for crédito => volta para à vista) ====
  useEffect(() => {
    setForm((f) => {
      const isCredito = /credito/.test(normalize(f.mtp));
      if (!isCredito) {
        return { ...f, pagamento_tipo: 'avista', pagamento_parcelas: 1 };
      }
      if (f.pagamento_tipo !== 'avista' && f.pagamento_tipo !== 'parcelado') {
        return { ...f, pagamento_tipo: 'avista' };
      }
      return f;
    });
  }, [form.mtp]);

  // Perfil/Config
  const [profile, setProfile] = useState<{ display_name: string; email: string; avatar_url?: string | null }>({
    display_name: '', email: '', avatar_url: null
  });
  const [profileTab, setProfileTab] = useState<'perfil'|'seg'|'tags'|'familia'>('perfil');
  const [showFamilyId, setShowFamilyId] = useState(false);
  const [copiedFamilyId, setCopiedFamilyId] = useState(false);
  const [members, setMembers] = useState<Array<{ id: string; display_name: string; role: string; is_active: boolean }>>([]);
  const [myId, setMyId] = useState<string>('');
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        const myId = (me as any).id ?? (me as any).user_id ?? (me as any).userId ?? '';
        setMyId(String(myId));
        if (me.access && !me.access.allowed) {
          if (me.access.waiting === 'admin_approval' && me.access.family?.id) {
            setGate({ mode: 'pending_admin', familyId: me.access.family.id, name: me.access.family.name });
          } else if (me.access.waiting === 'owner_approval') {
            try {
              const mine = await api.mineJoinRequests();
              const pend = (mine || []).find((x: any) => x.status === 'pending');
              if (pend) setGate({ mode: 'pending_owner', joinId: pend.id, familyId: pend.family_id, name: pend.name });
              else setGate({ mode: 'create_or_join' });
            } catch { setGate({ mode: 'create_or_join' }); }
          } else {
            setGate({ mode: 'create_or_join' });
          }
          setFamily(null);
          return;
        }
        const fam = await api.familiesMine();
        if (!fam) { setGate({ mode: 'create_or_join' }); return; }
        setGate({ mode: 'none' });
        setFamily({ ...fam, role: fam.role || me.access?.family?.role });

        const localAvatar = localStorage.getItem('me:avatar_url');
        setProfile({
          display_name: (me as any).displayName || (me as any).display_name || '',
          email: (me as any).email || '',
          avatar_url: (me as any).avatarUrl || (me as any).avatar_url || localAvatar || null
        });

        const saved = lsGet<Filters>(`filters:${fam.id}`, {
          month: new Date().toISOString().slice(0,7),
          tags: [],
          mtp: 'all',
          users: [],
          allActiveSelected: true,
          excludedIds: []
        });
        setFilters(saved);
      } catch {
        nav('/login', { replace: true });
      }
    })().catch(()=>{});
  }, [nav]);

  useEffect(() => {
    (async () => {
      if (profileTab !== 'familia' || !family?.id) return;
      try { setMembers(await api.listMembers(family.id, true)); } catch {}
    })();
  }, [profileTab, family?.id]);

  const usersParam = useMemo(
    () => buildUsersQueryParam(filters.allActiveSelected, new Set(filters.excludedIds), [], filters.users),
    [filters]
  );

  async function reload() {
    if (!family) return; setLoading(true);
    try {
      const qBase: any = { month: filters.month };
      if (usersParam) qBase['users[]'] = usersParam;
      else if (filters.allActiveSelected && (filters.excludedIds?.length || 0) === 0) qBase.user = 'all';
      if (filters.tags?.length) qBase['tags[]'] = filters.tags;
      if (filters.mtp && filters.mtp !== 'all') qBase.mtp = filters.mtp;
      const [rParc, rComp] = await Promise.all([
        api.listPurchases({ ...qBase, view: 'parcelas' }),
        api.listPurchases({ ...qBase, view: 'compras' }),
      ]);
      setPurchasesParcelas(rParc.purchases || []);
      setPurchasesCompras(rComp.purchases || []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => {
    if (!family?.id) return;
    lsSet(`filters:${family.id}`, filters);
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    family?.id,
    filters.month,
    filters.mtp,
    JSON.stringify(filters.users),
    JSON.stringify(filters.tags),
    filters.allActiveSelected,
    JSON.stringify(filters.excludedIds),
  ]);

  const [tabView, setTabView] = useState<'parcelas'|'compras'>('parcelas');
  const [asCards, setAsCards] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  const parcelas = useMemo(() => {
    return (purchasesParcelas || []).map((p:any) => {
      const usuario = p.user_name || p.usuario || p.created_by_name || p.created_by || p.createdBy || '';
      const estabelecimento = p.estabelecimento || p.store || p.merchant || '—';
      const idx = p.installment_idx ?? p.n ?? 1;
      const count = p.installment_count ?? p.pagamento_parcelas ?? 1;
      const valor = p.total_month ?? p.amount ?? p.valor ?? p.total ?? 0;
      const data = p.vencimento || p.emissao || p.due_date || p.date || p.created_at;
      return {
        id: p.row_key || `${p.id || p.purchase_id}#${idx}`,
        date: data,
        estabelecimento,
        parcela: `${idx}/${count}`,
        valor: Number(valor),
        usuario,
      };
    });
  }, [purchasesCompras]);

  const compras = useMemo(() => {
    const byId = new Map<string, AnyObj>();
    (purchasesCompras || []).forEach((r:AnyObj) => {
      const id = String(r.id || r.purchase_id || r.row_key || Math.random());
      const cur = byId.get(id) || {
        id,
        estabelecimento: r.estabelecimento || r.store || '—',
        emissao: r.emissao || r.vencimento || r.created_at,
        createdBy: r.createdBy || r.created_by || r.created_by_name || r.user_name || r.username || r.usuario || '',
        createdByUserId: r.created_by_user_id || r.createdByUserId || r.user_id || r.userId || '',
        total: 0,
        discount: 0,
        tags: r.tags || [],
        mtp: r.mtp || '',
        pagamento_tipo: r.pagamento_tipo || (r.pagamento_parcelas && r.pagamento_parcelas > 1 ? 'parcelado' : 'avista'),
        pagamento_parcelas: r.pagamento_parcelas || r.installment_count || 1,
        items: r.items || [],
      };
      const parcelaVal = Number(r.total_month ?? r.amount ?? 0);
      cur.total = Math.round(((cur.total || 0) + (isNaN(parcelaVal) ? 0 : parcelaVal)) * 100) / 100;
      if (!cur.emissao) cur.emissao = r.emissao || r.vencimento;
      if (!cur.tags?.length && r.tags?.length) cur.tags = r.tags;
      if (!cur.items?.length && r.items?.length) cur.items = r.items;
      if (typeof r.discount !== 'undefined') { const d = Number(r.discount); if (!isNaN(d)) cur.discount = d; }
      byId.set(id, cur);
    });
    return Array.from(byId.values());
  }, [purchasesCompras]);

  return (
    <div>
<header className="header">
  <div className="title">{family?.name || 'Família'}</div>
  <div className="menu">
    {family && <NotificationsBell familyId={family.id} />}
    {family && (
      <AvatarButton
        name={(profile.display_name || user?.username || '') as string}
        email={profile.email}
        src={profile.avatar_url || undefined}
        onOpenProfile={() => setShowProfile(true)}
        onLogout={() => logout().then(() => nav('/login', { replace: true }))}
      />
    )}
  </div>
</header>

      {family && family.role === 'owner' && <MemberExitModal familyId={family.id} />}

      <div className="container">

        {showProfile && (
          <dialog open>
            <div className="card modal">
              <div className="row auto-s-1042" >
                <h3  className="auto-s-1043">Configurações</h3>
                <button onClick={() => setShowProfile(false)}>Fechar</button>
              </div>

              <div className="row auto-s-1044" >
                <button aria-selected={profileTab==='perfil'} onClick={()=>setProfileTab('perfil')}>Perfil</button>
                <button aria-selected={profileTab==='seg'} onClick={()=>setProfileTab('seg')}>Segurança</button>
                <button aria-selected={profileTab==='tags'} onClick={()=>setProfileTab('tags')}>Tags</button>
                <button aria-selected={profileTab==='familia'} onClick={()=>setProfileTab('familia')}>Família</button>
              </div>

              {profileTab === 'perfil' && (
                <div className="col auto-s-1045" >
                  <div className="field"><label>Nome</label><input value={profile.display_name} readOnly /></div>
                  <div className="field"><label>E-mail</label><input value={profile.email} readOnly /></div>

                  {/* Uploader de avatar */}
                  <div className="field">
                    <label>Avatar</label>
                    <AvatarUploader
                      initialUrl={profile.avatar_url || null}
                      onUploaded={(url) => {
                        localStorage.setItem('me:avatar_url', url);
                        setProfile(p => ({ ...p, avatar_url: url }));
                      }}
                    />
                  </div>
                </div>
              )}

              {profileTab === 'seg' && (
                <div  className="auto-s-1046">
                  <SegurancaForm onDone={() => setShowProfile(false)} />
                </div>
              )}

              {profileTab === 'tags' && family && (
                <div className="auto-s-1047">
                  <TagsManager familyId={family.id} canDelete={(family.role || '') === 'owner'} />
                </div>
              )}

          {profileTab === 'familia' && family && (
            <div className="col auto-s-1048">
              <div className="field">
                <label>Nome da família</label>
                <input value={family.name} readOnly />
              </div>

              <div className="field">
                <label>ID da família</label>
               <div className="input-with-actions">
                <input
                  type={showFamilyId ? 'text' : 'password'}
                  value={family.id}
                  readOnly
                />

                  {/* Grupo de ações integrado à direita */}
                  <div className="input-actions">
                    {/* Ver/Ocultar */}
                    <button
                      type="button"
                      className="icon-btn input-action input-action--toggle"
                      title={showFamilyId ? 'Ocultar' : 'Ver'}
                      aria-label={showFamilyId ? 'Ocultar' : 'Ver'}
                      onClick={() => setShowFamilyId(v => !v)}
                    >
                      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg"
                          width="24" height="24" viewBox="0 0 24 24" fill="none">
                        {showFamilyId ? (
                          <>
                            <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                  d="M3.933 13.909A4.357 4.357 0 0 1 3 12c0-1 4-6 9-6m7.6 3.8A5.068 5.068 0 0 1 21 12c0 1-3 6-9 6-.314 0-.62-.014-.918-.04M5 19 19 5m-4 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                          </>
                        ) : (
                          <>
                            <path stroke="currentColor" strokeWidth="2"
                                  d="M21 12c0 1.2-4.03 6-9 6s-9-4.8-9-6c0-1.2 4.03-6 9-6s9 4.8 9 6Z" />
                            <path stroke="currentColor" strokeWidth="2"
                                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                          </>
                        )}
                      </svg>
                    </button>

                    {/* Copiar */}
                    <button
                      type="button"
                      className="icon-btn input-action input-action--copy"
                      title={copiedFamilyId ? 'Copiado!' : 'Copiar'}
                      aria-label={copiedFamilyId ? 'Copiado!' : 'Copiar'}
                      onClick={() => {
                        navigator.clipboard?.writeText(family.id);
                        setCopiedFamilyId(true);
                        setTimeout(() => setCopiedFamilyId(false), 1500);
                      }}
                    >
                      {copiedFamilyId ? (
                        // Ícone “copiado” (preenchido)
                        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg"
                            width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path fillRule="evenodd" clipRule="evenodd"
                                d="M18 3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1V9a4 4 0 0 0-4-4h-3a1.99 1.99 0 0 0-1 .267V5a2 2 0 0 1 2-2h7Z"/>
                          <path fillRule="evenodd" clipRule="evenodd"
                                d="M8 7.054V11H4.2a2 2 0 0 1 .281-.432l2.46-2.87A2 2 0 0 1 8 7.054ZM10 7v4a2 2 0 0 1-2 2H4v6a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/>
                        </svg>
                      ) : (
                        // Ícone “copiar” (contorno)
                        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg"
                            width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
                                d="M9 8v3a1 1 0 0 1-1 1H5m11 4h2a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v1m4 3v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7.13a1 1 0 0 1 .24-.65L7.7 8.35A1 1 0 0 1 8.46 8H13a1 1 0 0 1 1 1Z"/>
                        </svg>
                      )}
                    </button>
                  </div>

                </div>
              </div>

              <div className="field">
                <label>Membros ({members.length})</label>
                <ul className="auto-s-2003">
                  {members.map(m => {
                    const role = String(m.role || '').toLowerCase();
                    const isOwner = role === 'owner';
                    const iAmOwner = String(family.role || '').toLowerCase() === 'owner';
                    const canKick = iAmOwner && !isOwner && m.id !== myId;
                    return (
                      <li key={m.id} className="auto-s-2004">
                        <div>
                          <span className="auto-s-1049">{m.display_name}</span>{' '}
                          {m.role ? <span className="muted">({m.role})</span> : null}
                        </div>
                        {canKick && (
                          <button
                            className="icon-btn"
                            onClick={async () => {
                              if (!confirm(`Remover ${m.display_name} da família?`)) return;
                              try {
                                await api.removeMember(family.id, m.id);
                                setMembers(await api.listMembers(family.id, true));
                              } catch (e:any) {
                                alert(e?.message || 'Falha ao remover membro');
                              }
                            }}
                            title="Expulsar"
                          >
                            Expulsar
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

            </div>
          </dialog>
        )}

        {/* GATES */}
        {gate.mode === 'create_or_join' && (
          <dialog open>
            <div className="card modal">
              <h3 className="auto-s-1050">Criar ou entrar em uma família</h3>
              <CreateOrJoin
                onCreatePending={(fam)=> setGate({ mode: 'pending_admin', familyId: fam.id, name: fam.name })}
                onJoinPending={(jr)=> setGate({ mode: 'pending_owner', joinId: jr.id, familyId: jr.family_id, name: jr.name })}
              />
            </div>
          </dialog>
        )}
        {gate.mode === 'pending_admin' && (
          <dialog open>
            <div className="card modal">
              <h3 className="auto-s-1051">Sua família está em análise</h3>
              <p>Aguarde aprovação do administrador para acessar o painel.</p>
              <div className="actions auto-s-1052">
                <button onClick={async()=>{ if (!confirm('Cancelar criação da família?')) return;
                  try { await api.cancelFamily(gate.familyId); setGate({ mode: 'create_or_join' }); } catch (e:any) { alert(e?.message||'Falha'); } }}>
                  Cancelar criação
                </button>
                <button onClick={()=> logout().then(()=>nav('/login',{replace:true}))}>Sair</button>
              </div>
            </div>
          </dialog>
        )}
        {gate.mode === 'pending_owner' && (
          <dialog open>
            <div className="card modal">
              <h3 className="auto-s-1053">Aguardando aprovação do dono</h3>
              <p>Sua solicitação de entrada {gate.name ? `para "${gate.name}" `: ''}está pendente.</p>
              <div className="actions auto-s-1054">
                <button onClick={async()=>{ try { await api.cancelJoinRequest(gate.joinId); setGate({ mode: 'create_or_join' }); } catch (e:any) { alert(e?.message||'Falha'); } }}>
                  Cancelar solicitação
                </button>
                <button onClick={()=> logout().then(()=>nav('/login',{replace:true}))}>Sair</button>
              </div>
            </div>
          </dialog>
        )}

        {/* ===== PAINEL ===== */}
        {gate.mode === 'none' && (
          <>
            {/* FILTROS */}
            <section className="card filters">
              <div className="grid cols-3">
                <div className="field">
                  <label htmlFor="month">{t.month}</label>
                  <input
                    id="month"
                    type="month"
                    value={filters.month}
                    onChange={(e)=>setFilters((f)=>({ ...f, month: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>{t.users}</label>
                  {family && (
                    <UserMultiSelect
                      familyId={family.id}
                      value={filters.users}
                      onChange={(ids: string[])=>setFilters((f)=>({ ...f, users: ids }))}
                      onModeChange={(m: { allActiveSelected: boolean; excludedIds: string[] }) =>
                        setFilters((f)=> ({ ...f, allActiveSelected: m.allActiveSelected, excludedIds: m.excludedIds }))
                      }
                    />
                  )}
                </div>

                <div className="field">
                  <label>Tags</label>
                  {family && (
                    <TagMultiSelect
                      familyId={family.id}
                      value={filters.tags || []}
                      onChange={(ids)=> setFilters((f)=>({ ...f, tags: ids }))}
                      placeholder="Filtrar por tags…"
                    />
                  )}
                </div>
              </div>

              <div className="grid cols-3 auto-s-1055">
                <div className="field">
                  <label htmlFor="mtp">MtP</label>
                  <select
                    id="mtp"
                    value={filters.mtp || 'all'}
                    onChange={(e) => setFilters(f => ({ ...f, mtp: e.target.value }))}
                  >
                    <option value="all">Todos</option>
                    {MTP_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>

                <div className="field"></div>

                <div className="actions auto-s-1056">
                  <button className="primary" onClick={()=> setShowCreate(true)}>+ Nova compra</button>
                </div>
              </div>
            </section>

            {/* ABAS PARCELAS / COMPRAS */}
            <ResumoSection
              loading={loading}
              tabView={tabView}
              setTabView={setTabView}
              asCards={asCards}
              setAsCards={setAsCards}
              parcelas={parcelas}
              compras={compras}
              onOpenDetail={(c)=> setDetail(c)}
            />

            {/* MODAL DETALHES */}
            {detail && (
              <dialog open onClose={()=> setDetail(null)}>
                <div className="card modal">
                  <h3 className="auto-s-1057">{detail.estabelecimento}</h3>
                  <div className="muted auto-s-1058">
                    {dmy(detail.emissao)} — {detail.pagamento_tipo === 'parcelado' ? `parcelado (${detail.pagamento_parcelas}x)` : 'à vista'} — Total {brl(detail.total)}
                  </div>
                  <table className="table">
                    <thead>
                      <tr><th>Item</th><th>Qtd</th><th>Valor</th></tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((it:any, i:number) => (
                        <tr key={i}>
                          <td>{it.name}</td>
                          <td className="auto-s-1059">{it.qty ?? 1}</td>
                          <td className="num">{brl(it.total)}</td>
                        </tr>
                      ))}
                      {(detail.items || []).length === 0 && (
                        <tr><td colSpan={3} className="auto-s-1060">Itens indisponíveis.</td></tr>
                      )}
                      {Math.abs(Number(detail.discount || 0)) > 0 && (
                        <tr>
                          <td colSpan={2} className="auto-s-1061">Desconto R$:</td>
                          <td className="num">-{brl(Math.abs(Number(detail.discount || 0)))}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="actions auto-s-1062">
                    {(family?.role === 'owner' || String(detail.createdBy || '') === String(user?.username || '') || String(detail.createdByUserId || '') === String(myId || '')) && (
                      <button
                        onClick={async ()=>{
                          if (!confirm('Excluir esta compra? Esta ação não pode ser desfeita.')) return;
                          try {
                            await api.deletePurchase(detail.id);
                            setDetail(null);
                            reload();
                          } catch (e:any) {
                            alert(e?.message || 'Falha ao excluir');
                          }
                        }}
                      >
                        Excluir
                      </button>
                    )}
                    <button onClick={()=> setDetail(null)}>Fechar</button>
                  </div>
                </div>
              </dialog>
            )}

            {/* MODAL CRIAR COMPRA */}
            {showCreate && (
              <dialog open>
                <div className="card modal">
                  <h3 className="auto-s-1063">Adicionar compra</h3>

                  <div className="field">
                    <label>Estabelecimento</label>
                    <input value={form.estabelecimento} onChange={(e)=> setForm(f=>({ ...f, estabelecimento: e.target.value }))}/>
                  </div>

                  <div className="field">
                    <label>Data e hora da compra</label>
                    <input type="datetime-local" value={form.emissao} onChange={(e)=> setForm(f=>({ ...f, emissao: e.target.value }))}/>
                  </div>

                  <div className="field auto-s-1064">
                    <div className="row items-header">
                      <label className="auto-s-1065">Itens</label>
                      <div className="row auto-s-1066">
                        <button type="button" onClick={()=> setForm(f => ({ ...f, items: [...(f.items||[]), { name:'', qty:'1', total:'' }] }))}>
                          + Item
                        </button>
                      </div>
                    </div>

                    <div className="col auto-s-1067">
                      {(form.items || []).map((it: any, idx: number) => (
                        <div key={idx} className="row item-row">
                          <input placeholder="Nome do item" className="item-name" value={it.name}
                            onChange={(e) => setForm(f => { const items=[...(f.items||[])]; items[idx]={...items[idx], name:e.target.value}; return { ...f, items }; })}/>
                          <input inputMode="decimal" placeholder="1" className="item-qty" value={it.qty}
                            onChange={(e) => setForm(f => { const items=[...(f.items||[])]; items[idx]={...items[idx], qty:e.target.value}; return { ...f, items }; })}/>
                          <input inputMode="decimal" placeholder="0" className="item-price" value={it.total}
                            onChange={(e) => setForm(f => { const items=[...(f.items||[])]; items[idx]={...items[idx], total:e.target.value}; return { ...f, items }; })}/>
                          <button type="button" onClick={() => setForm(f => { const items=[...(f.items||[])]; items.splice(idx,1); return { ...f, items: items.length?items:[{name:'',qty:'1',total:''}] }; })}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid cols-2 auto-s-1068">
                    <div className="field">
                      <label>Desconto (R$)</label>
                      <input inputMode="decimal" value={form.discount} onChange={(e) => setForm(f => ({ ...f, discount: e.target.value }))}/>
                    </div>
                    <div className="field">
                      <label>Total (R$)</label>
                      <input inputMode="decimal" value={form.total} onChange={(e)=> { setTouchedTotal(true); setForm(f=>({...f, total: e.target.value})) }}/>
                    </div>
                  </div>

                  <div className="grid cols-2">
                    <div className="field">
                      <label>Tags</label>
                      {family && (
                        <TagMultiSelect familyId={family.id} value={form.tags} onChange={(ids)=> setForm(f => ({ ...f, tags: ids }))} placeholder="Selecione as tags…"/>
                      )}
                    </div>
                    <div className="field">
                      <label>MtP</label>
                      <select required value={form.mtp || 'Dinheiro'} onChange={(e) => setForm(f => ({ ...f, mtp: e.target.value }))}>
                        {MTP_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* ==== PATCH: bloco depois do seletor de MTP ==== */}
                  {/credito/.test(normalize(form.mtp)) && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label>Pagamento</label>
                        <select
                          className="input"
                          value={form.pagamento_tipo}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              pagamento_tipo: e.target.value as 'avista' | 'parcelado',
                              pagamento_parcelas:
                                e.target.value === 'parcelado'
                                  ? Math.max(1, Number(f.pagamento_parcelas || 1))
                                  : 1,
                            }))
                          }
                        >
                          <option value="avista">à vista</option>
                          <option value="parcelado">parcelado</option>
                        </select>
                      </div>

                      {form.pagamento_tipo === 'parcelado' && (
                        <div className="flex flex-col gap-1">
                          <label>Parcelas</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className="input"
                            value={form.pagamento_parcelas}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                pagamento_parcelas: Math.max(1, Number(e.target.value || 1)),
                              }))
                            }
                          />
                        </div>
                      )}
                    </>
                  )}

                  <div className="actions auto-s-1072">
                    <button onClick={()=> setShowCreate(false)}>Cancelar</button>
                    <button className="primary" onClick={async ()=>{
                      try {
                        if (!Number(form.total) || Number(form.total) <= 0) { alert('Valor inválido'); return; }
                        if (filters.month && !String(form.emissao).startsWith(filters.month)) {
                          alert('Data fora do mês selecionado'); return;
                        }

                        // ==== PATCH: montar payload antes do fetch ====
                        const payload = {
                          estabelecimento: form.estabelecimento || null,
                          emissao: new Date(form.emissao).toISOString(),
                          discount: parseMoney(form.discount),
                          total: parseMoney(form.total),
                          items: (form.items||[]).map((it:any)=> ({ name: it.name||'Item', qty: parseQty(it.qty||1) || 1, total: parseMoney(it.total) })),
                          tags: form.tags || [],
                          mtp: form.mtp,
                          ...( /credito/.test(normalize(form.mtp))
                            ? {
                                pagamento_tipo: form.pagamento_tipo,
                                pagamento_parcelas:
                                  form.pagamento_tipo === 'parcelado'
                                    ? Math.max(1, Number(form.pagamento_parcelas || 1))
                                    : 1,
                              }
                            : { pagamento_tipo: 'avista', pagamento_parcelas: 1 }
                          ),
                        };

                        await api.createPurchase(payload);

                        setShowCreate(false);
                        setForm({
                          estabelecimento: '',
                          emissao: new Date().toISOString().slice(0,16),
                          discount: '',
                          items: [{ name:'', qty:'1', total:'' }],
                          total: '',
                          tags: [],
                          mtp: 'Dinheiro',
                          pagamento_tipo: 'avista',
                          pagamento_parcelas: 1,
                        });
                        setTouchedTotal(false);
                        reload();
                      } catch (e:any) { alert(e?.message || 'Falha'); }
                    }}>Salvar</button>
                  </div>
                </div>
              </dialog>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ResumoSection({
  loading, tabView, setTabView, asCards, setAsCards,
  parcelas, compras, onOpenDetail
}: {
  loading: boolean;
  tabView: 'parcelas' | 'compras';
  setTabView: (t: 'parcelas' | 'compras') => void;
  asCards: boolean;
  setAsCards: React.Dispatch<React.SetStateAction<boolean>>;
  parcelas: any[];
  compras: any[];
  onOpenDetail: (c: any) => void;
}) {
  return (
    <section className="card">
      <div className="row auto-s-1073">
        <div className="row auto-s-1074">
          <button role="tab" aria-selected={tabView==='parcelas'} onClick={()=>setTabView('parcelas')}>Parcelas</button>
          <button role="tab" aria-selected={tabView==='compras'} onClick={()=>setTabView('compras')}>Compras</button>
        </div>
        {tabView==='compras' && (
          <button type="button" className="chip" onClick={()=> setAsCards(v => !v)} aria-label={asCards?'Ver como lista':'Ver como cards'}>
            {asCards ? 'Lista' : 'Cards'}
          </button>
        )}
      </div>

      {loading && <div className="muted auto-s-1075">Carregando…</div>}

      {!loading && tabView==='parcelas' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Data</th><th>Estabelecimento</th><th>Parcela</th><th className="num">Valor</th><th>Usuário</th></tr>
            </thead>
            <tbody>
              {parcelas.map((p:any)=>(
                <tr key={p.id}>
                  <td>{dmy(p.date)}</td>
                  <td>{p.estabelecimento}</td>
                  <td>{p.parcela}</td>
                  <td className="num">{brl(p.valor)}</td>
                  <td>{p.usuario || '—'}</td>
                </tr>
              ))}
              {parcelas.length===0 && <tr><td colSpan={5} className="auto-s-1076">Nenhuma parcela neste mês.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tabView==='compras' && (
        !asCards ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Emissão</th><th>Estabelecimento</th><th>Tag</th><th>MtP</th><th className="num">Total</th><th>Pagto</th></tr>
              </thead>
              <tbody>
                {compras.map((c:any)=>(
                  <tr
                    key={c.id}
                    className="auto-s-1077"
                    onClick={() => onOpenDetail(c)}
                  >
                    <td>{dmy(c.emissao)}</td>
                    <td>{c.estabelecimento}</td>
                    <td>
                      {(c.tags||[]).length
                        ? (c.tags||[]).map((t:any)=>(
                            <span key={(t.id||t.name||t)} className="tag-pill" style={tagStyle(t.color)}>{t.name||t}</span>
                          ))
                        : '—'}
                    </td>
                    <td>
                      <span className="tag-pill" style={tagStyle(mtpColor(c.mtp))}>{c.mtp || '—'}</span>
                    </td>
                    <td className="num">{brl(c.total)}</td>
                    <td>{c.pagamento_tipo === 'parcelado' ? `parcelado (${c.pagamento_parcelas}x)` : 'à vista'}</td>
                  </tr>
                ))}
                {compras.length===0 && <tr><td colSpan={6} className="auto-s-1078">Nenhuma compra neste mês.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid cols-2 auto-s-1079">
            {compras.map((c:any)=>(
              <div key={c.id} className="card auto-s-1080" onClick={()=> onOpenDetail(c)}>
                <div className="row auto-s-1081"><strong>{c.estabelecimento}</strong><strong>{brl(c.total)}</strong></div>
                <div className="row auto-s-1082">
                  <span className="tag-pill" style={tagStyle(mtpColor(c.mtp))}>{c.mtp}</span>
                  {(c.tags||[]).map((t:any)=>(
                    <span key={t.id||t} className="tag-pill" style={tagStyle(t.color)}>{t.name||t}</span>
                  ))}
                </div>
                <div className="muted auto-s-1083">{dmy(c.emissao)} • {c.pagamento_tipo === 'parcelado' ? `parcelado (${c.pagamento_parcelas}x)` : 'à vista'}</div>
              </div>
            ))}
            {compras.length===0 && <div className="muted auto-s-1084">Nenhuma compra neste mês.</div>}
          </div>
        )
      )}
    </section>
  );
}

function CreateOrJoin({ onCreatePending, onJoinPending }: { onCreatePending: (family: { id: string; name?: string }) => void; onJoinPending: (jr: { id: string; family_id: string; name?: string }) => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function doCreate() {
    try { setBusy(true); setErr(''); const r = await api.createFamily(name.trim()); onCreatePending({ id: (r as any).family?.id || (r as any).id, name }); }
    catch (e:any) { setErr(e?.message || 'Falha'); } finally { setBusy(false); }
  }
  async function doJoin() {
    try {
      setBusy(true); setErr('');
      const id = familyId.trim();
      await api.postJoinRequestById(id);
      try {
        const mine = await api.mineJoinRequests();
        const pend = (mine || []).find((x:any)=>x.status==='pending' && String(x.family_id)===String(id));
        if (pend) { onJoinPending({ id: pend.id, family_id: pend.family_id, name: pend.name }); return; }
      } catch {}
      onJoinPending({ id: 'pending', family_id: id });
    } catch (e:any) { setErr(e?.message || 'Falha'); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="row auto-s-1085">
        <button aria-selected={tab==='create'} onClick={()=>setTab('create')}>Criar família</button>
        <button aria-selected={tab==='join'} onClick={()=>setTab('join')}>Entrar em família</button>
      </div>
      {tab==='create' ? (
        <div className="col auto-s-1086">
          <div className="field"><label>Nome da família</label><input value={name} onChange={(e)=>setName(e.target.value)} /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="actions auto-s-1087">
            <button className="primary" disabled={busy || !name.trim()} onClick={doCreate}>Criar</button>
          </div>
        </div>
      ) : (
        <div className="col auto-s-1088">
          <div className="field"><label>ID da família</label><input value={familyId} onChange={(e)=>setFamilyId(e.target.value)} /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="actions auto-s-1089">
            <button className="primary" disabled={busy || !familyId.trim()} onClick={doJoin}>Entrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======== Componentes auxiliares do modal de Configurações ======== */

function SegurancaForm({ onDone }: { onDone: ()=>void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="col">
      <div className="field"><label>Senha atual</label><input type="password" value={current} onChange={(e)=>setCurrent(e.target.value)} /></div>
      <div className="field"><label>Nova senha</label><input type="password" value={next} onChange={(e)=>setNext(e.target.value)} /></div>
      <div className="actions auto-s-1090">
        <button className="primary" disabled={busy || next.length < 4} onClick={async ()=>{
          setBusy(true);
          try { await api.changePassword(current, next); alert('Senha atualizada'); onDone(); }
          catch (e:any) { alert(e?.message || 'Falha'); }
          finally { setBusy(false); }
        }}>Salvar</button>
      </div>
    </div>
  );
}

function TagsManager({ familyId, canDelete }: { familyId: string; canDelete: boolean }) {
  const [tags, setTags] = useState<Array<{ id: string; name: string; color?: string; is_builtin?: boolean }>>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6B7280');
  const [hasPicked, setHasPicked] = useState(false);
  const colorRef = useRef<HTMLInputElement>(null);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setColor(v);
    if (!hasPicked) setHasPicked(true);
  };

  async function reload() { try { setTags(await api.listTags()); } catch {} }
  useEffect(()=>{ reload(); }, [familyId]);

  async function create() {
    if (!name.trim()) return;
    try {
      await api.createTag({ name: name.trim(), color: color || undefined });
      await reload();
      setName('');
      setColor('#6B7280');
      setHasPicked(false);
    } catch (e: any) {
      alert(e?.message || 'Falha');
    }
  }

  async function remove(id: string, builtin?: boolean) {
    if (!canDelete) return alert('Somente o dono pode excluir tags.');
    if (builtin) return alert('Não é possível excluir a tag fixa "Outros".');
    if (!confirm('Excluir esta tag? Compras que a tenham como única tag serão movidas para "Outros".')) return;
    try { await api.deleteTag(id); await reload(); }
    catch (e:any) { alert(e?.message || 'Falha'); }
  }

  return (
    <div className="col auto-s-1091">
      <div className="row auto-s-1092">
        <div className="auto-s-1093">
          <input
            placeholder="Nome da tag"
            value={name}
            onChange={(e)=> setName(e.target.value)}
          />

          <button
            type="button"
            className={`color-dot-btn ${hasPicked ? '' : 'gradient'}`}
            aria-label="Escolher cor da tag"
            title="Cor"
            onClick={()=> colorRef.current?.click()}
            style={{ ...(hasPicked ? { background: color } : {}) }}
          />

          <input
            ref={colorRef}
            type="color"
            value={color}
            onChange={handleColorChange}
            onInput={handleColorChange}
            aria-hidden
            tabIndex={-1}
            className="auto-s-1095"
          />
        </div>

        <button className="primary" onClick={create}>Adicionar</button>
      </div>

      <div className="col auto-s-2005">
        {tags.map(t => (
          <div key={t.id} className="row auto-s-1096">
            <div className="row auto-s-1097">
              <span className="dot" style={{ background: t.color || 'var(--border)' }} />
              <strong>{t.name}</strong>{t.is_builtin && <span className="muted"> (fixa)</span>}
            </div>
            {canDelete && <button onClick={()=>remove(t.id, t.is_builtin)}>Excluir</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
