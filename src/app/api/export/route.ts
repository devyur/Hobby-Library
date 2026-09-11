import { NextResponse } from "next/server";

import { buildExportData } from "@/lib/queries/export";
import { buildExportCsv } from "@/lib/queries/exportCsv";

// The project's first file under src/app/api/ -- a Route Handler rather than
// a Server Action, per project-structure.md §1/§4's explicit carve-out for
// file downloads (issue #29). Auth uses the same cookie-based
// createClient() (anon key, no service-role key) every other query in this
// codebase uses; buildExportData() (lib/queries/export.ts) does the actual
// session check and data assembly, keeping this handler thin.
export async function GET(request: Request) {
  let data;
  try {
    data = await buildExportData();
  } catch (error) {
    // A query-level failure during assembly -- logged like every other
    // lib/queries read error, but surfaced as a real 500 here (rather than
    // degraded to an empty/partial result) since this endpoint's whole job
    // is producing a complete backup file.
    console.error("Failed to build export:", error);
    return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
  }

  if (!data) {
    // No signed-in session -- no library data in the body (issue #29 AC).
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

  // CSV branch (issue #45): only `?format=csv` diverges. Any other value
  // (or no param at all) falls through to the unconditional JSON response
  // below, unchanged from before this issue -- no new error path.
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const csvFilename = `hobby-library-export-${today}.csv`;
    return new NextResponse(buildExportCsv(data), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename}"`,
      },
    });
  }

  const filename = `hobby-library-export-${today}.json`;

  return new NextResponse(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
