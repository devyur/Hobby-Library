export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Hobby Library
      </h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Your personal cross-media library for tracking what you play, read,
        watch, and listen to.
      </p>
    </main>
  );
}
