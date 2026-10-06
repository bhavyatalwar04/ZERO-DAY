import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  // Move the Next.js dev indicator out of the way of the live-room order ticket
  devIndicators: {
    position: 'bottom-right',
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  // /dashboard is linked from login, onboarding and the sidebar but doesn't exist
  // yet (roadmap 7.4). Temporary (307), so browsers don't cache it once it does.
  async redirects() {
    return [{ source: '/dashboard', destination: '/ledger', permanent: false }]
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion', 'radix-ui'],
  },
};

export default nextConfig;
