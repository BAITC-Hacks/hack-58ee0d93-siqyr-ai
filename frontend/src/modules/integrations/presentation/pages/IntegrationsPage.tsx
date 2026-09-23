import { Button } from '@mantine/core';
import styles from './IntegrationsPage.module.css';

function JiraMark() {
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path fill="#2684FF" d="M4 3h11.2c0 5.7 4.1 9.8 9.8 9.8V24C13.1 24 4 14.9 4 3Z" />
    <path fill="#0052CC" d="M4 3h8.2c0 7.5 5.3 12.8 12.8 12.8V24C13.1 24 4 14.9 4 3Z" />
    <path fill="#2684FF" d="M4 3h5.3c0 9.2 6.5 15.7 15.7 15.7V24C13.1 24 4 14.9 4 3Z" />
  </svg>;
}

function MeetMark() {
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path fill="#00832D" d="M4 11h6v10H4z" />
    <path fill="#00AC47" d="M10 8h12v16H10z" />
    <path fill="#00832D" d="M10 21h12v3H10z" />
    <path fill="#FFBA00" d="M22 11l6-4v9l-6 3z" />
    <path fill="#EA4335" d="M22 19l6-3v9l-6-4z" />
    <path fill="#2684FC" d="M4 11l6-3v16l-6-3z" />
  </svg>;
}

const providers = [
  { name: 'Jira', description: 'Подключение рабочего аккаунта Jira', Mark: JiraMark },
  { name: 'Google Meet', description: 'Подключение рабочего аккаунта Google Meet', Mark: MeetMark },
] as const;

export default function IntegrationsPage() {
  return <div className={styles.page}>
    <h1>Интеграции</h1>
    <p className={styles.intro}>Подключения внешних сервисов появятся после настройки безопасного способа авторизации.</p>
    <div className={styles.cards}>
      {providers.map(({ name, description, Mark }) => <section className={styles.card} key={name} aria-label={name}>
        <div className={styles.identity}>
          <span className={styles.icon}><Mark /></span>
          <div className={styles.heading}><h2>{name}</h2><p>{description}</p></div>
        </div>
        <div className={styles.footer}>
          <span className={styles.status}><span className={styles.statusDot} aria-hidden="true" />Подключение недоступно</span>
          <Button variant="default" size="xs" disabled>Подключить</Button>
        </div>
      </section>)}
    </div>
  </div>;
}
