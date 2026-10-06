import fs from 'node:fs';

for (const dir of ['.next', '.next-build', 'out']) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`已清理 ${dir}`);
}
