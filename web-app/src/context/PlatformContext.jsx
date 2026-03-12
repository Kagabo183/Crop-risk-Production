import { createContext, useContext } from 'react'

// In the web-app we are ALWAYS on web — no Capacitor, no mobile detection needed.
const PlatformContext = createContext({
  isMobile: false,
  isNative: false,
  isWeb: true,
  isApp: false,
})

export function PlatformProvider({ children }) {
  return (
    <PlatformContext.Provider value={{ isMobile: false, isNative: false, isWeb: true, isApp: false }}>
      {children}
    </PlatformContext.Provider>
  )
}

export function usePlatform() {
  return useContext(PlatformContext)
}

export default PlatformContext
