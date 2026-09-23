const apiBase = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

async function checked(response: Response) {
  if (response.ok) return response;
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  throw new Error(body?.detail || `Сервер ответил ${response.status}.`);
}

export async function createRecording(input: { title: string; date: string | null; language: 'ru' | 'kk' | 'mixed' }) {
  const body = new FormData();
  body.set('title', input.title);
  body.set('lang', input.language === 'mixed' ? 'rukk' : input.language);
  if (input.date) body.set('meeting_date', input.date);
  const response = await checked(await fetch(`${apiBase}/api/runs/recordings`, { method: 'POST', body }));
  return (await response.json() as { run_id: string }).run_id;
}

export async function sendRecordingChunk(runId: string, chunk: Blob, offset: number): Promise<number> {
  const send = () => fetch(`${apiBase}/api/runs/${runId}/chunks`, {
    method: 'POST', headers: { 'X-Chunk-Offset': String(offset), 'Content-Type': 'application/octet-stream' }, body: chunk,
  });
  let response: Response;
  try { response = await send(); }
  catch { response = await send(); }
  await checked(response);
  return (await response.json() as { offset: number }).offset;
}

export async function finishRecording(runId: string) {
  await checked(await fetch(`${apiBase}/api/runs/${runId}/finish`, { method: 'POST' }));
}

export function recordingEventsUrl(runId: string) {
  return `${apiBase}/api/runs/${runId}/events`;
}

export async function getRecordingRun(runId: string) {
  const response = await checked(await fetch(`${apiBase}/api/runs/${runId}`));
  return response.json() as Promise<{
    run: { status: string; source_mode: string };
    steps: { seq: number; content: string; data?: { stage?: string } }[];
  }>;
}
