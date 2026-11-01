import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../hooks/useToast'

export function Panel({ title, description, actions, children, className = '' }: {
    title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
    return <section className={`panel ${className}`}>
        {(title || actions) && <div className="panel-heading">
            <div>{title && <h3>{title}</h3>}{description && <p>{description}</p>}</div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>}
        <div className="panel-body">{children}</div>
    </section>
}

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
    return <button type="button" {...props} className={`button button-${variant} ${className}`} />
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
    return <label className={`field ${wide ? 'field-wide' : ''}`}>
        <span className="field-label">{label}{hint && <Tooltip text={hint} />}</span>
        {children}
    </label>
}

/** 需要补充说明时用悬停问号占位，避免长段说明文字占据版面。 */
export function Tooltip({ text }: { text: string }) {
    const anchor = useRef<HTMLSpanElement>(null)
    const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null)
    const show = () => {
        const rect = anchor.current?.getBoundingClientRect()
        if (!rect) return
        const left = Math.max(12, Math.min(rect.left + rect.width / 2 - 130, window.innerWidth - 272))
        const top = rect.top > 140 ? rect.top - 8 : rect.bottom + 8
        setPosition({ top, left, above: rect.top > 140 })
    }
    return <span
        ref={anchor}
        className="tooltip"
        tabIndex={0}
        role="note"
        aria-label={text}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => setPosition(null)}
        onBlur={() => setPosition(null)}
    >
        ?
        {position && createPortal(<span
            className="tooltip-bubble tooltip-bubble-portal"
            role="tooltip"
            style={{ top: position.top, left: position.left, transform: position.above ? 'translateY(-100%)' : 'none' }}
        >{text}</span>, document.body)}
    </span>
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
    return <input {...props} className={`input ${props.className ?? ''}`} />
}

export function NumberInput({ value, ...props }: InputHTMLAttributes<HTMLInputElement>) {
    return <Input type="number" value={value} {...props} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return <textarea {...props} className={`input textarea ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
    return <select {...props} className={`input select ${props.className ?? ''}`} />
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }) {
    return <label className="toggle-row">
        <span>{label}{hint && <Tooltip text={hint} />}</span>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
}

export function Loading({ label = '正在加载' }: { label?: string }) {
    return <div className="empty"><span className="loading-line" />{label}</div>
}

export function Empty({ title, description }: { title: string; description: string }) {
    return <div className="empty"><strong>{title}</strong><span>{description}</span></div>
}

/** 操作结果统一走带倒计时进度条的 Toast。 */
export function Notice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'success' | 'error' | 'warning' }) {
    const previous = useRef('')
    useEffect(() => {
        if (message && message !== previous.current) showToast(message, tone)
        previous.current = message
    }, [message, tone])
    return null
}

export function ErrorNotice({ message }: { message: string }) {
    return <Notice message={message} tone="error" />
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
    return <span className={`badge badge-${tone}`}>{children}</span>
}

/** 固定宽度内循环滚动展示超长文本，避免撑破侧栏布局；悬停暂停便于阅读。 */
export function MarqueeText({ text, className = '' }: { text: string; className?: string }) {
    const host = useRef<HTMLElement>(null)
    const [overflow, setOverflow] = useState(false)
    useEffect(() => {
        const element = host.current
        if (!element) return
        const measure = () => {
            // 直接量文本自然宽度：裁剪后的子节点无法反映真实溢出。
            const probe = document.createElement('span')
            const style = getComputedStyle(element)
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;'
            probe.style.font = style.font
            probe.textContent = text
            document.body.appendChild(probe)
            const natural = probe.offsetWidth
            probe.remove()
            setOverflow(natural > element.clientWidth + 2)
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [text])
    return <span ref={host} className={`marquee ${overflow ? 'marquee-active' : ''} ${className}`}>
        {overflow
            ? <span className="marquee-inner"><span>{text}</span><span aria-hidden="true">{text}</span></span>
            : <span className="marquee-text">{text}</span>}
    </span>
}
