import { ActionIcon, Alert, Button, Group, Modal, Paper, ScrollArea, Stack, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { ArrowUp, BookOpenText, MessageSquareText, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import type { ChatConversation, ChatMessage, RagMode } from '../../application/ChatGateway';
import styles from './ChatPage.module.css';

const suggestions = [
  'Какие поручения обсуждали на последних встречах?',
  'Кто отвечает за открытые задачи?',
  'Кратко изложи решения по проекту',
];

export default function ChatPage() {
  const { chat: gateway } = useServices();
  const { meetings, tasks, loading, error: workspaceError } = useWorkspace();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RagMode | null>(null);
  const [renaming, setRenaming] = useState<ChatConversation | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, busy]);
  useEffect(() => {
    if (!gateway) { setError('Для чата подключите локальный сервер и войдите в аккаунт.'); return; }
    let mounted = true;
    void Promise.all([gateway.mode(), gateway.list()]).then(async ([currentMode, items]) => {
      if (!mounted) return;
      setMode(currentMode);
      setConversations(items);
      if (items[0]) {
        const loaded = await gateway.messages(items[0].id);
        if (mounted) { setActiveId(items[0].id); setMessages(loaded); }
      }
    })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить чаты.'); });
    return () => { mounted = false; };
  }, [gateway]);

  async function newChat() {
    if (busy || !gateway) return;
    try {
      const created = await gateway.create();
      setConversations((items) => [created, ...items]);
      setActiveId(created.id);
      setMessages([]);
      setQuestion('');
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать чат.'); }
  }

  async function openChat(id: string) {
    if (busy || !gateway) return;
    setError('');
    try {
      const loaded = await gateway.messages(id);
      setActiveId(id);
      setMessages(loaded);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть чат.'); }
  }

  async function deleteChat(id: string) {
    if (busy || !gateway) return;
    try {
      await gateway.delete(id);
      setConversations((items) => items.filter((item) => item.id !== id));
      if (activeId === id) { setActiveId(null); setMessages([]); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить чат.'); }
  }

  async function saveTitle() {
    if (!gateway || !renaming || !newTitle.trim()) return;
    try {
      const updated = await gateway.rename(renaming.id, newTitle.trim());
      setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
      setRenaming(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось переименовать чат.'); }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = question.trim();
    if (!text || busy || !gateway) return;
    if (loading || workspaceError) { setError(workspaceError || 'Подождите загрузки встреч.'); return; }
    setBusy(true);
    setError('');
    try {
      let conversationId = activeId;
      if (!conversationId) {
        const created = await gateway.create();
        conversationId = created.id;
        setActiveId(created.id);
        setConversations((items) => [created, ...items]);
      }
      await gateway.sync(meetings, tasks);
      const result = await gateway.ask(text, conversationId);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text, sources: [] }, result.message]);
      setActiveId(result.conversation_id);
      setQuestion('');
      setConversations(await gateway.list());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось получить ответ.'); }
    finally { setBusy(false); }
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const currentSuggestions = mode?.provider === 'dev_openai' ? mode.demo_questions : suggestions;

  return <div className={styles.page}>
    <aside className={styles.history} aria-label="История чатов">
      <Button variant="subtle" color="gray" leftSection={<Plus size={18} />} onClick={() => void newChat()} disabled={busy || !gateway} className={styles.newChat}>Новый чат</Button>
      <Text size="xs" fw={650} c="dimmed" className={styles.historyLabel}>История чатов</Text>
      {conversations.length ? <ScrollArea className={styles.historyScroll}>
        <Stack gap={3}>
          {conversations.map((conversation) => <div key={conversation.id} className={styles.historyRow}>
            <UnstyledButton type="button" onClick={() => void openChat(conversation.id)} className={`${styles.historyItem} ${conversation.id === activeId ? styles.historyItemActive : ''}`} aria-current={conversation.id === activeId ? 'page' : undefined}>
              <MessageSquareText size={16} aria-hidden="true" /><span>{conversation.title}</span>
            </UnstyledButton>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Переименовать чат ${conversation.title}`} onClick={() => { setRenaming(conversation); setNewTitle(conversation.title); }}><Pencil size={14} /></ActionIcon>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Удалить чат ${conversation.title}`} onClick={() => void deleteChat(conversation.id)}><Trash2 size={14} /></ActionIcon>
          </div>)}
        </Stack>
      </ScrollArea> : <Text size="sm" c="dimmed" className={styles.historyEmpty}>Здесь появятся ваши диалоги.</Text>}
    </aside>

    <section className={styles.chat} aria-label="Чат по встречам">
      <header className={styles.chatHeader}>
        <Group gap="xs"><Sparkles size={19} aria-hidden="true" /><Text fw={650}>Чат по встречам</Text>{mode?.provider === 'dev_openai' && <Text size="xs" c="dimmed">OpenAI · вымышленный пример</Text>}</Group>
        <Tooltip label="Начать новый чат"><ActionIcon variant="subtle" color="gray" aria-label="Новый чат" className={styles.mobileNewChat} disabled={!gateway} onClick={() => void newChat()}><Plus size={20} /></ActionIcon></Tooltip>
      </header>

      <div className={styles.thread} role="log" aria-live="polite" aria-label="Сообщения чата">
        {messages.length ? <div className={styles.messages}>
          {messages.map((message) => <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            {message.role === 'assistant' && <span className={styles.assistantIcon}><Sparkles size={17} /></span>}
            <div className={styles.messageBody}>
              <Text className={styles.messageText}>{message.text}</Text>
              {message.sources?.length ? <div className={styles.sources}><Text size="xs" fw={650} c="dimmed">Источники</Text>{message.sources.map((source, index) => <Paper key={`${source.source_id}-${source.segment_index}-${index}`} withBorder p="sm" radius="md">
                <Text size="sm" fw={600}>{source.kind === 'browser' ? <a href={`/meetings/${encodeURIComponent(source.source_id)}`}>{source.title}</a> : source.title}{source.start_seconds !== null && source.start_seconds !== undefined ? ` · ${Math.floor(source.start_seconds / 60)}:${String(Math.floor(source.start_seconds % 60)).padStart(2, '0')}` : ''}</Text>
                <Text size="xs" c="dimmed" lineClamp={3}>{source.excerpt}</Text>
              </Paper>)}</div> : null}
            </div>
          </article>)}
          {busy && <Text size="sm" c="dimmed">Ищу в записях и готовлю ответ…</Text>}
          <div ref={endRef} />
        </div> : <div className={styles.welcome}>
          <div className={styles.welcomeIcon}><BookOpenText size={27} strokeWidth={1.6} /></div>
          <Title order={1}>Что хотите узнать о встречах?</Title>
          <Text c="dimmed">{mode?.provider === 'dev_openai' ? 'Проверка RAG на вымышленном совещании. Выберите подготовленный вопрос.' : 'Задайте вопрос о ваших встречах. Ответы содержат фрагменты записей и протоколов.'}</Text>
          <div className={styles.suggestions}>{currentSuggestions.map((suggestion) => <UnstyledButton type="button" key={suggestion} disabled={!gateway} onClick={() => setQuestion(suggestion)} className={styles.suggestion}>{suggestion}</UnstyledButton>)}</div>
        </div>}
      </div>

      <div className={styles.composerWrap}>
        {error && <Alert color="orange" variant="light" role="alert" withCloseButton onClose={() => setError('')} mb="sm">{error}</Alert>}
        <form onSubmit={(event) => void send(event)} className={styles.composer}>
          <Textarea aria-label="Вопрос по встречам" placeholder={mode?.provider === 'dev_openai' ? 'Выберите вопрос по вымышленному примеру' : 'Спросите о встречах...'} readOnly={mode?.provider === 'dev_openai'} autosize minRows={1} maxRows={6} variant="unstyled" value={question} onChange={(event) => setQuestion(event.currentTarget.value)} onKeyDown={onQuestionKeyDown} className={styles.input} />
          <div className={styles.composerBottom}><Text size="xs" c="dimmed">Enter — отправить · Shift+Enter — новая строка</Text><ActionIcon type="submit" size={34} radius="md" loading={busy} disabled={!gateway || !question.trim() || loading || busy} aria-label="Отправить вопрос"><ArrowUp size={19} /></ActionIcon></div>
        </form>
        {mode?.provider === 'dev_openai' && messages.length > 0 && <div className={styles.demoQuestions}>{currentSuggestions.map((suggestion) => <UnstyledButton type="button" key={suggestion} onClick={() => setQuestion(suggestion)} className={styles.suggestion}>{suggestion}</UnstyledButton>)}</div>}
        <Text size="xs" c="dimmed" ta="center" className={styles.disclaimer}>{mode?.provider === 'dev_openai' ? 'Только вымышленный образец · запросы обрабатывает OpenAI API.' : 'Проверяйте ответы по источникам встреч.'}</Text>
      </div>
    </section>
    <Modal opened={Boolean(renaming)} onClose={() => setRenaming(null)} title="Переименовать чат" centered size="sm">
      <TextInput label="Название" value={newTitle} maxLength={100} onChange={(event) => setNewTitle(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveTitle(); }} />
      <Group justify="flex-end" mt="md"><Button variant="default" onClick={() => setRenaming(null)}>Отмена</Button><Button onClick={() => void saveTitle()} disabled={!newTitle.trim()}>Сохранить</Button></Group>
    </Modal>
  </div>;
}
