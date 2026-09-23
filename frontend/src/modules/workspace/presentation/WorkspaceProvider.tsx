import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';
import type { WorkspaceServices } from '../application/WorkspaceServices.ts';
import { workspaceKeys, workspaceQuery } from './workspace.queries.ts';

const ServicesContext = createContext<WorkspaceServices | null>(null);

export function WorkspaceProvider({ services, children }: PropsWithChildren<{ services: WorkspaceServices }>) {
  const queryClient = useQueryClient();
  const query = useQuery(workspaceQuery(services.workspace));

  useEffect(() => {
    let active = true;
    const repository = services.workspace;
    if (!query.isSuccess || !repository.observe) return;
    const unsubscribe = repository.observe(
      (snapshot) => { if (active) queryClient.setQueryData(workspaceKeys.snapshot(), snapshot); },
      () => { if (active) void queryClient.invalidateQueries({ queryKey: workspaceKeys.all }); },
    );
    return () => { active = false; unsubscribe?.(); };
  }, [services, queryClient, query.isSuccess]);

  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): WorkspaceServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('WorkspaceProvider is required.');
  return services;
}
