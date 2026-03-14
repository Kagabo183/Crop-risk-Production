import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations } from '../utils/translations';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
    // Check localStorage first, fallback to 'en'
    const [language, setLanguageState] = useState(() => {
        const stored = localStorage.getItem('app_language');
        return stored || 'en';
    });

    const setLanguage = useCallback((lang) => {
        setLanguageState(lang);
        localStorage.setItem('app_language', lang);
    }, []);

    const toggleLanguage = useCallback(() => {
        setLanguage(language === 'en' ? 'rw' : 'en');
    }, [language, setLanguage]);

    const t = useCallback((key) => {
        // Look up translation using key. Fall back to English dict, then key itself if missing.
        const dict = translations[language];
        const enDict = translations['en'];
        return dict[key] || enDict[key] || key;
    }, [language]);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
