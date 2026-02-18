import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = join(__dirname, '../node_modules/buffer-equal-constant-time/index.js');

let content;
try {
  content = readFileSync(filePath, 'utf8');
} catch {
  console.log('buffer-equal-constant-time not found, skipping patch.');
  process.exit(0);
}

// Already patched
if (content.includes('SlowBuffer && SlowBuffer.prototype')) {
  console.log('✓ buffer-equal-constant-time already patched.');
  process.exit(0);
}

content = content
  .replace(
    /Buffer\.prototype\.equal = SlowBuffer\.prototype\.equal = function equal\(that\) \{/,
    'Buffer.prototype.equal = function equal(that) {'
  )
  .replace(
    /\};\n\};\n\nvar origBufEqual/,
    '};\n  if (SlowBuffer && SlowBuffer.prototype) {\n    SlowBuffer.prototype.equal = Buffer.prototype.equal;\n  }\n};\n\nvar origBufEqual'
  )
  .replace(
    'var origSlowBufEqual = SlowBuffer.prototype.equal;',
    'var origSlowBufEqual = SlowBuffer && SlowBuffer.prototype ? SlowBuffer.prototype.equal : undefined;'
  )
  .replace(
    '  SlowBuffer.prototype.equal = origSlowBufEqual;\n};',
    '  if (SlowBuffer && SlowBuffer.prototype) {\n    SlowBuffer.prototype.equal = origSlowBufEqual;\n  }\n};'
  );

writeFileSync(filePath, content);
console.log('✓ Patched buffer-equal-constant-time for Node.js v22+ compatibility.');
