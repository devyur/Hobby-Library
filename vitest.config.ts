import react from "@vitejs/plugin-react";
import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  // Mirrors Next.js's own env loading (.env.local etc.) so tests can read
  // process.env.NEXT_PUBLIC_* the same way the app does at runtime.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: ["./vitest.setup.ts"],
      env: {
        NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
