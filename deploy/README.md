# prompts.chat 离线部署说明

本文档整理了这次已经在联网构建机上验证通过的完整流程，目标是：

1. 在联网机器上把项目构建好
2. 把 prompts 和 skills 数据准备完整
3. 构建并导出离线镜像
4. 在内网 Linux Docker 环境中无网部署
5. 避免出现“服务能启动，但 prompts / skills 为 0”的问题

---

## 一、最终验证结论

这套流程已经在当前联网机器上实际验证通过，验证结果如下：

- PostgreSQL 默认密码按 `prompts` 使用可跑通
- 数据库 migration 成功
- prompts 数据拉取成功
- skills 数据导入成功
- `promptschat-app:offline` 镜像构建成功
- `promptschat-db:offline` 镜像构建成功
- 使用离线镜像重新启动一套服务后，数据恢复成功
- 健康检查通过

最终实际验证到的数据量：

- `prompt_count = 1686`
- `SKILL = 66`

健康接口验证结果：

```json
{"status":"healthy","timestamp":"...","database":"connected"}
```

---

## 二、为什么之前会出现“页面打开但没有数据”

之前的问题不是单一原因，而是几个点叠加：

1. `app` 容器启动时只执行 `prisma migrate deploy`，不会自动执行 seed
2. `db` 镜像里的 `prompts_data.sql` 只会在 PostgreSQL 初始化“全新空数据目录”时执行一次
3. 如果目标环境里之前已经创建过错误的空 volume，后面即使换了正确镜像，旧 volume 也会继续被复用
4. Windows 上如果用不对的方式重定向 `pg_dump` 输出，`prompts_data.sql` 可能被写成错误编码，导致 PostgreSQL 初始化时读不进去

所以会出现这种假象：

- app 正常启动
- db 正常启动
- 页面也能打开
- 但数据库里业务数据其实没有恢复
- 最终页面显示 `0 prompts` / `0 skills`

---

## 三、这次修复和验证中落实的关键点

### 1. 默认数据库密码

当前流程是按下面这个密码验证通过的：

```env
POSTGRES_PASSWORD=prompts
```

如果你没有特别要求，建议先沿用这个值完成内网部署验证，稳定之后再替换。

### 2. 构建环境要使用 Node 24

项目要求：

- Node `24.x`

宿主机如果不是 Node 24，建议使用 Docker 的 `node:24-bookworm-slim` 容器来做构建和 seed，避免本机环境差异。

### 3. `skills` 导入脚本问题已经修复

已经修复两类问题：

- Windows `CRLF` 换行导致 frontmatter 解析失败，skill 名称全变成 `Unknown`
- 某些 skill 目录里包含字体、压缩包、PDF 等二进制文件，文本入库时会触发 PostgreSQL 的 `invalid byte sequence for encoding "UTF8": 0x00`

现在导入脚本会：

- 正确兼容 `CRLF`
- 自动跳过包含 NUL 字节的二进制文件

### 4. app 镜像构建时跳过 Puppeteer 下载

已经在 `docker/Dockerfile` 中加入：

- `PUPPETEER_SKIP_DOWNLOAD=true`

避免 runner 阶段因为 Puppeteer 下载 Chrome 失败，导致镜像构建卡住。

### 5. 数据库快照打包时保留 `prompts_data.sql`

已经修复 `.dockerignore`，确保根目录的 `prompts_data.sql` 会进入 `db` 镜像构建上下文。

---

## 四、联网机器上的构建与验证流程

以下流程用于在有网机器上准备最终离线部署包。

### 1. 准备临时 PostgreSQL

可以直接使用默认密码 `prompts`。

示例：

```bash
docker run -d \
  --name promptschat-offline-db \
  -e POSTGRES_USER=prompts \
  -e POSTGRES_PASSWORD=prompts \
  -e POSTGRES_DB=prompts \
  -p 55432:5432 \
  -v promptschat_offline_pgdata:/var/lib/postgresql/data \
  postgres:17-bookworm
```

检查数据库是否 ready：

```bash
docker exec promptschat-offline-db pg_isready -U prompts -d prompts
```

### 2. 执行 migration 和 prompts seed

建议使用 `node:24-bookworm-slim` 容器执行，避免宿主机 Node 版本不匹配。

数据库连接字符串示例：

