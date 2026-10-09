import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import router from '../api/router.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(await readFile(resolve(root,'vercel.json'),'utf8'));
const types={'.woff2':'font/woff2','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
const staticAllowed = path => !path.includes('..') && ( /^\/[^/]+\.html$/.test(path) || /^\/assets\/[\w/.-]+$/.test(path) || ['/manifest.webmanifest','/service-worker.js','/robots.txt'].includes(path));

export function createDevServer() {
  return http.createServer(async(req,res)=>{
    res.status=code=>{res.statusCode=code;return res;};
    res.json=body=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));};
    res.send=body=>res.end(body);
    res.redirect=(status,url)=>{if(typeof status==='string'){url=status;status=302;}res.writeHead(status,{Location:url});res.end();};
    try{
      const url=new URL(req.url,'http://localhost');
      let destination=url.pathname;
      for(const rule of config.routes){
        if(rule.handle==='filesystem'){
          if(staticAllowed(destination)){try{if((await stat(resolve(root,'.'+destination))).isFile())break;}catch{}}
          continue;
        }
        const match=new RegExp('^'+rule.src+'$').exec(url.pathname);
        if(!match)continue;
        destination=rule.dest.replace(/\$(\d+)/g,(_,i)=>encodeURIComponent(match[Number(i)]||''));
        if(rule.status)res.statusCode=rule.status;break;
      }
      const target=new URL(destination,'http://localhost');
      for(const [key,value] of target.searchParams)url.searchParams.set(key,value);
      req.query=Object.fromEntries(url.searchParams);
      // Vercel rewrites do not expose the original query as route authority.
      if(target.pathname==='/api/router')return await router(req,res);
      if(!['GET','HEAD'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
      if(!staticAllowed(target.pathname))return res.status(404).json({error:'Not found'});
      const path=resolve(root,'.'+decodeURIComponent(target.pathname));
      if(!path.startsWith(root+'/'))return res.status(404).json({error:'Not found'});
      for(const group of config.headers||[]){
        if(new RegExp('^'+group.source.replace(/\(\.\*\)/g,'.*')+'$').test(url.pathname))for(const h of group.headers)res.setHeader(h.key,h.value);
      }
      res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');
      if(/health|profile|admin|auth|doctor-portal|visit-intake/.test(path))res.setHeader('Cache-Control','no-store, private');
      const content=await readFile(path);
      res.end(req.method==='HEAD'?undefined:content);
    }catch(error){
      if(!res.headersSent)res.status(error.code==='ENOENT'?404:500).json({error:'درخواست انجام نشد'});
    }
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3000);
  const server=createDevServer();
  server.listen(port,'127.0.0.1',()=>console.log(`DrMan development server listening on port ${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
