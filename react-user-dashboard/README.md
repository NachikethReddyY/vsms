# VSMS React dashboard

The dashboard is the React 19 and Vite client for VSMS event operations. Setup, route inventory, verification commands, and deployment requirements are documented in the [repository README](../README.md).

Useful commands:

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm build
pnpm preview
```

Local development is HTTPS-only and expects developer-generated certificates at `certs/localhost.pem` and `certs/localhost-key.pem`. These files are intentionally not committed. Vite exits instead of falling back to HTTP when the certificates are unavailable.

For a separately hosted API, provide `VITE_API_BASE_URL` at build time.
