import { createHttpClient } from '@/app/composition/createHttpClient';
import { HttpError } from '@/shared/application/HttpClient';
import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import type { Task } from '@/modules/tasks/domain/task.types';

export interface ChatSource {
  title: string;
  excerpt: string;
  kind: 'browser' | 'run';
  source_id: string;
  segment_index: number | null;
  start_seconds: number | null;
  status: string;
}
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; sources: ChatSource[] }
export interface ChatConversation { id: string; title: string; updated_at: string }

function client() {
  const url = import.meta.env.VITE_API_URL?.trim();
  if (!url) throw new Error('Для RAG-чата настройте VITE_API_URL на локальный сервер.');
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Тексты встреч можно отправлять только на локальный сервер RAG.');
  }
  return createHttpClient();
}

function explain(error: unknown): Error {
  if (error instanceof HttpError) {
    if (error.status === 401) return new Error('Для чата войдите в аккаунт локального сервера.');
    if (error.status === 503) return new Error('Локальные модели RAG или LLM не готовы. Проверьте настройку сервера.');
    return new Error(`Сервер чата недоступен (${error.status ?? 'сеть'}).`);
  }
  return error instanceof Error ? error : new Error('Не удалось выполнить запрос чата.');
}

export class ApiChatGateway {
  async create(title = 'Новый чат'): Promise<ChatConversation> {
    try { return await client().request<ChatConversation>({ method: 'POST', path: '/api/chat/conversations', body: { title } }); }
    catch (error) { throw explain(error); }
  }

  async rename(id: string, title: string): Promise<ChatConversation> {
    try { return await client().request<ChatConversation>({ method: 'PATCH', path: `/api/chat/conversations/${encodeURIComponent(id)}`, body: { title } }); }
    catch (error) { throw explain(error); }
  }
  async list(): Promise<ChatConversation[]> {
    try { return await client().request<ChatConversation[]>({ method: 'GET', path: '/api/chat/conversations' }); }
    catch (error) { throw explain(error); }
  }

  async messages(id: string): Promise<ChatMessage[]> {
    try {
      const result = await client().request<{ messages: ChatMessage[] }>({ method: 'GET', path: `/api/chat/conversations/${encodeURIComponent(id)}` });
      return result.messages;
    } catch (error) { throw explain(error); }
  }

  async sync(meetings: Meeting[], tasks: Task[]): Promise<void> {
    const body = { meetings: meetings.map((meeting) => ({
      id: meeting.id, title: meeting.title, status: meeting.status, date: meeting.date, summary: meeting.summary,
      transcript: meeting.transcript.map(({ id, speaker, text }) => ({ id, speaker, text })),
      tasks: tasks.filter((task) => task.meetingId === meeting.id).map(({ title, assignee, deadlineText, status }) =>
        ({ title, assignee, deadline_text: deadlineText, status })),
    })) };
    try { await client().request({ method: 'POST', path: '/api/chat/sync', body, timeout: 180_000 }); }
    catch (error) { throw explain(error); }
  }

  async ask(question: string, conversationId: string | null): Promise<{ conversation_id: string; message: ChatMessage }> {
    try {
      return await client().request({ method: 'POST', path: '/api/chat/messages', body: { question, conversation_id: conversationId }, timeout: 180_000 });
    } catch (error) { throw explain(error); }
  }

  async delete(id: string): Promise<void> {
    try { await client().request({ method: 'DELETE', path: `/api/chat/conversations/${encodeURIComponent(id)}` }); }
    catch (error) { throw explain(error); }
  }
}
