export type LoginPayload = { emailOrUsername: string; password: string };
export type SignupPayload = { first_name: string; last_name: string; username: string; email: string; password: string; uf: string };
export type AccessState = { allowed: boolean; waiting?: 'no_family' | 'admin_approval' | 'owner_approval'; family?: { id: string; slug?: string; name?: string; role?: string } };

const API_BASE = '';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && (body as any)?.error) || (isJson && (body as any)?.message) || `${res.status}`);
  if (!isJson) throw new Error('invalid_response');
  return body as T;
}

export const api = {
  login: (p: LoginPayload) => request<void>('/api/login', { method: 'POST', body: JSON.stringify({ username: p.emailOrUsername, password: p.password }) }),
  logout: () => request<void>('/api/logout', { method: 'POST' }),
  signup: (p: SignupPayload) => request<void>('/api/register', { method: 'POST', body: JSON.stringify(p) }),
  forgot: (email: string) => request<void>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  reset: (token: string, new_password: string) => request<void>('/auth/reset', { method: 'POST', body: JSON.stringify({ token, new_password }) }),

  // ADAPTADO: inclui avatar_url/avatarUrl no tipo e normaliza a resposta
  me: async () => {
    const r = await request<any>('/api/me');
    const avatar =
      (r && (r.avatar_url || r.avatarUrl)) ? (r.avatar_url || r.avatarUrl) :
      (r && r.user && (r.user.avatar_url || r.user.avatarUrl)) ? (r.user.avatar_url || r.user.avatarUrl) :
      null;
    return { ...r, avatar_url: avatar };
  },

  updateProfile: (p: { display_name?: string; email?: string; avatar_url?: string | null }) =>
    request<void>('/api/me', { method: 'PATCH', body: JSON.stringify(p) }),

  familiesMine: async () => request<{ id: string; slug: string; name: string; role?: string } | null>('/api/families/mine'),
  createFamily: (name: string) => request<{ id: string; slug: string }>("/api/families", { method: 'POST', body: JSON.stringify({ name }) }),
  listMembers: (id: string, activeOnly = true) => request<Array<{ id: string; display_name: string; role: string; is_active: boolean }>>(`/api/families/${id}/members?active_only=${activeOnly ? 'true' : 'false'}`),
  specialUsers: (id: string) => request<{ deactivated_user_id: string | null; has_purchases: boolean }>(`/api/families/${id}/special-users`),
  removeMember: (id: string, userId: string) => request<void>(`/api/families/${id}/members/${userId}`, { method: 'DELETE' }),

  postJoinRequest: (family_slug: string) => request<void>('/api/join-requests', { method: 'POST', body: JSON.stringify({ family_slug }) }),
  postJoinRequestById: (family_id: string) => request<void>('/api/join-requests', { method: 'POST', body: JSON.stringify({ family_id }) }),
  mineJoinRequests: () => request<Array<{ id: string; family_id: string; status: string; created_at: string; name?: string; slug?: string }>>('/api/join-requests/mine'),
  cancelJoinRequest: (id: string) => request<void>(`/api/join-requests/${id}/cancel`, { method: 'POST' }),
  cancelFamily: (id: string) => request<void>(`/api/families/${id}`, { method: 'DELETE' }),
  ownerPendingJoinRequests: (familyId: string) => request<Array<any>>(`/api/families/${familyId}/join-requests`),
  approveJoinRequest: (id: string) => request<void>(`/api/join-requests/${id}/approve`, { method: 'POST' }),
  rejectJoinRequest: (id: string) => request<void>(`/api/join-requests/${id}/reject`, { method: 'POST' }),

  listPurchases: (q: Record<string, string | string[] | undefined>) => {
    const usp = new URLSearchParams();
    let hasUserParam = false;
    for (const [k, v] of Object.entries(q)) {
      if (v === undefined || v === null) continue;
      if (k === 'user' || k === 'users[]') hasUserParam = true;
      if (Array.isArray(v)) v.forEach((x) => usp.append(k, String(x)));
      else usp.set(k, String(v));
    }
    if (!hasUserParam) usp.set('user', 'me');
    return request<{ purchases: any[]; summary?: any }>(`/api/purchases?${usp.toString()}`);
  },
  createPurchase: (payload: any) => request<any>('/api/purchases', { method: 'POST', body: JSON.stringify(payload) }),
  updatePurchase: (id: string, payload: any) => request<any>(`/api/purchases/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePurchase: (id: string) => request<void>(`/api/purchases/${id}`, { method: 'DELETE' }),

  pendingMemberExits: (familyId: string) => request<Array<{ exit_id: string; user_id: string; user_name: string }>>(`/families/${familyId}/pending-member-exits`),
  keepMemberExit: (familyId: string, exitId: string) => request<void>(`/families/${familyId}/member-exits/${exitId}/keep`, { method: 'POST' }),
  deleteMemberExit: (familyId: string, exitId: string) => request<void>(`/families/${familyId}/member-exits/${exitId}/delete`, { method: 'POST' }),

  notifications: () => request<Array<{ id: string; type: string; title: string; body?: string; created_at: string; read_at?: string }>>('/notifications'),
  markNotificationRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    }),

  listTags: () =>
    request<Array<{ id: string; name: string; color?: string; is_builtin?: boolean }>>('/api/tags'),

  createTag: (payload: { name: string; color?: string }) =>
    request<{ id: string; name: string; color?: string; is_builtin?: boolean }>(
      '/api/tags',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  deleteTag: (id: string) =>
    request<void>(`/api/tags/${id}`, { method: 'DELETE' }),
};

export function buildUsersQueryParam(allActiveSelected: boolean, excludedIds: Set<string>, activeIds: string[], selectedIds: string[]): string[] | undefined {
  if (allActiveSelected && excludedIds.size === 0) return undefined; // omit
  if (allActiveSelected) {
    const ids = activeIds.filter((id) => !excludedIds.has(id));
    return ids;
  }
  return selectedIds;
}
