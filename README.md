# SEO Rank Monitor

Next.js + PostgreSQL + Prisma + ECharts 的关键词排名监控面板。

## 当前页面与浏览器采集

- `/`：关键词关系图、地区切换、排名覆盖率及前 10 / 30 / 50 / 100 分布。
- `/keywords`：关键词、所属话题、地区声量、更新时间及四国排名明细。
- `/manage`：话题维护与 CSV 导入。
- `GET /api/rankings/import`：定时采集任务读取当前关键词列表。
- `POST /api/rankings/import`：批量导入 GSC / Ahrefs 浏览器采集结果，支持密钥认证、事务写入和幂等重试。

上线准备与请求格式见 [导入接口文档](docs/ranking-import.md)。Vercel 生产构建会自动应用幂等增量 SQL；导入密钥可从登录后的「数据管理」复制，无需额外配置 Vercel 环境变量。每天北京时间 10:30 的采集在独立会话中另行配置；网页在可见时每 15 秒更新。旧 SerpApi Cron 已移除。

## 功能

- 维护主关键词和长尾关键词
- 用 ECharts graph 渲染关键词父子及同话题关联
- 美国、日本、西班牙、巴西四个地区的 Google 排名监控
- 排名颜色：前 10 绿色、11–30 蓝色、31–50 黄色、51–100 橙色、无前 100 排名灰色
- 通过 Ahrefs 获取关键词声量，并映射为关系图节点大小
- 每日生成排名 snapshot，并和上次结果生成 diff
- 支持外部每日浏览器采集任务导入；旧 SerpApi 同步 API 保留供兼容使用

## 环境变量

复制 `.env.example` 为 `.env`，至少填：

```bash
DATABASE_URL="postgresql://..."
CRON_SECRET="..."
LOGIN_PWD="..."
SEO_TARGET_DOMAIN="example.com"
SERPAPI_API_KEY="..."
AHREFS_API_TOKEN="..."
```

没有 `DATABASE_URL` 时，页面会显示 demo 数据；旧同步 API 在缺少排名 API 配置时会返回 demo 排名，Ahrefs 演示声量不会写入数据库。浏览器采集导入接口只保存上传的真实采集结果。

设置 `LOGIN_PWD` 后，页面和普通 API 会要求先登录；不设置时登录保护不启用。登录态通过 `httpOnly` cookie 保持 30 天。

Ahrefs 的 Keywords Explorer Overview 接口要求 `select` 和 `country` 参数；默认模板会请求 `keyword,volume`。

## 本地开发

```bash
npm install
npm run db:push
npm run dev
```

打开 `http://localhost:3000`。

## CSV 导入

页面右侧可以下载模板 CSV，也可以上传 CSV。格式：

```csv
keyword,parent keyword
seo tools,
daily rank tracker,seo tools
japan seo tracking,seo tools
```

- 第一列：关键词
- 第二列：父关键词
- 父关键词为空时导入为主关键词
- 父关键词不为空时，用关键词文本完全匹配父关键词，并导入为长尾关键词
- 父关键词只出现在第二列时，会自动创建为主关键词

## Vercel 部署

1. 在 Vercel 项目里添加 `.env.example` 中的环境变量。
2. 使用支持连接池的 PostgreSQL URL 填 `DATABASE_URL`。
3. 首次部署后，在本地或 CI 对生产数据库执行：

```bash
npm run db:push
```

4. 生产构建自动增加导入数据表；登录「数据管理」复制导入密钥。每日浏览器采集任务通过独立会话配置，见导入接口文档。

## API

- `GET /api/dashboard`：仪表盘数据
- `GET /api/keywords`：关键词列表
- `POST /api/keywords`：新增关键词
- `GET /api/keywords/import/template`：下载 CSV 模板
- `POST /api/keywords/import`：CSV 导入关键词
- `POST /api/sync/run`：手动执行一次同步
- `GET /api/cron/daily-rankings`：Vercel Cron 入口
- `GET /api/health`：健康检查
