import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
let count=0;
async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=resolve(dir,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(/\.(js|mjs)$/.test(path)){
      const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
      if(result.status!==0)throw Error(result.stderr);count++;
    }
  }
}
for(const dir of ['api','server','assets','scripts'])await walk(dir);
for(const name of await readdir('.')){
  if(!name.endsWith('.html'))continue;
  const html=await readFile(name,'utf8');
  for(const [,attrs,code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc\s*=|application\/ld\+json/i.test(attrs))continue;
    const result=spawnSync(process.execPath,['--check','--input-type='+(/type=["']module/.test(attrs)?'module':'commonjs')],{input:code,encoding:'utf8'});
    if(result.status!==0)throw Error(name+': '+result.stderr);count++;
  }
  for(const [,asset] of html.matchAll(/(?:href|src)=["'](\/assets\/[^"']+)["']/g))await readFile('.'+asset);
}
for(const path of ['package.json','package-lock.json','vercel.json','manifest.webmanifest'])JSON.parse(await readFile(path,'utf8'));
console.log(`Validated ${count} JavaScript files/scripts, static asset references and JSON configuration.`);
