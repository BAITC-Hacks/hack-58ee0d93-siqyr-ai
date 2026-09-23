import { Button, Group } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { LoginBackdrop } from '@/modules/auth/presentation/components/LoginBackdrop';
import styles from '@/modules/auth/presentation/pages/LoginPage.module.css';
import { firstAccessiblePath } from './access';

export function AccessDenied() {
  const { state, controller } = useAuth();
  const target = state.status === 'authenticated' ? firstAccessiblePath(state.session) : null;
  return <main className={styles.page}>
    <LoginBackdrop />
    <div className={styles.statusContent}>
      <h1>Доступ ограничен</h1>
      <p>У вашей учётной записи нет доступа к этой странице.</p>
      <Group justify="center">
        {target && <Button component={Link} to={target} variant="default">В рабочее пространство</Button>}
        <Button variant="default" onClick={() => void controller.signOut()}>Выйти</Button>
      </Group>
    </div>
  </main>;
}
