// Minimal zip reader for .catz / .gstz files and repo .zip downloads.
// Uses the platform's DecompressionStream (all current browsers, Node 18+), so no extra library.

export interface ZipEntry {
  name: string;
  read: () => Promise<Uint8Array>;
}

const u16 = (b: DataView, o: number) => b.getUint16(o, true);
const u32 = (b: DataView, o: number) => b.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** List the files in a zip archive. Throws if it isn't one. */
export function readZip(buf: ArrayBuffer | Uint8Array): ZipEntry[] {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // find the end-of-central-directory record (it sits in the last 64 KB + 22 bytes)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(v, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(v, p) !== 0x02014b50) throw new Error('Damaged zip file');
    const method = u16(v, p + 10);
    const size = u32(v, p + 20);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    out.push({
      name,
      read: async () => {
        if (u32(v, local) !== 0x04034b50) throw new Error(`Damaged zip entry ${name}`);
        const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
        const raw = bytes.subarray(start, start + size);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`Unsupported compression in ${name}`);
      },
    });
  }
  return out;
}

export const isZipped = (path: string) => /\.(catz|gstz)$/i.test(path);

/** Text of a data file: plain XML as-is, .catz/.gstz unpacked (they hold a single XML file). */
export async function dataFileText(path: string, body: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const looksZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZipped(path) && !looksZip) return new TextDecoder().decode(bytes);
  const entries = readZip(bytes);
  const xml = entries.find((e) => /\.(cat|gst)$/i.test(e.name)) ?? entries[0];
  if (!xml) throw new Error(`${path} is empty`);
  return new TextDecoder().decode(await xml.read());
}
