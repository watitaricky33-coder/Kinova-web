import express from 'express';
import { createServer } from 'node:http';
import type { Config } from '@netlify/server';
import { isSignedMediaLink } from '../../server/mediaLinks.ts';
import { createApiRouter } from '../../server/routes/apiRoutes.ts';

const app = express();
const apiRouter = createApiRouter({ trustedProvidersOnly: true });
const mediaPaths = new Set(['/proxy', '/m3u8-proxy', '/ts-proxy', '/sub-proxy', '/streams/download']);

app.disable('x-powered-by');
app.set('query parser', 'simple');
app.use('/api', (request, response, next) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  if (mediaPaths.has(request.path)) {
    if (!isSignedMediaLink(request.originalUrl)) {
      return response.status(403).json({ error: 'Open a fresh stream from the catalog to get a valid media link.' });
    }
  } else if (!/^\/(?:health(?:\/probe)?$|(?:tmdb|anime|streams\/(?:movie|tv))\/)/.test(request.path)) {
    return response.status(404).json({ error: 'API route not found.' });
  }
  return apiRouter(request, response, next);
});

export const config: Config = {
  path: '/api/*',
  includedFiles: ['../../node_modules/ffmpeg-static/ffmpeg', '../../node_modules/ffmpeg-static/package.json'],
};

export default createServer(app);