```text
postgresql://prompts:prompts@host.docker.internal:55432/prompts?schema=public
```

### 3. 拉取 Anthropic skills 并导入

把 Anthropic `skills` 仓库拉到本地，例如：

```bash
git clone --depth 1 https://github.com/anthropics/skills.git .offline-build/anthropic-skills
```

然后通过 `ANTHROPIC_SKILLS_DIR` 指向其 `skills/` 目录执行导入。

### 4. 检查数据库内容

在临时数据库里验证：

```bash
SELECT COUNT(*) AS prompt_count FROM public.prompts;
SELECT type, COUNT(*) FROM public.prompts GROUP BY type ORDER BY type;
```

这次验证通过的结果是：

```text
prompt_count = 1686
SKILL = 66
```

### 5. 导出数据库快照

在 Windows 上导出时，必须注意不要把 SQL 文件写成错误编码。

推荐使用 `cmd /c` 重定向输出：

```bash
cmd /c "docker exec promptschat-offline-db pg_dump -U prompts -d prompts > prompts_data.sql"
```

不要随意用 PowerShell 的重定向去生成最终 SQL 快照，否则有概率把文件写坏，导致 PostgreSQL 初始化时报：

```text
invalid command \a.MdoamnsNTrd
```

### 6. 构建最终离线镜像

```bash
docker build -f docker/Dockerfile -t promptschat-app:offline .
docker build -f docker/Dockerfile.db -t promptschat-db:offline .
```

### 7. 先在联网机本地自测一遍离线镜像

这是强烈建议的步骤，不要跳过。

使用 `deploy/compose.yml` 和 `.env` 启动：

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env down -v
docker compose -f deploy/compose.yml --env-file deploy/.env up -d
```

然后检查：

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env ps
docker compose -f deploy/compose.yml --env-file deploy/.env logs --tail=200 db
docker compose -f deploy/compose.yml --env-file deploy/.env logs --tail=200 app
```

并确认：

```bash
SELECT COUNT(*) AS prompt_count FROM public.prompts;
SELECT type, COUNT(*) FROM public.prompts GROUP BY type ORDER BY type;
```

以及健康接口：

```bash
curl http://127.0.0.1:4444/api/health
```

只有这一步通过，才建议导出镜像并带去内网环境。

### 8. 导出镜像

```bash
docker save -o deploy/export/promptschat-images-offline.tar promptschat-app:offline promptschat-db:offline
```

导出后，目录里至少应包含：

```text
deploy/export/
  promptschat-images-offline.tar
  prompts_data.sql
```

---

## 五、内网 Linux 部署步骤

### 1. 拷贝文件到内网机器

建议目录结构如下：

```text
/opt/prompts-chat/deploy/
  compose.yml
  .env.example
  README.md
  export/
    promptschat-images-offline.tar
    prompts_data.sql
```

### 2. 导入镜像

```bash
cd /opt/prompts-chat/deploy
docker load -i export/promptschat-images-offline.tar
```

确认镜像存在：

```bash
docker images | grep promptschat
```

应该能看到：

- `promptschat-app   offline`
- `promptschat-db    offline`

### 3. 准备 `.env`

```bash
cp .env.example .env
vi .env
```

推荐初始值：

```env
POSTGRES_PASSWORD=prompts
AUTH_SECRET=你自己生成的一串随机字符串
PORT=4444
APP_URL=http://你的内网IP:4444
```

生成 `AUTH_SECRET`：

```bash
openssl rand -base64 32
```

### 4. 如果以前部署失败过，先删旧卷

这一步非常重要。

如果之前起过错误空卷，一定先执行：

```bash
docker compose -f compose.yml down -v
```

否则旧 volume 会继续被复用，新的离线数据快照不会重新执行。

### 5. 启动服务

```bash
docker compose -f compose.yml up -d
```

### 6. 检查状态

```bash
docker compose -f compose.yml ps
```

正常应该看到：

- `db` healthy
- `app` healthy

### 7. 查看日志

```bash
docker compose -f compose.yml logs --tail=200 db
docker compose -f compose.yml logs --tail=200 app
```

#### `db` 日志中应关注

应该看到：

- `/docker-entrypoint-initdb.d/prompts_data.sql`
- 大量 `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE`
- 最后 `database system is ready to accept connections`

#### `app` 日志中应关注

应该看到：

