import React, { useEffect, useMemo, useState, useRef } from 'react';
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

type Filters = {
  month: string;
  tags: string[];     // agora é array de IDs de tag
  mtp?: string;
  users: string[];
  allActiveSelected: boolean;
  excludedIds: string[];
};

type PurchaseItem = { name: string; qty: string; total: string };

type PurchaseForm = {
  estabelecimento: string;
  emissao: string;
  total: string;
  discount: string;
  items: PurchaseItem[];
  tags: string[];
  mtp: string;
  pagamento_tipo: 'avista' | 'parcelado';
  pagamento_parcelas: number;
};


export default function Panel() {
  const t = pt.panel; const nav = useNavigate();
  const { logout } = useAuth();
  const [family, setFamily] = useState<{ id: string; slug: string; name: string; role?: string } | null>(null);
  const [filters, setFilters] = useState<Filters>({
    month: new Date().toISOString().slice(0,7),
    tags: [] as string[],
    mtp: 'all',                  // valor padrão dos filtros
    users: [],
    allActiveSelected: false,
    excludedIds: []
  });

  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [gate, setGate] = useState<
    | { mode: 'none' }
    | { mode: 'create_or_join' }
    | { mode: 'pending_admin'; familyId: string; name?: string }
    | { mode: 'pending_owner'; joinId: string; familyId: string; name?: string }
  >({ mode: 'create_or_join' });

  const [form, setForm] = useState<PurchaseForm>({
    estabelecimento: '',
    emissao: new Date().toISOString().slice(0,16),
    total: '',
    discount: '',
    items: [{ name: '', qty: '1', total: '' }],
    tags: [] as string[],
    mtp: 'Dinheiro',
    pagamento_tipo: 'avista',
    pagamento_parcelas: 1,
  });

  // helper p/ comparar strings com/sem acento
  const normalize = (s: any) =>
    String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  
  // helpers de número
  const parseMoney = (s:any) => {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    const n = String(s).replace(/\./g,'').replace(',','.');
    const v = Number(n);
    return isNaN(v) ? 0 : v;
  };
  const round2 = (n:number) => Math.round(n*100)/100;
  // quantidade pode ter casas decimais com vírgula (kg)
  const parseQty = (s:any) => {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    const n = String(s).replace(',', '.');
    const v = Number(n);
    return isNaN(v) ? 0 : v;
  };

  // recalcula total pelos itens quando o usuário ainda não editou manualmente
  const [touchedTotal, setTouchedTotal] = useState(false);
  useEffect(() => {
    if (!touchedTotal) {
      const sumItems = (form.items || []).reduce((acc:any, it:any)=> acc + parseMoney(it.total||0), 0);
      const total = round2(sumItems - parseMoney(form.discount||0));
      if (!isNaN(total)) setForm(f=>({...f, total: String(total)}));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(form.items), form.discount]);

  // Se MtP mudar para algo que não seja crédito, força "à vista 1x"
  useEffect(() => {
    const isCredito = normalize(form.mtp).includes('credito');
    if (!isCredito && (form.pagamento_tipo !== 'avista' || form.pagamento_parcelas !== 1)) {
      setForm(f => ({ ...f, pagamento_tipo: 'avista', pagamento_parcelas: 1 }));
    }
  }, [form.mtp]);

  const [profile, setProfile] = useState<{ display_name: string; email: string }>({ display_name: '', email: '' });
  const [profileTab, setProfileTab] = useState<'perfil'|'seg'|'tags'|'familia'>('perfil');
  const [showFamilyId, setShowFamilyId] = useState(false);
  const [members, setMembers] = useState<Array<{ id: string; display_name: string; role: string; is_active: boolean }>>([]);

  // carrega membros quando abre Configurações > Família
  useEffect(() => {
    (async () => {
      if (!showProfile || profileTab !== 'familia' || !family?.id) return;
      try { setMembers(await api.listMembers(family.id, true)); } catch {}
    })();
  }, [showProfile, profileTab, family?.id]);

  useEffect(() => { (async () => {
    try {
      const me = await api.me();
      // Gate usando /api/me.access
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
      // ensure role is present (some endpoints may omit it)
      setFamily({ ...fam, role: fam.role || me.access?.family?.role });
      setProfile({ display_name: me.displayName || '', email: me.email || '' });

      // filtros salvos
      const saved = lsGet<Filters>(`filters:${fam.id}`, {
        month: new Date().toISOString().slice(0,7),
        tags: [],
        mtp: 'all',          // manter consistente com o estado inicial
        users: [],
        allActiveSelected: true,
        excludedIds: []
      });
      setFilters(saved);
    } catch {
      nav('/login', { replace: true });
    }
  })().catch(()=>{}); }, [nav]);

  const usersParam = useMemo(
    () => buildUsersQueryParam(filters.allActiveSelected, new Set(filters.excludedIds), [], filters.users),
    [filters]
  );

  async function reload() {
    if (!family) return; setLoading(true);
    try {
      const q: any = { month: filters.month };
      if (usersParam) q['users[]'] = usersParam;
      else if (filters.allActiveSelected && (filters.excludedIds?.length || 0) === 0) q.user = 'all';
      if (filters.tags?.length) q['tags[]'] = filters.tags;
      if (filters.mtp && filters.mtp !== 'all') q.mtp = filters.mtp;
      const r = await api.listPurchases(q);
      setPurchases(r.purchases || []);
    } catch (e) { /* no-op */ } finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [family]);

  function applyFilters() {
    if (!family) return;
    lsSet(`filters:${family.id}`, filters);
    reload();
  }

  function clearFilters() {
    if (!family) return;
    const cleared: Filters = {
      month: filters.month,
      tags: [],              // limpa multi-tags
      mtp: 'all',
      users: [],
      allActiveSelected: true,
      excludedIds: []
    };
    setFilters(cleared);
    lsSet(`filters:${family.id}`, cleared);
  }

  return (
    <div>
      <header className="header">
        <div className="title">{family?.name || 'Família'}</div>
        <div className="menu">
          {family && <NotificationsBell familyId={family.id} />}
          {family && (
            <button aria-label="Configurações" title="Configurações" onClick={()=> setShowProfile(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                {/* gear icon */}
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.032 7.032 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.7 8.84a.5.5 0 00.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.04.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.23 1.13-.54 1.63-.94l2.39.96c.21.09.47 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"/>
              </svg>
            </button>
          )}
          <button onClick={() => logout().then(()=>nav('/login', { replace: true }))}>Sair</button>
        </div>
      </header>

      {family && family.role === 'owner' && <MemberExitModal familyId={family.id} />}

      <div className="container">
        {/* Gate overlays */}
        {gate.mode === 'create_or_join' && (
          <dialog open>
            <div className="card modal">
              <h3 style={{ marginTop: 0 }}>Criar ou entrar em uma família</h3>
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
              <h3 style={{ marginTop: 0 }}>Sua família está em análise</h3>
              <p>Aguarde aprovação do administrador para acessar o painel.</p>
              <div className="actions" style={{ justifyContent:'flex-end' }}>
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
              <h3 style={{ marginTop: 0 }}>Aguardando aprovação do dono</h3>
              <p>Sua solicitação de entrada {gate.name ? `para "${gate.name}" `: ''}está pendente.</p>
              <div className="actions" style={{ justifyContent:'flex-end' }}>
                <button onClick={async()=>{ try { await api.cancelJoinRequest(gate.joinId); setGate({ mode: 'create_or_join' }); } catch (e:any) { alert(e?.message||'Falha'); } }}>
                  Cancelar solicitação
                </button>
                <button onClick={()=> logout().then(()=>nav('/login',{replace:true}))}>Sair</button>
              </div>
            </div>
          </dialog>
        )}

        {/* Painel somente quando gate é none */}
        {gate.mode === 'none' && (
          <>
            <section className="card filters">
              <div className="grid cols-3">
                <div className="field">
                  <label htmlFor="month">{t.month}</label>
                  <input id="month" type="month" value={filters.month} onChange={(e)=>setFilters((f)=>({ ...f, month: e.target.value }))} />
                </div>

                <div className="field">
                  <label>{t.users}</label>
                  {family && (
                    <UserMultiSelect
                      familyId={family.id}
                      value={filters.users}
                      onChange={(ids: string[])=>setFilters((f)=>({ ...f, users: ids }))}
                      onModeChange={(m: { allActiveSelected: boolean; excludedIds: string[] })=>
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

              <div className="grid cols-3">
                <div className="field">
                  <label htmlFor="mtp">MtP</label>
                  <select
                    id="mtp"
                    value={filters.mtp || 'all'}
                    onChange={(e) => setFilters(f => ({ ...f, mtp: e.target.value }))}
                  >
                    <option value="all">Todos</option>
                    {MTP_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="field"></div>
                <div className="actions" style={{ alignSelf:'end', justifyContent:'flex-end' }}>
                  <button onClick={applyFilters}>{t.apply}</button>
                  <button onClick={clearFilters}>{t.clear}</button>
                </div>
              </div>
            </section>

            <section className="grid">
              <div className="card">
                <div className="row" style={{ justifyContent:'space-between' }}>
                  <h3 style={{ margin: 0 }}>{t.summary}</h3>
                  <button className="primary" onClick={()=> setShowCreate(true)}>{t.new_purchase}</button>
                </div>
                {loading ? <div className="muted">Carregando…</div> : (
                  purchases.length === 0 ? <div className="muted">Sem compras</div> : (
                    <div className="col">
                      {purchases.map((p) => {
                        const valor = Number(p.total_month ?? p.total ?? 0);
                        const parcela =
                          p.installment_idx && p.installment_count
                            ? ` • ${p.installment_idx}/${p.installment_count}`
                            : '';
                        return (
                          <div key={p.row_key || p.id} className="row" style={{ justifyContent:'space-between', borderBottom:'1px solid var(--border)', padding: '.5rem 0' }}>
                            <div>
                              <div style={{ fontWeight:600 }}>{p.estabelecimento || p.store || 'Compra'}</div>
                              <div className="muted" style={{ fontSize: '.9rem' }}>
                                {(p.emissao || p.date || '').slice(0,10)}{parcela} • {(p.tags && p.tags.length) ? p.tags.map((t:any)=>t.name).join(', ') : '-'}
                              </div>
                            </div>
                            <div className="row" style={{ gap: '.5rem' }}>
                              <div>R$ {valor.toFixed(2)}</div>
                              <button onClick={async ()=>{ if (!confirm('Excluir compra?')) return;
                                try { await api.deletePurchase(p.id); reload(); } catch (e: any) { alert(e?.message || 'Falha'); } }}>
                                Excluir
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            </section>

            {/* seção removida: ID da família e Gerenciar membros migraram para Configurações > Família */}

            {showCreate && (
              <dialog open>
                <div className="card modal">
                  <h3 style={{ marginTop: 0 }}>Adicionar compra</h3>

                  {/* Estabelecimento (linha cheia) */}
                  <div className="field">
                    <label>Estabelecimento</label>
                    <input
                      value={form.estabelecimento}
                      onChange={(e)=> setForm(f=>({ ...f, estabelecimento: e.target.value }))}
                    />
                  </div>

                  {/* Data e hora (linha cheia) */}
                  <div className="field">
                    <label>Data e hora da compra</label>
                    <input
                      type="datetime-local"
                      value={form.emissao}
                      onChange={(e)=> setForm(f=>({ ...f, emissao: e.target.value }))}
                    />
                  </div>

                  {/* Linha 2 — Itens + Desconto */}
                  {/* Itens (linha cheia) */}
                  <div className="field" style={{ alignSelf:'start', marginTop: 8 }}>
                      <div className="row items-header">
                        <label style={{ margin: 0 }}>Itens</label>
                        <div className="row" style={{ gap: 8 }}>
                          {/* Importar por QR (futuro) */}
                          <button
                            type="button"
                            onClick={() =>
                              setForm(f => ({
                                ...f,
                                items: [...(f.items || []), { name: '', qty: '1', total: '' }],
                              }))
                            }
                          >
                            + Item
                          </button>
                        </div>
                      </div>

                      <div className="col" style={{ gap: 8 }}>
                        {(form.items || []).map((it: any, idx: number) => (
                          <div key={idx} className="row item-row">
                            <input
                              placeholder="Nome do item"
                              className="item-name"
                              value={it.name}
                              onChange={(e) =>
                                setForm(f => {
                                  const items = [...(f.items || [])];
                                  items[idx] = { ...items[idx], name: e.target.value };
                                  return { ...f, items };
                                })
                              }
                            />
                          <input
                            inputMode="decimal"
                            placeholder="1"
                            className="item-qty"
                            value={it.qty}
                            onChange={(e) =>
                              setForm(f => {
                                const items = [...(f.items || [])];
                                items[idx] = { ...items[idx], qty: e.target.value };
                                return { ...f, items };
                              })
                            }
                          />
                            <input
                              inputMode="decimal"
                              placeholder="0"
                              className="item-price"
                              value={it.total}
                              onChange={(e) =>
                                setForm(f => {
                                  const items = [...(f.items || [])];
                                  items[idx] = { ...items[idx], total: e.target.value };
                                  return { ...f, items };
                                })
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setForm(f => {
                                  const items = [...(f.items || [])];
                                  items.splice(idx, 1);
                                  return { ...f, items: items.length ? items : [{ name:'', qty:'1', total:'' }] };
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Desconto x Total (lado a lado; empilha no mobile) */}
                    <div className="grid cols-2" style={{ marginTop: 8 }}>
                      <div className="field">
                        <label>Desconto (R$)</label>
                        <input
                          inputMode="decimal"
                          value={form.discount}
                          onChange={(e) => setForm(f => ({ ...f, discount: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label>Total (R$)</label>
                        <input inputMode="decimal" value={form.total} onChange={(e)=> { setTouchedTotal(true); setForm(f=>({...f, total: e.target.value})) }} />
                      </div>
                    </div>

                  <div className="grid cols-2">

                    <div className="field">
                      <label>Tags</label>
                      {family && (
                        <TagMultiSelect
                          familyId={family.id}
                          value={form.tags}
                          onChange={(ids)=> setForm(f => ({ ...f, tags: ids }))}
                          placeholder="Selecione as tags…"
                        />
                      )}
                    </div>

                    <div className="field">
                      <label>MtP</label>
                      <select
                        required
                        value={form.mtp || 'Dinheiro'}
                        onChange={(e) => setForm(f => ({ ...f, mtp: e.target.value }))}
                      >
                        {MTP_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Campos extras quando crédito */}
                  {normalize(form.mtp).includes('credito') && (
                    <div className="grid cols-3" style={{ marginTop: 8 }}>
                      <div className="field" style={{ gridColumn: '1 / -1' }}>
                        <label>Pagamento</label>
                        <select
                          value={form.pagamento_tipo}
                          onChange={(e) => setForm(f => ({
                            ...f,
                            pagamento_tipo: (e.target.value as 'avista' | 'parcelado'),
                            pagamento_parcelas: e.target.value === 'parcelado' ? Math.max(2, Number(f.pagamento_parcelas || 2)) : 1,
                          }))}
                        >
                          <option value="avista">À vista (1x)</option>
                          <option value="parcelado">Parcelado</option>
                        </select>
                      </div>

                      {form.pagamento_tipo === 'parcelado' && (
                        <div className="field" style={{ gridColumn: '1 / -1' }}>
                          <label>Parcelas</label>
                          <input
                            type="number"
                            min={2}
                            max={36}
                            value={form.pagamento_parcelas || 2}
                            onChange={(e) => setForm(f => ({ ...f, pagamento_parcelas: Math.max(2, Number(e.target.value || 2)) }))}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="actions" style={{ justifyContent:'flex-end' }}>
                    <button onClick={()=> setShowCreate(false)}>Cancelar</button>
                    <button className="primary" onClick={async ()=>{
                      try {
                        if (!Number(form.total) || Number(form.total) <= 0) { alert('Valor inválido'); return; }
                        if (filters.month && !String(form.emissao).startsWith(filters.month)) {
                          alert('Data fora do mês selecionado'); return;
                        }

                        const isCredito = normalize(form.mtp).includes('credito');

                        await api.createPurchase({
                          estabelecimento: form.estabelecimento,
                          emissao: new Date(form.emissao).toISOString(),
                          discount: parseMoney(form.discount),
                          total: parseMoney(form.total),
                          items: (form.items||[]).map((it:any)=> ({ name: it.name||'Item', qty: parseQty(it.qty||1) || 1, total: parseMoney(it.total) })),
                          tags: form.tags || [],
                          mtp: form.mtp || undefined,
                          ...(isCredito
                            ? {
                                pagamento_tipo: form.pagamento_tipo === 'parcelado' ? 'parcelado' : 'avista',
                                pagamento_parcelas: form.pagamento_tipo === 'parcelado'
                                  ? Math.max(1, Number(form.pagamento_parcelas || 1))
                                  : 1,
                              }
                            : { pagamento_tipo: 'avista', pagamento_parcelas: 1 }),
                        });

                        setShowCreate(false);
                        setForm({
                          estabelecimento: '',
                          emissao: new Date().toISOString().slice(0,16),
                          discount: '',
                          items: [{ name:'', qty:'1', total:'' }],
                          total: '',
                          tags: [],            // reset correto
                          mtp: 'Dinheiro',
                          pagamento_tipo: 'avista',
                          pagamento_parcelas: 1,
                        });
                        setTouchedTotal(false);
                        reload();
                      } catch (e: any) { alert(e?.message || 'Falha'); }
                    }}>Salvar</button>
                  </div>
                </div>
              </dialog>
            )}

            {showProfile && (
              <dialog open>
                <div className="card modal">
                  <h3 style={{ marginTop: 0 }}>Configurações</h3>

                  {/* abas simples */}
                  <div className="row" role="tablist" style={{ gap: 8, marginBottom: 12 }}>
                    <button className={profileTab==='perfil'?'primary':''} onClick={()=>setProfileTab('perfil')}>Perfil</button>
                    <button className={profileTab==='seg'?'primary':''} onClick={()=>setProfileTab('seg')}>Segurança</button>
                    <button className={profileTab==='tags'?'primary':''} onClick={()=>setProfileTab('tags')}>Definir Tags</button>
                    <button className={profileTab==='familia'?'primary':''} onClick={()=>setProfileTab('familia')}>Família</button>
                  </div>

                  {/* PERFIL */}
                  {profileTab==='perfil' && (
                    <div className="col">
                      <div className="field"><label>Nome</label>
                        <input value={profile.display_name} onChange={(e)=> setProfile((p)=>({ ...p, display_name: e.target.value }))} />
                      </div>
                      <div className="field"><label>E-mail</label>
                        <input type="email" value={profile.email} onChange={(e)=> setProfile((p)=>({ ...p, email: e.target.value }))} />
                      </div>
                      <div className="actions" style={{ justifyContent:'flex-end' }}>
                        <button onClick={()=> setShowProfile(false)}>Cancelar</button>
                        <button className="primary" onClick={async ()=> {
                          try { await api.updateProfile({ display_name: profile.display_name, email: profile.email }); alert('Salvo'); setShowProfile(false); }
                          catch (e: any) { alert(e?.message || 'Falha'); }
                        }}>Salvar</button>
                      </div>
                    </div>
                  )}

                  {/* SEGURANÇA */}
                  {profileTab==='seg' && (
                    <SegurancaForm onDone={()=>setShowProfile(false)} />
                  )}

                  {/* TAGS */}
                  {profileTab==='tags' && family && (
                    <div className="col" style={{ gap: 12 }}>
                      <TagsManager familyId={family.id} canDelete={family.role === 'owner'} />
                      <div className="actions" style={{ justifyContent:'flex-end' }}>
                        <button onClick={()=> setShowProfile(false)}>Fechar</button>
                      </div>
                    </div>
                  )}

                  {/* FAMÍLIA */}
                  {profileTab==='familia' && family && (
                    <div className="col">
                      <div className="field"><label>Nome da família</label>
                        <input value={family.name} readOnly />
                      </div>

                      <div className="field"><label>ID da família</label>
                        <div style={{ position:'relative' }}>
                          <input type={showFamilyId ? 'text' : 'password'} value={family.id} readOnly style={{ paddingRight: 72 }} />
                          <button
                            type="button"
                            className="icon-btn"
                            title={showFamilyId ? 'Ocultar' : 'Ver'}
                            aria-label={showFamilyId ? 'Ocultar' : 'Ver'}
                            onClick={()=> setShowFamilyId(v=>!v)}
                            style={{ position:'absolute', right: 40, top: '50%', transform:'translateY(-50%)' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              {showFamilyId
                                ? <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 110-10 5 5 0 010 10z"/>
                                : <path d="M2 3l19 19-1.5 1.5L17.7 22C16 22.7 14.1 23 12 23 5 23 2 16 2 16s1-2.3 2.9-4.6L.5 7.1 2 5.6 20.4 24l-1.4-1.4L2 3z"/>}
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Copiar"
                            aria-label="Copiar"
                            onClick={()=> { navigator.clipboard?.writeText(family.id).then(()=>alert('ID copiado')); }}
                            style={{ position:'absolute', right: 8, top: '50%', transform:'translateY(-50%)' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              <path d="M16 1H4a2 2 0 00-2 2v12h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="field"><label>Membros ({members.length})</label></div>
                      <div className="col" style={{ maxHeight: 300, overflow: 'auto', border:'1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                        {members.map((m, idx)=> (
                          <div key={m.id} className="row" style={{ justifyContent:'space-between', padding: '.5rem 0', borderTop: idx>0 ? '1px solid var(--border)' : undefined }}>
                            <div>{m.display_name || m.id}</div>
                            {family.role === 'owner' && m.role !== 'owner' && (
                              <button onClick={async ()=> {
                                if (!confirm('Expulsar membro?')) return;
                                try { await api.removeMember(family.id, m.id); setMembers(await api.listMembers(family.id, true)); }
                                catch (e:any) { alert(e?.message || 'Falha'); }
                              }}>
                                Expulsar
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="actions" style={{ justifyContent:'flex-end' }}>
                        <button onClick={()=> setShowProfile(false)}>Fechar</button>
                      </div>
                    </div>
                  )}
                </div>
              </dialog>
            )}

            {/* modal antigo de membros removido (agora em Configurações > Família) */}
          </>
        )}
      </div>
    </div>
  );
}

function CreateOrJoin({ onCreatePending, onJoinPending }: { onCreatePending: (family: { id: string; name?: string }) => void; onJoinPending: (jr: { id: string; family_id: string; name?: string }) => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function doCreate() {
    try {
      setBusy(true); setErr('');
      const r = await api.createFamily(name.trim());
      onCreatePending({ id: (r as any).family?.id || (r as any).id, name });
    } catch (e:any) { setErr(e?.message || 'Falha'); } finally { setBusy(false); }
  }

  async function doJoin() {
    try {
      setBusy(true); setErr('');
      const id = familyId.trim();
      await api.postJoinRequestById(id);
      try {
        const mine = await api.mineJoinRequests();
        const pend = (mine || []).find((x:any) => x.status === 'pending' && String(x.family_id) === String(id));
        if (pend) { onJoinPending({ id: pend.id, family_id: pend.family_id, name: pend.name }); return; }
      } catch {}
      onJoinPending({ id: 'pending', family_id: id });
    } catch (e:any) { setErr(e?.message || 'Falha'); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button aria-selected={tab==='create'} onClick={()=>setTab('create')}>Criar família</button>
        <button aria-selected={tab==='join'} onClick={()=>setTab('join')}>Entrar em família</button>
      </div>
      {tab==='create' ? (
        <div className="col" style={{ gap: 8 }}>
          <div className="field"><label>Nome da família</label><input value={name} onChange={(e)=>setName(e.target.value)} /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="actions" style={{ justifyContent:'flex-end' }}>
            <button className="primary" disabled={busy || !name.trim()} onClick={doCreate}>Criar</button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="field"><label>ID da família</label><input value={familyId} onChange={(e)=>setFamilyId(e.target.value)} /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="actions" style={{ justifyContent:'flex-end' }}>
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
      <div className="actions" style={{ justifyContent:'flex-end' }}>
        <button onClick={onDone}>Fechar</button>
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

      // atualiza a lista
      await reload();

      // reset do formulário + volta a bolinha para o "gradiente"
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
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <div style={{ position:'relative', flex: 1 }}>
          <input
            placeholder="Nome da tag"
            value={name}
            onChange={(e)=> setName(e.target.value)}
            style={{ paddingRight: 44 }}
          />

          <button
            type="button"
            className={`color-dot-btn ${hasPicked ? '' : 'gradient'}`}
            aria-label="Escolher cor da tag"
            title="Cor"
            onClick={()=> colorRef.current?.click()}
            style={{
              position:'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              // só pinta com a cor quando o usuário já escolheu
              ...(hasPicked ? { background: color } : {})
            }}
          />

          <input
            ref={colorRef}
            type="color"
            value={color}
            onChange={handleColorChange}
            onInput={handleColorChange}
            style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}
            aria-hidden
            tabIndex={-1}
          />
        </div>


        <button className="primary" onClick={create}>Adicionar</button>
      </div>


      <div className="col" style={{ maxHeight: 260, overflowY:'auto', border:'1px solid var(--border)', borderRadius: 8, padding: 8 }}>
        {tags.map(t => (
          <div key={t.id} className="row" style={{ justifyContent:'space-between', padding: 6 }}>
            <div className="row" style={{ gap: 8, alignItems:'center' }}>
              <span className="dot" style={{ width:14, height:14, borderRadius: 999, background: t.color || 'var(--border)' }} />
              <strong>{t.name}</strong>{t.is_builtin && <span className="muted"> (fixa)</span>}
            </div>
            {canDelete && <button onClick={()=>remove(t.id, t.is_builtin)}>Excluir</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

