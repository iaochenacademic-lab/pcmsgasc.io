import { useCallback, useEffect, useState } from 'react';
import { Menu, UserRound, LogOut } from 'lucide-react';
import { ApiError, api, errorMessage } from './api';
import type { Actor } from './types';
import { Account, Login } from './auth';
import { DataState, Globe, Modal, ToastContext } from './ui';
import { Checkin, Credits, Dashboard, Events, RankingsPage, Records } from './student';
import { Members } from './members';
import { ClassesAdmin } from './classes';
import { EventsAdmin } from './events';
import { Adjustments, Archives, AuditPage, Decisions, Settings } from './governance';

const studentNav = [['dashboard', '本期首頁', 'home'], ['checkin', '課堂簽到', 'attendance'], ['events', '活動一覽', 'programme'], ['record', '我的紀錄', 'personal record'], ['leaderboard', '積分排行榜', 'ranking'], ['account', '帳號設定', 'account'], ['credits', '開發致謝', 'acknowledgements']];
const adminNav = [['dashboard', '管理總覽', 'overview'], ['members', '成員管理', 'directory'], ['sessions', '課次與點名', 'attendance'], ['activities', '活動管理', 'programme'], ['leaderboard', '積分排行榜', 'ranking'], ['record', '成員積分紀錄', 'records'], ['adjustments', '分數修正', 'score ledger'], ['thresholds', '門檻設定', 'thresholds'], ['decisions', '截止待審', 'review'], ['archives', '封存與新期', 'archive'], ['logs', '操作紀錄', 'audit & export'], ['account', '帳號設定', 'account'], ['credits', '開發致謝', 'acknowledgements']];
const initialPage = () => window.location.hash.slice(1) || (window.location.pathname === '/checkin' ? 'checkin' : 'dashboard');

export function App() {
  const [user, setUser] = useState<Actor | null>(null); const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const [page, setPage] = useState(initialPage); const [menu, setMenu] = useState(false); const [toast, setToast] = useState(''); const [loggingOut, setLoggingOut] = useState(false);
  const notify = useCallback((message: string) => setToast(message), []);
  const loadUser = useCallback(async () => { setReady(false); setError(''); try { setUser((await api<{ user: Actor }>('/api/auth/me')).user); } catch (failure) { if (!(failure instanceof ApiError && failure.status === 401)) setError(errorMessage(failure)); setUser(null); } finally { setReady(true); } }, []);
  useEffect(() => { void loadUser(); const expired = () => { setUser(null); setToast('登入已到期或已撤銷，請重新登入。'); }; window.addEventListener('session-expired', expired); return () => window.removeEventListener('session-expired', expired); }, [loadUser]);
  useEffect(() => { const changed = () => { setPage(initialPage()); setMenu(false); }; window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  const navigate = (destination: string) => { window.location.hash = destination; setPage(destination); setMenu(false); window.scrollTo({ top: 0 }); requestAnimationFrame(() => document.getElementById('main-content')?.focus()); };
  const logout = async () => { if (loggingOut) return; setLoggingOut(true); try { await api('/api/auth/logout', 'POST', {}); setUser(null); } catch (failure) { notify(errorMessage(failure)); } finally { setLoggingOut(false); } };
  const nav = user?.role === 'admin' ? adminNav : studentNav;
  const selected = nav.find(item => item[0] === page) ?? nav[0];
  const activePage = selected[0];
  function content() {
    if (!user) return null;
    if (user.mustChangePassword || activePage === 'account') return <Account user={user} onUser={setUser} logout={() => void logout()} forced={user.mustChangePassword}/>;
    switch (activePage) {
      case 'dashboard': return <Dashboard user={user} navigate={navigate}/>;
      case 'checkin': return <Checkin/>;
      case 'events': return <Events/>;
      case 'record': return <Records user={user}/>;
      case 'leaderboard': return <RankingsPage user={user}/>;
      case 'members': return <Members currentUser={user} onUserChanged={loadUser}/>;
      case 'sessions': return <ClassesAdmin/>;
      case 'activities': return <EventsAdmin/>;
      case 'adjustments': return <Adjustments/>;
      case 'thresholds': return <Settings/>;
      case 'decisions': return <Decisions/>;
      case 'archives': return <Archives navigate={navigate}/>;
      case 'logs': return <AuditPage/>;
      default: return <Credits/>;
    }
  }
  return <ToastContext.Provider value={notify}>{!ready || error ? <main className="startup"><div className="auth-mark"><Globe/></div><DataState loading={!ready} error={error} retry={() => void loadUser()}><></></DataState></main> : !user ? <Login onUser={setUser}/> : <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳至主要內容</a><div className="app-shell"><aside className="sidebar" aria-label="主要導覽"><div className="brand"><span className="brand-mark"><Globe/></span><div><strong>國際議題研習學會</strong><span>international studies society</span></div></div><div className="identity-label"><span className="eyebrow">{user.role === 'admin' ? 'administration' : 'member workspace'}</span><strong>{user.name}<small>{user.role === 'admin' ? '管理員' : user.className}</small></strong></div><nav className="nav-list">{!user.mustChangePassword && nav.map(([id, label], index) => <button key={id} className="nav-button" onClick={() => navigate(id)} aria-current={activePage === id ? 'page' : undefined}><span className="nav-number">{String(index + 1).padStart(2, '0')}</span>{label}</button>)}</nav><div className="sidebar-note"><span className="eyebrow">observe · question · understand</span><p>探索世界，也記錄每一次參與。<br/>所有時間均以東八區顯示。</p></div></aside><div className="workspace"><header className="topbar"><div className="mobile-brand"><Globe/><span>國際議題研習學會</span></div><div className="topbar-context"><span className="eyebrow">{selected[2]}</span><strong>{user.mustChangePassword ? '首次登入' : selected[1]}</strong></div><div className="topbar-actions"><button className="icon-button" onClick={() => navigate('account')} aria-label="帳號設定"><UserRound/></button><button className="icon-button" disabled={loggingOut} onClick={() => void logout()} aria-label="登出"><LogOut/></button>{!user.mustChangePassword && <button className="icon-button mobile-only" onClick={() => setMenu(true)} aria-label="開啟全部頁面" aria-expanded={menu}><Menu/></button>}</div></header><main id="main-content" tabIndex={-1} key={activePage}>{content()}</main></div>{!user.mustChangePassword && <nav className="mobile-nav" aria-label="手機主要導覽">{nav.slice(0, 4).map(([id, label], index) => <button key={id} data-index={String(index + 1).padStart(2, '0')} aria-current={id === activePage ? 'page' : undefined} onClick={() => navigate(id)}>{label.replace('管理', '').replace('本期', '')}</button>)}<button data-index="··" aria-current={nav.slice(0, 4).some(item => item[0] === activePage) ? undefined : 'page'} onClick={() => setMenu(true)}>更多</button></nav>}</div>{menu && <Modal title="全部頁面" onClose={() => setMenu(false)}><nav className="mobile-sheet-list">{nav.map(([id, label]) => <button key={id} className="nav-button" aria-current={id === activePage ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav></Modal>}</>}<div className="toast-root" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="toast">{toast}</div>}</div></ToastContext.Provider>;
}
