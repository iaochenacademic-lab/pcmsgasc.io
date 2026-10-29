import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { Field, Form, Globe, Notice, PageHead, useToast } from './ui';
import type { Actor } from './types';

function PasswordInput({ name, autoComplete, minLength }: { name: string; autoComplete: string; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input"><input className="input" name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required/><button type="button" className="password-toggle" aria-label={visible ? '隱藏密碼' : '顯示密碼'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span>;
}
export function Login({ onUser }: { onUser: (user: Actor) => void }) {
  return <main className="auth-page"><section className="auth-panel"><div className="auth-panel-inner"><div className="auth-brand"><span className="brand-mark"><Globe/></span><span>國際議題研習學會</span></div><h2>登入</h2><p className="muted">使用老師提供的學號與密碼登入。</p><Form submit="登入學會" onSubmit={async data => { const result = await api<{ user: Actor }>('/api/auth/login', 'POST', { studentId: String(data.get('studentId')).trim(), password: String(data.get('password')) }); onUser(result.user); }}><Field label="學號／管理帳號"><input className="input" name="studentId" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={64} required placeholder="請輸入學號"/></Field><Field label="密碼"><PasswordInput name="password" autoComplete="current-password"/></Field></Form><div className="auth-help"><ShieldCheck size={20}/><p>帳號由老師建立及分發。<br/>忘記密碼或無法登入，請聯絡指導老師協助。</p></div></div></section></main>;
}
export function PasswordForm({ user, onUser }: { user: Actor; onUser: (user: Actor) => void }) {
  const toast = useToast(); const [version, setVersion] = useState(0);
  return <Form key={version} submit="更新密碼" onSubmit={async data => {
    const password = String(data.get('newPassword') ?? '');
    if (password !== String(data.get('confirmPassword'))) throw new Error('兩次新密碼不一致，請重新確認。');
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) throw new Error('新密碼至少 12 個字元，中文與其他字元合計不可超過 72 位元組。');
    const result = await api<{ user: Actor }>('/api/auth/change-password', 'POST', { currentPassword: String(data.get('currentPassword')), newPassword: password });
    onUser(result.user); setVersion(value => value + 1); toast('密碼已更新，其他裝置的登入已登出。');
  }}><input type="text" autoComplete="username" value={user.studentId} readOnly className="visually-hidden" tabIndex={-1} aria-hidden="true"/><Field label="目前密碼"><PasswordInput name="currentPassword" autoComplete="current-password"/></Field><Field label="新密碼" hint="至少 12 個字元。可使用空白及中文，總長度最多 72 位元組。"><PasswordInput name="newPassword" autoComplete="new-password" minLength={12}/></Field><Field label="再次輸入新密碼"><PasswordInput name="confirmPassword" autoComplete="new-password" minLength={12}/></Field></Form>;
}
export function Account({ user, onUser, logout, forced = false }: { user: Actor; onUser: (user: Actor) => void; logout: () => void; forced?: boolean }) {
  return <><PageHead title={forced ? '先設定你的新密碼' : '帳號設定'} description={forced ? '這是首次登入，請先更換初始密碼，即可進入學會。' : '管理登入密碼，保護你的個人紀錄。'}/><div className="grid grid-2"><section className="card"><SectionTitle/>{forced && <Notice kind="warning">為保護帳號，完成改密前無法使用其他功能。</Notice>}<PasswordForm user={user} onUser={onUser}/></section><aside className="card"><h2>{user.name}</h2><dl className="detail-list"><div><dt>學號／帳號</dt><dd>{user.studentId}</dd></div><div><dt>班別</dt><dd>{user.className || '—'}</dd></div><div><dt>身份</dt><dd>{user.role === 'admin' ? '管理員' : '學生'}</dd></div></dl><p className="muted">密碼更新後，其他裝置需重新登入。姓名或班別需要更正時，請聯絡管理員。</p><button className="button" onClick={logout}>登出帳號</button></aside></div></>;
}
function SectionTitle() { return <h2 className="form-title">變更密碼</h2>; }
