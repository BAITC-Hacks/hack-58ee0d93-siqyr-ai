import { parseLocalDate } from '../domain/LocalDate.ts';

const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function formatDate(value: string | null): string {
  if (!value) return 'Дата не указана';
  const date = parseLocalDate(value);
  return date ? formatter.format(date) : value;
}
