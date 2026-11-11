const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {catalogUrl,mergeCatalogRows}=require('../src/lib/seo-page-catalog.ts');
const {analyticsView,observedPageUrls}=require('../src/lib/seo-analytics.ts');
const url='https://flatkey.ai/blog/free-llm-apis-2026',date='2026-11-08',range={start:date,end:date};
const base={date,observedAt:'2026-11-11T01:00:00.000Z',source:'google-api',complete:true};
const anchors=Array.from({length:7},(_,i)=>url+'#section-'+i);
const reports=[{...base,kind:'ga4-pages',property:'541304395',scope:'session-organic-search',rows:[{hostname:'flatkey.ai',path:'/blog/free-llm-apis-2026',sessions:27,registrations:null}]},
 {...base,kind:'gsc-pages',property:'sc-domain:flatkey.ai',rows:[{url,clicks:27,impressions:1000,position:5},...anchors.map(url=>({url,clicks:0,impressions:100,position:6}))]}];

test('seven GSC chapter anchors become one document with 27 sessions, preserving all original URLs',()=>{
 const urls=observedPageUrls(reports);assert.deepEqual(urls,[url]);
 const pages=analyticsView(range,urls,reports).pages;
 assert.equal(pages.length,1);assert.equal(pages[0].ga4.sessions,27);
 assert.equal(pages[0].gsc.clicks,27);assert.equal(pages[0].gsc.impressions,1000);
 assert.deepEqual(pages[0].sourceUrls,[url,...anchors]);
 const targets=anchors.map((source,i)=>({url:source,keywords:['keyword-'+i]}));
 const inventory=[{url,baseline:true,category:'blog',firstSeen:base.observedAt,lastSeen:base.observedAt,sourceUrl:'https://flatkey.ai/sitemap.xml',sitemapLastmod:null}];
 const rows=mergeCatalogRows(targets,inventory,pages,'flatkey.ai');
 assert.equal(rows.length,1);assert.equal(rows[0].sourceUrls.length,8);assert.equal(rows[0].keywords.length,7);
 assert.equal(rows[0].inventory.url,url);
});

test('host, language, business query and slash variants stay separate while tracking and fragments merge',()=>{
 const urls=[url,url+'#section',url+'?utm_source=github&gclid=example',url+'?plan=gpu',url+'/',url.replace('/blog/','/ja/blog/'),url.replace('flatkey.ai','console.flatkey.ai')];
 const rows=mergeCatalogRows(urls.map(url=>({url,keywords:[]})),[],[],'flatkey.ai');
 assert.equal(rows.length,5);assert.equal(rows.find(row=>row.url===url).sourceUrls.length,3);
 assert.equal(catalogUrl('https://flatkey.ai.evil.test/blog','flatkey.ai'),null);
 assert.equal(catalogUrl('https://secret@flatkey.ai/blog','flatkey.ai'),null);
});

test('fragment-only search evidence stays inspectable without inventing a canonical GSC aggregate',()=>{
 const fragmentOnly=[reports[0],{...reports[1],rows:reports[1].rows.slice(1)}];
 const page=analyticsView(range,observedPageUrls(fragmentOnly),fragmentOnly).pages[0];
 assert.equal(page.ga4.sessions,27);assert.equal(page.gsc,null);assert.deepEqual(page.sourceUrls,anchors);
});
