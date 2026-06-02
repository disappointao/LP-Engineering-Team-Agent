import { bundleSingleFileHtml } from "@lp-agent/artifacts";
import { Buffer } from "node:buffer";
import {
  jsonResponse,
  loadCurrentTaskArtifacts,
  type TaskArtifactRouteContext
} from "../artifact-route-helpers";

export const dynamic = "force-dynamic";

type ExportFormat = "single-html" | "split-zip" | "index-html" | "styles-css" | "script-js";

type ExportSpec = {
  filename: string;
  contentType: string;
  content: string | ArrayBuffer;
};

export async function GET(
  request: Request,
  context: TaskArtifactRouteContext
): Promise<Response> {
  const url = new URL(request.url);
  const format = parseExportFormat(url.searchParams.get("file"));
  if (!format) {
    return jsonResponse({ ok: false, error: "unsupported_export" }, 400);
  }

  const result = await loadCurrentTaskArtifacts(request, context);
  if (!result.ok) {
    return jsonResponse(result, 404);
  }

  const spec = createExportSpec(format, result.artifacts);
  return new Response(spec.content, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${spec.filename}"`,
      "content-type":
        typeof spec.content === "string"
          ? `${spec.contentType}; charset=utf-8`
          : spec.contentType
    }
  });
}

function parseExportFormat(value: string | null): ExportFormat | undefined {
  switch (value) {
    case "single-html":
    case "split-zip":
    case "index-html":
    case "styles-css":
    case "script-js":
      return value;
    default:
      return undefined;
  }
}

function createExportSpec(
  format: ExportFormat,
  artifacts: Parameters<typeof bundleSingleFileHtml>[0]
): ExportSpec {
  switch (format) {
    case "single-html":
      return {
        filename: "index.single.html",
        contentType: "text/html",
        content: bundleSingleFileHtml(artifacts)
      };
    case "split-zip":
      return {
        filename: "lp-static-files.zip",
        contentType: "application/zip",
        content: createStoredZip([
          { filename: "index.html", content: artifacts.indexHtml },
          { filename: "styles.css", content: artifacts.stylesCss },
          { filename: "script.js", content: artifacts.scriptJs }
        ])
      };
    case "index-html":
      return {
        filename: "index.html",
        contentType: "text/html",
        content: artifacts.indexHtml
      };
    case "styles-css":
      return {
        filename: "styles.css",
        contentType: "text/css",
        content: artifacts.stylesCss
      };
    case "script-js":
      return {
        filename: "script.js",
        contentType: "application/javascript",
        content: artifacts.scriptJs
      };
  }
}

function createStoredZip(entries: Array<{ filename: string; content: string }>): ArrayBuffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.filename, "utf8");
    const content = Buffer.from(entry.content, "utf8");
    const crc = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(centralStart, 16);
  endRecord.writeUInt16LE(0, 20);

  return toArrayBuffer(Buffer.concat([...localParts, ...centralParts, endRecord]));
}

const crc32Table = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc32Table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}
