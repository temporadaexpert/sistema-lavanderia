import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Configuração enxuta: ambiente node (testamos services puros sobre
// repositórios in-memory, sem React/DOM), resolve do alias @ alinhado ao
// tsconfig.json. Sem globals — importamos describe/it/expect explicitamente
// em cada arquivo para rastreabilidade.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
