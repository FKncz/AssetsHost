import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from './server/config';
import { verifySessionToken } from './server/auth/session';
import { isDemoMode } from './lib/demo';

// exact-match public pages/endpoints.
const PUBLIC_PATHS = ['/', '/gallery', '/login', '/api/auth/login', '/api/gallery'];
// prefix-matched public trees (file serving is never auth gated). /demo/ holds the bundled
// demo assets that /f/ rewrites to in demo mode. /p/ & /api/protected/ are the per-file
// password gate => public by design, they enforce their own boundary.
const PUBLIC_PREFIXES = ['/cdn/', '/f/', '/demo/', '/p/', '/api/protected/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Two responsibilities:
 *  1. Public file alias — /f/:name is rewritten to /cdn/:name & served without auth.
 *  2. Auth guard — the control panel & its APIs require a valid session; the public
 *     landing, gallery, login surface & file routes do not.
 *
 * The app is host agnostic: example.com & cdn.example.com serve the exact same routes, so
 * there is no CDN_HOST special-casing here (CDN_HOST only shapes generated URLs, see lib/format).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /f/:name → /cdn/:name. in demo there is no DB/Blob behind /cdn, so the same alias
  // instead points at the bundled static asset under /demo/:name.
  if (pathname.startsWith('/f/')) {
    const name = pathname.slice(3);
    const target = isDemoMode() ? `/demo/${name}` : `/cdn/${name}`;
    return NextResponse.rewrite(new URL(target, request.url));
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

// ignore this commit. 
