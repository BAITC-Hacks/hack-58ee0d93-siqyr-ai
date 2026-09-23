import { AuthProvider } from '@/modules/auth/presentation/AuthProvider';
import { MantineProvider } from '@mantine/core';
import { useState, type PropsWithChildren } from 'react';
import { createAuthController } from '../composition/createAuthController';
import { theme } from '../styles/theme';

export function AppProviders({ children }: PropsWithChildren) {
  const [controller] = useState(createAuthController);
  return <MantineProvider theme={theme} defaultColorScheme="light">
    <AuthProvider controller={controller}>{children}</AuthProvider>
  </MantineProvider>;
}
