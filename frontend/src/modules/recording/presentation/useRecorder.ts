import { useEffect, useSyncExternalStore } from 'react';
import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';

export function useRecorder() {
  const { recorder } = useServices();
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
  useEffect(() => () => recorder.discard(), [recorder]);
  return { ...snapshot, start: recorder.start, pause: recorder.pause, resume: recorder.resume, stop: recorder.stop, discard: recorder.discard };
}

export function useRecordingActivity(): boolean {
  const { recorder } = useServices();
  return useSyncExternalStore(recorder.subscribe, recorder.getIsActive);
}
