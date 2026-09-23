import { Button, Loader } from '@mantine/core';
import { useAuth } from '../AuthProvider';
import { LoginBackdrop } from './LoginBackdrop';
import styles from '../pages/LoginPage.module.css';

export function SessionStatus() {
  const { state, controller } = useAuth();
  return <main className={styles.page}>
    <LoginBackdrop />
    <div className={styles.statusContent}>
      {state.status === 'error' ? <>
        <h1>{state.operation === 'sign-out' ? 'Не удалось завершить сеанс' : 'Не удалось проверить вход'}</h1>
        <p>Проверьте подключение и попробуйте ещё раз.</p>
        <Button variant="default" onClick={() => void (state.operation === 'sign-out' ? controller.signOut() : controller.restore())}>Повторить</Button>
      </> : <><Loader color="var(--accent)" aria-label="Проверка сеанса" /><p role="status">Проверяем сеанс…</p></>}
    </div>
  </main>;
}
