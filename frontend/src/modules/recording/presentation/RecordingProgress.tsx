import { Alert } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import type { RunProgress } from '../application/RecordingGateway.ts';

const statusLabel: Record<string, string> = {
  recording: 'Идёт запись', queued: 'В очереди на обработку', transcribing: 'Распознавание речи', running: 'Подготовка протокола',
  awaiting_approval: 'Черновик готов к проверке', executing: 'Формирование файлов', done: 'Обработка завершена',
  error: 'Ошибка обработки', rejected: 'Протокол отклонён',
};

export function RecordingProgress({ runId, className }: { runId: string; className?: string }) {
  const { recordings } = useServices();
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!recordings) return;
    setProgress(null);
    setError('');
    return recordings.watch(runId, setProgress, setError);
  }, [recordings, runId]);
  if (!recordings) return <Alert color="gray" className={className} title="Серверная обработка недоступна">Задайте VITE_API_URL, чтобы видеть ход распознавания этой записи.</Alert>;
  const status = progress?.status ?? 'queued';
  return <Alert color={status === 'error' || error ? 'red' : 'teal'} className={className} title={statusLabel[status] ?? status}>
    {error && <p role="alert">{error}</p>}
    <ol aria-label="Этапы обработки">{progress?.steps.map((step) => <li key={step.seq}>{step.content}</li>)}</ol>
  </Alert>;
}
