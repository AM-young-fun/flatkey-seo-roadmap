import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { weeklyEvidenceSchema } from "./weekly-evidence-schema";

export const GA4_PROPERTY = "541304395";
export const GA4_TIMEZONE = "America/Los_Angeles";
const CHANNEL = "firstUserPrimaryChannelGroup";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ga4KeySchema = z.object({ type: z.literal("service_account"), client_email: z.email().refine(value => value.endsWith(".gserviceaccount.com")), private_key: z.string().min(100).max(10000) });
type Key = z.infer<typeof ga4KeySchema>;
const reportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })).default([]), metricHeaders: z.array(z.object({ name: z.string() })),
  rows: z.array(z.object({ dimensionValues: z.array(z.object({ value: z.string() })).default([]), metricValues: z.array(z.object({ value: z.string() })) })).default([]),
  rowCount: z.number().optional(), metadata: z.object({ timeZone: z.string().optional(), subjectToThresholding: z.boolean().optional(), dataLossFromOtherRow: z.boolean().optional(), samplingMetadatas: z.array(z.unknown()).optional() }).optional(),
});
type Report = z.infer<typeof reportSchema>;
const check = (raw: unknown): Report => {
  const data = reportSchema.parse(raw), meta = data.metadata;
  if (meta?.timeZone && meta.timeZone !== GA4_TIMEZONE) throw new Error("GA4_TIMEZONE_MISMATCH");
  if (meta?.subjectToThresholding || meta?.dataLossFromOtherRow || meta?.samplingMetadatas?.length || (data.rowCount ?? 0) > data.rows.length) throw new Error("GA4_INCOMPLETE");
  return data;
};
export const ga4Count = (value: string | undefined) => {
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("GA4_METRIC_INVALID");
  return Number(value);
};
export function reportRows(raw: unknown) {
  const data = check(raw);
  return data.rows.map(row => ({ dimensions: Object.fromEntries(data.dimensionHeaders.map((header, i) => [header.name, row.dimensionValues[i]?.value ?? ""])),
    metrics: Object.fromEntries(data.metricHeaders.map((header, i) => [header.name, ga4Count(row.metricValues[i]?.value)])) }));
}
export function parseGa4Funnel(raw: unknown) {
  const response = z.object({ funnelTable: z.unknown() }).parse(raw), data = check(response.funnelTable);
  const stepIndex = data.dimensionHeaders.findIndex(header => header.name === "funnelStepName"), usersIndex = data.metricHeaders.findIndex(header => header.name === "activeUsers");
  if (stepIndex < 0 || usersIndex < 0) throw new Error("GA4_FUNNEL_INVALID");
  const rows = data.rows.filter(row => row.dimensionValues.every((value, index) => index === stepIndex || value.value === "RESERVED_TOTAL"))
    .map(row => ({ step: Number(row.dimensionValues[stepIndex]?.value.match(/^(\d+)\./)?.[1]), users: ga4Count(row.metricValues[usersIndex]?.value) })).sort((a,b) => a.step-b.step);
  if (rows.length !== 2 || rows[0].step !== 1 || rows[1].step !== 2 || rows[1].users > rows[0].users) throw new Error("GA4_FUNNEL_INVALID");
  return [{ name: "首次访问", users: rows[0].users, completionRate: rows[0].users ? rows[1].users/rows[0].users : null }, { name: "注册成功", users: rows[1].users, completionRate: null }];
}
export async function ga4Client(input: unknown) {
  const key: Key = ga4KeySchema.parse(input);
  const privateKey = createPrivateKey(key.private_key);
  if (privateKey.asymmetricKeyType !== "rsa") throw new Error("GA4_KEY_INVALID");
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url"), issued = Math.floor(Date.now()/1000);
  const unsigned = `${encode({alg:"RS256",typ:"JWT"})}.${encode({iss:key.client_email,scope:"https://www.googleapis.com/auth/analytics.readonly",aud:TOKEN_URL,iat:issued,exp:issued+3600})}`;
  const assertion = `${unsigned}.${sign("RSA-SHA256",Buffer.from(unsigned),privateKey).toString("base64url")}`;
  const tokenResponse = await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),signal:AbortSignal.timeout(15000),cache:"no-store",redirect:"error"});
  if (!tokenResponse.ok) throw new Error("GA4_AUTH_FAILED");
  const token = z.object({access_token:z.string().min(1)}).parse(await tokenResponse.json()).access_token;
  return async (body: object, funnel = false) => {
    const url = `https://analyticsdata.googleapis.com/${funnel ? "v1alpha" : "v1beta"}/properties/${GA4_PROPERTY}:${funnel ? "runFunnelReport" : "runReport"}`;
    const response = await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(25000),cache:"no-store",redirect:"error"});
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "GA4_PERMISSION" : response.status === 429 ? "GA4_QUOTA" : "GA4_REQUEST_FAILED");
    return response.json() as Promise<unknown>;
  };
}
type Client = Awaited<ReturnType<typeof ga4Client>>;
const exact = (fieldName: string, value: string) => ({filter:{fieldName,stringFilter:{matchType:"EXACT",value,caseSensitive:true}}});
const registered = exact("eventName","sign_up_success");
export async function verifyGa4(input: unknown) {
  const client = await ga4Client(input);
  const data = reportRows(await client({dateRanges:[{startDate:"28daysAgo",endDate:"yesterday"}],metrics:[{name:"totalUsers"}],dimensionFilter:registered}));
  if (!data.length || !data[0].metrics.totalUsers) throw new Error("GA4_REGISTRATION_EVENT_UNVERIFIED");
  return ga4KeySchema.parse(input);
}
export async function collectGa4Period(client: Client, period: {start:string;end:string}) {
  const dateRanges = [{startDate:period.start,endDate:period.end}];
  const query = (metric: string, dimensions: string[] = [], filter?: object) => client({dateRanges,metrics:[{name:metric}],dimensions:dimensions.map(name=>({name})),...(filter?{dimensionFilter:filter}:{}),limit:10000});
  // Whole-period distinct registration users, never eventCount or daily sums.
  const [users,registrations,channelUsers,channelRegistrations,countryRegistrations,funnel] = await Promise.all([
    query("newUsers"),query("totalUsers",[],registered),query("newUsers",[CHANNEL]),query("totalUsers",[CHANNEL],registered),
    query("totalUsers",["country"],{andGroup:{expressions:[registered,exact(CHANNEL,"Direct")]}}),
    client({dateRanges,funnel:{isOpenFunnel:false,steps:[{name:"首次访问",filterExpression:{funnelEventFilter:{eventName:"first_visit"}}},{name:"注册成功",filterExpression:{funnelEventFilter:{eventName:"sign_up_success"}}}]}},true),
  ]);
  const total = (value:unknown,metric:string) => { const rows=reportRows(value); if (rows.length>1) throw new Error("GA4_TOTAL_INVALID"); return rows[0]?.metrics[metric]??0; };
  const channels = new Map<string,{newUsers:number;newRegistrations:number}>();
  for (const [data,metric,target] of [[channelUsers,"newUsers","newUsers"],[channelRegistrations,"totalUsers","newRegistrations"]] as const)
    for (const row of reportRows(data)) {const name=row.dimensions[CHANNEL]; if (!name || channels.has(name) && channels.get(name)![target] !== 0) throw new Error("GA4_CHANNEL_INVALID"); const pair=channels.get(name)??{newUsers:0,newRegistrations:0};pair[target]=row.metrics[metric];channels.set(name,pair);}
  return { totals:{newUsers:total(users,"newUsers"),newRegistrations:total(registrations,"totalUsers")},channels:[...channels].map(([name,value])=>({name,...value})),
    directCountries:Object.fromEntries(reportRows(countryRegistrations).map(row=>[row.dimensions.country,row.metrics.totalUsers])),funnel:parseGa4Funnel(funnel) };
}
export type Ga4Period = Awaited<ReturnType<typeof collectGa4Period>>;
export function mergeGa4Periods(current: Ga4Period, previous: Ga4Period) {
  const names = new Set([...current.channels,...previous.channels].map(row=>row.name));
  const countries = new Set([...Object.keys(current.directCountries),...Object.keys(previous.directCountries)]);
  return weeklyEvidenceSchema.parse({complete:true,totals:{current:current.totals,previous:previous.totals},channels:[...names].map(name=>{
    const a=current.channels.find(row=>row.name===name),b=previous.channels.find(row=>row.name===name);
    return {name,newUsers:{current:a?.newUsers??0,previous:b?.newUsers??0},registrations:{current:a?.newRegistrations??0,previous:b?.newRegistrations??0}};
  }),newVisitorFunnel:{current:current.funnel,previous:previous.funnel},directRegistrationCountries:Object.fromEntries([...countries].map(name=>[name,{current:current.directCountries[name]??0,previous:previous.directCountries[name]??0}])),sources:[`https://analytics.google.com/analytics/web/#/p${GA4_PROPERTY}/reports` ]});
}
