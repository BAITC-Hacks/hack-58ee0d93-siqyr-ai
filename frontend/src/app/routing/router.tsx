import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import LoginPage from '@/modules/auth/presentation/pages/LoginPage';
import { SecurityRoute } from './SecurityRoute';
import { GuestRoute } from './GuestRoute';
import { pagePolicies, type SecurityHandle } from './access';
import { WorkspaceRedirect } from './WorkspaceRedirect';

const MeetingsPage = lazy(() => import('@/modules/meetings/presentation/pages/MeetingsPage'));
const AuthenticatedWorkspace = lazy(() => import('../providers/AuthenticatedWorkspace').then((module) => ({ default: module.AuthenticatedWorkspace })));
const MeetingPage = lazy(() => import('@/modules/meetings/presentation/pages/MeetingPage'));
const NewMeetingPage = lazy(() => import('@/modules/meetings/presentation/pages/NewMeetingPage'));
const TasksPage = lazy(() => import('@/modules/tasks/presentation/pages/TasksPage'));
const IntegrationsPage = lazy(() => import('@/modules/integrations/presentation/pages/IntegrationsPage'));
const SettingsPage = lazy(() => import('@/modules/settings/presentation/pages/SettingsPage'));
const pageFallback = <Center mih="50vh"><Loader aria-label="Загрузка страницы" /></Center>;

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <SecurityRoute />,
    children: [
      { index: true, handle: { access: {} } satisfies SecurityHandle, element: <WorkspaceRedirect /> },
      { path: '*', handle: { access: {} } satisfies SecurityHandle, element: <WorkspaceRedirect /> },
      {
        element: <Suspense fallback={pageFallback}><AuthenticatedWorkspace /></Suspense>,
        children: [
          { path: 'meetings', handle: { access: pagePolicies.meetings } satisfies SecurityHandle, element: <Suspense fallback={pageFallback}><MeetingsPage /></Suspense> },
          { path: 'meetings/new', handle: { access: pagePolicies.newMeeting } satisfies SecurityHandle, element: <Suspense fallback={pageFallback}><NewMeetingPage /></Suspense> },
          { path: 'meetings/:id', handle: { access: pagePolicies.meeting } satisfies SecurityHandle, element: <Suspense fallback={pageFallback}><MeetingPage /></Suspense> },
          { path: 'tasks', handle: { access: pagePolicies.tasks } satisfies SecurityHandle, element: <Suspense fallback={pageFallback}><TasksPage /></Suspense> },
          { path: 'integrations', handle: { access: pagePolicies.integrations } satisfies SecurityHandle, element: <Suspense fallback={pageFallback}><IntegrationsPage /></Suspense> },
          { path: 'settings', handle: { access: pagePolicies.settings } satisfies SecurityHandle, element: <Suspense fallback={pageFallback}><SettingsPage /></Suspense> },
        ],
      },
    ],
  },
]);
