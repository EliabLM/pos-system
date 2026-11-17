import type { NextConfig } from "next";
import { PrismaPlugin } from '@prisma/nextjs-monorepo-workaround-plugin';

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    // Never optimize SVG through /_next/image and only allow the UploadThing
    // hosts that store product images today (legacy utfs.io + this app's ufs.sh).
    dangerouslyAllowSVG: false,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'utfs.io',
        pathname: '/f/**',
      },
      {
        protocol: 'https',
        hostname: 'toeustbcqq.ufs.sh',
        pathname: '/f/**',
      },
    ],
  },
  serverExternalPackages: ['@prisma/client', 'prisma'],
  outputFileTracingIncludes: {
    '/**/*': ['./src/generated/prisma/**/*'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('@prisma/client');
      config.plugins = [...config.plugins, new PrismaPlugin()];
    }
    return config;
  },
};

export default nextConfig;
