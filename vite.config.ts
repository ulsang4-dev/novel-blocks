import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
});
