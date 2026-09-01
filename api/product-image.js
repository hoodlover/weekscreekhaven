import { json } from '../_lib/security.js';

const RETAIL_HOSTS=[
  'a.co','amazon.com','amazon.ca','foodlion.com','walmart.com','target.com',
  'lowes.com','homedepot.com','costco.com','samsclub.com'
];

function allowedHost(hostname){
  const host=String(hostname||'').toLowerCase();
  return RETAIL_HOSTS.some(domain=>host===domain||host.endsWith(`.${domain}`));
}

function safeRetailUrl(value){
  try{const url=new URL(String(value||''));return url.protocol==='https:'&&allowedHost(url.hostname)?url:null;}catch{return null;}
}

function metadataImage(html,baseUrl){
  const tags=String(html||'').match(/<meta\b[^>]*>/gi)||[];
  for(const tag of tags){
    const key=tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if(!['og:image','og:image:url','twitter:image','twitter:image:src'].includes(key))continue;
    const content=tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if(!content)continue;
    try{const image=new URL(content.replace(/&amp;/g,'&'),baseUrl);if(['https:','http:'].includes(image.protocol))return image.toString();}catch{}
  }
  return '';
}

export default async function handler(request,response){
  if(request.method!=='GET')return json(response,405,{error:'Method not allowed.'});
  const productUrl=safeRetailUrl(request.query?.url);
  if(!productUrl)return json(response,400,{error:'Use a supported retailer product link.'},{'Cache-Control':'public, max-age=300'});
  try{
    const page=await fetch(productUrl,{redirect:'follow',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0 (compatible; WeeksCreekHaven/1.0)','Accept':'text/html,application/xhtml+xml'}});
    if(!page.ok||!String(page.headers.get('content-type')||'').includes('text/html'))throw new Error('Product page unavailable');
    const finalUrl=safeRetailUrl(page.url);
    if(!finalUrl)throw new Error('Unsupported redirect');
    const image=metadataImage((await page.text()).slice(0,2000000),finalUrl);
    if(!image)throw new Error('Product image unavailable');
    response.writeHead(302,{'Location':image,'Cache-Control':'public, s-maxage=604800, stale-while-revalidate=2592000'});
    response.end();
  }catch{
    return json(response,404,{error:'No product image was found.'},{'Cache-Control':'public, s-maxage=3600'});
  }
}
