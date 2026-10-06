import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { safeNext } from '@/lib/auth/redirect'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    // safeNext blocks open redirects (?next=@evil.com) and defaults to /ledger
    const next = safeNext(searchParams.get('next'))

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    // Return the user to an error page with some instructions
    // (Previously /auth/auth-code-error, a page that doesn't exist.)
    return NextResponse.redirect(`${origin}/login?error=auth_callback`)
}
