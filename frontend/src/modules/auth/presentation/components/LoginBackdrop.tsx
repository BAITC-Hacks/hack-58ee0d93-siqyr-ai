import styles from '../pages/LoginPage.module.css';

export function LoginBackdrop() {
  return <div className={styles.backdrop} aria-hidden="true">
    <div className={`${styles.sheet} ${styles.sheetTop}`} />
    <div className={`${styles.sheet} ${styles.sheetRightBack}`} />
    <div className={`${styles.sheet} ${styles.sheetRight}`} />
    <div className={`${styles.sheet} ${styles.sheetBottomBack}`} />
    <div className={`${styles.sheet} ${styles.sheetBottom}`} />
  </div>;
}
