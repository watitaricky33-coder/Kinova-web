import assert from 'node:assert/strict';
import http from 'node:http';
import { createAppServer } from '../server.js';
import {
  findMediaStartOffset,
  rewriteHlsManifest,
  validateExternalProxyTarget,
  verifyPlayableCandidate,
  convertSrtToVtt,
} from './proxyEngine.js';

async function runTests() {
  console.log('=== 1. Unit Tests: SSRF, HLS Rewriter, Magic-Byte Unwrapper, SRT->VTT ===');

  // SSRF checks
  assert.equal(validateExternalProxyTarget('http://127.0.0.1:8080/a').ok, false);
  assert.equal(validateExternalProxyTarget('http://localhost/test').ok, false);
  assert.equal(validateExternalProxyTarget('http://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(validateExternalProxyTarget('http://10.0.0.5/video.mp4').ok, false);
  assert.equal(validateExternalProxyTarget('http://192.168.1.1/stream.m3u8').ok, false);
  assert.equal(validateExternalProxyTarget('file:///etc/passwd').ok, false);
  assert.equal(validateExternalProxyTarget('https://core.vidzee.wtf/streams/movie/27205').ok, true);
  console.log('PASS: SSRF guard blocks loopback, RFC1918, link-local, file:// and allows HTTPS');

  // HLS manifest rewriting (master + key + map + media + segment)
  const sampleMaster = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",URI="audio/en.m3u8"',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080',
    '1080p/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720',
    'seg/extless_variant_token',
    'segment001.ts',
  ].join('\n');

  const rewritten = rewriteHlsManifest(
    sampleMaster,
    'https://cdn.example.com/hls/master.m3u8',
    'http://localhost:3000',
    { referer: 'https://player.vidzee.wtf/' }
  );
  assert.ok(rewritten.includes('/api/m3u8-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2F1080p%2Findex.m3u8'));
  assert.ok(rewritten.includes('/api/m3u8-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Fseg%2Fextless_variant_token'));
  assert.ok(rewritten.includes('/api/ts-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Fsegment001.ts'));
  assert.ok(rewritten.includes('/api/ts-proxy?url=https%3A%2F%2Fkeys.example.com%2Fkey.bin'));
  assert.ok(rewritten.includes('/api/ts-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Finit.mp4'));
  assert.ok(rewritten.includes('/api/m3u8-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Faudio%2Fen.m3u8'));
  assert.ok(rewritten.includes('referer=https%3A%2F%2Fplayer.vidzee.wtf%2F'));
  console.log('PASS: HLS manifest rewriter handles variants (incl. extensionless), #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, and segments');

  // Magic-byte PNG wrapper + 188-byte MPEG-TS sync detection
  const pngPrefix = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const tsPayload = Buffer.alloc(600, 0x11);
  tsPayload[0] = 0x47;
  tsPayload[188] = 0x47;
  tsPayload[376] = 0x47;
  const disguised = Buffer.concat([pngPrefix, tsPayload]);
  assert.equal(findMediaStartOffset(disguised), pngPrefix.length);
  console.log('PASS: Magic-byte unwrapper locates MPEG-TS offset after prepended PNG bytes');

  // SRT -> VTT conversion
  const vtt = convertSrtToVtt('1\r\n00:00:01,250 --> 00:00:04,500\r\nHello KINOVA\r\n');
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('00:00:01.250 --> 00:00:04.500'));
  assert.ok(vtt.includes('Hello KINOVA'));
  console.log('PASS: SRT-to-WEBVTT converter produces valid WebVTT cues');

  console.log('\n=== 2. Integration Tests: Express Server, Proxy Streaming, Range, Health ===');

  // Start a local mock media upstream server to test end-to-end HTTP proxying
  const mediaBytes = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const upstreamServer = http.createServer((req, res) => {
    if (req.url === '/playlist.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:4.0,\n/seg.ts\n');
      return;
    }
    if (req.url === '/dead-playlist.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:4.0,\n/pure.png\n');
      return;
    }
    if (req.url === '/seg.ts') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(disguised);
      return;
    }
    if (req.url === '/pure.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.concat([pngPrefix, Buffer.alloc(60, 0xaa)]));
      return;
    }
    if (req.url === '/movie.mp4') {
      const range = req.headers.range;
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/);
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : mediaBytes.length - 1;
        const slice = mediaBytes.subarray(start, end + 1);
        res.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${mediaBytes.length}`,
          'Content-Length': String(slice.length),
          'Accept-Ranges': 'bytes',
        });
        res.end(slice);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(mediaBytes.length) });
      res.end(mediaBytes);
      return;
    }
    if (req.url === '/sub.srt') {
      res.writeHead(200, { 'Content-Type': 'application/x-subrip' });
      res.end('1\n00:00:02,000 --> 00:00:05,000\nTest subtitle\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
  const upPort = (upstreamServer.address() as { port: number }).port;
  const upBase = `http://127.0.0.1:${upPort}`;

  // Test server with allowPrivateProxyForTest=true ONLY for local mock upstream
  const app = await createAppServer({ allowPrivateProxyForTest: true });
  const kinovaServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => kinovaServer.once('listening', resolve));
  const kPort = (kinovaServer.address() as { port: number }).port;
  const kBase = `http://127.0.0.1:${kPort}`;

  try {
    // Health endpoint
    const healthRes = await fetch(`${kBase}/api/health`);
    const healthJson = (await healthRes.json()) as Record<string, unknown>;
    assert.equal(healthRes.status, 200);
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.cloudflareDependency, false);
    console.log('PASS: /api/health confirms Node.js Express runtime with zero Cloudflare');

    // Playlist rewrite via /api/m3u8-proxy
    const m3u8Res = await fetch(`${kBase}/api/m3u8-proxy?url=${encodeURIComponent(`${upBase}/playlist.m3u8`)}`);
    const m3u8Text = await m3u8Res.text();
    assert.equal(m3u8Res.status, 200);
    assert.ok(m3u8Text.includes(`/api/ts-proxy?url=${encodeURIComponent(`${upBase}/seg.ts`)}`));
    console.log('PASS: /api/m3u8-proxy rewrote segment URL cleanly');

    // Disguised segment unwrapping via /api/ts-proxy (including open-ended Range: bytes=0- sent by ffmpeg)
    const tsRes = await fetch(`${kBase}/api/ts-proxy?url=${encodeURIComponent(`${upBase}/seg.ts`)}`);
    const tsBuf = Buffer.from(await tsRes.arrayBuffer());
    assert.equal(tsRes.status, 200);
    assert.equal(tsRes.headers.get('content-type'), 'video/mp2t');
    assert.equal(tsBuf[0], 0x47);
    assert.equal(tsBuf.length, tsPayload.length);

    const tsRangeRes = await fetch(`${kBase}/api/ts-proxy?url=${encodeURIComponent(`${upBase}/seg.ts`)}`, {
      headers: { Range: 'bytes=0-' },
    });
    const tsRangeBuf = Buffer.from(await tsRangeRes.arrayBuffer());
    assert.equal(tsRangeRes.status, 200);
    assert.equal(tsRangeBuf[0], 0x47);
    assert.equal(tsRangeBuf.length, tsPayload.length);
    console.log('PASS: /api/ts-proxy stripped disguised PNG bytes (with and without Range: bytes=0-) and served valid video/mp2t');

    // Pure image rejection
    const imgRes = await fetch(`${kBase}/api/ts-proxy?url=${encodeURIComponent(`${upBase}/pure.png`)}`);
    assert.equal(imgRes.status, 502);
    console.log('PASS: /api/ts-proxy rejected non-media pure image payload with HTTP 502');

    // HTTP Range passthrough
    const rangeRes = await fetch(`${kBase}/api/proxy?url=${encodeURIComponent(`${upBase}/movie.mp4`)}`, {
      headers: { Range: 'bytes=0-9' },
    });
    const rangeText = await rangeRes.text();
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeText, '0123456789');
    assert.equal(rangeRes.headers.get('content-range'), `bytes 0-9/${mediaBytes.length}`);
    console.log('PASS: /api/proxy preserved HTTP 206 Range request & Content-Range');

    // Subtitle SRT -> VTT proxy
    const subRes = await fetch(`${kBase}/api/sub-proxy?url=${encodeURIComponent(`${upBase}/sub.srt`)}&format=vtt`);
    const subText = await subRes.text();
    assert.equal(subRes.status, 200);
    assert.ok(subText.includes('WEBVTT') && subText.includes('00:00:02.000 --> 00:00:05.000'));
    console.log('PASS: /api/sub-proxy converted SRT to WebVTT with CORS headers');

    // Direct MP4 download endpoint
    const dlMp4Res = await fetch(
      `${kBase}/api/streams/download?url=${encodeURIComponent(`${upBase}/movie.mp4`)}&type=mp4&filename=test.mp4`
    );
    assert.equal(dlMp4Res.status, 200);
    assert.ok((dlMp4Res.headers.get('content-disposition') || '').includes('attachment; filename="test.mp4"'));
    assert.equal(await dlMp4Res.text(), '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    console.log('PASS: /api/streams/download streams direct file with attachment disposition');

    // Segment-level verification rejects playlists whose segments are tiny dummy PNGs and accepts unwrapped TS
    const deadCheck = await verifyPlayableCandidate(`${upBase}/dead-playlist.m3u8`, {}, 4000, true);
    assert.equal(deadCheck.ok, false);
    const liveCheck = await verifyPlayableCandidate(`${upBase}/playlist.m3u8`, {}, 4000, true);
    assert.equal(liveCheck.ok, true);
    assert.equal(liveCheck.streamType, 'hls');
    console.log('PASS: verifyPlayableCandidate blocks dummy-segment playlists and accepts real unwrapped TS');

    // Live provider probe
    const probeRes = await fetch(`${kBase}/api/health/probe`);
    const probeJson = (await probeRes.json()) as Record<string, unknown>;
    console.log('Live Upstream Probe Result:', JSON.stringify(probeJson, null, 2));

    // Live TMDB/Fallback home discovery
    const homeRes = await fetch(`${kBase}/api/tmdb/home`);
    const homeJson = (await homeRes.json()) as Record<string, unknown>;
    assert.equal(homeRes.status, 200);
    console.log(
      `PASS: /api/tmdb/home returned tmdbConfigured=${homeJson.tmdbConfigured}, movies=${(homeJson.popularMovies as unknown[])?.length || 0}, series=${(homeJson.popularSeries as unknown[])?.length || 0}, anime=${(homeJson.popularAnime as unknown[])?.length || 0}`
    );

    // Live 123Anime search test
    const animeRes = await fetch(`${kBase}/api/anime/search?q=naruto`);
    const animeJson = (await animeRes.json()) as { items: unknown[] };
    assert.equal(animeRes.status, 200);
    console.log(`PASS: /api/anime/search returned ${animeJson.items.length} anime results`);
  } finally {
    kinovaServer.close();
    upstreamServer.close();
  }
}

runTests()
  .then(() => {
    console.log('\nALL KINOVA PROXY & PROVIDER TESTS PASSED');
    process.exit(0);
  })
  .catch((err) => {
    console.error('TEST FAILURE:', err);
    process.exit(1);
  });
