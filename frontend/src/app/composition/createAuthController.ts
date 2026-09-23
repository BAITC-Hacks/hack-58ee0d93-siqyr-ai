import { AuthController } from '@/modules/auth/application/AuthController';
import { ApiAuthGateway } from '@/modules/auth/infrastructure/ApiAuthGateway';
import { LocalWorkspaceAuthGateway } from '@/modules/auth/infrastructure/LocalWorkspaceAuthGateway';
import { UnconfiguredAuthGateway } from '@/modules/auth/infrastructure/UnconfiguredAuthGateway';
import { createHttpClient } from './createHttpClient';

export function createAuthController(): AuthController {
  const remote = import.meta.env.VITE_API_URL?.trim()
    ? new ApiAuthGateway(createHttpClient(), window.sessionStorage)
    : new UnconfiguredAuthGateway();
  return new AuthController(new LocalWorkspaceAuthGateway(remote, window.sessionStorage));
}
