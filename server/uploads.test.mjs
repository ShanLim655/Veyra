import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatUploadType } from './uploads.mjs';

test('chat images preserve image and audio formats without allowing SVG', () => {
  assert.equal(normalizeChatUploadType('chat-images', 'image/jpeg'), 'image/jpeg');
  assert.equal(normalizeChatUploadType('chat-images', 'image/webp'), 'image/webp');
  assert.equal(normalizeChatUploadType('chat-images', 'audio/mpeg'), 'audio/mpeg');
});

test('active and unknown file types are stored as downloads', () => {
  assert.equal(normalizeChatUploadType('chat-images', 'image/svg+xml'), null);
  assert.equal(normalizeChatUploadType('chat-images', 'text/html'), 'application/octet-stream');
  assert.equal(normalizeChatUploadType('chat-images', 'application/pdf'), 'application/octet-stream');
  assert.equal(normalizeChatUploadType('chat-images', 'application/octet-stream'), 'application/octet-stream');
});

test('video and voice buckets preserve only their media types', () => {
  assert.equal(normalizeChatUploadType('chat-videos', 'video/mp4'), 'video/mp4');
  assert.equal(normalizeChatUploadType('chat-videos', 'text/html'), 'application/octet-stream');
  assert.equal(normalizeChatUploadType('chat-voice', 'audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeChatUploadType('chat-voice', 'text/html'), 'application/octet-stream');
});
