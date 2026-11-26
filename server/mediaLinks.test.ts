import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { buildMediaLink, isSignedMediaLink } from './mediaLinks.ts';

test('accepts issued media links and rejects modified, duplicated, or unsigned links', () => {
  process.env.TMDB_API_KEY ??= randomBytes(32).toString('hex');
  const path = '/api/proxy';
  const params = new URLSearchParams({ url: 'https://example.com/video.mp4' });
  const unsigned = `${path}?${params}`;
  const signed = buildMediaLink(path, params);
  assert.equal(isSignedMediaLink(signed), true);
  assert.equal(isSignedMediaLink(unsigned), false);
  assert.equal(isSignedMediaLink(signed.replace('video.mp4', 'different.mp4')), false);
  assert.equal(isSignedMediaLink(signed.replace(path, '/api/streams/download')), false);
  assert.equal(isSignedMediaLink(`${signed}&sig=duplicate`), false);
});
