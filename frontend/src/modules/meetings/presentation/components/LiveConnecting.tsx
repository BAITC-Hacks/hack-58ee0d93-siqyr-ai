import { Text, Title } from '@mantine/core';
import { useId } from 'react';
import styles from './LiveConnecting.module.css';

export function LiveConnecting() {
  const id = useId();
  return <section className={styles.root} role="status" aria-live="polite" aria-atomic="true">
    <div className={styles.art} aria-hidden="true">
      <svg viewBox="0 0 360 300" fill="none" focusable="false">
        <defs>
          <radialGradient id={id + '-sphere'} cx=".3" cy=".2" r=".85">
            <stop stopColor="#e8ecff" /><stop offset=".42" stopColor="#aab8ec" /><stop offset=".78" stopColor="#5269bd" /><stop offset="1" stopColor="#26397e" />
          </radialGradient>
          <linearGradient id={id + '-orbit'} x1="40" y1="80" x2="320" y2="220" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3448a5" stopOpacity=".12" /><stop offset=".5" stopColor="#9cafe5" /><stop offset="1" stopColor="#3448a5" stopOpacity=".32" />
          </linearGradient>
          <radialGradient id={id + '-shadow'}><stop stopColor="#3448a5" stopOpacity=".18" /><stop offset="1" stopColor="#3448a5" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse className={styles.shadow} cx="180" cy="267" rx="96" ry="16" fill={'url(#' + id + '-shadow)'} />
        <g className={styles.float}>
          <circle cx="180" cy="145" r="119" stroke="#3448a5" strokeOpacity=".1" strokeDasharray="2 9" />
          <g className={styles.orbitBack} stroke={'url(#' + id + '-orbit)'} strokeWidth="1.2">
            <ellipse cx="180" cy="145" rx="140" ry="48" transform="rotate(-32 180 145)" />
            <ellipse cx="180" cy="145" rx="140" ry="48" transform="rotate(42 180 145)" />
          </g>
          <circle cx="180" cy="145" r="69" fill={'url(#' + id + '-sphere)'} />
          <circle cx="180" cy="145" r="68.5" stroke="white" strokeOpacity=".35" />
          <g stroke="#f5f7ff" strokeWidth="4" strokeLinecap="round">
            {[18, 32, 48, 28, 40, 20].map((height, index) => <path key={index} className={styles.wave} style={{ animationDelay: String(index * -.16) + 's' }} d={'M' + (155 + index * 10) + ' ' + (145 - height / 2) + 'v' + height} />)}
          </g>
          <g className={styles.orbitFront}>
            <g transform="rotate(-32 180 145)">
              <ellipse cx="180" cy="145" rx="137" ry="49" stroke={'url(#' + id + '-orbit)'} strokeWidth="1.4" />
              <circle cx="43" cy="145" r="6" fill="#4b63bf" stroke="#fff" strokeWidth="3" />
              <circle cx="317" cy="145" r="4" fill="#b8c5ee" stroke="#fff" strokeWidth="2" />
            </g>
          </g>
        </g>
      </svg>
    </div>
    <Text className={styles.eyebrow}>SIQYRAI LIVE</Text>
    <Title order={1}>Создаём разговор</Title>
    <Text c="dimmed" className={styles.description}>Готовим пространство для вашей записи</Text>
    <div className={styles.pulse} aria-hidden="true"><i /><i /><i /></div>
  </section>;
}
