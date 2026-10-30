import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

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
        <span className="field-label">{label}</span>
        {children}
        {hint && <span className="field-hint">{hint}</span>}
    </label>
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

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
    return <label className="toggle-row">
        <span>{label}</span>
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

export function ErrorNotice({ message }: { message: string }) {
    return message ? <div className="notice notice-error" role="alert">{message}</div> : null
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
    return <span className={`badge badge-${tone}`}>{children}</span>
}
