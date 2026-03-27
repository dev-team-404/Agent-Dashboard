import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: '0.0.0.0',
        // 모든 호스트 허용 (Docker 환경)
        allowedHosts: ['a2g.samsungds.net', 'localhost', '127.0.0.1'],
        proxy: {
            '/api': {
                // Docker 네트워크 내에서 API 컨테이너 접근
                // dashboard-api (container_name) 또는 api (service_name)
                target: 'http://dashboard-api:3000',
                changeOrigin: true,
                // /api prefix 제거 (nginx와 동일하게 동작)
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
