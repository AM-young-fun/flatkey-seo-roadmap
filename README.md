# SEO Rank Monitor

Next.js + PostgreSQL + Prisma + ECharts 的关键词排名监控面板。

## 功能

- 维护主关键词和长尾关键词
- 用 ECharts graph 渲染关键词父子关系
- 美国、日本、西班牙三个地区的 Google 排名监控
- 排名颜色：前 5 绿色，前 10 黄色，前 50 红色，未进入前 50 黑色
- 通过 Ahrefs 获取关键词声量，并映射为关系图节点大小
- 每日生成排名 snapshot，并和上次结果生成 diff
- Vercel Cron 每天自动执行一次同步

## 环境变量

复制 `.env.example` 为 `.env`，至少填：

```bash
DATABASE_URL="postgresql://..."
CRON_SECRET="..."
SEO_TARGET_DOMAIN="example.com"
SERPAPI_API_KEY="..."
AHREFS_API_TOKEN="..."
```

没有 `DATABASE_URL` 时，页面会显示 demo 数据；有 `DATABASE_URL` 但没有外部 API key 时，同步会写入可复现的 demo 排名和声量。

## 本地开发

```bash
npm install
npm run db:push
npm run dev
```

打开 `http://localhost:3000`。

## CSV 导入

页面右侧可以上传 CSV。格式：

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

4. `vercel.json` 已配置每日 `08:15 UTC` 调用 `/api/cron/daily-rankings`。

## API

- `GET /api/dashboard`：仪表盘数据
- `GET /api/keywords`：关键词列表
- `POST /api/keywords`：新增关键词
- `POST /api/keywords/import`：CSV 导入关键词
- `POST /api/sync/run`：手动执行一次同步
- `GET /api/cron/daily-rankings`：Vercel Cron 入口
- `GET /api/health`：健康检查
