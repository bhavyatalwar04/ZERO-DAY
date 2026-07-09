'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useNavigation } from '@/lib/contexts/navigation-context'
import { useUser } from '@/lib/contexts/user-context'
import { initUser } from '@/lib/utils/localStorage'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
    const { navigateTo } = useNavigation()
    const { setUser } = useUser()
    const [mounted, setMounted] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [formData, setFormData] = useState({
        email: '',
        password: '',
    })
    const [isLoading, setIsLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)

    useEffect(() => {
        setMounted(true)
    }, [])

    const handleGoogleSignIn = async () => {
        setAuthError(null)
        try {
            const supabase = createClient()
            const isConfigured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('https://')
            if (!isConfigured) {
                // Mock Google sign in for demo/stub mode
                const newUser = initUser({
                    id: `usr_google_${Date.now()}`,
                    firstName: 'Demo',
                    lastName: 'User',
                    email: 'demo@zeroday.market',
                })
                setUser(newUser)
                navigateTo('/welcome')
                return
            }

            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback?next=/welcome`,
                },
            })

            if (error) {
                setAuthError(error.message)
            }
        } catch (err: any) {
            setAuthError(err.message || 'Failed to start Google sign-in')
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setAuthError(null)

        try {
            const supabase = createClient()
            const isConfigured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('https://')
            if (!isConfigured) {
                // Offline fallback - search if user details can be stubbed
                const emailParts = formData.email.split('@')
                const name = emailParts[0]
                const newUser = initUser({
                    id: `usr_${Date.now()}`,
                    firstName: name.charAt(0).toUpperCase() + name.slice(1),
                    lastName: 'Trader',
                    email: formData.email,
                })
                setUser(newUser)
                setTimeout(() => {
                    navigateTo('/welcome')
                }, 1000)
                return
            }

            const { data, error } = await supabase.auth.signInWithPassword({
                email: formData.email,
                password: formData.password,
            })

            if (error) {
                setAuthError(error.message)
                setIsLoading(false)
                return
            }

            if (data?.user) {
                const metadata = data.user.user_metadata || {}
                const nameParts = (metadata.name || '').split(' ')
                const newUser = initUser({
                    id: data.user.id,
                    firstName: metadata.first_name || nameParts[0] || 'Welcome',
                    lastName: metadata.last_name || nameParts.slice(1).join(' ') || 'User',
                    email: formData.email,
                })
                setUser(newUser)
                navigateTo('/welcome')
            }
        } catch (err: any) {
            setAuthError(err.message || 'Authentication failed')
            setIsLoading(false)
        }
    }

    if (!mounted) return <div className="min-h-screen bg-black" />

    return (
        <div className="min-h-screen flex">
            {/* Left Side - Compact art panel */}
            <div className="hidden lg:flex lg:w-[38%] bg-black flex-col justify-between p-8 relative overflow-hidden">
                <div
                    className="absolute -left-[-10%] -right-[5%] top-0 bottom-0 bg-cover bg-center"
                    style={{
                        backgroundImage: 'url(/images/AJ_fx.jpg)',
                        filter: 'brightness(0.7)',
                        transform: 'scale(1.15)'
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />

                {/* Logo */}
                <motion.div
                    className="relative z-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8 }}
                >
                    <Link href="/">
                        <span
                            className="text-3xl tracking-[0.12em]"
                            style={{ fontFamily: 'var(--font-anton), sans-serif' }}
                        >
                            <span className="text-red-600">ZERO-DAY</span>{' '}
                            <span className="text-white/90">MARKET</span>
                        </span>
                    </Link>
                </motion.div>

                {/* Bottom content */}
                <motion.div
                    className="relative z-10"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                >
                    <h1 className="text-[32px] leading-[1.2] text-white font-light tracking-tight mb-4">
                        Sign in to the<br />
                        <span className="text-white/50">simulations terminal.</span>
                    </h1>
                    <div className="flex items-center gap-4 text-white/35 text-xs mt-6">
                        <span>50+ scenarios</span>
                        <span className="w-1 h-1 rounded-full bg-white/25" />
                        <span>Zero risk</span>
                        <span className="w-1 h-1 rounded-full bg-white/25" />
                        <span>Free</span>
                    </div>
                </motion.div>
            </div>

            {/* Right Side - Form area */}
            <div className="w-full lg:w-[62%] bg-black flex items-center justify-center p-8 lg:px-16 relative overflow-hidden">
                {/* Ambient glow */}
                <div
                    className="absolute top-20 right-20 w-[500px] h-[500px] rounded-full blur-3xl opacity-[0.025]"
                    style={{ background: 'radial-gradient(circle, #ffffff 0%, transparent 60%)' }}
                />
                <div
                    className="absolute -bottom-20 -left-20 w-[400px] h-[400px] rounded-full blur-3xl opacity-[0.02]"
                    style={{ background: 'radial-gradient(circle, #22c55e 0%, transparent 60%)' }}
                />

                <motion.div
                    className="w-full max-w-xl relative z-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                >
                    {/* Mobile Logo */}
                    <div className="lg:hidden mb-8">
                        <Link href="/">
                            <span
                                className="text-xl tracking-wider"
                                style={{ fontFamily: 'var(--font-anton), sans-serif' }}
                            >
                                <span className="text-red-600">ZERO-DAY</span>{' '}
                                <span className="text-white/90">MARKET</span>
                            </span>
                        </Link>
                    </div>

                    {/* Header */}
                    <div className="mb-10">
                        <h2
                            className="text-[32px] text-white tracking-wide mb-3"
                            style={{ fontFamily: 'var(--font-anton), sans-serif' }}
                        >
                            Sign in to terminal
                        </h2>
                        <p className="text-white/40 text-sm">
                            Access historical scenarios and profile progress
                        </p>
                    </div>

                    {/* Social Login */}
                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <button
                            type="button"
                            onClick={handleGoogleSignIn}
                            className="flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white/[0.03] border border-white/10 text-white/70 hover:bg-white/[0.06] hover:border-white/20 transition-all text-sm"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </button>
                        <button
                            type="button"
                            className="flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white/[0.03] border border-white/10 text-white/70 hover:bg-white/[0.06] hover:border-white/20 transition-all text-sm opacity-50 cursor-not-allowed"
                        >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                            </svg>
                            Continue with Apple
                        </button>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-4 mb-8">
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-white/25 text-xs tracking-wider">OR</span>
                        <div className="flex-1 h-px bg-white/10" />
                    </div>

                    {authError && (
                        <div className="mb-6 p-4 bg-red-950/40 border border-red-500/30 rounded-xl text-red-400 text-sm">
                            {authError}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Email */}
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full px-4 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/25 focus:bg-white/[0.05] focus:outline-none transition-all text-sm"
                            placeholder="Email address"
                            required
                        />

                        {/* Password */}
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/25 focus:bg-white/[0.05] focus:outline-none transition-all text-sm pr-12"
                                placeholder="Password"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/50 transition-colors"
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* Submit */}
                        <div className="pt-2 relative">
                            <div className="absolute inset-0 rounded-xl blur-xl bg-white/5" />
                            <motion.button
                                type="submit"
                                disabled={isLoading}
                                className="relative w-full py-4 rounded-xl bg-white text-black text-sm font-medium tracking-wide hover:bg-white/95 hover:shadow-[0_0_40px_rgba(255,255,255,0.1)] transition-all disabled:opacity-50"
                                whileTap={{ scale: 0.995 }}
                            >
                                {isLoading ? 'Signing in...' : 'Sign In'}
                            </motion.button>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-4 text-sm">
                            <div>
                                <span className="text-white/30">New to Zero Day? </span>
                                <Link href="/signup" className="text-white/60 hover:text-white transition-colors">
                                    Create account
                                </Link>
                            </div>
                            <div className="text-white/20 text-xs">
                                <Link href="/terms" className="hover:text-white/40 transition-colors">Terms</Link>
                                <span className="mx-2">·</span>
                                <Link href="/privacy" className="hover:text-white/40 transition-colors">Privacy</Link>
                            </div>
                        </div>
                    </form>
                </motion.div>
            </div>
        </div>
    )
}
