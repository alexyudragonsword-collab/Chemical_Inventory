// Serve an SDS PDF from the file store.

import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await prisma.sdsDocument.findUnique({ where: { id } });
  if (!doc?.fileKey) return new Response("Not found", { status: 404 });

  const root = process.env.FILE_STORAGE_ROOT ?? "./data/files";
  const filePath = path.join(root, doc.fileKey);
  if (!filePath.startsWith(path.resolve(root)) && !filePath.startsWith(root)) {
    return new Response("Not found", { status: 404 });
  }
  if (!existsSync(filePath)) return new Response("File missing from store", { status: 404 });

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sds-${doc.revision}.pdf"`,
    },
  });
}
