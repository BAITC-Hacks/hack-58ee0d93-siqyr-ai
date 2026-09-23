import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), 'JIRA_TOKEN');
  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [react(), tailwindcss()],
    define: { __JIRA_TOKEN_PRESENT__: JSON.stringify(Boolean(serverEnv.JIRA_TOKEN?.trim())) },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
  };
});
