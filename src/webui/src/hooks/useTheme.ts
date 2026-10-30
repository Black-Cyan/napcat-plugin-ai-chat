import { useEffect, useState } from 'react'

export type ThemeMode = 'auto' | 'light' | 'dark'

export function useTheme() {
    const [theme, setTheme] = useState<ThemeMode>(() => {
        try {
            return (localStorage.getItem('napcat-theme') as ThemeMode) || 'auto'
        } catch {
            return 'auto'
        }
    })

    useEffect(() => {
        const apply = () => {
            let dark = false
            if (theme === 'dark') {
                dark = true
            } else if (theme === 'light') {
                dark = false
            } else {
                dark = window.matchMedia('(prefers-color-scheme: dark)').matches
            }
            document.documentElement.classList.toggle('dark', dark)
            try {
                localStorage.setItem('napcat-theme', theme)
            } catch {
                // ignore
            }
        }

        apply()

        if (theme === 'auto') {
            const mq = window.matchMedia('(prefers-color-scheme: dark)')
            mq.addEventListener('change', apply)
            return () => mq.removeEventListener('change', apply)
        }
    }, [theme])

    const toggleTheme = () => {
        setTheme((curr) => (curr === 'auto' ? 'dark' : curr === 'dark' ? 'light' : 'auto'))
    }

    return { theme, setTheme, toggleTheme }
}
