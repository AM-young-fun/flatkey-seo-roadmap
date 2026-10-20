# 项目定时任务

## 时间与执行位置

| 任务 | 北京时间 | 执行方式 |
| --- | --- | --- |
| 发现已有实际排名的新词，再查询正式目标词实际排名 | 隔周周二 10:30；本轮之后为 2026-11-03 | Vercel 原排名调度，保持现有预算和去重账本 |
| 流量周报 | 每周二 10:30 排队，18:30 读取完整周 | Vercel `/api/cron/project-jobs`，每 5 分钟检查到期任务 |
| 三张协作表同步 | 每日 10:30 | 项目数据库排队，常驻 DWS worker 领取并回传 |

周报统计上周二至周一，GA4 属性为 Flatkey `541304395`，时区 `America/Los_Angeles`。18:30 北京时间在夏令时、冬令时均晚于该周结束。只获取新的一周，上期优先使用已保存的完整证据；确实缺失时才补一次上期。注册使用 `sign_up_success` 的整段去重用户数，另用封闭顺序漏斗统计同批新访客注册；不用事件数或每日人数累加冒充去重人数。

关键词采集周先缓存流量结果，等待同一期关键词完成后保存正式周报，不重复请求 GA4。非采集周沿用最近一期关键词并明确标注。上一周缺少关键词结果时沿用第一期，保留实际日期和覆盖量。任务只读取原有排名账本，不能开启或重复提交付费任务。范围仍仅 Flatkey，美国、日本、西班牙、巴西。

## 持久化与重试

- `ProjectJob` 的日期固定 ID 防止多次 cron 重复建任务。数据库原子领取、10 分钟租约防止并发领取；旧租约不能提交完成。
- 网络/校验失败按 5、10、20 分钟退避，4 次后停止并显示失败。授权失败等待重新连接或人工点击重试，不静默填零。
- 未到完整周时间、等待关键词不消耗失败重试次数。已取到的数据保存在私有任务中，续跑不重抓。
- 本期已有完整人工导入时直接复用，避免与一次性补齐重复。导入使用固定 requestId，并沿用原有校验与事务保护。
- 三表错过的每日检查由当天完整读取替代，不按历史日期伪造检查。无变更也保存独立完整检查回执。
- 页面只查询保存的数据和元信息，不触发供应商请求。完成入库后更新展示快照。

## GA4 连接

1. 在 Google Cloud 开启 Google Analytics Data API，创建服务账号及 JSON 私钥。
2. 将该服务账号邮箱加入 GA4 属性 `541304395`，权限为“查看者”。
3. 打开数据管理 → 自动取数连接 → 上传服务账号 JSON。项目验证认证、属性时区和近 28 天注册事件后，加密保存。接口不会回显私钥。

凭据尚未连接时，任务显示“等待 GA4 授权”；不是已启用且采集成功。更改网页登录加密密码后需要重新保存连接。Google API 端点和只读 scope 固定，不使用 JSON 中自带的任意 token URL。

## 三表采集器部署

Vercel 的无状态函数不能使用个人电脑上的钉钉登录。项目提供独立 Node.js worker，部署在**保持 DWS 授权的常驻主机**，无需 Codex 运行或保持聊天打开。服务器未部署/离线时，数据管理如实显示等待连接，不把“已排队”当作同步成功。

1. 主机安装 Node 22 和 DWS CLI，使用有这三张表访问权限的钉钉账号登录。多账号时在配置中指定 `profile`（`corpId:userId`）。不要拷贝个人浏览器 cookie 或 DWS OAuth 缓存到 Vercel。
2. 数据管理生成采集器配对凭据；它只能领取三表任务，不能访问管理接口或付费采集。
3. 在仓库外创建权限 `600` 的配置文件，例如 `/etc/flatkey/source-worker.json`：

```json
{
  "baseUrl": "https://你的项目域名/",
  "token": "数据管理生成的配对凭据",
  "profile": "corpId:userId",
  "dwsPath": "/usr/local/bin/dws"
}
```

4. 使用进程管理器运行 `npm run worker:sources`。示例 systemd 服务（按主机修改路径和用户）：

```ini
[Unit]
Description=Flatkey source sync worker
After=network-online.target

[Service]
Type=simple
User=flatkey
WorkingDirectory=/opt/flatkey-seo-roadmap
Environment=SOURCE_WORKER_CONFIG=/etc/flatkey/source-worker.json
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /opt/flatkey-seo-roadmap/scripts/source-sync-worker.mjs
Restart=always
RestartSec=30
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

部署用户须能读取自己的 DWS 登录配置。`--once` 可检查一次队列然后退出；不带此参数每分钟检查一次。日志仅输出任务级错误代码，不输出表格内容或凭据。更换配对凭据后更新配置并重启服务。

worker 仅调用 DWS 的 `doc info`、`sheet info`、`sheet range read`。不向钉钉写数据，每批最多 30 行；表头变化、重复稳定编号、读取期间版本/范围变化会停止本次，不标完成。排除 Ahrefs 候选列，仅导入三表确认的主/副关键词。新词先保留研究，不自动认定业务相关性或实际页面覆盖；原有人工审核和页面关联由既有事务保护。

## 查看与控制

数据管理 → 运行计划显示下一次执行、当前等待原因和执行记录。自动取数连接中可分别暂停周报与三表、重试失败任务。DataForSEO 费用开关保持独立。

当前一次性 Codex 补齐保留作过渡，直到 GA4 服务账号和采集器真正连接。项目有完整入库去重，但尚未连接时不能声称所有线上取数都已自动运行；也不能用未来计划替代本期完整报告。
