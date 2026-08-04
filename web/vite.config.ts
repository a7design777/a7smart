import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // У деві фронтенд і API живуть на різних портах; у проді їх віддає
    // один контейнер, тому шляхи /api/* однакові в обох середовищах.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    // Сервер віддає статику з ./web — див. server/src/index.ts
    assetsDir: 'assets',
  },
});
