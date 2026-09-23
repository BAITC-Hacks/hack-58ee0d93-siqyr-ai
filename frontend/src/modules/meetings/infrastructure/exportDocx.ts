import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { formatDate as dateText } from '../../../shared/lib/formatDate.ts';
import type { Task } from '../../tasks/domain/task.types.ts';
import type { Meeting } from '../domain/meeting.types.ts';


const languageText = { ru: 'Русский', kk: 'Қазақша', mixed: 'Смешанный' };

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 70) || 'Протокол встречи';
}

function textParagraphs(text: string) {
  return (text.trim() ? text.trim().split(/\n\s*\n/) : ['Краткое содержание пока не заполнено.'])
    .map((part) => new Paragraph({ text: part.trim(), spacing: { after: 160 } }));
}

export async function exportMeetingDocx(meeting: Meeting, tasks: Task[], includeTranscript = false) {
  if (meeting.backendRunId) throw new Error('Экспорт серверной встречи доступен только из утверждённого протокола.');
  const label = meeting.kind === 'example' ? 'ПРИМЕР ПРОТОКОЛА' : 'ЧЕРНОВИК ПРОТОКОЛА';
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: meeting.organization || 'Организация не указана', spacing: { after: 170 } }),
    new Paragraph({ text: `${label}${meeting.number ? ` № ${meeting.number}` : ''}`, heading: HeadingLevel.HEADING_1, spacing: { after: 100 } }),
    new Paragraph({ text: meeting.title, heading: HeadingLevel.HEADING_2, spacing: { after: 180 } }),
    new Paragraph({ text: meeting.kind === 'example' ? 'Демонстрационный пример. Не является рабочим протоколом.' : 'Черновик. Не утверждён секретарём.', spacing: { after: 180 } }),
    new Paragraph({ text: `Дата: ${dateText(meeting.date)}    Язык: ${languageText[meeting.language]}`, spacing: { after: 220 } }),
    new Paragraph({ text: 'Участники', heading: HeadingLevel.HEADING_2 }),
    ...textParagraphs(meeting.participants.length ? meeting.participants.map((person) => `${person.name}${person.role ? ` — ${person.role}` : ''}`).join('\n') : 'Участники не указаны.'),
    new Paragraph({ text: 'Краткое содержание', heading: HeadingLevel.HEADING_2 }),
    ...textParagraphs(meeting.summary),
    new Paragraph({ text: 'Поручения', heading: HeadingLevel.HEADING_2 }),
  ];

  if (tasks.length) {
    const row = (values: string[], heading = false) => new TableRow({ children: values.map((value) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: value, bold: heading })] })] })) });
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      row(['№', 'Поручение', 'Ответственный', 'Срок', 'Статус'], true),
      ...tasks.map((task, index) => row([String(index + 1), task.title, task.assignee || 'Не назначен', task.deadlineText || 'Не указан', task.status === 'done' ? 'Выполнено' : task.status === 'in-progress' ? 'В работе' : 'К выполнению'])),
    ] }));
  } else {
    children.push(new Paragraph('Поручений пока нет.'));
  }

  if (includeTranscript) {
    children.push(new Paragraph({ text: 'Расшифровка', heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
    let section = '';
    for (const segment of meeting.transcript) {
      if (segment.section && segment.section !== section) {
        section = segment.section;
        children.push(new Paragraph({ text: section, heading: HeadingLevel.HEADING_3 }));
      }
      children.push(new Paragraph({ children: [new TextRun({ text: `${segment.speaker}${segment.role ? ` · ${segment.role}` : ''}`, bold: true }), new TextRun({ text: `\n${segment.text}`, break: 1 })], spacing: { after: 170 } }));
    }
  }

  const docxDocument = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(docxDocument);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${meeting.kind === 'example' ? 'Пример' : 'Черновик'} — ${safeName(meeting.title)}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
