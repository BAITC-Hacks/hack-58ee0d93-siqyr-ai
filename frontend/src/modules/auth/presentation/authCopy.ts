import { AuthError, type AuthErrorCode } from '../domain/auth.types.ts';

const errors: Record<AuthErrorCode, string> = {
  'not-configured': 'Вход пока недоступен. Сервис авторизации ещё не подключён.',
  'invalid-credentials': 'Не удалось войти. Проверьте логин и пароль.',
  'unavailable': 'Не удалось связаться с сервисом входа. Попробуйте ещё раз.',
  'invalid-session': 'Не удалось подтвердить сеанс. Попробуйте войти ещё раз.',
};

export function signInError(error: unknown): string {
  return errors[error instanceof AuthError ? error.code : 'unavailable'];
}
