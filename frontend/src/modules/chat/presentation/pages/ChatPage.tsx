import { ActionIcon, Alert, Button, Group, Paper, ScrollArea, Stack, Text, Textarea, Title, Tooltip } from '@mantine/core';
import { ArrowUp, BookOpenText, MessageSquareText, Plus, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import styles from './ChatPage.module.css';

interface ChatMessage {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  sources?: ReadonlyArray<{ title: string; excerpt: string; href?: string }>;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
}

const suggestions = [
  'Какие поручения обсуждали на последних встречах?',
  'Кто отвечает за открытые задачи?',
  'Кратко изложи решения по проекту',
];

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const active = conversations.find((item) => item.id === activeId);
  const messages = active?.messages ?? [];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  function newChat() {
    setActiveId(null);
    setQuestion('');
    setError('');
  }

  function send(event?: FormEvent) {
    event?.preventDefault();
    const text = question.trim();
    if (!text) return;
    const id = activeId ?? crypto.randomUUID();
    const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setConversations((current) => activeId
      ? current.map((item) => item.id === activeId ? { ...item, messages: [...item.messages, message] } : item)
      : [{ id, title: text, messages: [message] }, ...current]);
    setActiveId(id);
    setQuestion('');
    setError('Сервис ответов по встречам ещё не подключён. Попробуйте позже.');
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  return <div className={styles.page}>
    <aside className={styles.history} aria-label="История чатов">
      <Button variant="subtle" color="gray" leftSection={<Plus size={18} />} onClick={newChat} className={styles.newChat}>Новый чат</Button>
      <Text size="xs" fw={650} c="dimmed" className={styles.historyLabel}>В этой вкладке</Text>
      {conversations.length ? <ScrollArea className={styles.historyScroll}>
        <Stack gap={3}>
          {conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => { setActiveId(conversation.id); setError(''); }} className={`${styles.historyItem} ${conversation.id === activeId ? styles.historyItemActive : ''}`} aria-current={conversation.id === activeId ? 'page' : undefined}>
            <MessageSquareText size={16} aria-hidden="true" /><span>{conversation.title}</span>
          </button>)}
        </Stack>
      </ScrollArea> : <Text size="sm" c="dimmed" className={styles.historyEmpty}>Здесь появятся вопросы из текущей вкладки.</Text>}
    </aside>

    <section className={styles.chat} aria-label="Чат по встречам">
      <header className={styles.chatHeader}>
        <Group gap="xs"><Sparkles size={19} aria-hidden="true" /><Text fw={650}>Чат по встречам</Text></Group>
        <Tooltip label="Начать новый чат"><ActionIcon variant="subtle" color="gray" aria-label="Новый чат" className={styles.mobileNewChat} onClick={newChat}><Plus size={20} /></ActionIcon></Tooltip>
      </header>

      <div className={styles.thread} role="log" aria-live="polite" aria-label="Сообщения чата">
        {messages.length ? <div className={styles.messages}>
          {messages.map((message) => <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            {message.role === 'assistant' && <span className={styles.assistantIcon}><Sparkles size={17} /></span>}
            <div className={styles.messageBody}>
              <Text className={styles.messageText}>{message.text}</Text>
              {message.sources?.length ? <div className={styles.sources}><Text size="xs" fw={650} c="dimmed">Источники</Text>{message.sources.map((source, index) => <Paper key={`${source.title}-${index}`} withBorder p="sm" radius="md"><Text size="sm" fw={600}>{source.href ? <a href={source.href}>{source.title}</a> : source.title}</Text><Text size="xs" c="dimmed" lineClamp={2}>{source.excerpt}</Text></Paper>)}</div> : null}
            </div>
          </article>)}
          <div ref={endRef} />
        </div> : <div className={styles.welcome}>
          <div className={styles.welcomeIcon}><BookOpenText size={27} strokeWidth={1.6} /></div>
          <Title order={1}>Что хотите узнать о встречах?</Title>
          <Text c="dimmed">Задайте вопрос о решениях и поручениях. Ответы появятся здесь вместе с источниками, когда сервис будет подключён.</Text>
          <div className={styles.suggestions}>{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)} className={styles.suggestion}>{suggestion}</button>)}</div>
        </div>}
      </div>

      <div className={styles.composerWrap}>
        {error && <Alert color="orange" variant="light" role="alert" withCloseButton onClose={() => setError('')} mb="sm">{error}</Alert>}
        <form onSubmit={send} className={styles.composer}>
          <Textarea aria-label="Вопрос по встречам" placeholder="Спросите о встречах..." autosize minRows={1} maxRows={6} variant="unstyled" value={question} onChange={(event) => setQuestion(event.currentTarget.value)} onKeyDown={onQuestionKeyDown} className={styles.input} />
          <div className={styles.composerBottom}><Text size="xs" c="dimmed">Enter — отправить · Shift+Enter — новая строка</Text><ActionIcon type="submit" size={34} radius="md" disabled={!question.trim()} aria-label="Отправить вопрос"><ArrowUp size={19} /></ActionIcon></div>
        </form>
        <Text size="xs" c="dimmed" ta="center" className={styles.disclaimer}>Проверяйте ответы по исходным материалам встреч.</Text>
      </div>
    </section>
  </div>;
}
