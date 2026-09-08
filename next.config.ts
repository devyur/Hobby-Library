import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let Next.js write its own AI-agent instructions into AGENTS.md —
  // that file is a hand-maintained project doc (see AGENTS.md itself).
  agentRules: false,
};

export default nextConfig;
