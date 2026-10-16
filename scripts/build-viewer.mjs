import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const output = resolve('public/website-template');
const runtimePackages=new Set();
await build({ configFile: false, root: resolve('viewer'), base: './', plugins: [react(), {
  name:'viewer-licences',
  generateBundle(_options,bundle){
    for(const chunk of Object.values(bundle))if(chunk.type==='chunk')for(const id of Object.keys(chunk.modules)){
      const match=id.replaceAll('\0','').replaceAll('\\','/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/);
      if(match)runtimePackages.add(match[1]);
    }
  },
}], build: { outDir: output, emptyOutDir: true } });
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(resolve(dir, entry.name), name + '/'));
    else result.push(name);
  }
  return result;
}
const sha256=data=>createHash('sha256').update(data).digest('hex');
const sourceFiles=JSON.parse(await readFile('viewer/source-files.json','utf8'));
const sourceHash=createHash('sha256');
for(const file of [...sourceFiles,'viewer/source-files.json','scripts/build-viewer.mjs'].sort()){
  sourceHash.update(file+'\0');sourceHash.update((await readFile(file,'utf8')).replaceAll('\r\n','\n'));sourceHash.update('\0');
}
let notices='Third-party software bundled in MapMason Viewer\nEach dependency retains its own licence. Map tiles and map data have separate attribution terms.\n';
for(const directory of [...runtimePackages].sort()){
  const pkg=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));
  notices+=`\n${'='.repeat(70)}\n${pkg.name} ${pkg.version} (${pkg.license??'see licence below'})\n`;
  for(const file of (await readdir(directory)).filter(name=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort()){
    try{notices+=`\n${file}\n${await readFile(resolve(directory,file),'utf8')}\n`;}catch{/* Some packages use a licence directory. */}
  }
}
const licence=await readFile('viewer-release/LICENSE.txt','utf8');
await writeFile(resolve(output,'LICENSE.txt'),licence);
await writeFile(resolve(output,'THIRD_PARTY_NOTICES.txt'),notices);
const assetHashes={};
for(const file of (await files(output)).filter(name=>name.startsWith('assets/')).sort())assetHashes[file]=sha256(await readFile(resolve(output,file)));
const manifest={format:'mapmason-viewer-build',version:1,sourceRepository:'https://github.com/aur0/mapmason-viewer',sourceSha256:sourceHash.digest('hex'),assets:assetHashes};
await writeFile(resolve(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
let index=await readFile(resolve(output,'index.html'),'utf8');
const buildInfo=`<script id="viewer-build-info" type="application/json">${JSON.stringify(manifest).replaceAll('<','\\u003c')}</script>`;
const licenceComment=`<!--\nMapMason Viewer: MIT. Designer software is not included.\n${(licence+'\n'+notices).replaceAll('--','- -')}\n-->`;
index=index.replace('<head>',()=>'<head>'+licenceComment+buildInfo);
await writeFile(resolve(output,'index.html'),index);
// Keep the ZIP template unchanged and produce a second template with all code
// and styles inline, so file:// never has to fetch neighbouring files.
let single = await readFile(resolve(output, 'index.html'), 'utf8');
for (const match of [...single.matchAll(/<script\b[^>]*\bsrc="\.\/([^" ]+)"[^>]*><\/script>/g)]) {
  const code = await readFile(resolve(output, match[1]), 'utf8');
  single = single.replace(match[0], () => `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of [...single.matchAll(/<link\b[^>]*\bhref="\.\/([^" ]+\.css)"[^>]*>/g)]) {
  const css = await readFile(resolve(output, match[1]), 'utf8');
  single = single.replace(match[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}
single = single.replace('<head>', '<head><script id="event-map-data" type="application/json">__FIELDWORK_MAP_DATA__</script>');
await writeFile(resolve(output, 'single.html'), single);
await writeFile(resolve(output,'files.json'),JSON.stringify((await files(output)).filter(name=>!['single.html','files.json'].includes(name))));
