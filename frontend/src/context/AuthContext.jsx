import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { loginUser, registerUser, getProfile } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [token, setToken] = useState(() => localStorage.getItem('token'))
    const [loading, setLoading] = useState(true)

    // On mount, check if we have a stored token and fetch profile
    useEffect(() => {
        if (token) {
            getProfile()
                .then(res => setUser(res.data))
                .catch(() => {
                    localStorage.removeItem('token')
                    setToken(null)
                    setUser(null)
                })
                .finally(() => setLoading(false))
        } else {
            setLoading(false)
        }
    }, []) // eslint-disable-line

    const login = useCallback(async (email, password) => {
        const res = await loginUser(email, password)
        const { access_token, user: userData } = res.data
        localStorage.setItem('token', access_token)
        setToken(access_token)
        setUser(userData)
        return userData
    }, [])

    const register = useCallback(async (data) => {
        const res = await registerUser(data)
        return res.data
    }, [])

    const logout = useCallback(() => {
        localStorage.removeItem('token')
        setToken(null)
        setUser(null)
    }, [])

    const hasRole = useCallback((...roles) => {
        return user && roles.includes(user.role)
    }, [user])

    const isAdmin = user?.role === 'admin'
    const isAgronomist = user?.role === 'agronomist' || isAdmin
    const isFarmer = user?.role === 'farmer' || isAgronomist

    return (
        <AuthContext.Provider value={{
            user, token, loading,
            login, register, logout,
            hasRole, isAdmin, isAgronomist, isFarmer,
            isAuthenticated: !!user,
        }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
}

export default AuthContext
