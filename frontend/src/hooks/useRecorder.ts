import { useCallback, useEffect, useRef, useState } from 'react';

type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finishing' | 'complete';

function broadcastRecording(active: boolean) {
  window.dispatchEvent(new CustomEvent('recorder-state', { detail: { active } }));
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadRef = useRef<Promise<void>>(Promise.resolve());
  const uploadErrorRef = useRef<unknown>(null);
  const stoppedRef = useRef<Promise<void>>(Promise.resolve());
  const startedAtRef = useRef(0);
  const recordedMsRef = useRef(0);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  const release = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    broadcastRecording(false);
  }, []);

  const discard = useCallback(() => {
    requestRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    release();
    uploadRef.current = Promise.resolve();
    uploadErrorRef.current = null;
    recordedMsRef.current = 0;
    if (mountedRef.current) {
      setElapsedMs(0);
      setError('');
      setStatus('idle');
    }
  }, [release]);

  const start = useCallback(async (onChunk: (chunk: Blob, offset: number) => Promise<number>) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Запись с микрофона не поддерживается в этом браузере. Загрузите готовый файл.');
      return false;
    }
    discard();
    setStatus('requesting');
    const requestId = requestRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || requestId !== requestRef.current) {
        stopTracks(stream);
        return false;
      }
      streamRef.current = stream;
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!preferredType) throw new Error('WebM недоступен в этом браузере. Загрузите готовый файл.');
      const recorder = new MediaRecorder(stream, { mimeType: preferredType });
      recorderRef.current = recorder;
      let offset = 0;
      uploadRef.current = Promise.resolve();
      uploadErrorRef.current = null;
      stoppedRef.current = new Promise<void>((resolve) => { recorder.onstop = () => { recorderRef.current = null; release(); resolve(); }; });
      recorder.ondataavailable = (event) => {
        if (!event.data.size || uploadErrorRef.current) return;
        uploadRef.current = uploadRef.current.then(async () => {
          if (uploadErrorRef.current) return;
          offset = await onChunk(event.data, offset);
        }).catch((cause: unknown) => {
          uploadErrorRef.current = cause;
          if (recorder.state !== 'inactive') recorder.stop();
          if (mountedRef.current) {
            setStatus('idle');
            setError(cause instanceof Error ? cause.message : 'Не удалось отправить звук на сервер.');
          }
        });
      };
      recorder.onerror = () => {
        uploadErrorRef.current = new Error('Не удалось записать звук. Проверьте микрофон.');
        if (recorder.state !== 'inactive') recorder.stop();
        if (mountedRef.current) setError('Не удалось записать звук. Проверьте микрофон.');
      };
      recorder.start(1000);
      startedAtRef.current = Date.now();
      recordedMsRef.current = 0;
      setElapsedMs(0);
      setStatus('recording');
      broadcastRecording(true);
      return true;
    } catch (cause) {
      release();
      if (!mountedRef.current || requestId !== requestRef.current) return false;
      setStatus('idle');
      const name = cause instanceof DOMException ? cause.name : '';
      setError(name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Доступ к микрофону отклонён. Разрешите его в браузере или загрузите файл.'
        : name === 'NotFoundError' ? 'Микрофон не найден. Подключите устройство или загрузите файл.'
          : cause instanceof Error ? cause.message : 'Не удалось начать запись.');
      return false;
    }
  }, [discard, release]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    recordedMsRef.current += Date.now() - startedAtRef.current;
    setElapsedMs(recordedMsRef.current);
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    startedAtRef.current = Date.now();
    setStatus('recording');
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') throw new Error('Запись уже остановлена.');
    if (recorder.state === 'recording') recordedMsRef.current += Date.now() - startedAtRef.current;
    setElapsedMs(recordedMsRef.current);
    setStatus('finishing');
    recorder.stop();
    await stoppedRef.current;
    await uploadRef.current;
    if (uploadErrorRef.current) throw uploadErrorRef.current;
    if (mountedRef.current) setStatus('complete');
  }, []);

  useEffect(() => {
    if (status !== 'recording') return;
    const interval = window.setInterval(() => setElapsedMs(recordedMsRef.current + Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      release();
    };
  }, [release]);

  return { status, elapsedMs, error, start, pause, resume, stop, discard };
}
