(() => {
  if (window.__siqyrCapture) return;
  const NativePC = window.RTCPeerConnection;
  const state = { context: null, destination: null, recorder: null, segment: -1, seq: 0,
                  startedAt: 0, audio: [], tracks: new WeakSet(), stopped: false, pending: [] };
  const emit = (data) => {
    if (typeof window.__siqyrReceive === 'function') {
      return Promise.resolve(window.__siqyrReceive(data)).catch(() => {});
    }
    return Promise.resolve();
  };
  const startRecorder = () => {
    if (state.recorder || !state.destination || state.stopped) return;
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      emit({ type: 'error', reason: 'MediaRecorder Opus недоступен' }); return;
    }
    state.segment += 1;
    state.seq = 0;
    state.startedAt = Date.now();
    const recorder = new MediaRecorder(state.destination.stream, { mimeType: 'audio/webm;codecs=opus' });
    state.recorder = recorder;
    const segment = state.segment;
    recorder.ondataavailable = (event) => {
      if (!event.data || !event.data.size) return;
      const seq = state.seq++;
      const send = (async () => {
        const buffer = await event.data.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        await emit({ type: 'chunk', segment, seq,
                     started_at_ms: state.startedAt, captured_at_ms: Date.now(), base64: btoa(binary) });
      })();
      state.pending.push(send);
    };
    recorder.onerror = (event) => emit({ type: 'error', reason: String(event.error || 'MediaRecorder error') });
    recorder.start(window.__SIQYR_CHUNK_MS || 10000);
    emit({ type: 'segment', segment: state.segment, started_at_ms: state.startedAt });
  };
  const attachTrack = (track) => {
    if (!track || track.kind !== 'audio' || state.tracks.has(track)) return;
    state.tracks.add(track);
    try {
      state.context ||= new AudioContext();
      state.destination ||= state.context.createMediaStreamDestination();
      const stream = new MediaStream([track]);
      const element = document.createElement('audio');
      element.muted = true;
      element.autoplay = true;
      element.style.display = 'none';
      element.srcObject = stream;
      (document.body || document.documentElement).appendChild(element);
      state.audio.push(element);
      element.play().catch(() => {});
      const source = state.context.createMediaStreamSource(stream);
      source.connect(state.destination);
      state.context.resume().catch(() => {});
      startRecorder();
      emit({ type: 'audio_track', t_ms: Date.now(), track_id: track.id });
    } catch (error) { emit({ type: 'error', reason: String(error) }); }
  };
  if (NativePC) {
    class CapturedPC extends NativePC {
      constructor(...args) {
        super(...args);
        this.addEventListener('track', (event) => attachTrack(event.track));
      }
    }
    window.RTCPeerConnection = CapturedPC;
  }
  window.__siqyrCapture = {
    state,
    stop: async () => {
      state.stopped = true;
      if (state.recorder && state.recorder.state !== 'inactive') {
        await new Promise((resolve) => {
          state.recorder.addEventListener('stop', resolve, { once: true });
          state.recorder.stop();
        });
      }
      await Promise.all(state.pending);
      emit({ type: 'capture_stopped', t_ms: Date.now() });
    },
  };
})();
