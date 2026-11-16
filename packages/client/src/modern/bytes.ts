// Comparing the map's byte grids (terrain, buildings, owners) with copies of them, as the modern view does every frame
// to see whether anything changed: four bytes at a time where the arrays allow it.

type Bytes = Uint8Array | Int8Array;

/** Whether two byte arrays hold the same bytes. */
export function sameBytes(a: Bytes, b: Bytes): boolean {
  const n = a.length;
  if (n !== b.length) return false;
  if (!((a.byteOffset | b.byteOffset | n) & 3)) {
    const wa = new Uint32Array(a.buffer, a.byteOffset, n >> 2);
    const wb = new Uint32Array(b.buffer, b.byteOffset, n >> 2);
    for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
