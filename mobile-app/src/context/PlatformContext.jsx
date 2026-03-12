import { createContext, useContext } from 'react'
import { Capacitor } from '@capacitor/core'

// In the mobile-app we are ALWAYS in mobile/app mode.
const isNative = Capacitor.isNativePlatform()

const PlatformContext = createContext({
  isMobile: true,
  isNative,
  isWeb: false,
  isApp: true,
})

export function PlatformProvider({ children }) {
  return (
    <PlatformContext.Provider value={{ isMobile: true, isNative, isWeb: false, isApp: true }}>
      {children}
    </PlatformContext.Provider>
  )
}

export function usePlatform() {
  return useContext(PlatformContext)
}

export default PlatformContext
