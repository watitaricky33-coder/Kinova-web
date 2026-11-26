# KINOVA — Stories Worth Watching

KINOVA is a dark-obsidian cinema, television, and anime streaming web application built with **React + Vite + Tailwind CSS** and a standalone **Node.js + Express** streaming & HLS proxy backend (**zero Cloudflare, zero Vercel, zero VPS dependencies**).

## Backend & Proxy Architecture

All stream resolution, manifest rewriting, and HTTP proxying run inside the Express server (`server.ts` + `server/`):

- **Unified Node.js Proxy (`server/proxyEngine.ts`)**:
  - Integrates `Varomine/streamrelay` HTTP/HTTPS streaming pipe & `Range` passthrough
  - Integrates `MHSanaei/HLS-Proxy-Worker` host-based `Referer` / `Origin` header rules (ported natively to Node.js without Cloudflare Workers)
  - Integrates `neilbauman21-hub/free-moveis-api` `/api/m3u8-proxy`, `/api/ts-proxy`, and `#EXT-X-KEY` / `#EXT-X-MAP` / `#EXT-X-MEDIA` / `#EXT-X-I-FRAME-STREAM-INF` manifest rewriting
  - Integrates `mdtahseen7/123anime-api` keep-alive agent behavior and `/api/sub-proxy` (`.srt` → `WEBVTT` normalization)
  - Integrates `vyla-backend` SSRF guard (blocking loopback, RFC1918, link-local) and disguised image magic-byte unwrapping (`findMediaStartOffset`)
- **Playback Providers**:
  - **Movies & Series**: `VidZee` (`core.vidzee.wtf/streams/...&e=0` servers `dcloud`, `tik`, `ipcloud`, `v6:Hindi`, etc.) + `x8rr/movies` multi-source scrapers + optional Vyla gateway + Internet Archive open cinema fallback
  - **Anime**: `123Anime API` (`123anime.la` / configurable `ANIME123_BASE_URL` mirror) with automatic **AniList GraphQL** discovery/episode fallback + **VidZee / X8RR** stream failover
- **Offline Downloads**: Browser IndexedDB Vault (`src/services/offlineStorage.ts`) saving MP4 streams and unencrypted HLS playlists/segments locally with pause/resume/delete and storage quota tracking.

## Environment Variables (`.env`)

- `PORT=3000`
- `TMDB_API_KEY=` (Server-side TMDB v3 key; when unset, KINOVA automatically falls back to Internet Archive, TVMaze, and AniList public discovery)
- `ANIME123_BASE_URL=` (Optional mirror override for 123anime scraper)
- `VYLA_STREAM_API_BASE_URL=` (Optional external Vyla gateway URL)

On Netlify, the Vite build serves the frontend and Netlify Server handles `/api/health` and `/api/tmdb/*`. Set `TMDB_API_KEY` in the Functions scope for the deploy context. `/api/health` reports whether a key is present; a successful `/api/tmdb/movies` response with `tmdb_movie_` IDs verifies live TMDB access.

## Commands

```bash
npm install
npm run dev      # Starts Vite + Express server on 0.0.0.0:3000
npm run lint     # TypeScript type-check (tsc --noEmit)
npm run build    # Production Vite build (dist/)
npm start        # Production Express server
```
