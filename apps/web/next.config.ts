import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @chatbot/core ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@chatbot/core'],
};

export default nextConfig;
