# SQLite → PostgreSQL 迁移

应用已硬切换到 PostgreSQL。运行时只通过 `DATABASE_URL` 连接；不再读写 `data/otero.db`。

> **注意：** 仓库已移除带 `TRUNCATE` / `--wipe` 的 `sqlite-to-pg.mjs`，避免误清空生产库。
> 若仍需从 SQLite 导入，请用 `pg_dump` / 手工迁移，或在空库上自行编写只插入、不 wipe 的导入流程。

对象存储（S3 / R2）资产不在本流程内。

## 前置条件

1. PostgreSQL 可达（本地：`docker compose up -d postgres`）
2. `.env` 中配置 `DATABASE_URL`
3. 目标库为空，或你已自行备份后决定如何处理冲突

## 推荐做法

- **已有 Postgres 数据**：用 `pg_dump` / `pg_restore` 在机器间搬迁，不要对生产库做全表清空。
- **仅有旧 SQLite**：在**空的**目标库上做一次性导入（自行编写插入脚本，或从备份恢复）；不要对已有文献库执行 wipe。

## 回滚

1. 停服务
2. 从 `pg_dump` 备份恢复，或回退到仍使用 SQLite 的旧部署与 `otero.db` 备份

## 测试

```bash
docker compose up -d postgres
npm test   # 需 DATABASE_URL；测试不会 TRUNCATE 业务表
```
