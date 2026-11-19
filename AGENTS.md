## SEO 工作授权边界（用户于 2026-11-19 明确更新）

- 用户后续澄清：禁止 Console/后端指产品代码改动，正常素材入库及既有后台内容管理不受影响。官网 Prompt 素材继续经现有 Console 内容接口按原 create-only 权限新增并读回，其他官网内容维护沿用各自已有接口与授权；不能将接口域名为 Console、内部落库或数据库写入等同于改后台代码而误停任务。不得扩大为产品代码、鉴权、计费、路由或数据库结构改动；GA/GTM/GSC 仍默认只读。Prompt 定时任务保持原启用状态、时间、目标和入库流程，不停止其已启动的素材准备会话。

- 技术扫描、技术修复、页面优化、落地页新增与优化，仅限 Flatkey 官网（flatkey.ai、www.flatkey.ai）、RackRate（rackrate.org）、ModelFit（modelfit.cc）的公开官网页面。
- 博客新增与优化仅限 Flatkey 和 ModelFit；不为 RackRate、JEV 或 Mochi 制作或优化博客。JEV、Mochi 不进入页面制作、优化和技术修复队列。
- 不扫描、领取、创建、续跑、修改或发布 Console、Router、API/Go 后端、鉴权、计费、数据库、模型中继等产品技术任务。Flatkey 的 SEO 代码修改仅在 website/ 及必要官网资源内；官网引用后端不构成后端修改授权。官网链接到 Console/Router 时只检查链接本身，不进入目标扫描。
- GA/GA4、GTM、GSC 默认只读。可按既有授权读取和汇总数据；不得改管理配置、标识、数据流、事件/关键事件、埋点代码、同意与身份逻辑、容器/标签/触发器或发布、属性/权限/索引设置。任何变更须先说明具体内容并取得用户当次明确授权，不能沿用旧批准或以缺数为由自动修复。
- api-paid-success-evidence-20261118 及关联 GA/后端候选已由用户撤回，不得自动恢复、重新建单、合并或发布。保留历史证据用于追溯，不将撤回误标为已上线或已修复。
- 定时扫描、研究排期、任务派发、续跑及发布前均核对以上边界；向后续执行会话传递同一边界。范围外候选排除并说明，不自动扩大范围。仅官网发布不得选择 all/backend/console。
- 既有只读数据采集、报告及独立 GitHub 渠道采集保持原授权；以上不新增外部发送、付费或发布授权。详细规则见 docs/seo-scope-policy.md。

## SEO 搜索研究补证（用户于 2026-11-19 明确更新）

- 用户同日后续调整：Flatkey 暂停新建落地页，全部新建额度转给 RackRate 和 ModelFit；普通五工作日周两站合计最多7个。按实际工作日 D 转移原总量：`landing=0`、`clusterLanding=D+min(2,D)`，从11/23周执行新计划契约；历史任务与回执保留，不换站或建替代。优先延展两站已有价格/比较/模型/硬件/工具板块，按独立需求逐页增加，细则见 [持续建设计划](docs/cluster-landing-growth-plan.md)。原博客、页面优化额度和完整补证门槛不变。

- 博客与页面制作/优化执行前，读取并遵守 [SEO 执行研究与补证规范](docs/seo-execution-research.md)，派发和原会话续跑时传递同一规则。
- Ahrefs 结果不足、过旧或不可用时，先换已有授权的当地搜索渠道或正常浏览器渲染补证；直连 JavaScript 提示页不代表没有结果，不直接据此判定阻塞或要求用户提供导出。
- 原关键词、原市场语言、10 条自然结果、前 5 条实际打开的逐页 3C、完整去重、真实关键词身份和生产原任务 CAS 保存读回的门槛保持不变；未通过不得制稿或发布。不得扩付费预算、绕访问限制、换词凑证据或新建替代任务。

## 周报周期与审核（用户于 2026-11-19 当次确认）

- 周报统一统计 `America/Los_Angeles` 上周四至本周三，北京时间周四16:30开始整理。首次新期为2026-11-12至11-18；历史快照保留原周期，不混比。
- 整理后保存并读回确切快照供用户审核；原周五周报自动发送暂停，用户对具体版本明确批准前不发送。日报、内容候选／正式排期及付费排名日程不变。
- 来源延迟保留实际日期和缺口，只有完整同口径的相邻两期计算周环比；其他时区日桶不得冒充洛杉矶同期。不得以统一周期为由修改GA/GTM/GSC配置。细则见 `docs/seo-weekly-report-standard.md`。
- 用户同日追加：北京时间周四的日报只保留数据、采集、同步、预览与归档，不发送钉钉机器人群消息，也不在次日补发。原每日18:00任务保持启用，仅跳过周四日报群发送；其他工作日日报沿原规则。此例外不影响已批准周报，未来周报仍先审后发，详见 `docs/daily-report-send-readiness.md`。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
