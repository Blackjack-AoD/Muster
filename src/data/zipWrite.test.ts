import { describe, expect, it } from 'vitest';
import { readZip } from './zip';
import { crc32, writeZip } from './zipWrite';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('writeZip', () => {
  it('writes files the zip reader gets back unchanged', async () => {
    const files = [
      { name: 'Warhammer 40,000 Kill Team.gst', text: '<gameSystem id="g"/>' },
      { name: "T'au Empire.cat", text: '<catalogue id="c">' + 'x'.repeat(5000) + '</catalogue>' },
      { name: 'Empty.cat', text: '' },
    ];
    const entries = readZip(await writeZip(files));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, e] of entries.entries()) expect(text(await e.read())).toBe(files[i].text);
  });
  it('records each file’s CRC-32, sizes and UTF-8 names in the headers', async () => {
    const zip = await writeZip([{ name: 'Café.cat', text: 'hello' }]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hello')));
    expect(v.getUint32(22, true)).toBe(5);
    const eocd = zip.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 8, true)).toBe(1);
    expect(v.getUint16(eocd + 10, true)).toBe(1);
  });
  it('makes a valid empty zip', async () => {
    expect(readZip(await writeZip([]))).toEqual([]);
  });
});
