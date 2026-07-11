# SQLite → PostgreSQL 迁移

应用已硬切换到 PostgreSQL。运行时只通过 `DATABASE_URL` 连接；不再读写 `data/otero.db`。

MinIO / PDF 资产不在本流程内。

## 前置条件

1. PostgreSQL 可达（本地：`docker compose up -d postgres`）
2. `.env` 中配置 `DATABASE_URL`（宿主机用 `127.0.0.1`，compose 内 `otero` 服务用主机名 `postgres`）
3. 源库：只读的 `data/otero.db`（或其它路径）

## 本地验证

```bash
docker compose up -d postgres
node scripts/sqlite-to-pg.mjs --wipe
npm test
npm run serve
```

冒烟：列表 / 搜索 / 条目详情 / 全文状态。

## 服务器迁移步骤

1. **停写**：停掉旧应用进程，确保 SQLite WAL 已合并（`otero.db-wal` 消失或 0 字节）。
2. **备份**：保留 `otero.db` 副本（回滚用）。
3. **起 Postgres**：确保目标库空或可接受 `--wipe`。
4. **导入**：

```bash
# 在服务器项目根目录
node scripts/sqlite-to-pg.mjs --sqlite=/path/to/otero.db --wipe
```

5. **切配置**：`.env` / compose 中 `DATABASE_URL` 指向新库；确认无 `better-sqlite3` / `dbPath`。
6. **起服务**并验证列表、搜索、条目、附件路径（附件仍在 MinIO/磁盘）。

## 导入脚本行为

`scripts/sqlite-to-pg.mjs`：

- 只读打开 SQLite（`node:sqlite`）
- `--wipe`：按 FK 逆序 `TRUNCATE ... CASCADE` 后导入
- 按依赖顺序拷贝表；校准 IDENTITY 序列到 `MAX(id)`
- 结束时对比各表行数

## 回滚

1. 停新服务
2. 恢复旧代码分支（仍用 SQLite）或从 `pg_dump` 恢复
3. 用备份的 `otero.db` 继续旧部署

推荐：迁移成功并验证前，不要删除 `otero.db` 备份。

## 测试

```bash
docker compose up -d postgres
npm test   # 需 DATABASE_URL；串行执行并对库 TRUNCATE
```
