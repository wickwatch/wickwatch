import type { InstanceFile } from "@wickwatch/core";

// A minimal ustar writer: enough to copy a few small files into a container (PUT /containers/{id}/archive).

const BLOCK = 512;

function header(path: string, mode: number, size: number, type: "0" | "5"): Buffer {
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = path.lastIndexOf("/", 155);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Path too long: ${path}`);
  const h = Buffer.alloc(BLOCK);
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, "0") + "\0";
  h.write(name, 0, 100);
  h.write(octal(mode, 8), 100, 8);
  h.write(octal(0, 8), 108, 8);
  h.write(octal(0, 8), 116, 8);
  h.write(octal(size, 12), 124, 12);
  h.write(octal(0, 12), 136, 12);
  h.write(" ".repeat(8), 148, 8);
  h.write(type, 156, 1);
  h.write("ustar\0", 257, 6);
  h.write("00", 263, 2);
  h.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/** Tar archive of the files (owned by root) and their parent directories, relative to `/`. */
export function tarFiles(files: InstanceFile[]): Buffer {
  const parts: Buffer[] = [];
  const dirs = new Set<string>();
  for (const file of files) {
    if (!file.path.startsWith("/") || file.path.split("/").includes("..")) {
      throw new Error(`File path must be absolute: ${file.path}`);
    }
    const segments = file.path.slice(1).split("/");
    for (let i = 1; i < segments.length; i++) {
      const dir = `${segments.slice(0, i).join("/")}/`;
      if (dirs.has(dir)) continue;
      dirs.add(dir);
      parts.push(header(dir, 0o755, 0, "5"));
    }
    const content = Buffer.from(file.content);
    parts.push(header(segments.join("/"), file.mode, content.length, "0"), content);
    const padding = (BLOCK - (content.length % BLOCK)) % BLOCK;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}
