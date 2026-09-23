import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { AxiosHttpClient } from '../src/infrastructure/http/AxiosHttpClient.ts';
import { storedAccessToken } from '../src/modules/auth/infrastructure/ApiAuthGateway.ts';
import { mediaSourceError } from '../src/modules/meetings/domain/mediaSource.ts';
import { parseParticipantLines } from '../src/modules/meetings/domain/participantLines.ts';
import { ApiRecordingGateway } from '../src/modules/recording/infrastructure/ApiRecordingGateway.ts';
import { HttpError, type HttpClient, type HttpRequest } from '../src/shared/application/HttpClient.ts';

function client(reply: (request: HttpRequest) => unknown): HttpClient & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return { requests, request: async <T>(request: HttpRequest) => { requests.push(request); return reply(request) as T; } };
}

const input = { title: 'Планёрка', date: '2026-09-23', language: 'mixed' as const };

test('upload sends the recording and meeting context to POST /api/runs and returns the server run', async () => {
  const http = client(() => ({ run_id: 'run-1', status: 'queued' }));
  const file = new File(['RIFF'], 'Совещание.wav', { type: 'audio/wav' });
  assert.equal(await new ApiRecordingGateway(http, 'http://127.0.0.1:8000/').upload(input, file), 'run-1');
  const [request] = http.requests;
  assert.ok(request);
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/api/runs');
  assert.ok(request.timeout && request.timeout > 30_000);
  const body = request.body as FormData;
  assert.equal(body.get('title'), 'Планёрка');
  assert.equal(body.get('lang'), 'rukk');
  assert.equal(body.get('meeting_date'), '2026-09-23');
  const sent = body.get('file') as File;
  assert.equal(sent.name, 'Совещание.wav');
  assert.equal(await sent.text(), 'RIFF');
});

test('participants go to the server run on start and can be replaced while it records', async () => {
  const participants = parseParticipantLines('Алия Сарсенова — главный инженер\n\n  Бекзат Омаров  \n');
  assert.deepEqual(participants, [{ name: 'Алия Сарсенова', role: 'главный инженер' }, { name: 'Бекзат Омаров', role: '' }]);

  const http = client(() => ({ run_id: 'run-1', status: 'recording' }));
  const gateway = new ApiRecordingGateway(http, 'http://api');
  await gateway.create({ ...input, participants });
  const created = http.requests[0]?.body as FormData;
  assert.deepEqual(JSON.parse(String(created.get('participants'))), [{ name: 'Алия Сарсенова', role: 'главный инженер' }, { name: 'Бекзат Омаров' }]);

  await gateway.updateParticipants('run-1', [...participants, { name: 'Дана', role: '' }]);
  const [, update] = http.requests;
  assert.equal(update?.method, 'PATCH');
  assert.equal(update?.path, '/api/runs/run-1/participants');
  assert.deepEqual(update?.body, { participants: [{ name: 'Алия Сарсенова', role: 'главный инженер' }, { name: 'Бекзат Омаров' }, { name: 'Дана' }] });

  await gateway.create(input);
  assert.equal((http.requests[2]?.body as FormData).has('participants'), false);
});

test('upload explains rejected formats and an unreachable server without server text', async () => {
  const file = new File(['%PDF'], 'protocol.mp3', { type: 'audio/mpeg' });
  const rejected = new ApiRecordingGateway(client(() => { throw new HttpError('request failed', 415); }), 'http://api');
  await assert.rejects(rejected.upload(input, file), /не аудио- или видеозапись поддерживаемого формата/);
  const offline = new ApiRecordingGateway(client(() => { throw new HttpError('request failed'); }), 'http://api');
  await assert.rejects(offline.upload(input, file), /Сервер недоступен/);
  const busy = new ApiRecordingGateway(client(() => { throw new HttpError('request failed', 429); }), 'http://api');
  await assert.rejects(busy.upload(input, file), /Повторите через минуту/);
  const silent = new ApiRecordingGateway(client(() => ({ status: 'queued' })), 'http://api');
  await assert.rejects(silent.upload(input, file), /идентификатор/);
});

test('formats come from GET /api/formats and drive the browser check', async () => {
  const http = client(() => ({ max_upload_mb: 50, accept: '.wav,.amr,audio/wav', extensions: ['.wav', '.amr'], formats: [] }));
  const formats = await new ApiRecordingGateway(http, 'http://api').formats();
  assert.equal(http.requests[0]?.path, '/api/formats');
  assert.deepEqual(formats, { accept: '.wav,.amr,audio/wav', extensions: ['.wav', '.amr'], maxBytes: 50 * 1024 * 1024 });

  assert.equal(mediaSourceError({ name: 'phone.AMR', type: '', size: 10 }, formats), null);
  assert.match(mediaSourceError({ name: 'notes.txt', type: 'audio/mpeg', size: 10 }, formats) ?? '', /WAV, AMR/);
  assert.match(mediaSourceError({ name: 'long.wav', type: 'audio/wav', size: 50 * 1024 * 1024 + 1 }, formats) ?? '', /50 МБ/);
  await assert.rejects(new ApiRecordingGateway(client(() => ({ accept: '.wav' })), 'http://api').formats(), /форматов/);
});

test('API calls carry the signed-in Bearer token; an explicit header and a signed-out state are respected', async () => {
  const seen: (string | undefined)[] = [];
  const instance = axios.create({ adapter: async (config) => {
    seen.push(config.headers.Authorization as string | undefined);
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  } });
  let token: string | null = 'jwt-1';
  const http = new AxiosHttpClient('http://api', instance, () => token);
  await http.request({ method: 'POST', path: '/api/runs' });
  await http.request({ method: 'GET', path: '/api/auth/me', headers: { Authorization: 'Bearer restored' } });
  token = null;
  await http.request({ method: 'GET', path: '/api/formats' });
  assert.deepEqual(seen, ['Bearer jwt-1', 'Bearer restored', undefined]);

  const storage = { getItem: () => JSON.stringify({ token: 'jwt-2', expiresAt: 2_000 }) };
  assert.equal(storedAccessToken(storage, 1_000), 'jwt-2');
  assert.equal(storedAccessToken(storage, 3_000), null);
  assert.equal(storedAccessToken({ getItem: () => 'broken' }, 1_000), null);
});
