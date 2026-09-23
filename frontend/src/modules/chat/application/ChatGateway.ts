import type { Meeting } from '../../meetings/domain/meeting.types';
import type { Task } from '../../tasks/domain/task.types';

export interface ChatSource {
  title: string;
  excerpt: string;
  kind: 'browser' | 'run' | 'fixture';
  source_id: string;
  segment_index: number | null;
  start_seconds: number | null;
  status: string;
}

export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; sources: ChatSource[] }
export interface ChatConversation { id: string; title: string; updated_at: string }
export interface RagMode { provider: 'local' | 'dev_openai'; demo_questions: string[] }

export interface ChatGateway {
  mode(): Promise<RagMode>;
  create(title?: string): Promise<ChatConversation>;
  rename(id: string, title: string): Promise<ChatConversation>;
  list(): Promise<ChatConversation[]>;
  messages(id: string): Promise<ChatMessage[]>;
  sync(meetings: Meeting[], tasks: Task[]): Promise<void>;
  ask(question: string, conversationId: string | null): Promise<{ conversation_id: string; message: ChatMessage }>;
  delete(id: string): Promise<void>;
}
