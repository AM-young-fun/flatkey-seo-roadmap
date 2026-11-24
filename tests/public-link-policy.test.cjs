const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;Module._resolveFilename=function(n,p,...args){return resolve.call(this,n.startsWith('@/')?path.join(root,'src',n.slice(2)):n,p,...args)};
for(const extension of ['.ts','.tsx'])require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
const {externalLinkRel}=require('../src/lib/public-link-policy.ts'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{SeoAnchor}=require('../src/components/SeoAnchor.tsx');
test('all cross-host HTTP anchors get nofollow without changing internal navigation or non-HTTP schemes',()=>{
 for(const href of ['https://example.com/a','//example.com/a','https://flatkey.ai/blog/a','http://EXAMPLE.COM/a'])assert.equal(externalLinkRel(href,'ugc noopener noreferrer sponsored'),'ugc noopener noreferrer sponsored nofollow');
 for(const href of ['/work/1','#heading','?tab=week','https://flatkey-seo-roadmap.vercel.app/work','https://www.flatkey-seo-roadmap.vercel.app/work','mailto:a@example.com','tel:+123'])assert.equal(externalLinkRel(href,'noreferrer'),'noreferrer');
 assert.equal(externalLinkRel('https://example.com','nofollow noreferrer nofollow'),'nofollow noreferrer');
 assert.equal(externalLinkRel({protocol:'https:',hostname:'example.com',pathname:'/guide'}),'nofollow');
 assert.equal(externalLinkRel({protocol:'https',hostname:'example.com',pathname:'/guide'}),'nofollow');
});
test('nofollow is present in initial SSR HTML, including dynamic URLs and original rel tokens',()=>{
 const html=renderToStaticMarkup(React.createElement(SeoAnchor,{href:'https://example.com/source',target:'_blank',rel:'noopener noreferrer'},'source'));
 assert.match(html,/rel="noopener noreferrer nofollow"/);assert.match(html,/href="https:\/\/example.com\/source"/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(SeoAnchor,{href:'/work'},'internal')),/nofollow/);
});
test('UI anchors and framework links cannot bypass the common SSR policy, and future image elements declare alt',()=>{
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 for(const file of walk(path.join(root,'src')).filter(f=>f.endsWith('.tsx'))){if(/\/(SeoAnchor|SeoLink)\.tsx$/.test(file))continue;const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='next/link'&&node.importClause?.name)assert.fail('Use the policy wrapper: '+file);
   if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){const tag=node.tagName.getText(ast);assert.notEqual(tag,'a','Use SeoAnchor: '+file);if(['img','Image'].includes(tag))assert.ok(node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='alt'),'Image alt missing: '+file);}
   ts.forEachChild(node,visit)};visit(ast);
 }
});
