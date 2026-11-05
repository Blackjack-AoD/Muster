// tsconfig leaves out Node's types so that browser code can't reach for them. This is the one export the tests use.
declare module 'node:buffer' {
  export const Blob: typeof globalThis.Blob;
}
