// npm audit, failing on any advisory of any severity except the few listed here.
//
// An advisory goes on this list only when no fixed release exists yet and it cannot reach what ships. Each entry
// says why and when it comes off; take it off as soon as a fixed release lands (Dependabot opens the PR).

import { execFileSync } from 'node:child_process';

const EXEMPT = new Map([
  // picomatch <=4.0.7 ReDoS through repeated extglobs. 4.0.7 is the newest release. Reached only through the build
  // and test tools (vite, vitest, tinyglobby, fdir), which match our own patterns; the image ships none of them.
  // Remove once picomatch 4.0.8 is out.
  ['GHSA-fc5q-39xc-vjpf', 'picomatch ReDoS, no fixed release yet, build and test tools only'],
]);

let out;
try {
  out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20, shell: process.platform === 'win32' });
} catch (e) {
  // npm audit exits non-zero when it finds anything; the report is still on stdout.
  out = e.stdout;
  if (!out) throw e;
}
const report = JSON.parse(out);
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

const found = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object') continue;
    const id = via.url?.split('/').pop() ?? String(via.source);
    found.set(id, `${via.name} (${via.severity}): ${via.title} ${via.url ?? ''}`.trim());
  }
}

const blocking = [...found].filter(([id]) => !EXEMPT.has(id));
for (const [id, why] of EXEMPT) {
  console.log(found.has(id) ? `Exempt: ${id}, ${why}.` : `Exempt but no longer reported: ${id}. Take it off the list in tools/audit.mjs.`);
}
if (blocking.length) {
  console.error(`\n${blocking.length} advisor${blocking.length === 1 ? 'y' : 'ies'}:`);
  for (const [, text] of blocking) console.error(`  ${text}`);
  process.exit(1);
}
console.log('No other advisories.');
