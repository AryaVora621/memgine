import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // A stray lockfile in the home directory makes Next.js infer the wrong workspace root.
    root: path.join(__dirname),
  },
};

export default nextConfig;
