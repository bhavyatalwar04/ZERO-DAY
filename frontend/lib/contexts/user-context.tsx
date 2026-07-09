'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { StoredUser, getUser, saveUser } from '@/lib/utils/localStorage'
import { createClient } from '@/lib/supabase/client'

interface UserContextType {
    user: StoredUser | null;
    setUser: (user: StoredUser | null) => void;
    clearUser: () => void;
    isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
    const [user, setUserState] = useState<StoredUser | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        // Load user from localStorage on mount
        const stored = getUser()
        if (stored) {
            setUserState(stored)
        }
        setIsLoading(false)

        // Sync with Supabase session changes
        const supabase = createClient()
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event: any, session: any) => {
            if (session?.user) {
                const metadata = session.user.user_metadata || {}
                const nameParts = (metadata.name || '').split(' ')
                const userObj: StoredUser = {
                    id: session.user.id,
                    firstName: metadata.first_name || nameParts[0] || '',
                    lastName: metadata.last_name || nameParts.slice(1).join(' ') || '',
                    email: session.user.email || '',
                    stats: metadata.stats || {
                        xp: 0,
                        level: 1,
                        streak: 0,
                        lastActiveDate: null,
                        completedScenarios: [],
                        accuracyHistory: [],
                        unlockedBadges: [],
                        knowledgeLevel: null,
                    }
                }

                // Prevent infinite loop by checking if state actually changed
                const existing = getUser()
                const hasChanged = !existing || 
                    existing.id !== userObj.id ||
                    existing.firstName !== userObj.firstName ||
                    existing.lastName !== userObj.lastName ||
                    JSON.stringify(existing.stats) !== JSON.stringify(userObj.stats)

                if (hasChanged) {
                    setUserState(userObj)
                    localStorage.setItem('zdm_user_v2', JSON.stringify(userObj))
                }
            } else if (event === 'SIGNED_OUT') {
                setUserState(null)
                localStorage.removeItem('zdm_user_v2')
            }
        })

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const setUser = (newUser: StoredUser | null) => {
        setUserState(newUser)
        if (newUser) {
            saveUser(newUser)
        } else {
            localStorage.removeItem('zdm_user_v2')
        }
    }

    const clearUser = () => {
        setUser(null)
    }

    return (
        <UserContext.Provider value={{ user, setUser, clearUser, isLoading }}>
            {children}
        </UserContext.Provider>
    )
}

export function useUser() {
    const context = useContext(UserContext)
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider')
    }
    return context
}
