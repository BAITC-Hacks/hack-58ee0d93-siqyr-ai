import { Alert, Button, TextInput } from '@mantine/core';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { safeReturnPath } from '../../domain/returnPath';
import { useLoginModel } from '../useLoginModel';
import { useAuth } from '../AuthProvider';
import { LoginBackdrop } from '../components/LoginBackdrop';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Вход · SiqyrAI';
    return () => { document.title = previousTitle; };
  }, []);
  const [params] = useSearchParams();
  const { state } = useAuth();
  const { form, pending, error, signIn } = useLoginModel(safeReturnPath(params.get('returnTo')));
  const fieldClasses = { root: styles.field, label: styles.label, input: styles.input, error: styles.fieldError };

  return <main className={styles.page}>
    <LoginBackdrop />
    <section className={styles.content} aria-labelledby="login-title">
      <div className={styles.brand}><img className={styles.brandMark} src="/brand-mark.png" alt="" aria-hidden="true" /><span>SiqyrAI</span></div>
      <h1 id="login-title" className={styles.title}>Вход в рабочее пространство</h1>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void signIn('password'); }} aria-busy={pending !== null}>
        <TextInput label="Логин" type="text" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required withAsterisk={false} disabled={pending !== null} classNames={fieldClasses} {...form.getInputProps('username')} />
        <TextInput label="Пароль" type="password" name="password" autoComplete="current-password" required withAsterisk={false} disabled={pending !== null} classNames={fieldClasses} {...form.getInputProps('password')} />
        {state.status === 'anonymous' && state.reason === 'expired' && <p role="status" className={styles.message}>Сеанс завершён. Войдите ещё раз.</p>}
        {error && <Alert role="alert" color="red" className={styles.error}>{error}</Alert>}
        <Button type="submit" className={styles.primary} fullWidth loading={pending === 'password'} disabled={pending !== null && pending !== 'password'}>Войти</Button>
      </form>
      <div className={styles.divider}><span>или</span></div>
      <div className={styles.alternatives} role="group" aria-label="Другие способы входа">
        <Button type="button" variant="default" className={styles.secondary} fullWidth disabled title="Вход с ЭЦП пока не настроен">Войти с ЭЦП</Button>
        <Button type="button" variant="default" className={styles.secondary} fullWidth disabled title="Корпоративный вход пока не настроен">Войти через Keycloak</Button>
      </div>
      <p className={styles.message}>Вход с ЭЦП и через Keycloak пока не настроен.</p>
    </section>
  </main>;
}
