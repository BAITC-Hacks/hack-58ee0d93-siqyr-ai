import { useEffect, useRef, useState } from 'react';
import type { MeetingLanguage } from '../../meetings/domain/meeting.types';
import type { RecorderStatus } from '../application/Recorder';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type TranscriptStatus = 'idle' | 'checking' | 'listening' | 'paused' | 'install-needed' | 'unavailable' | 'error';

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

interface LocalRecognition {
  processLocally: boolean;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface LocalRecognitionConstructor {
  new (): LocalRecognition;
  available(options: { langs: string[]; processLocally: true }): Promise<Availability>;
  install?(options: { langs: string[]; processLocally: true }): Promise<boolean>;
}

function localRecognizer(): LocalRecognitionConstructor | null {
  const constructor = (globalThis as { SpeechRecognition?: LocalRecognitionConstructor }).SpeechRecognition;
  return typeof constructor === 'function' && typeof constructor.available === 'function' ? constructor : null;
}

const speechLocale = { ru: 'ru-RU', kk: 'kk-KZ' } as const;

export function useOnDeviceTranscript(language: MeetingLanguage, recorderStatus: RecorderStatus, onFinal: (text: string) => void) {
  const [status, setStatus] = useState<TranscriptStatus>('idle');
  const [interim, setInterim] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const recognition = useRef<LocalRecognition | null>(null);
  const shouldListen = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalCallback = useRef(onFinal);
  finalCallback.current = onFinal;

  useEffect(() => {
    shouldListen.current = recorderStatus === 'recording';
    if (recorderStatus !== 'recording') {
      if (restartTimer.current) clearTimeout(restartTimer.current);
      recognition.current?.stop();
      setInterim('');
      setStatus(recorderStatus === 'paused' ? 'paused' : 'idle');
      return;
    }
    if (language === 'mixed') {
      setStatus('unavailable');
      setMessage('Автоматическое локальное распознавание смешанной речи недоступно. Добавляйте реплики вручную.');
      return;
    }
    const constructor = localRecognizer();
    if (!constructor) {
      setStatus('unavailable');
      setMessage('Этот браузер не поддерживает локальное распознавание речи. Запись звука продолжится.');
      return;
    }
    let cancelled = false;
    setStatus('checking');
    setMessage('Проверяем локальный языковой пакет…');
    const locale = speechLocale[language];
    void constructor.available({ langs: [locale], processLocally: true }).then((availability) => {
      if (cancelled || !shouldListen.current) return;
      if (availability !== 'available') {
        setStatus(availability === 'unavailable' ? 'unavailable' : 'install-needed');
        setMessage(availability === 'unavailable'
          ? 'Для выбранного языка локальное распознавание недоступно. Запись звука продолжится.'
          : 'Для живой расшифровки нужен локальный языковой пакет. Установите его на этом устройстве.');
        return;
      }
      const instance = new constructor();
      if (!('processLocally' in instance)) {
        setStatus('unavailable');
        setMessage('Браузер не подтвердил локальную обработку речи. Запись звука продолжится.');
        return;
      }
      instance.processLocally = true;
      instance.lang = locale;
      instance.continuous = true;
      instance.interimResults = true;
      const finalIndices = new Set<number>();
      instance.onresult = (event) => {
        const interimParts: string[] = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const item = event.results[index];
          const text = item?.[0]?.transcript?.trim();
          if (!item || !text) continue;
          if (item.isFinal && !finalIndices.has(index)) {
            finalIndices.add(index);
            finalCallback.current(text);
          } else if (!item.isFinal) interimParts.push(text);
        }
        setInterim(interimParts.join(' '));
      };
      instance.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        shouldListen.current = false;
        setStatus('error');
        setMessage(event.error === 'language-not-supported'
          ? 'Языковой пакет не установлен. Запись звука продолжится.'
          : 'Локальное распознавание остановилось. Запись звука продолжится, реплики можно добавить вручную.');
      };
      instance.onend = () => {
        setInterim('');
        if (shouldListen.current && !cancelled) {
          restartTimer.current = setTimeout(() => {
            try { instance.start(); }
            catch { setStatus('error'); setMessage('Не удалось возобновить распознавание. Запись звука продолжится.'); }
          }, 250);
        }
      };
      recognition.current = instance;
      try {
        instance.start();
        setStatus('listening');
        setMessage('Речь распознаётся только на этом устройстве. Имена говорящих назначаются вручную.');
      } catch {
        shouldListen.current = false;
        setStatus('error');
        setMessage('Не удалось запустить локальное распознавание. Запись звука продолжится.');
      }
    }).catch(() => {
      if (!cancelled) {
        setStatus('unavailable');
        setMessage('Не удалось проверить локальное распознавание. Запись звука продолжится.');
      }
    });
    return () => {
      cancelled = true;
      shouldListen.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      recognition.current?.stop();
      recognition.current = null;
    };
  }, [language, recorderStatus, retry]);

  async function installLanguage() {
    if (language === 'mixed') return;
    const constructor = localRecognizer();
    if (!constructor?.install) return;
    setStatus('checking');
    setMessage('Устанавливаем локальный языковой пакет…');
    try {
      const installed = await constructor.install({ langs: [speechLocale[language]], processLocally: true });
      if (!installed) throw new Error('install failed');
      setRetry((value) => value + 1);
    } catch {
      setStatus('install-needed');
      setMessage('Не удалось установить языковой пакет. Запись звука продолжится без расшифровки.');
    }
  }

  async function stopAndFlush(): Promise<void> {
    shouldListen.current = false;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    const instance = recognition.current;
    if (!instance) return;
    await new Promise<void>((resolve) => {
      const previous = instance.onend;
      const timer = setTimeout(resolve, 800);
      instance.onend = () => { clearTimeout(timer); previous?.(); resolve(); };
      try { instance.stop(); } catch { clearTimeout(timer); resolve(); }
    });
  }

  return { status, interim, message, installLanguage, stopAndFlush };
}
