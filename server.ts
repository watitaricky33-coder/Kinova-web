import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './server/routes/apiRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createAppServer(options: { allowPrivateProxyForTest?: boolean } = {}) {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Public static assets (fonts, images)
  app.use(express.static(path.join(__dirname, 'public')));

  // Unified API + Node.js Stream Proxy
  app.use('/api', createApiRouter({ allowPrivateProxyForTest: options.allowPrivateProxyForTest }));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntry) {
  const port = Number(process.env.KINOVA_PORT || 3000);
  createAppServer()
    .then((app) => {
      app.listen(port, '0.0.0.0', () => {
        console.log(`[KINOVA] Server listening on http://0.0.0.0:${port} (Node.js native proxy active, zero Cloudflare)`);
      });
    })
    .catch((err) => {
      console.error('[KINOVA] Failed to start server:', err);
      process.exit(1);
    });
}
