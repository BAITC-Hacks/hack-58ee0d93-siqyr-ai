import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { Meeting, Task } from '../domain/types';

function dateText(value: string | null) {
  if (!value) return 'Дата не указана';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

const languageText = { ru: 'Русский', kk: 'Қазақша', mixed: 'Смешанный' };

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 70) || 'Протокол встречи';
}

function textParagraphs(text: string) {
  return (text.trim() ? text.trim().split(/\n\s*\n/) : ['Краткое содержание пока не заполнено.'])
    .map((part) => new Paragraph({ text: part.trim(), spacing: { after: 160 } }));
}

export async function exportMeetingDocx(meeting: Meeting, tasks: Task[], includeTranscript = false) {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: meeting.organization || 'Организация не указана', spacing: { after: 170 } }),
    new Paragraph({ text: `ПРОТОКОЛ${meeting.number ? ` № ${meeting.number}` : ''}`, heading: HeadingLevel.HEADING_1, spacing: { after: 100 } }),
    new Paragraph({ text: meeting.title, heading: HeadingLevel.HEADING_2, spacing: { after: 180 } }),
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
  link.download = `${safeName(meeting.title)}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function printMeeting(meeting: Meeting, tasks: Task[], includeTranscript = false) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна и попробуйте снова.');
  const paragraphs = (value: string) => escapeHtml(value).split(/\n\s*\n/).map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
  const participants = meeting.participants.map((person) => `<li>${escapeHtml(person.name)}${person.role ? ` · ${escapeHtml(person.role)}` : ''}</li>`).join('');
  const rows = tasks.map((task, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.assignee || 'Не назначен')}</td><td>${escapeHtml(task.deadlineText || 'Не указан')}</td><td>${task.status === 'done' ? 'Выполнено' : task.status === 'in-progress' ? 'В работе' : 'К выполнению'}</td></tr>`).join('');
  const transcript = includeTranscript ? `<h2>Расшифровка</h2>${meeting.transcript.map((segment) => `<section><strong>${escapeHtml(segment.speaker)}</strong>${segment.role ? ` · ${escapeHtml(segment.role)}` : ''}${paragraphs(segment.text)}</section>`).join('')}` : '';
  popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(meeting.title)}</title><style>@page{size:A4;margin:20mm 17mm}body{font:12pt/1.5 Arial,sans-serif;color:#1d292c;max-width:760px;margin:auto}header{border-bottom:1px solid #9aa;padding-bottom:16px;margin-bottom:28px}small{color:#667274}h1{font-size:20pt;margin:0 0 8px}h2{font-size:13pt;margin:26px 0 10px}p{margin:0 0 12px}ul{padding-left:22px}table{border-collapse:collapse;width:100%;font-size:10pt}td,th{border:1px solid #ccd3d0;padding:7px;text-align:left;vertical-align:top}tr{break-inside:avoid}section{margin-bottom:14px;break-inside:avoid}@media screen{body{padding:32px}}</style></head><body><header><small>${escapeHtml(meeting.organization || 'Организация не указана')}</small><h1>Протокол${meeting.number ? ` № ${meeting.number}` : ''}: ${escapeHtml(meeting.title)}</h1><small>${escapeHtml(dateText(meeting.date))} · ${languageText[meeting.language]}</small></header><h2>Участники</h2>${participants ? `<ul>${participants}</ul>` : '<p>Участники не указаны.</p>'}<h2>Краткое содержание</h2>${paragraphs(meeting.summary || 'Краткое содержание пока не заполнено.')}<h2>Поручения</h2>${tasks.length ? `<table><thead><tr><th>№</th><th>Поручение</th><th>Ответственный</th><th>Срок</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Поручений пока нет.</p>'}${transcript}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 300);
}
