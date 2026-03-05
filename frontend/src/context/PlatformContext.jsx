import { createContext, useContext, useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'

const PlatformContext = createContext(null)

export function PlatformProvider({ children }) {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 1024)
    const isNative = Capacitor.isNativePlatform()

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 1024)
        }

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    return (
        <PlatformContext.Provider value={{
            isMobile,
            isNative,
            // We consider it "Web Mode" if it's not native AND not a small screen
            isWeb: !isNative && !isMobile,
            // "App Mode" is either native OR a small screen (where we want mobile-like UX)
            isApp: isNative || isMobile
        }}>
            {children}
        </PlatformContext.Provider>
    )
}

export function usePlatform() {
    const ctx = useContext(PlatformContext)
    if (!ctx) throw new Error('usePlatform must be used within PlatformProvider')
    return ctx
}
