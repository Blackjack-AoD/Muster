// Builds real zip files for tests.
const bytes = (s: string) => new TextEncoder().encode(s);

async function deflate(data: Uint8Array) {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export interface ZipFile { name: string; text?: string; method?: number; /** bytes of extra header, as real zip tools write */ extra?: number }

export async function makeZip(files: ZipFile[], comment = ''): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = bytes(f.name);
    const raw = bytes(f.text ?? '');
    const method = f.method ?? 8;
    const body = method === 8 ? await deflate(raw) : raw;
    const extra = new Uint8Array(f.extra ?? 0);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, method, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, extra.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, method, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, extra, body);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + extra.length + body.length;
  }
  const size = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const c = bytes(comment);
  end.setUint16(20, c.length, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer), c];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let p = 0;
  for (const part of all) { out.set(part, p); p += part.length; }
  return out;
}
