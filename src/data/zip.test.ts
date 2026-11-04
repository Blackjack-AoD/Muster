import { describe, expect, it } from 'vitest';
import { dataFileText, isZipped, readZip } from './zip';
import { makeZip } from '../test/zipfile';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('readZip', () => {
  it('reads deflated and stored files', async () => {
    const entries = readZip(await makeZip([{ name: 'a.txt', text: 'hello hello hello' }, { name: 'b.txt', text: 'plain', method: 0 }]));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(text(await entries[0].read())).toBe('hello hello hello');
    expect(text(await entries[1].read())).toBe('plain');
  });
  it('skips the extra header real zip tools add', async () => {
    const [entry] = readZip(await makeZip([{ name: 'a.txt', text: 'x', method: 0, extra: 9 }]));
    expect(text(await entry.read())).toBe('x');
  });
  it('accepts an ArrayBuffer', async () => {
    const z = await makeZip([{ name: 'a.txt', text: 'x' }]);
    expect(readZip(z.buffer.slice(0) as ArrayBuffer)).toHaveLength(1);
  });
  it('reads a view into a larger buffer', async () => {
    const z = await makeZip([{ name: 'a.txt', text: 'x', method: 0 }]);
    const padded = new Uint8Array(z.length + 7);
    padded.set(z, 3);
    expect(text(await readZip(padded.subarray(3, 3 + z.length))[0].read())).toBe('x');
  });
  it('skips folders', async () => {
    expect(readZip(await makeZip([{ name: 'dir/', method: 0 }, { name: 'dir/a.txt', text: 'x' }])).map((e) => e.name)).toEqual(['dir/a.txt']);
  });
  it('copes with a comment at the end', async () => {
    expect(readZip(await makeZip([{ name: 'a.txt' }], 'made by a test'))).toHaveLength(1);
  });
  it('rejects something that is not a zip', () => {
    expect(() => readZip(new Uint8Array(100))).toThrow('Not a zip file');
    expect(() => readZip(new Uint8Array(3))).toThrow('Not a zip file');
  });
  it('rejects a damaged central directory', async () => {
    const z = await makeZip([{ name: 'a.txt', text: 'x', method: 0 }]);
    const cd = z.findIndex((_, i) => z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 1 && z[i + 3] === 2);
    z[cd] = 0;
    expect(() => readZip(z)).toThrow('Damaged zip file');
  });
  it('rejects a damaged entry when reading it', async () => {
    const z = await makeZip([{ name: 'a.txt', text: 'x', method: 0 }]);
    const [entry] = readZip(z);
    z[0] = 0;
    await expect(entry.read()).rejects.toThrow('Damaged zip entry a.txt');
  });
  it('rejects compression it does not know', async () => {
    const [entry] = readZip(await makeZip([{ name: 'a.txt', text: 'x', method: 12 }]));
    await expect(entry.read()).rejects.toThrow('Unsupported compression in a.txt');
  });
});

describe('isZipped', () => {
  it('recognises zipped data files', () => {
    expect(['a.catz', 'a.GSTZ', 'a.cat', 'a.zip'].map(isZipped)).toEqual([true, true, false, false]);
  });
});

describe('dataFileText', () => {
  const xml = '<catalogue/>';
  it('returns plain XML as it is', async () => {
    expect(await dataFileText('a.cat', new TextEncoder().encode(xml))).toBe(xml);
  });
  it('accepts an ArrayBuffer', async () => {
    expect(await dataFileText('a.cat', new TextEncoder().encode(xml).buffer)).toBe(xml);
  });
  it('unpacks a .catz', async () => {
    expect(await dataFileText('a.catz', await makeZip([{ name: 'a.cat', text: xml }]))).toBe(xml);
  });
  it('unpacks a zip misnamed as .cat', async () => {
    expect(await dataFileText('a.cat', await makeZip([{ name: 'a.cat', text: xml }]))).toBe(xml);
  });
  it('prefers the data file inside', async () => {
    expect(await dataFileText('a.catz', await makeZip([{ name: 'readme.txt', text: 'no' }, { name: 'a.gst', text: xml }]))).toBe(xml);
  });
  it('falls back to the first file', async () => {
    expect(await dataFileText('a.catz', await makeZip([{ name: 'data.xml', text: xml }]))).toBe(xml);
  });
  it('rejects an empty archive', async () => {
    await expect(dataFileText('a.catz', await makeZip([]))).rejects.toThrow('a.catz is empty');
  });
});
