import { useCallback, useEffect, useRef, useState } from 'react';

type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finishing' | 'complete';

const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

function broadcastRecording(active: boolean) {
  window.dispatchEvent(new CustomEvent('recorder-state', { detail: { active } }));
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const recordedMsRef = useRef(0);
  const discardRef = useRef(false);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  const release = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    broadcastRecording(false);
  }, []);

  const discard = useCallback(() => {
    requestRef.current += 1;
    discardRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    release();
    chunksRef.current = [];
    recordedMsRef.current = 0;
    startedAtRef.current = 0;
    if (mountedRef.current) {
      setBlob(null);
      setElapsedMs(0);
      setError('');
      setStatus('idle');
    }
  }, [release]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Запись с микрофона не поддерживается в этом браузере. Загрузите готовый файл.');
      return;
    }
    discard();
    discardRef.current = false;
    setStatus('requesting');
    const requestId = requestRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || requestId !== requestRef.current) {
        stopTracks(stream);
        return;
      }
      streamRef.current = stream;
      const preferredType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardRef.current = true;
        release();
        if (mountedRef.current) {
          setStatus('idle');
          setError('Не удалось записать звук. Проверьте микрофон и попробуйте снова.');
        }
      };
      recorder.onstop = () => {
        const captured = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        recorderRef.current = null;
        release();
        if (!mountedRef.current || discardRef.current) return;
        if (captured.size === 0) {
          setStatus('idle');
          setError('Запись пуста. Запишите звук ещё раз.');
        } else if (captured.size > MAX_RECORDING_BYTES) {
          setStatus('idle');
          setError('Запись превышает 100 МБ. Сделайте запись короче.');
        } else {
          setBlob(captured);
          setStatus('complete');
        }
      };
      recorder.start(1000);
      startedAtRef.current = Date.now();
      recordedMsRef.current = 0;
      setElapsedMs(0);
      setStatus('recording');
      broadcastRecording(true);
    } catch (cause) {
      release();
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setStatus('idle');
      const name = cause instanceof DOMException ? cause.name : '';
      setError(name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Доступ к микрофону отклонён. Разрешите его в браузере или загрузите файл.'
        : name === 'NotFoundError'
          ? 'Микрофон не найден. Подключите устройство или загрузите файл.'
          : 'Не удалось начать запись. Проверьте микрофон и попробуйте снова.');
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

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (recorder.state === 'recording') recordedMsRef.current += Date.now() - startedAtRef.current;
    setElapsedMs(recordedMsRef.current);
    recorder.stop();
    setStatus('finishing');
    release();
  }, [release]);

  useEffect(() => {
    if (status !== 'recording') return;
    const interval = window.setInterval(() => {
      setElapsedMs(recordedMsRef.current + Date.now() - startedAtRef.current);
    }, 250);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      release();
    };
  }, [release]);

  return { status, blob, elapsedMs, error, start, pause, resume, stop, discard };
}
