// Fetches the SoundFont that Options > Instruments > Sampled plays: GeneralUser GS 2.0.3 by S. Christian Collins
// (licence in GeneralUser-GS-LICENSE.txt beside this file: free to use, modify and ship with software). It is not
// kept in git; the Docker image fetches it at build time, and `npm run soundfont` fetches it for the dev server.
// The file is pinned to one commit of the author's repository and checked against its SHA-256.
//
//   node tools/soundfont/fetch.mjs [destination]   (default assets/generated/music/soundfont.sf2)

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2';
const SHA256 = '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dest = resolve(process.argv[2] ?? `${root}/assets/generated/music/soundfont.sf2`);
const sha = (data) => createHash('sha256').update(data).digest('hex');

try {
  if (sha(await readFile(dest)) === SHA256) {
    console.log(`${dest} is already GeneralUser GS 2.0.3`);
    process.exit(0);
  }
} catch {
  // Not there yet.
}
console.log(`Fetching GeneralUser GS 2.0.3 (32 MB) to ${dest}`);
const res = await fetch(URL_);
if (!res.ok) throw new Error(`soundfont: ${URL_} answered ${res.status}`);
const data = Buffer.from(await res.arrayBuffer());
if (sha(data) !== SHA256) throw new Error(`soundfont: the download's SHA-256 is ${sha(data)}, expected ${SHA256}`);
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, data);
console.log('Done');
