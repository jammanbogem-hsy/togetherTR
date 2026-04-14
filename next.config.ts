import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/api/knowledge-graph': ['./data/**'],
    '/api/ontology/relate': ['./data/**'],
    '/api/ontology/search': ['./data/**'],
    '/api/chat/stream': ['./data/**'],
    '/api/analyze/a21': ['./data/**'],
    '/api/analyze/cumulative': ['./data/**'],
    '/api/analyze/stage': ['./data/**'],
    '/api/problem-situation/generate': ['./data/**'],
  },
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', 'react-markdown'],
  },
};

export default nextConfig;
