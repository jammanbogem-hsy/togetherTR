import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  // firebase-admin을 번들 외부화(실제 패키지명 런타임 require)로 고정.
  // 미지정 시 Turbopack이 해시 별칭(firebase-admin-<hash>)으로 외부화하는데,
  // Firebase Hosting 함수 번들 node_modules에는 그 별칭이 없어
  // ERR_MODULE_NOT_FOUND → 모든 채팅 라우트 500 (2026-07-05 프로덕션 장애 원인).
  serverExternalPackages: ['firebase-admin'],
  outputFileTracingIncludes: {
    '/api/knowledge-graph': ['./data/**'],
    '/api/ontology/relate': ['./data/**'],
    '/api/ontology/search': ['./data/**'],
    '/api/chat/stream': ['./data/**'],
    '/api/analyze/a21': ['./data/**'],
    '/api/analyze/cumulative': ['./data/**'],
    '/api/analyze/stage': ['./data/**'],
    '/api/problem-situation/generate': ['./data/**'],
    // 아래 두 라우트는 data/ (내용체계 JSON·지식그래프)를 fs로 읽는데 트레이싱에서 누락되어
    // 번들 배포 시 내용체계가 전부 비어(=지식·이해/과정·기능 공란) 나올 수 있었다.
    '/api/core-ideas': ['./data/**'],
    '/api/curriculum-sheet/autofill': ['./data/**'],
  },
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', 'react-markdown'],
  },
};

export default nextConfig;
