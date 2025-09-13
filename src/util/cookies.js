export function cookieOptsAdmin() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/admin',
  };
}

export function cookieOptsUser() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

export default { cookieOptsAdmin, cookieOptsUser };

