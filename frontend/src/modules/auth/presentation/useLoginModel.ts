import { useState } from 'react';
import { useForm } from '@mantine/form';
import { useAuth } from './AuthProvider';
import { signInError } from './authCopy';
import type { SignInMethod } from '../domain/auth.types';

export function useLoginModel(returnPath: string) {
  const { controller } = useAuth();
  const [pending, setPending] = useState<SignInMethod | null>(null);
  const [error, setError] = useState('');
  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) => value.trim().length >= 3 ? null : 'Введите логин (не менее 3 символов).',
      password: (value) => value.length ? null : 'Введите пароль.',
    },
  });

  async function signIn(method: SignInMethod) {
    if (pending) return;
    setError('');
    if (method === 'password' && form.validate().hasErrors) return;
    setPending(method);
    try {
      if (method === 'password') await controller.signInWithPassword(form.values);
      else await controller.signInWithProvider(method, returnPath);
    } catch (cause) {
      setError(signInError(cause));
    } finally {
      form.setFieldValue('password', '');
      setPending(null);
    }
  }

  return { form, pending, error, signIn };
}
