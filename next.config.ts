import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let Next.js write its own AI-agent instructions into AGENTS.md —
  // that file is a hand-maintained project doc (see AGENTS.md itself).
  agentRules: false,
  experimental: {
    serverActions: {
      // Issue #19 (cover image upload): a 5 MB cover file plus multipart
      // form-data overhead can exceed Next.js's 1 MB default Server Action
      // body limit, which would reject a validly-sized upload before
      // uploadCoverAction's own size check ever runs. Comfortably above the
      // 5 MB cap enforced in the action/migration, not a separate limit of
      // its own.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
