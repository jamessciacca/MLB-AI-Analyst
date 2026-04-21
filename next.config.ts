import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.mlbstatic.com",
        pathname: "/team-logos/**",
      },
      {
        protocol: "https",
        hostname: "img.mlbstatic.com",
        pathname: "/mlb-photos/**",
      },
    ],
  },
};

export default nextConfig;
