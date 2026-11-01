import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui'
import { IconDots, IconX } from './icons'

export interface PopoverAction {
    label: string
    onSelect: () => void
    danger?: boolean
    disabled?: boolean
}

/** 行尾三点按钮 + 玻璃 Popover 操作菜单 */
export function PopoverMenu({ actions, label = '更多操作' }: { actions: PopoverAction[]; label?: string }) {
    const [open, setOpen] = useState(false)
    const [position, setPosition] = useState({ top: 0, left: 0 })
    const anchor = useRef<HTMLDivElement>(null)
    const menu = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onPointer = (event: Event) => {
            const target = event.target as Node
            if (anchor.current?.contains(target) || menu.current?.contains(target)) return
            setOpen(false)
        }
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
        const onScroll = () => setOpen(false)
        document.addEventListener('pointerdown', onPointer)
        document.addEventListener('keydown', onKey)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
            document.removeEventListener('pointerdown', onPointer)
            document.removeEventListener('keydown', onKey)
            window.removeEventListener('scroll', onScroll, true)
            window.removeEventListener('resize', onScroll)
        }
    }, [open])

    const toggle = (event: React.MouseEvent) => {
        event.stopPropagation()
        if (!open && anchor.current) {
            // 用视口坐标挂到 body，避免被面板 overflow 或排版挤压。
            const rect = anchor.current.getBoundingClientRect()
            const width = 172
            const height = actions.length * 34 + 14
            const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
            const below = rect.bottom + 6
            const top = below + height > window.innerHeight - 12
                ? Math.max(12, rect.top - height - 6)
                : below
            setPosition({ top, left })
        }
        setOpen((value) => !value)
    }

    return <div className="popover-anchor" ref={anchor}>
        <button
            type="button"
            className="icon-button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
        ><IconDots size={16} /></button>
        {open && createPortal(<div ref={menu} className="popover popover-portal" role="menu" style={{ top: position.top, left: position.left, right: 'auto' }}>
            {actions.map((action) => <button
                key={action.label}
                type="button"
                role="menuitem"
                className={`popover-item ${action.danger ? 'danger' : ''}`}
                disabled={action.disabled}
                onClick={(event) => { event.stopPropagation(); setOpen(false); action.onSelect() }}
            >{action.label}</button>)}
        </div>, document.body)}
    </div>
}

export function SidePanel({ title, subtitle, onClose, footer, children, dirty = false }: {
    title: string
    subtitle?: string
    onClose: () => void
    footer?: ReactNode
    children: ReactNode
    dirty?: boolean
}) {
    const [confirmClose, setConfirmClose] = useState(false)
    const requestClose = useCallback(() => {
        if (!dirty) { onClose(); return }
        setConfirmClose(true)
    }, [dirty, onClose])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [requestClose])

    return <div className="overlay" onClick={requestClose}>
        <aside className="side-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
            <header className="side-panel-header">
                <div className="side-panel-heading">
                    <h3>{title}</h3>
                    {subtitle && <p>{subtitle}</p>}
                </div>
                <button type="button" className="icon-button" aria-label="关闭面板" onClick={requestClose}><IconX size={16} /></button>
            </header>
            <div className="side-panel-body">{children}</div>
            {footer && <footer className="side-panel-footer">{footer}</footer>}
        </aside>
        {confirmClose && <ConfirmDialog
            title="放弃未保存的修改？"
            description="关闭后，本次在该面板中做的修改不会保存。"
            confirmLabel="放弃修改"
            onCancel={() => setConfirmClose(false)}
            onConfirm={() => { setConfirmClose(false); onClose() }}
        />}
    </div>
}

export function ConfirmDialog({ title, description, confirmLabel = '确认删除', cancelLabel = '取消', danger = true, onConfirm, onCancel, busy = false }: {
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onCancel])

    return <div className="overlay overlay-center" onClick={onCancel}>
        <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
            <div className="confirm-actions">
                <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
                <Button variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>{busy ? '处理中' : confirmLabel}</Button>
            </div>
        </div>
    </div>
}

interface ConfirmOptions {
    title: string
    description?: string
    confirmLabel?: string
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => true)

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null)
    const ask = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve })
    }), [])
    return <ConfirmContext.Provider value={ask}>
        {children}
        {pending && <ConfirmDialog
            title={pending.title}
            description={pending.description}
            confirmLabel={pending.confirmLabel}
            onCancel={() => { pending.resolve(false); setPending(null) }}
            onConfirm={() => { pending.resolve(true); setPending(null) }}
        />}
    </ConfirmContext.Provider>
}

/** 用 await ask({ title, description }) 替代浏览器 confirm() */
export function useConfirm() {
    return useContext(ConfirmContext)
}
