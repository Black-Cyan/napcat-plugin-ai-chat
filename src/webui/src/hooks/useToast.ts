import { useSyncExternalStore } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
    id: number
    message: string
    type: ToastType
    duration: number
    hiding?: boolean
}

let toasts: Toast[] = []
let toastId = 0
const listeners = new Set<() => void>()

function emitChange() {
    listeners.forEach((fn) => fn())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getSnapshot() {
    return toasts
}

export function addToast(message: string, type: ToastType = 'info', duration?: number) {
    const id = ++toastId
    const ttl = duration ?? (type === 'error' ? 6000 : 4000)
    toasts = [...toasts, { id, message, type, duration: ttl }]
    emitChange()
    return id
}

export function dismissToast(id: number) {
    toasts = toasts.map((toast) => toast.id === id ? { ...toast, hiding: true } : toast)
    emitChange()
    setTimeout(() => {
        toasts = toasts.filter((toast) => toast.id !== id)
        emitChange()
    }, 220)
}

export function useToasts() {
    return useSyncExternalStore(subscribe, getSnapshot)
}

export const showToast = (message: string, type: ToastType = 'info') => addToast(message, type)
