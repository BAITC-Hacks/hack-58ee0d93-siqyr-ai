import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core';
import { useWorkspace } from './hooks/useWorkspace';
import Shell from './components/Shell';
import MeetingsPage from './pages/MeetingsPage';

const MeetingPage = lazy(() => import('./pages/MeetingPage'));
const NewMeetingPage = lazy(() => import('./pages/NewMeetingPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const pageFallback = <Center mih="50vh"><Loader aria-label="Загрузка страницы" /></Center>;

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/meetings" replace /> },
      { path: 'meetings', element: <MeetingsPage /> },
      { path: 'meetings/new', element: <Suspense fallback={pageFallback}><NewMeetingPage /></Suspense> },
      { path: 'meetings/:id', element: <Suspense fallback={pageFallback}><MeetingPage /></Suspense> },
      { path: 'tasks', element: <Suspense fallback={pageFallback}><TasksPage /></Suspense> },
      { path: 'settings', element: <Suspense fallback={pageFallback}><SettingsPage /></Suspense> },
      { path: '*', element: <Navigate to="/meetings" replace /> },
    ],
  },
]);

export default function App() {
  const { loading, error } = useWorkspace();

  if (error) {
    return (
      <Center mih="100vh" px="md">
        <Alert color="red" title="Не удалось открыть локальные данные" maw={480}>
          <Stack gap="md">
            <Text size="sm">{error}</Text>
            <Button variant="light" onClick={() => window.location.reload()}>Повторить</Button>
          </Stack>
        </Alert>
      </Center>
    );
  }

  if (loading) return <Center mih="100vh"><Loader aria-label="Загрузка рабочего пространства" /></Center>;

  return <RouterProvider router={router} />;
}
