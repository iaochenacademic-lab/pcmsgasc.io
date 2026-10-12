import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, ArrowRight, LoaderCircle } from 'lucide-react';
import { errorMessage, textField, useResource } from './api';
import type { Cycle } from './types';

export const ToastContext = createContext<(message: string) => void>(() => {});
const openModals: symbol[] = [];
let beforeModalOverflow = '';
export const useToast = () => useContext(ToastContext);
export function Globe() { return <svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="22"/><ellipse cx="28" cy="28" rx="10" ry="22"/><path d="M8 20h40M6 28h44M8 36h40M28 6v44"/></svg>; }
export function PageHead({ title, eyebrow, description, children }: { title: string; eyebrow: string; description?: string; children?: ReactNode }) { return <header className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="page-actions">{children}</div>}</header>; }
export function Tag({ children, kind = 'outline' }: { children: ReactNode; kind?: 'outline' | 'success' | 'warning' | 'danger' }) { return <span className={`tag tag-${kind}`}>{children}</span>; }
export function Notice({ children, kind = '', title }: { children: ReactNode; kind?: string; title?: string }) { return <div className={`notice ${kind ? `notice-${kind}` : ''}`} role={kind === 'error' ? 'alert' : undefined}>{title && <strong>{title}</strong>}{children}</div>; }
export function Empty({ children = '目前尚無紀錄。' }: { children?: ReactNode }) { return <div className="empty-state"><span className="eyebrow">a new page</span><p>{children}</p></div>; }
export function Loading() { return <div className="loading-state" role="status"><LoaderCircle className="spinner" size={22}/>正在載入…</div>; }
export function DataState({ loading, error, retry, children }: { loading: boolean; error: string; retry?: () => void; children: ReactNode }) { return loading ? <Loading/> : error ? <Notice kind="error"><p>{error}</p>{retry && <button className="button" onClick={retry}>重新載入</button>}</Notice> : <>{children}</>; }
export function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) { return <article className="card metric"><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong>{note && <span className="metric-delta">{note}</span>}</article>; }
export function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) { return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{children}</div>; }
export function Field({ label, children, hint, full = false }: { label: string; children: ReactNode; hint?: string; full?: boolean }) { return <label className={`field ${full ? 'field-full' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Form({ onSubmit, children, submit = '儲存', className = 'stack', danger = false, disabled = false }: { onSubmit: (data: FormData) => Promise<void>; children: ReactNode; submit?: string; className?: string; danger?: boolean; disabled?: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false);
  async function handle(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (lock.current || disabled) return; const data = new FormData(event.currentTarget); lock.current = true; setBusy(true); setError(''); try { await onSubmit(data); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); lock.current = false; } }
  return <form onSubmit={handle} className={className} aria-busy={busy}><fieldset disabled={busy} className="form-fieldset">{children}</fieldset>{error && <Notice kind="error">{error}</Notice>}<button type="submit" className={`button ${danger ? 'button-danger' : 'button-primary'}`} disabled={busy || disabled}>{busy ? <><LoaderCircle size={16} className="spinner"/>處理中…</> : <>{submit}<ArrowRight size={16}/></>}</button></form>;
}
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null); const closeRef = useRef(onClose); closeRef.current = onClose; const id = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null; const token = Symbol('modal'); if (!openModals.length) beforeModalOverflow = document.body.style.overflow; openModals.push(token); document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
    (focusable()[0] ?? panel.current)?.focus();
    function key(event: KeyboardEvent) {
      if (openModals.at(-1) !== token) return;
      if (event.key === 'Escape' && !panel.current?.querySelector('[aria-busy="true"]')) closeRef.current();
      if (event.key === 'Tab') { const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1]; if (!first) { event.preventDefault(); panel.current?.focus(); } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    }
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); const wasTop = openModals.at(-1) === token; openModals.splice(openModals.indexOf(token), 1); if (!openModals.length) document.body.style.overflow = beforeModalOverflow; if (wasTop && before?.isConnected) before.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !panel.current?.querySelector('[aria-busy="true"]')) onClose(); }}><div ref={panel} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">international studies society</span><h2 id={id}>{title}</h2></div><button className="icon-button" aria-label="關閉視窗" onClick={() => { if (!panel.current?.querySelector('[aria-busy="true"]')) onClose(); }}><X size={18}/></button></div>{children}</div></div>;
}
export function Confirm({ title, description, onClose, onConfirm, reason = true, submit = '確認執行' }: { title: string; description: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>; reason?: boolean; submit?: string }) { return <Modal title={title} onClose={onClose}><Form danger submit={submit} onSubmit={async data => { await onConfirm(textField(data, 'reason')); onClose(); }}><Notice kind="warning">{description}</Notice>{reason && <Field label="操作原因"><textarea className="textarea" name="reason" required minLength={2} maxLength={1000} rows={3}/></Field>}</Form></Modal>; }
export function CyclePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const resource = useResource<{ cycles: Cycle[] }>('/api/cycles');
  return <Field label="查閱週期"><select className="select" value={value} onChange={event => onChange(event.target.value)} disabled={resource.loading}><option value="">目前週期</option>{resource.data?.cycles.filter(cycle => cycle.status === 'archived').map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.name} · 已封存</option>)}</select>{resource.error && <small role="alert">週期列表無法載入。<button type="button" className="link-button" onClick={resource.refresh}>重試</button></small>}</Field>;
}
export function ReasonField({ hint }: { hint?: string }) { return <Field label="登記／更正原因" hint={hint}><textarea name="reason" className="textarea" required minLength={2} maxLength={1000} rows={2}/></Field>; }
