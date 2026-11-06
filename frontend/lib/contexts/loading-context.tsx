'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'

interface LoadingContextType {
    isLoading: boolean
    setIsLoading: (loading: boolean) => void
    startLoading: () => void
    stopLoading: () => void
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined)

export function LoadingProvider({ children }: { children: ReactNode }) {
    const [isLoading, setIsLoading] = useState(false)
    const [showLoading, setShowLoading] = useState(false)

    // Debounce loading screen to avoid flashes on fast transitions
    useEffect(() => {
        let timer: NodeJS.Timeout
        if (isLoading) {
            timer = setTimeout(() => setShowLoading(true), 300)
        } else {
            setShowLoading(false)
        }
        return () => clearTimeout(timer)
    }, [isLoading])

    const startLoading = () => setIsLoading(true)
    const stopLoading = () => setIsLoading(false)

    return (
        <LoadingContext.Provider value={{ isLoading, setIsLoading, startLoading, stopLoading }}>
            {children}
            <AnimatePresence>
                {showLoading && (
                    <motion.div
                        className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-white"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                        >
                            <Loader2 className="w-12 h-12 text-blue-500 opacity-80" />
                        </motion.div>
                        <motion.div
                            className="mt-6 font-mono text-sm tracking-widest text-blue-400"
                            animate={{ opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        >
                            CONNECTING TO EXCHANGE...
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </LoadingContext.Provider>
    )
}

export function useLoading() {
    const context = useContext(LoadingContext)
    if (context === undefined) {
        throw new Error('useLoading must be used within a LoadingProvider')
    }
    return context
}
