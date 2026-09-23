import { HttpError, type HttpClient } from '@/shared/application/HttpClient';
import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import type { Task } from '@/modules/tasks/domain/task.types';
import type { ChatGateway, ChatConversation, ChatMessage } from '../application/ChatGateway';

function explain(error: unknown): Error {
  if (error instanceof HttpError) {
    if (error.status === 401) return new Error('Для чата войдите в аккаунт локального сервера.');
    if (error.status === 503) return new Error('Чат сейчас недоступен. Попробуйте позже.');
    return new Error('Не удалось связаться с чатом. Проверьте подключение и попробуйте снова.');
  }
  return new Error('Не удалось выполнить действие в чате. Попробуйте снова.');
}

export class ApiChatGateway implements ChatGateway {
  private readonly http: HttpClient;

  constructor(http: HttpClient) { this.http = http; }
  async create(title = 'Новый чат'): Promise<ChatConversation> {
    try { return await this.http.request<ChatConversation>({ method: 'POST', path: '/api/chat/conversations', body: { title } }); }
    catch (error) { throw explain(error); }
  }

  async rename(id: string, title: string): Promise<ChatConversation> {
    try { return await this.http.request<ChatConversation>({ method: 'PATCH', path: `/api/chat/conversations/${encodeURIComponent(id)}`, body: { title } }); }
    catch (error) { throw explain(error); }
  }
  async list(): Promise<ChatConversation[]> {
    try { return await this.http.request<ChatConversation[]>({ method: 'GET', path: '/api/chat/conversations' }); }
    catch (error) { throw explain(error); }
  }

  async messages(id: string): Promise<ChatMessage[]> {
    try {
      const result = await this.http.request<{ messages: ChatMessage[] }>({ method: 'GET', path: `/api/chat/conversations/${encodeURIComponent(id)}` });
      return result.messages;
    } catch (error) { throw explain(error); }
  }

  async sync(meetings: Meeting[], tasks: Task[]): Promise<void> {
    const body = { meetings: meetings.filter((meeting) => meeting.kind !== 'example').map((meeting) => ({
      id: meeting.id, title: meeting.title, status: meeting.status, date: meeting.date, summary: meeting.summary,
      transcript: meeting.transcript.map(({ id, speaker, text }) => ({ id, speaker, text })),
      tasks: tasks.filter((task) => task.meetingId === meeting.id).map(({ title, assignee, deadlineText, status }) =>
        ({ title, assignee, deadline_text: deadlineText, status })),
    })) };
    try { await this.http.request({ method: 'POST', path: '/api/chat/sync', body, timeout: 180_000 }); }
    catch (error) { throw explain(error); }
  }

  async ask(question: string, conversationId: string | null): Promise<{ conversation_id: string; message: ChatMessage }> {
    try {
      return await this.http.request({ method: 'POST', path: '/api/chat/messages', body: { question, conversation_id: conversationId }, timeout: 180_000 });
    } catch (error) { throw explain(error); }
  }

  async delete(id: string): Promise<void> {
    try { await this.http.request({ method: 'DELETE', path: `/api/chat/conversations/${encodeURIComponent(id)}` }); }
    catch (error) { throw explain(error); }
  }
}
