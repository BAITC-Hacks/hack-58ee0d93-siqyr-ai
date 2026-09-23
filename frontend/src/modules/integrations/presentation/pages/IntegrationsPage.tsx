import styles from './IntegrationsPage.module.css';

declare const __JIRA_TOKEN_PRESENT__: boolean;

export default function IntegrationsPage() {
  const jiraTokenPresent = __JIRA_TOKEN_PRESENT__;

  return <div className={styles.page}>
    <h1>Интеграции</h1>
    <p className={styles.intro}>Сервисы для работы со встречами и поручениями.</p>
    <div className={styles.cards}>
      <section className={styles.card} aria-label="Jira">
        <div className={styles.identity}>
          <span className={styles.icon}><img src="/integrations/jira.ico" alt="" aria-hidden="true" /></span>
          <div className={styles.heading}><h2>Jira</h2><p>Работа с поручениями</p></div>
        </div>
        <div className={styles.footer}>
          <span className={styles.status}><span className={`${styles.statusDot} ${jiraTokenPresent ? styles.statusDotActive : ''}`} aria-hidden="true" />{jiraTokenPresent ? 'Подключено' : 'Не подключено'}</span>
        </div>
      </section>
      <section className={styles.card} aria-label="Google Meet">
        <div className={styles.identity}>
          <span className={styles.icon}><img src="/integrations/google-meet.png" alt="" aria-hidden="true" /></span>
          <div className={styles.heading}><h2>Google Meet</h2><p>Участие во встречах</p></div>
        </div>
        <div className={styles.footer}>
          <span className={styles.status}><span className={styles.statusDot} aria-hidden="true" />Не подключено</span>
        </div>
      </section>
    </div>
  </div>;
}
