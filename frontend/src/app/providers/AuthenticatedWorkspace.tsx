import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { WorkspaceProvider } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { createServices } from '../composition/createServices';
import { createQueryClient } from './createQueryClient';
import Shell from '../layout/Shell';

function WorkspaceContent() {
  const { loading, error, retry } = useWorkspace();
  if (error) return <Center mih="100dvh" px="md">
    <Alert color="red" title="Не удалось открыть данные" maw={480}>
      <Stack gap="md"><Text size="sm">{error}</Text><Button variant="light" onClick={() => void retry()}>Повторить</Button></Stack>
    </Alert>
  </Center>;
  if (loading) return <Center mih="100dvh"><Loader aria-label="Загрузка рабочего пространства" /></Center>;
  return <Shell />;
}

function WorkspaceScope({ principalId }: { principalId: string }) {
  const [services] = useState(() => createServices(principalId));
  const [queryClient] = useState(createQueryClient);
  useEffect(() => () => {
    services.recorder.discard();
    void queryClient.cancelQueries();
    queryClient.clear();
    services.close();
  }, [services, queryClient]);
  return <QueryClientProvider client={queryClient}>
    <WorkspaceProvider services={services}><WorkspaceContent /></WorkspaceProvider>
  </QueryClientProvider>;
}

export function AuthenticatedWorkspace() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  return <WorkspaceScope key={state.session.principal.id} principalId={state.session.principal.id} />;
}
