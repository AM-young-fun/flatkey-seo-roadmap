const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const yaml = require("js-yaml");
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, "../.github/workflows/seo-daily.yml"), "utf8"));
function enabled(job, { event = "workflow_dispatch", result = "success", unified = "false", inputs = {} } = {}) {
 const defaults = Object.fromEntries(Object.entries(workflow.on.workflow_dispatch.inputs).map(([name, config]) => [name, config.default]));
 return Boolean(vm.runInNewContext(workflow.jobs[job].if, { always: () => true, github: {ref:"refs/heads/main",event_name:event}, vars:{SEO_SERVER_COLLECTION_ENABLED:"true",SEO_UNIFIED_REPORTING_ENABLED:unified}, needs:{collect:{result}}, inputs:event === "workflow_dispatch" ? {...defaults,...inputs} : {} }));
}
test("manual notification opt-out uses a boolean defaulting to legacy delivery", () => {
 assert.equal(workflow.on.workflow_dispatch.inputs.send_notifications.type,"boolean");
 assert.equal(workflow.on.workflow_dispatch.inputs.send_notifications.default,true);
 assert.equal(enabled("collect"),true);assert.equal(enabled("notify"),true);assert.equal(enabled("verify-dingtalk"),false);
});
test("manual and scheduled collection use fourteen days unless ninety-day backfill is explicit", () => {
 const input=workflow.on.workflow_dispatch.inputs.lookback_days;
 assert.equal(input.type,"choice");assert.equal(input.default,"14");assert.deepEqual(input.options,["14","90"]);
 const expression=workflow.jobs.collect.steps.find(step=>step.id==="analytics").env.SEO_COLLECTION_LOOKBACK_DAYS.slice(3,-3).trim();
 const evaluate=(event,days)=>vm.runInNewContext(expression,{github:{event_name:event},inputs:{lookback_days:days}});
 assert.equal(evaluate("schedule",undefined),"14");assert.equal(evaluate("workflow_dispatch",undefined),"14");
 assert.equal(evaluate("workflow_dispatch","14"),"14");assert.equal(evaluate("workflow_dispatch","90"),"90");
});
test("collection-only manual runs retain collection and suppress every workflow group send on success or failure", () => {
 for(const result of ["success","failure","cancelled"]){
  const options={result,inputs:{send_notifications:false,verify_dingtalk:false}};
  assert.equal(enabled("collect",options),true);assert.equal(enabled("notify",options),false);assert.equal(enabled("verify-dingtalk",options),false);
 }
});
test("notification opt-out also suppresses explicit verification and cannot send a test by accident", () => {
 const options={inputs:{send_notifications:false,verify_dingtalk:true}};
 for(const job of ["collect","notify","verify-dingtalk"])assert.equal(enabled(job,job==="notify"?{...options,result:"skipped"}:options),false);
 assert.equal(enabled("verify-dingtalk",{inputs:{verify_dingtalk:true,send_notifications:true}}),true);
});
test("scheduled collection keeps the existing behavior and unified reporting still disables old notifications", () => {
 assert.equal(enabled("collect",{event:"schedule"}),true);
 assert.equal(enabled("notify",{event:"schedule"}),true);assert.equal(enabled("verify-dingtalk",{event:"schedule"}),false);
 assert.equal(enabled("notify",{event:"schedule",unified:"true"}),false);
 assert.equal(enabled("notify",{unified:"true"}),false);
 assert.equal(enabled("notify",{result:"skipped"}),false);
});
test("report-only dispatch never collects or invokes legacy notices, including conflicting inputs", () => {
 for (const verify_dingtalk of [false,true]) {
  const options={inputs:{report_only:true,verify_dingtalk,send_notifications:true,send_report:false}};
  assert.equal(enabled("report-send",options),true);
  for(const job of ["collect","notify","verify-dingtalk"]) assert.equal(enabled(job,options),false);
 }
 assert.equal(enabled("report-send",{event:"schedule"}),false);
 assert.equal(enabled("report-send"),false);
 assert.equal(workflow.on.workflow_dispatch.inputs.send_report.default,false);
 const step=workflow.jobs["report-send"].steps.find(s=>s.env?.SEO_REPORT_SEND);
 assert.equal(step.env.SEO_DINGTALK_CONFIG,"${{ secrets.SEO_DINGTALK_CONFIG }}");
 assert.match(step.run,/if \[ "\$SEO_REPORT_SEND" = true \]/);
 assert.match(step.run,/args\+=\(--send\)/);
 assert.match(step.run,/args\+=\(--report-id="\$SEO_REPORT_ID"\)/);
 assert.match(step.run,/node scripts\/server-seo-digest-send\.cjs "\$\{args\[@\]\}"/);
 assert.match(workflow.concurrency.group,/inputs\.report_only/);
 assert.match(workflow.concurrency.group,/seo-report-\{0\}-\{1\}/);
});
