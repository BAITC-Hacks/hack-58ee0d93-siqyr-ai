import { formatDate as dateText } from '../../../shared/lib/formatDate.ts';
import type { Task } from '../../tasks/domain/task.types.ts';
import type { MeetingExporter } from '../application/MeetingExporter.ts';
import type { Meeting } from '../domain/meeting.types.ts';

const languageText = { ru: 'Русский', kk: 'Қазақша', mixed: 'Смешанный' };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export class BrowserMeetingExporter implements MeetingExporter {
  async download(meeting: Meeting, tasks: Task[], includeTranscript = false): Promise<void> {
    if (meeting.backendRunId) throw new Error('Экспорт серверной встречи доступен только из утверждённого протокола.');
    const { exportMeetingDocx } = await import('./exportDocx');
    await exportMeetingDocx(meeting, tasks, includeTranscript);
  }

  print(meeting: Meeting, tasks: Task[], includeTranscript = false) {
  if (meeting.backendRunId) throw new Error('Печать серверной встречи доступна только из утверждённого протокола.');
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна и попробуйте снова.');
  const paragraphs = (value: string) => escapeHtml(value).split(/\n\s*\n/).map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
  const participants = meeting.participants.map((person) => `<li>${escapeHtml(person.name)}${person.role ? ` · ${escapeHtml(person.role)}` : ''}</li>`).join('');
  const rows = tasks.map((task, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.assignee || 'Не назначен')}</td><td>${escapeHtml(task.deadlineText || 'Не указан')}</td><td>${task.status === 'done' ? 'Выполнено' : task.status === 'in-progress' ? 'В работе' : 'К выполнению'}</td></tr>`).join('');
  const transcript = includeTranscript ? `<h2>Расшифровка</h2>${meeting.transcript.map((segment) => `<section><strong>${escapeHtml(segment.speaker)}</strong>${segment.role ? ` · ${escapeHtml(segment.role)}` : ''}${paragraphs(segment.text)}</section>`).join('')}` : '';
  popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(meeting.title)}</title><style>@page{size:A4;margin:20mm 17mm}body{font:12pt/1.5 Arial,sans-serif;color:#202939;max-width:760px;margin:auto}header{border-bottom:1px solid #e4e7ec;padding-bottom:16px;margin-bottom:28px}small{color:#667085}h1{font-size:20pt;margin:0 0 8px}h2{font-size:13pt;margin:26px 0 10px}p{margin:0 0 12px}ul{padding-left:22px}table{border-collapse:collapse;width:100%;font-size:10pt}td,th{border:1px solid #e4e7ec;padding:7px;text-align:left;vertical-align:top}tr{break-inside:avoid}section{margin-bottom:14px;break-inside:avoid}@media screen{body{padding:32px}}</style></head><body><header><small>${escapeHtml(meeting.organization || 'Организация не указана')}</small><h1>${meeting.kind === 'example' ? 'ПРИМЕР ПРОТОКОЛА' : 'ЧЕРНОВИК ПРОТОКОЛА'}${meeting.number ? ` № ${meeting.number}` : ''}: ${escapeHtml(meeting.title)}</h1><small>${escapeHtml(dateText(meeting.date))} · ${languageText[meeting.language]}</small><p>${meeting.kind === 'example' ? 'Демонстрационный пример. Не является рабочим протоколом.' : 'Черновик. Не утверждён секретарём.'}</p></header><h2>Участники</h2>${participants ? `<ul>${participants}</ul>` : '<p>Участники не указаны.</p>'}<h2>Краткое содержание</h2>${paragraphs(meeting.summary || 'Краткое содержание пока не заполнено.')}<h2>Поручения</h2>${tasks.length ? `<table><thead><tr><th>№</th><th>Поручение</th><th>Ответственный</th><th>Срок</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Поручений пока нет.</p>'}${transcript}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 300);
}

}
