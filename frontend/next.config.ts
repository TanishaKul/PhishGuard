import type { NextConfig } from "next";

// With API_PROXY_TARGET set (e.g. https://phishguard-api.onrender.com), the
// web app forwards /api/* to the API, so the browser only ever talks to one
// site and the session cookie stays first-party. Build with
// NEXT_PUBLIC_API_URL="" to call the API through this proxy.
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  async rewrites() {
    return apiProxyTarget ? [{ source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` }] : [];
  },
};

export default nextConfig;
