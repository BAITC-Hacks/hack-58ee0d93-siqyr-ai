import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwnServer } from '../src/shared/domain/ownServer.ts';

test('a loopback API is this deployment from any page', () => {
  assert.equal(isOwnServer('http://localhost:8000', 'http://localhost:5174'), true);
  assert.equal(isOwnServer('http://127.0.0.1:8000', 'http://127.0.0.1:5174'), true);
  assert.equal(isOwnServer('http://[::1]:8000', 'http://localhost:5174'), true);
});

test('on-premise server: the API on the same origin as the page is this deployment', () => {
  assert.equal(isOwnServer('https://siqyr.company.kz', 'https://siqyr.company.kz'), true);
  assert.equal(isOwnServer('https://siqyr.company.kz/', 'https://siqyr.company.kz'), true);
});

test('any other host is not this deployment', () => {
  assert.equal(isOwnServer('https://siqyr-api.up.railway.app', 'https://siqyr.vercel.app'), false);
  assert.equal(isOwnServer('https://siqyr.company.kz', 'http://siqyr.company.kz'), false);
  assert.equal(isOwnServer('https://siqyr.company.kz:8443', 'https://siqyr.company.kz'), false);
  assert.equal(isOwnServer('http://evil.example', 'https://siqyr.company.kz'), false);
  assert.equal(isOwnServer('http://%', 'https://siqyr.company.kz'), false);
});
