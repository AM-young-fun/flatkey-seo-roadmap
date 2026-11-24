# 11月24日改造后的原入口补齐守卫

这是一批已授权原任务的本机执行保护，不是新任务、调度、付费或发布授权。确切1600批准SHA为`7540d3427ac7c7c9a13d18f8b3426f58f6020661a8861ff4ca28219bb1fb5d54`，但名单批准不等于成员、身份、季度冻结或全链验收已完成。

## 真正调用位置

权威scanner源码为`scripts/seo-due-tasks.cjs`。本机原`seo-codex-progress`仍通过原settings.scanner调用`.local/seo-due-tasks.cjs`；仅在核对原文件SHA后将同一权威源码安装到该原路径，不改设置、任务ID或租约API。

scanner先沿原服务读取operational资格并调用原`dueTasks`，再由`seo-recovery-guard.cjs`过滤本批原ID。实际领取前在本机目录锁内重核剩余容量并预留一项，随后才调用原服务claims；真实成功、已有租约/完成或未知响应各自落账。正常服务仍核租约、fencing token、版本、依赖、审批和发布资格，守卫不替代这些规则。

静态清单`scripts/lib/seo-recovery-manifest-20261124.json`只公开28个本期原常规ID及完整身份的单向SHA摘要和最早执行窗，不把原词/市场及未发布内容计划上传公开源码；原始映射留本地审核回执。20个指向11/25–26，8个容量冲突最早11/27原工作时段续跑，原due不修改。3热点extra、2个原11/27任务和已验收任务不在该起窗白名单，不偷换或迁移。

只对这28项启用HOLD、原身份和起窗硬拦截；独立Prompt、数据/效果采集、技术研究、正常续租、真实extra和发布后原版本验收不被该起窗门槛误拦。其他正常内容领取仅被记入共享实际用量，原资格保持，由原计划和原审批负责；不能把本保护称为全平台跨机器配额总闸。

## READY的来源

默认读取项目下`.local/seo-final-review-20261124/implementation-v9/automation-recovery-final-preparation-20261124/runtime-recovery-state.json`。不存在、HOLD、批准SHA不符、缺回执或回执文件字节哈希不符都拒绝本批新领取。HOLD仍允许只读验收和用户已批元数据整理；它不会调用采集、制作或发送。

READY需`actualPrerequisiteReceipts`六项真实文件引用：`member1600`、`wordLanguageAndMarketIdentity1600`、`quarterPlanningSaveApproveFreeze`、`internalLoopAcceptance`、`originalTaskArrangementProductionReadback`、`automationRestore13Readback`。每项格式均为`{artifact:绝对路径,sha256:确切文件SHA256}`。回执内容的真实性和阶段验收由原正常保存/读回流程负责，不能编造文件把HOLD变READY。

另需`usageBaseline`同格式引用正常读取的完整数据库workflow快照，含`storage=database`、`generatedAt`、tasks和publications。operational快照会隐藏已验收记录，不能用它冒充完整已用额度。已锁基线、当前快照和本机真实claims合并；不新查Google或Ahrefs。

## 时段、容量和未知回执

本批只在实际工作日、最早起窗之后领取。原10:15、11:15及14:15–18:15入口各有最多一小时的延迟领取窗，午间和末窗以外不能新开本批任务；已取得有效租约的正常续租不受影响。此窗不创建触发、不改变原RRULE，也不保证任务在窗口内完成。

本批每日按唯一原任务/页面核Flatkey源文5、ModelFit源文1、普通优化2、两站新页2；新页还核同一BJT周五–周四最多7。翻新按独立队列计数，实际新增翻新身份/计划的每天2篇限制由独立维护合同负责，本批28项没有虚构翻新ID。翻译不算源文，真extra不占常规。GGUF同页两次发布只算1，与已有两页合计占3，不能漏计成只剩名义任务清单。

本机`.local/seo-recovery-runtime-v1/ledger.json`使用目录锁和原子改名保存，多个工作会话共享额度；相同ID当日续跑不多占一项。UNKNOWN/RESERVED继续占位且禁止该ID自动重新领取；只接受原服务实际回执核对，不重建任务、换runId或释放未知额度。文件锁冲突保守退出，不能随手删除其他进程锁。服务器有效租约不被本机守卫抢占。

`scripts/seo-recovery-guard.cjs status`只读显示状态。`claim-receipt`只用于写入已取得的原服务真实回执，不是重发claim或伪造fencing token的接口。

## 11月25日一次scope账本

本次仅9个已授权漏跑scope：Prompt、小时执行、周二轮查、注册、10:30轻扫、GA/GSC、来源验收、日报预览和日报归档/原资格处理。旧周五发送、月度/非运行日、GitHub不加入。原rrule表面19次中4个早间触发在周二不具日常资格，实际15次，合并最多9个未完scope；7个小时不变成7倍容量。

在原11/25会话补本scope之前，调用`once-claim 原入口ID`，owner默认使用实际CODEX_THREAD_ID/CODEX_SESSION_ID；未取得原scope则读回并续原会话，不开第二份工作。该命令只允许11/25，既有completed不再领；partial仍沿原scope，不能伪造完成。正常本日循环与补昨天scope分开，不重复查询或发送。

完成或部分完成后，向`once-receipt 原入口ID`传真实`status`、完整时区的`observedAt`及至少一个`{artifact,sha256}`证据引用；文件必须实际存在且字节匹配。只保存真实原来源/run/归档结果，缺GSC、身份或付费源仍partial/unknown。Prompt仍按原create-only流程及目标，不读SEO季度词表；周二未完证据由原10:30消费同一回执，不新增周三调度。

上述命令不发送消息、不发起付费、不调用Google配置或产品后台；周四日报只归档不补发，周报仍每期确切全文先审后发。原自动化提示及AGENTS必须明确消费本守卫和账本，不能仅因代码已合并就称业务已补齐。
