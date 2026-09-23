import { useEffect, useState } from 'react';
import { Burger, Button, Drawer, Group, Modal, Text } from '@mantine/core';
import { CheckSquare2, Mic2, Settings2 } from 'lucide-react';
import { NavLink, Outlet, useBlocker, useLocation } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import styles from './Shell.module.css';

const navigation = [
  { to: '/meetings', label: 'Встречи', icon: Mic2 },
  { to: '/tasks', label: 'Поручения', icon: CheckSquare2 },
  { to: '/settings', label: 'Настройки', icon: Settings2 },
];

function pageName(pathname: string) {
  if (pathname.startsWith('/meetings/new')) return 'Новая встреча';
  if (pathname.startsWith('/meetings/') && pathname !== '/meetings/') return 'Встреча';
  if (pathname.startsWith('/tasks')) return 'Поручения';
  if (pathname.startsWith('/settings')) return 'Настройки';
  return 'Встречи';
}

export default function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const { pathname } = useLocation();
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    recording && currentLocation.pathname === '/meetings/new' && nextLocation.pathname !== currentLocation.pathname,
  );
  const { tasks, settings } = useWorkspace();
  const openTasks = tasks.filter((task) => task.status !== 'done').length;
  const displayName = settings.displayName.trim() || 'Моё пространство';

  useEffect(() => {
    const onRecorderState = (event: Event) => setRecording(Boolean((event as CustomEvent<{ active: boolean }>).detail?.active));
    window.addEventListener('recorder-state', onRecorderState);
    return () => window.removeEventListener('recorder-state', onRecorderState);
  }, []);

  const sidebar = (
    <div className={styles.sidebarInner}>
      <NavLink to="/meetings" className={styles.brand} onClick={() => setDrawerOpen(false)} aria-label="На страницу встреч">
        <span className={styles.brandMark} aria-hidden="true"><span /><span /><span /></span>
        <span className={styles.brandText}>Siqyr<span className={styles.brandDot}>AI</span></span>
      </NavLink>

      <div className={styles.workspaceLabel}>РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav className={styles.navigation} aria-label="Основная навигация">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
            {to === '/tasks' && openTasks > 0 && <span className={styles.navCount}>{openTasks}</span>}
          </NavLink>
        ))}
      </nav>

    </div>
  );

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>{sidebar}</aside>
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
            <span className={styles.breadcrumbRoot}>Рабочее пространство</span>
            <span className={styles.breadcrumbSlash}>/</span>
            <span className={styles.breadcrumbCurrent}>{pageName(pathname)}</span>
          </div>
          <div className={styles.topbarRight}>
            <div className={styles.account} title={displayName}>
              <span className={styles.avatar}>{displayName.slice(0, 1).toUpperCase()}</span>
              <span className={styles.accountName}>{displayName}</span>
            </div>
          </div>
        </header>
        <main className={styles.main}><Outlet /></main>
      </div>
    </div>
  );
}
