import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Stub route (issue #10, acceptance criteria C): looks up the requested
// slug against `categories`. A known slug (the only kind reachable via a
// nav click, since tabs only render seeded slugs) renders a minimal
// placeholder inside the shell -- the real library list/card view + filters
// is #12's job, so no item querying belongs here. An unknown slug (only
// reachable by typing a bad URL directly) is a genuine 404 via notFound(),
// per the issue's edge cases -- not a shell-wrapped "coming soon" stub.
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;

  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();

  if (!category) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">
        {category.name}
      </h1>
      <p className="text-sm text-text-secondary">
        Full library view coming in #12.
      </p>
    </div>
  );
}
