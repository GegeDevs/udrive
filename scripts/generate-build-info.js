import { writeFileSync } from 'fs';

// Generate build timestamp
const buildTime = new Date().toISOString();

// Write to build-info.js
const content = `// Auto-generated during build
export const BUILD_TIMESTAMP = '${buildTime}';
`;

writeFileSync('client/build-info.js', content);

console.log(`Build timestamp: ${buildTime}`);
