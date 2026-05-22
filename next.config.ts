import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*.ngrok-free.app"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.userapi.com" },
      { protocol: "https", hostname: "*.vk.com" },
      { protocol: "https", hostname: "*.vkuser.net" },
      { protocol: "https", hostname: "sun*.userapi.com" },
    ],
  },
};

export default nextConfig;
