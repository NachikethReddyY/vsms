import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";

export default defineConfig(({ command }) => {
  // Check if certs exist before attempting to read them
  const certsExist =
    fs.existsSync("./certs/localhost-key.pem") &&
    fs.existsSync("./certs/localhost.pem");

  const localHttps =
    command === "serve" &&
    process.env.DEV_HTTPS !== "false" &&
    certsExist;

  return {
    plugins: [react(), tailwindcss()],

    server: {
      https: localHttps
        ? {
            key: fs.readFileSync("./certs/localhost-key.pem"),
            cert: fs.readFileSync("./certs/localhost.pem"),
          }
        : false,

      port: 5173,
      strictPort: true,

      // Enable proxying regardless of localHttps status
      proxy: {
        "/auth": {
          target: "http://localhost:5000",
          changeOrigin: true,
          secure: false,
        },
        "/users": {
          target: "http://localhost:5000",
          changeOrigin: true,
          secure: false,
        },
        "/events": {
          target: "http://localhost:5000",
          changeOrigin: true,
          secure: false,
        },
        "/participants": {
          target: "http://localhost:5000",
          changeOrigin: true,
          secure: false,
        },
        "/qr": {
          target: "http://localhost:5000",
          changeOrigin: true,
          secure: false,
        },
        "/event-registrations": {
          target: "http://localhost:5000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});