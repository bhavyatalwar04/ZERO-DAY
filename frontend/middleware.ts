import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    try {
        // Skip auth entirely if Supabase env vars are not configured (local dev / demo)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.next({ request })
        }

        let supabaseResponse = NextResponse.next({
            request,
        })

        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
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

        const {
            data: { user },
        } = await supabase.auth.getUser()

        // Protected routes - require authentication
        const protectedRoutes = ['/profile']
        const isProtectedRoute = protectedRoutes.some(route =>
            request.nextUrl.pathname.startsWith(route)
        )

        // Auth routes - redirect to dashboard if already logged in
        const authRoutes = ['/signup']
        const isAuthRoute = authRoutes.some(route =>
            request.nextUrl.pathname.startsWith(route)
        )

        if (isProtectedRoute && !user) {
            // Not logged in, redirect to signup
            const url = request.nextUrl.clone()
            url.pathname = '/signup'
            return NextResponse.redirect(url)
        }

        if (isAuthRoute && user) {
            // Already logged in, redirect to dashboard
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }

        return supabaseResponse
    } catch (error) {
        console.error('Middleware execution failed:', error)
        return NextResponse.next({ request })
    }
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