- `Running database migrations...`
- `Migrations applied successfully.`
- `Starting application on port 3000`
- `Ready`

### 8. 验证业务数据

总量检查：

```bash
docker compose -f compose.yml exec -T db psql -U prompts -d prompts -c 'SELECT COUNT(*) AS prompt_count FROM public.prompts;'
```

预期：

```text
1686
```

类型分布检查：

```bash
docker compose -f compose.yml exec -T db psql -U prompts -d prompts -c "SELECT type, COUNT(*) FROM public.prompts GROUP BY type ORDER BY type;"
```

预期大致为：

```text
TEXT       1240
IMAGE       350
VIDEO        25
AUDIO         3
STRUCTURED    2
SKILL        66
```

### 9. 验证健康接口

```bash
curl http://127.0.0.1:4444/api/health
```

应返回：

```json
{"status":"healthy","timestamp":"...","database":"connected"}
```

### 10. 浏览器验证

打开：

```text
http://你的内网IP:4444
```

重点确认：

- 页面能打开
- prompts 列表不为空
- `/skills` 页面有数据
- 不是 `0 prompts` / `0 skills`

---

## 六、最小可执行命令顺序（内网）

内网机器上可以直接按下面顺序执行：

```bash
cd /opt/prompts-chat/deploy
docker load -i export/promptschat-images-offline.tar
cp .env.example .env
vi .env
docker compose -f compose.yml down -v
docker compose -f compose.yml up -d
docker compose -f compose.yml ps
docker compose -f compose.yml exec -T db psql -U prompts -d prompts -c 'SELECT COUNT(*) AS prompt_count FROM public.prompts;'
docker compose -f compose.yml exec -T db psql -U prompts -d prompts -c "SELECT type, COUNT(*) FROM public.prompts GROUP BY type ORDER BY type;"
curl http://127.0.0.1:4444/api/health
```

---

## 七、常见问题与排查

### 问题 1：页面能打开，但 prompts / skills 为 0

优先排查：

1. 旧 volume 没删除
2. `prompts_data.sql` 没有正确执行
3. 导出的 SQL 文件编码有问题

处理方式：

```bash
docker compose -f compose.yml down -v
docker compose -f compose.yml up -d
```

然后再看：

```bash
docker compose -f compose.yml logs --tail=300 db
docker compose -f compose.yml exec -T db psql -U prompts -d prompts -c 'SELECT COUNT(*) AS prompt_count FROM public.prompts;'
```

### 问题 2：`db` 容器正常，但数据没进去

重点看 `db` 日志是否出现类似错误：

```text
invalid command \a.MdoamnsNTrd
```

如果出现，说明 `prompts_data.sql` 很可能在 Windows 上被错误编码导出，需要重新生成 SQL 并重建 `db` 镜像。

### 问题 3：`app` 镜像构建卡在 Puppeteer 下载

如果 runner 阶段因为 `puppeteer` 下载 Chrome 失败而构建失败，需要确保 `docker/Dockerfile` 中已设置：

```text
PUPPETEER_SKIP_DOWNLOAD=true
```

### 问题 4：skills 导入异常

如果 skill 名称都变成 `Unknown`，或者导入时出现：

```text
invalid byte sequence for encoding "UTF8": 0x00
```

说明导入脚本没有正确处理 Windows 换行或二进制文件，需要使用当前已修复版本的 `scripts/seed-skills.ts`。

---

## 八、当前导出产物

当前这次验证通过后的产物位置：

```text
deploy/export/promptschat-images-offline.tar
deploy/export/prompts_data.sql
```

这两个文件对应的是已经经过以下验证的版本：

- 数据库已恢复
- skills 已恢复
- 离线镜像已能启动
- 健康检查已通过

---

## 九、推荐原则

1. 不要跳过联网机本地自测
2. 内网首次验证时，建议直接使用 `POSTGRES_PASSWORD=prompts`
3. 如果内网部署过失败版本，必须先 `down -v`
4. 每次都要用 SQL 查询验证 `public.prompts`，不要只看页面
5. 每次导出数据库快照后，都建议至少重建一次 `db` 镜像并重新启动验证

---

## 十、补充说明

如果后续还要继续完善，可以考虑把 `server-deploy-guide.md` 中与旧表名、旧排障方式有关的内容进一步统一更新，避免和当前实际表结构 `public.prompts` 混淆。
