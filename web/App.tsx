import { useCallback, useEffect, useState } from 'react';
import { Archive, CalendarDays, ClipboardCheck, FileText, Gavel, House, Info, LayoutDashboard, LogOut, Menu, PenLine, ScrollText, Settings as SettingsIcon, SlidersHorizontal, Trophy, UserRound, Users, type LucideIcon } from 'lucide-react';
import { ApiError, api, errorMessage } from './api';
import type { Actor } from './types';
import { Account, Login } from './auth';
import { DataState, Globe, Modal, ToastContext } from './ui';
import { Checkin, Credits, Dashboard, Events, RankingsPage, Records } from './student';
import { Members } from './members';
import { ClassesAdmin } from './classes';
import { EventsAdmin } from './events';
import { Adjustments, Archives, AuditPage, Decisions, Settings } from './governance';

interface NavItem { id: string; label: string; short: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }
const studentNav: NavGroup[] = [
  { label: '', items: [{ id: 'dashboard', label: '本期首頁', short: '首頁', icon: House }, { id: 'checkin', label: '課堂簽到', short: '簽到', icon: ClipboardCheck }, { id: 'events', label: '活動一覽', short: '活動', icon: CalendarDays }, { id: 'record', label: '我的紀錄', short: '紀錄', icon: FileText }, { id: 'leaderboard', label: '積分排行榜', short: '排行', icon: Trophy }] },
  { label: '其他', items: [{ id: 'account', label: '帳號設定', short: '帳號', icon: SettingsIcon }, { id: 'credits', label: '開發致謝', short: '致謝', icon: Info }] },
];
const adminNav: NavGroup[] = [
  { label: '日常', items: [{ id: 'dashboard', label: '管理總覽', short: '總覽', icon: LayoutDashboard }, { id: 'members', label: '成員管理', short: '成員', icon: Users }, { id: 'sessions', label: '課次與點名', short: '點名', icon: ClipboardCheck }, { id: 'activities', label: '活動管理', short: '活動', icon: CalendarDays }] },
  { label: '積分', items: [{ id: 'leaderboard', label: '積分排行榜', short: '排行', icon: Trophy }, { id: 'record', label: '成員積分紀錄', short: '紀錄', icon: FileText }, { id: 'adjustments', label: '分數修正', short: '修正', icon: PenLine }] },
  { label: '學期結算', items: [{ id: 'thresholds', label: '門檻設定', short: '門檻', icon: SlidersHorizontal }, { id: 'decisions', label: '截止待審', short: '待審', icon: Gavel }, { id: 'archives', label: '封存與新期', short: '封存', icon: Archive }] },
  { label: '系統', items: [{ id: 'logs', label: '操作紀錄', short: '紀錄', icon: ScrollText }, { id: 'account', label: '帳號設定', short: '帳號', icon: SettingsIcon }, { id: 'credits', label: '開發致謝', short: '致謝', icon: Info }] },
];
function NavGroups({ groups, active, navigate }: { groups: NavGroup[]; active: string; navigate: (id: string) => void }) {
  return <>{groups.map(group => <div className="nav-group" key={group.label}>{group.label && <span className="nav-group-label">{group.label}</span>}{group.items.map(({ id, label, icon: Icon }) => <button key={id} className="nav-button" onClick={() => navigate(id)} aria-current={active === id ? 'page' : undefined}><Icon/>{label}</button>)}</div>)}</>;
}
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
  const groups = user?.role === 'admin' ? adminNav : studentNav;
  const nav = groups.flatMap(group => group.items);
  const selected = nav.find(item => item.id === page) ?? nav[0];
  const activePage = selected.id;
  const mobileNav = nav.slice(0, 4);
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
  return <ToastContext.Provider value={notify}>{!ready || error ? <main className="startup"><div className="auth-mark"><Globe/></div><DataState loading={!ready} error={error} retry={() => void loadUser()}><></></DataState></main> : !user ? <Login onUser={setUser}/> : <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳至主要內容</a><div className="app-shell"><aside className="sidebar" aria-label="主要導覽"><div className="brand"><span className="brand-mark"><Globe/></span><strong>國際議題研習學會</strong></div><div className="identity-label"><strong>{user.name}</strong><small>{user.role === 'admin' ? '管理員' : user.className}</small></div><nav className="nav-list">{!user.mustChangePassword && <NavGroups groups={groups} active={activePage} navigate={navigate}/>}</nav><p className="sidebar-note">所有時間均為東八區。</p></aside><div className="workspace"><header className="topbar"><div className="mobile-brand"><Globe/><span>國際議題研習學會</span></div><div className="topbar-context"><strong>{user.mustChangePassword ? '首次登入' : selected.label}</strong></div><div className="topbar-actions"><button className="icon-button" onClick={() => navigate('account')} aria-label="帳號設定"><UserRound/></button><button className="icon-button" disabled={loggingOut} onClick={() => void logout()} aria-label="登出"><LogOut/></button>{!user.mustChangePassword && <button className="icon-button mobile-only" onClick={() => setMenu(true)} aria-label="開啟全部頁面" aria-expanded={menu}><Menu/></button>}</div></header><main id="main-content" tabIndex={-1} key={activePage}>{content()}</main></div>{!user.mustChangePassword && <nav className="mobile-nav" aria-label="手機主要導覽">{mobileNav.map(({ id, short, icon: Icon }) => <button key={id} aria-current={id === activePage ? 'page' : undefined} onClick={() => navigate(id)}><Icon/>{short}</button>)}<button aria-current={mobileNav.some(item => item.id === activePage) ? undefined : 'page'} onClick={() => setMenu(true)}><Menu/>更多</button></nav>}</div>{menu && <Modal title="全部頁面" onClose={() => setMenu(false)}><nav className="mobile-sheet-list"><NavGroups groups={groups} active={activePage} navigate={navigate}/></nav></Modal>}</>}<div className="toast-root" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="toast">{toast}</div>}</div></ToastContext.Provider>;
}
