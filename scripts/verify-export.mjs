import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const input=process.argv[2];
if(!input)throw Error('Usage: npm run verify -- path/to/export.html OR path/to/extracted-website');
const expected=JSON.parse(await readFile('public/website-template/build-manifest.json','utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if((await stat(input)).isDirectory()){
  for(const [file,digest] of Object.entries(expected.assets)){
    if(hash(await readFile(resolve(input,file)))!==digest)throw Error(`Viewer asset differs: ${file}`);
  }
}else{
  const html=await readFile(input,'utf8');
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match=>!match[1].includes('application/json'));
  if(scripts.length!==1||!scripts[0][1].includes('type="module"')||/\bsrc\s*=/.test(scripts[0][1]))throw Error('Expected exactly one bundled inline module script.');
  const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  const digests=[hash(scripts[0][2]),...styles.map(match=>hash(match[1]))];
  const expectedDigests=await Promise.all(Object.keys(expected.assets).map(async file=>{
    const code=await readFile(resolve('public/website-template',file),'utf8');
    return hash(file.endsWith('.css')?code.replace(/<\/style/gi,'<\\/style'):code.replace(/<\/script/gi,'<\\/script'));
  }));
  if(digests.length!==expectedDigests.length||expectedDigests.some(digest=>!digests.includes(digest)))throw Error('Viewer JavaScript or CSS differs from the locally built source.');
}
console.log(`MATCH: viewer JavaScript/CSS match local build (source SHA-256 ${expected.sourceSha256}).`);
console.log('This compares viewer assets, not the complete host page, service workers or external resources. Inspect those and network activity separately.');
