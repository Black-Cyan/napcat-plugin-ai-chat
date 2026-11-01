import { useEffect, useRef, useState } from 'react'
import { dismissToast, useToasts, type Toast } from '../hooks/useToast'
import { IconCheck, IconX, IconInfo, IconAlert } from './icons'

const RING_LENGTH = 2 * Math.PI * 10

const toneIcon = {
    success: <IconCheck size={15} />,
    error: <IconX size={15} />,
    info: <IconInfo size={15} />,
    warning: <IconAlert size={15} />,
}

export default function ToastContainer() {
    const toasts = useToasts()
    return <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} />)}
    </div>
}

function ToastItem({ toast }: { toast: Toast }) {
    const [progress, setProgress] = useState(100)
    const remaining = useRef(toast.duration)
    const paused = useRef(false)
    const dismissed = useRef(false)

    useEffect(() => {
        if (toast.hiding) return
        let frame = 0
        let last = performance.now()
        const tick = (now: number) => {
            const delta = now - last
            last = now
            if (!paused.current) {
                // 进度条与剩余时间共用同一个计时源，保证归零即关闭。
                remaining.current = Math.max(0, remaining.current - delta)
                setProgress((remaining.current / toast.duration) * 100)
                if (remaining.current <= 0 && !dismissed.current) {
                    dismissed.current = true
                    dismissToast(toast.id)
                    return
                }
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [toast.id, toast.duration, toast.hiding])

    return <div
        className={`toast toast-${toast.type} ${toast.hiding ? 'toast-exit' : 'toast-enter'}`}
        role="status"
        onMouseEnter={() => { paused.current = true }}
        onMouseLeave={() => { paused.current = false }}
    >
        <div className="toast-content">
            <span className="toast-icon">{toneIcon[toast.type]}</span>
            <span className="toast-message">{toast.message}</span>
            {!toast.hiding && <svg className="toast-ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle className="toast-ring-track" cx="11" cy="11" r="10" fill="none" strokeWidth="2" />
            <circle
                className="toast-ring-progress"
                cx="11" cy="11" r="10" fill="none" strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={RING_LENGTH * (1 - progress / 100)}
                transform="rotate(-90 11 11)"
            />
        </svg>}
            <button type="button" className="toast-close" aria-label="关闭通知" onClick={() => dismissToast(toast.id)}>
                <IconX size={13} />
            </button>
        </div>
    </div>
}
