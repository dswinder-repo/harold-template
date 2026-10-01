import { createServerClient } from '@supabase/ssr'
import { supabaseUrlOrPlaceholder, supabaseKeyOrPlaceholder } from '@/lib/supabase/env'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Demo mode has no session and no database to check one against, so the auth
  // round-trip is skipped entirely. Never set in production.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') return supabaseResponse

  try {
    const supabase = createServerClient(
      supabaseUrlOrPlaceholder,
      supabaseKeyOrPlaceholder,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            supabaseResponse = NextResponse.next({
              request,
            })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (
      !user &&
      !request.nextUrl.pathname.startsWith('/login') &&
      !request.nextUrl.pathname.startsWith('/auth/')
    ) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }

    // Redirect authenticated users from /login directly to /dashboard
    // (Previously redirected to '/' which is itself a redirect page — caused
    // triple auth-check chains and increased failure surface area)
    if (user && request.nextUrl.pathname.startsWith('/login')) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  } catch {
    // If auth check fails, redirect unauthenticated routes to login
    if (!request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/auth/')) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
  }

  // Prevent browser from caching HTML responses (avoids stale-page hangs on refresh)
  supabaseResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  supabaseResponse.headers.set('Pragma', 'no-cache')

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
