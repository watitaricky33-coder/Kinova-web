import express from 'express';
import { createServer } from 'node:http';
import type { Config } from '@netlify/server';
import { createApiRouter } from '../../server/routes/apiRoutes.ts';

const app = express();
const apiRouter = createApiRouter();

app.disable('x-powered-by');
app.use('/api', (request, response, next) => {
  if (request.path !== '/health' && !request.path.startsWith('/tmdb/')) {
    return next();
  }
  return apiRouter(request, response, next);
});

export const config: Config = { path: ['/api/health', '/api/tmdb/*'] };

export default createServer(app);
