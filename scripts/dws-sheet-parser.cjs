const { createHash } = require("node:crypto");
const normalize = value => String(value ?? "").normalize("NFKC").trim();
const spec = {
  api_main: {primary:["主关键词（Topic map）","主关键词"],secondary:["副关键词（已确定）"],status:["生成状态"],url:["文章链接"],title:["title"],language:["language"]},
  cloud_main: {primary:["Primary Keyword"],secondary:["Secondary Keywords"],status:["生成状态"],url:["文章链接"],title:["title"],language:["language"]},
  optimization: {primary:["主关键词"],secondary:["辅助关键词"],status:["发布状态"],url:["页面URL"],title:["页面标题（Title）"],language:["语言"]},
};
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parseSheet(sourceId, matrix) {
  const config=spec[sourceId]; if(!config || !matrix.length)throw new Error("SHEET_SCHEMA_CHANGED");
  const headers=matrix[0].map(normalize);
  for(const choices of [config.primary,config.secondary,config.status,config.url,config.language]) if(!choices.some(name=>headers.includes(normalize(name))))throw new Error("SHEET_SCHEMA_CHANGED");
  const get=(row,choices)=>normalize(row[headers.findIndex(value=>choices.map(normalize).includes(value))]);
  const rows=[];
  for(const row of matrix.slice(1)) {
    const primary=get(row,config.primary), secondary=get(row,config.secondary);
    if(!primary&&!secondary)continue;
    const id=get(row,["编号"]),slug=get(row,["slug"]),rawLanguage=get(row,config.language).toLowerCase().split("(")[0].trim();
    const language=({english:"en",chinese:"zh",japanese:"ja",russian:"ru",spanish:"es",indonesian:"id",vietnamese:"vi",portuguese:"pt",中文:"zh",英语:"en",日语:"ja"})[rawLanguage]??rawLanguage;
    if((!id&&!slug)||!language)throw new Error("SHEET_SCHEMA_CHANGED");
    const rawStatus=get(row,config.status),pageUrl=get(row,config.url);
    if(pageUrl) {const url=new URL(pageUrl);if(url.protocol!=="https:"||!(url.hostname==="flatkey.ai"||url.hostname.endsWith(".flatkey.ai"))||url.username||url.password)throw new Error("SHEET_SCHEMA_CHANGED");}
    const words=new Map();
    for(const [role,values] of [["PRIMARY",[primary]],["SECONDARY",secondary.split(/[;；\r\n]+/u)]]) for(const raw of values) {
      const keyword=normalize(raw).toLowerCase().replace(/\s*\([^)]*(?:展示|均位|美国量|kd\s*\d)[^)]*\)\s*$/iu,"").trim();
      if(!keyword||words.has(keyword))continue;
      words.set(keyword,{keyword,role,relevance:"REVIEW",reason:"自动读取协作表来源；新词先保留研究，页面内容意图待审核。",pageIntentMatched:false,newModel:false});
    }
    if(!words.size)continue;
    rows.push({rowKey:`${id?"id":"slug"}:${id||slug}:${language}`,slug,language,title:get(row,config.title),topic:primary,
      completion:(sourceId==="optimization"?/^(已发布|生产与.*已发布)/.test(rawStatus):rawStatus==="已生成")?"COMPLETED":"PENDING",rawStatus,...(pageUrl?{pageUrl}:{}),
      publication:{pageVerified:false,verificationReason:"来源状态不代替页面正文审核；保留现有人工审核和页面关联。"},keywords:[...words.values()]});
  }
  if(new Set(rows.map(row=>row.rowKey)).size!==rows.length)throw new Error("SHEET_SCHEMA_CHANGED");
  return rows.sort((a,b)=>a.rowKey.localeCompare(b.rowKey,"en"));
}
module.exports={parseSheet,hash};
