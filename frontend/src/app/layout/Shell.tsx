import { useRecordingActivity } from '@/modules/recording/presentation/useRecorder';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { canAccess } from '@/modules/auth/domain/accessPolicy';
import { pagePolicies, workspaceNavigation } from '../routing/access';
import { Burger, Button, Drawer, Group, Menu, Modal, Text, UnstyledButton } from '@mantine/core';
import { CalendarDays, CheckSquare2, ChevronDown, LogOut, MessageSquareText, Mic2, PanelLeftClose, PanelLeftOpen, Plug2, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useBlocker, useLocation } from 'react-router-dom';
import styles from './Shell.module.css';

const navigationIcons = { meetings: CalendarDays, tasks: CheckSquare2, integrations: Plug2, settings: Settings2, meeting: CalendarDays, newMeeting: CalendarDays, liveMeeting: Mic2, chat: MessageSquareText };

function pageName(pathname: string) {
  if (pathname.startsWith('/chat')) return 'Чат по встречам';
  if (pathname.startsWith('/meetings/live/call')) return 'Разговор';
  if (pathname.startsWith('/meetings/live')) return 'Разговоры';
  if (pathname.startsWith('/meetings/new')) return 'Новая встреча';
  if (pathname.startsWith('/meetings/') && pathname !== '/meetings/') return 'Встреча';
  if (pathname.startsWith('/tasks')) return 'Поручения';
  if (pathname.startsWith('/integrations')) return 'Интеграции';
  if (pathname.startsWith('/settings')) return 'Настройки';
  return 'Встречи';
}

export default function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('siqyr-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem('siqyr-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      // Browser storage may be unavailable.
    }
  }, [sidebarCollapsed]);
  const { state: auth, controller } = useAuth();
  const recording = useRecordingActivity();
  const { pathname } = useLocation();
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    recording && (currentLocation.pathname === '/meetings/new' || currentLocation.pathname === '/meetings/live/call') && nextLocation.pathname !== currentLocation.pathname,
  );
  const { settings } = useWorkspace();
  const displayName = settings.displayName.trim() || (auth.status === 'authenticated' ? auth.session.principal.displayName : '') || 'Моё пространство';
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('ru')).join('');
  const navigation = workspaceNavigation.filter((item) => auth.status === 'authenticated' && canAccess(auth.session, pagePolicies[item.id]));
  const mainNavigation = navigation.filter((item) => item.id === 'meetings' || item.id === 'liveMeeting' || item.id === 'chat');
  const bottomNavigation = navigation.filter((item) => item.id !== 'meetings' && item.id !== 'liveMeeting' && item.id !== 'chat');

  const sidebar = (
    <div className={styles.sidebarInner}>
      <NavLink to="/meetings/live" className={styles.brand} onClick={() => setDrawerOpen(false)} aria-label="На страницу разговоров">
        <img className={styles.brandMark} src="/brand-mark.png" alt="" aria-hidden="true" />
        <span className={styles.brandText}>Siqyr<span className={styles.brandDot}>AI</span></span>
      </NavLink>

      <nav className={styles.navigation} aria-label="Основная навигация">
        {mainNavigation.map(({ id, to, label }) => {
          const Icon = navigationIcons[id];
          return (
          <NavLink
            key={to}
            to={to}
            end={id === 'meetings'}
            title={label}
            aria-label={label}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
          );
        })}
      </nav>
      <nav className={styles.bottomNavigation} aria-label="Дополнительная навигация">
        {bottomNavigation.map(({ id, to, label }) => {
          const Icon = navigationIcons[id];
          return <NavLink
            key={to}
            to={to}
            title={label}
            aria-label={label}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
          >
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>;
        })}
      </nav>
    </div>
  );

  return (
    <div className={styles.app}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>{sidebar}</aside>
      <Drawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        withCloseButton={false}
        size={282}
        padding={0}
        classNames={{ body: styles.drawerBody, content: styles.drawerContent }}
        title="Навигация"
      >
        {sidebar}
      </Drawer>
      <Modal opened={confirmSignOut} onClose={() => setConfirmSignOut(false)} title="Запись ещё идёт" centered size="sm">
        <Text size="sm" mb="lg">При выходе текущая запись будет прервана. Выйти из аккаунта?</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmSignOut(false)}>Остаться</Button>
          <Button color="red" onClick={() => void controller.signOut()}>Выйти</Button>
        </Group>
      </Modal>
      <Modal opened={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Запись ещё идёт" centered size="sm">
        <Text size="sm" mb="lg">При переходе запись остановится. Продолжить?</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => blocker.reset?.()}>Остаться</Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>Перейти</Button>
        </Group>
      </Modal>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <Burger className={styles.mobileBurger} opened={drawerOpen} onClick={() => setDrawerOpen((value) => !value)} size="sm" aria-label="Открыть меню" />
            <UnstyledButton type="button" className={styles.sidebarToggle} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню'}>
              {sidebarCollapsed ? <PanelLeftOpen size={20} strokeWidth={1.8} aria-hidden="true" /> : <PanelLeftClose size={20} strokeWidth={1.8} aria-hidden="true" />}
            </UnstyledButton>
            <span className={styles.mobilePageName}>{pageName(pathname)}</span>
          </div>
          <div className={styles.topbarRight}>
            <Menu position="bottom-end" width={200} shadow="sm" withinPortal>
              <Menu.Target>
                <UnstyledButton type="button" className={styles.account} aria-label={`Профиль: ${displayName}`}>
                  <span className={styles.avatar}>{initials}</span>
                  <span className={styles.accountName}>{displayName}</span>
                  <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{displayName}</Menu.Label>
                <Menu.Item leftSection={<LogOut size={15} />} onClick={() => recording ? setConfirmSignOut(true) : void controller.signOut()}>Выйти</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </header>
        <main className={`${styles.main} ${pathname.startsWith('/chat') ? styles.mainChat : ''}`}><Outlet /></main>
      </div>
    </div>
  );
}
