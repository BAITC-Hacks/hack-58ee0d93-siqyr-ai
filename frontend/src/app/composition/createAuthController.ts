import { AuthController } from '@/modules/auth/application/AuthController';
import { ApiAuthGateway } from '@/modules/auth/infrastructure/ApiAuthGateway';
import { UnconfiguredAuthGateway } from '@/modules/auth/infrastructure/UnconfiguredAuthGateway';
import { createHttpClient } from './createHttpClient';

export function createAuthController(): AuthController {
  if (!import.meta.env.VITE_API_URL?.trim()) return new AuthController(new UnconfiguredAuthGateway());
  return new AuthController(new ApiAuthGateway(createHttpClient(), window.sessionStorage));
}
