import type { Task } from '@/modules/tasks/domain/task.types';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { formatDate as readableDate } from '@/shared/lib/formatDate';
import { Alert, Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useEffect, useState } from 'react';
import { useTaskCommands } from '../useTaskCommands';
import styles from './TaskEditor.module.css';

interface TaskEditorProps {
  opened: boolean;
  onClose: () => void;
  task?: Task;
  meetingId?: string;
}

interface TaskFields {
  title: string;
  meetingId: string;
  assignee: string;
  deadlineText: string;
  dueDate: string;
  status: Task['status'];
  note: string;
}

const statusOptions = [
  { value: 'todo', label: 'К выполнению' },
  { value: 'in-progress', label: 'В работе' },
  { value: 'done', label: 'Готово' },
];


export default function TaskEditor({ opened, onClose, task, meetingId }: TaskEditorProps) {
  const { meetings } = useWorkspace();
  const { createTask, updateTask } = useTaskCommands();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const form = useForm<TaskFields>({
    initialValues: { title: '', meetingId: '', assignee: '', deadlineText: '', dueDate: '', status: 'todo', note: '' },
    validate: {
      title: (value) => value.trim() ? null : 'Введите поручение',
      meetingId: (value) => value ? null : 'Выберите встречу',
    },
  });

  useEffect(() => {
    if (!opened) return;
    form.setValues({
      title: task?.title ?? '',
      meetingId: task?.meetingId ?? meetingId ?? meetings[0]?.id ?? '',
      assignee: task?.assignee ?? '',
      deadlineText: task?.deadlineText ?? '',
      dueDate: task?.dueDate ?? '',
      status: task?.status ?? 'todo',
      note: task?.note ?? '',
    });
    form.clearErrors();
    setSaveError('');
  // Reset only when the editor opens for a different task or meeting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, task?.id, meetingId, meetings[0]?.id]);

  const meetingOptions = meetings.map((meeting) => ({ value: meeting.id, label: meeting.title }));

  async function submit(values: TaskFields) {
    setSaving(true);
    setSaveError('');
    const dueDate = values.dueDate || null;
    const payload = {
      title: values.title.trim(),
      meetingId: values.meetingId,
      assignee: values.assignee.trim(),
      deadlineText: values.deadlineText.trim() || (dueDate ? readableDate(dueDate) : ''),
      dueDate,
      status: values.status,
      note: values.note.trim(),
    };
    try {
      if (task) await updateTask(task.id, payload);
      else await createTask(payload);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить поручение. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={task ? 'Редактировать поручение' : 'Новое поручение'} size="lg" centered classNames={{ content: styles.modal, title: styles.title }} closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
          {saveError && <Alert color="red" title="Не удалось сохранить">{saveError}</Alert>}
          <TextInput label="Поручение" placeholder="Что нужно сделать" required autoFocus {...form.getInputProps('title')} />
          <Select label="Встреча" data={meetingOptions} searchable nothingFoundMessage="Встречи не найдены" required {...form.getInputProps('meetingId')} />
          <TextInput label="Ответственный" placeholder="Можно указать позже" description="Оставьте пустым, если ответственный не назначен" {...form.getInputProps('assignee')} />
          <div className={styles.dateFields}>
            <TextInput label="Срок из протокола" placeholder="Например: до 15 октября или к пятнице" description="Исходная формулировка сохраняется без изменений" {...form.getInputProps('deadlineText')} />
            <DatePickerInput label="Точная дата" description="Для сортировки и напоминаний" placeholder="Выберите дату" locale="ru" valueFormat="DD.MM.YYYY" clearable value={form.values.dueDate || null} onChange={(value) => form.setFieldValue('dueDate', value || '')} />
          </div>
          <Select label="Статус" data={statusOptions} allowDeselect={false} {...form.getInputProps('status')} />
          <Textarea label="Примечание" placeholder="Детали, ссылка или ход работы" minRows={3} autosize {...form.getInputProps('note')} />
          <Group justify="flex-end" className={styles.actions}>
            <Button variant="subtle" color="gray" onClick={onClose} disabled={saving}>Отмена</Button>
            <Button type="submit" loading={saving} disabled={meetings.length === 0}>{task ? 'Сохранить' : 'Добавить поручение'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
