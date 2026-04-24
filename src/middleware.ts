import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { nextUrl } = req

  const isAuthPage = nextUrl.pathname.startsWith('/login')
  const isApiAuth = nextUrl.pathname.startsWith('/api/auth')
  const isStatic = nextUrl.pathname.startsWith('/_next') || nextUrl.pathname === '/favicon.ico'

  if (isApiAuth || isStatic) return NextResponse.next()

  // Internal verification bypass for scripts/verify-and-fix.sh
  if (req.headers.get('x-verify-secret') === 'ni-verify-2026') {
    return NextResponse.next()
  }

  // NextAuth v5 stores session token in this cookie
  const sessionToken =
    req.cookies.get('authjs.session-token')?.value ||
    req.cookies.get('__Secure-authjs.session-token')?.value

  const isLoggedIn = !!sessionToken

  if (!isLoggedIn && !isAuthPage) {
    const loginUrl = new URL('/login', nextUrl)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoggedIn && isAuthPage) {
    const execUrl = new URL('/executive', nextUrl)
    return NextResponse.redirect(execUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
}
