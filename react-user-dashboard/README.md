# VSMS React dashboard

The dashboard is the React 19 and Vite client for VSMS event operations. Setup, route inventory, verification commands, and deployment requirements are documented in the [repository README](../README.md).

Useful commands:

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

Local development uses HTTPS and expects developer-generated certificates at `certs/localhost.pem` and `certs/localhost-key.pem`. These files are intentionally not committed. Set `DEV_HTTPS=false` only for the loopback QA mirror configured in `vite.config.ts`.

For a separately hosted API, provide `VITE_API_BASE_URL` at build time.
