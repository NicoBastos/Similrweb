import type { NextConfig } from "next";
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from the monorepo root
config({ path: resolve(__dirname, '../../.env') });

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fpwkocfpazvkggbwfvoq.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Handle ESM imports for p-limit and async_hooks
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '#async_hooks': 'async_hooks',
      });
    }
    
    return config;
  },
};

export default nextConfig;
