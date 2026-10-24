# 生产部署（Docker 镜像）

本文介绍如何在一台干净的服务器上用 **Docker Hub 上的预构建镜像** 部署 Otero。服务器只需要 Docker Engine 和 Docker Compose 插件，**不需要安装 Node.js，也不需要 `git clone` 源码或在本地构建镜像**。

镜像由 GitHub Actions 在每次推送到 `main` 或打 `v*` 标签时自动构建，并同时发布 `linux/amd64` 与 `linux/arm64` 两个架构；服务器是 x86 还是 ARM（如 Oracle Cloud aarch64）都会自动拉取匹配的版本。

- 镜像：`sitdownkevin/otero`
- 标签：`latest`、`main`、`sha-<短 SHA>`，以及 `1.2.3` / `1.2` / `1` 等语义化版本（由 git tag `v1.2.3` 生成，镜像标签会去掉 `v`）

## 前置条件

- **自备 PostgreSQL 16 及以上**（原容器内使用 `postgres:16-alpine`）。应用使用 **schema v6**，首次启动会自动建表并记录版本；更高版本的 PostgreSQL 也可以。
- 数据库、用户和库名需要**提前创建**好，并确保运行容器的服务器能通过网络访问它（防火墙、`listen_addresses`、`pg_hba.conf` 均已放行）。
- 建议为应用用户预装 `pg_trgm` 扩展（`CREATE EXTENSION IF NOT EXISTS pg_trgm;`）。若没有权限，迁移会打印警告并跳过三元组索引，功能可用但模糊搜索会变慢。
- 不需要在服务器上安装 Node.js，也不需要 `git clone` 源码或本地构建镜像。

## 1. 准备文件

在服务器上选一个部署目录（示例 `/opt/otero`）：

```bash
mkdir -p /opt/otero && cd /opt/otero

# 拉取生产 compose 文件
curl -fsSLO https://raw.githubusercontent.com/TJ-IS/otero/main/docker-compose.prod.yml

# 拉取环境变量模板并直接作为 .env
curl -fsSL https://raw.githubusercontent.com/TJ-IS/otero/main/.env.prod.example -o .env
chmod 600 .env
```

> 如果服务器无法访问 GitHub raw，也可以从仓库手动复制这两个文件。

## 2. 填写密钥

编辑 `.env`，把 `<...>` 占位符全部替换掉，至少包括：

- `DATABASE_URL`：指向你自备的 PostgreSQL，必填（示例见模板；密码含特殊字符时需 URL 编码）
- `OTERO_AUTH_SECRET`：**必须**替换，用 `openssl rand -hex 32` 生成
- `STORAGE_TYPE` 与 `S3_*`：使用 R2 时填 S3 API 端点（不是公共域名）
- `OTERO_MINERU_TOKEN`：全文解析所需
- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`：LLM 能力所需
- `OTERO_EDITOR_WHITELIST`：可写钱包地址，逗号分隔
- `PUBLIC_BASE_URL`：站点对外地址

`DATABASE_URL` 直接由 compose 通过 `env_file` 透传给容器，**不会再被自动拼装或覆盖**；数据库主机名由你决定。仓库里只有 `.env.prod.example` 模板，切勿把填好的 `.env` 提交回仓库。

## 3. 首次部署

```bash
cd /opt/otero
docker compose -f docker-compose.prod.yml up -d
```

Compose 只会拉取并启动 `otero` 镜像（端口 `4321` → 容器 `3000`，数据落在 `./data`），不再启动任何数据库容器。请先确认 `.env` 中的 `DATABASE_URL` 可以连通。

**数据库迁移是自动的。** 容器入口脚本 `docker-entrypoint.sh` 会在启动服务前依次执行 `node src/db/migrate.js` 和 `node src/db/seed.js`，因此首次部署不需要手动建表或跑迁移；这两个命令都是幂等的。若数据库不可达，容器会启动失败并按 `restart: unless-stopped` 反复重启，此时先看日志排查连接问题。

检查状态与日志：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f otero
curl http://127.0.0.1:4321/health
```

镜像仓库是公开的，拉取无需登录；若遇到 Docker Hub 匿名拉取限流，可先执行 `docker login`（用有拉取权限的账号）。

生产环境通常在前面放 Nginx/Caddy 处理 TLS，并把域名反代到 `127.0.0.1:4321`；`PUBLIC_BASE_URL` 要填最终对外的 `https://` 地址。

## 4. 升级

```bash
cd /opt/otero

# 若固定了 OTERO_IMAGE_TAG，先改 .env；用 latest 时直接拉新镜像
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

升级时：

- `./data` 是宿主机目录，容器重建不会丢数据；数据库目录由你的 PostgreSQL 自行管理，不在 `./data` 下；
- 入口脚本会再次执行迁移，已应用的迁移会跳过，只应用新增迁移；
- 建议升级前备份数据库（见下）。

用 `latest` 时，`up -d` 不会自动检查远端是否有新镜像，所以升级步骤里要先 `pull`。

## 5. 版本回滚

生产环境建议在 `.env` 中固定 `OTERO_IMAGE_TAG`，例如：

```env
OTERO_IMAGE_TAG=1.2.3
```

（git tag 为 `v1.2.3` 时，`docker/metadata-action` 生成的镜像标签是 `1.2.3`，不带 `v`。）

回滚时把该值改成之前的版本（或某个 `sha-<短 SHA>`），然后：

```bash
docker compose -f docker-compose.prod.yml pull otero
docker compose -f docker-compose.prod.yml up -d otero
```

注意：数据库迁移是**向前**的。如果新版本已经应用了不兼容的 schema 变更，仅回退镜像可能无法正常工作；因此升级前应先备份，必要时回滚后再恢复数据库。

## 6. 备份

数据库在 compose 之外，请直接在数据库主机（或任何装有 `pg_dump` 且能连到数据库的机器）上执行：

```bash
# 自定义格式（推荐，配合 pg_restore）
pg_dump -h <DB_HOST> -p 5432 -U <DB_USER> -d <DB_NAME> \
  -Fc -f backup-$(date +%F).dump

# 或纯 SQL 文本
pg_dump -h <DB_HOST> -p 5432 -U <DB_USER> -d <DB_NAME> \
  -Fp > backup-$(date +%F).sql
```

也可以直接用 `.env` 中的连接串（在本机已安装 PostgreSQL 客户端时）：

```bash
pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump
```

建议使用与服务端同版本或更高版本的 `pg_dump`（PostgreSQL 16+）。

```bash
# PDF / 全文：使用 R2 时走 R2 侧备份；使用 filesystem 时打包 ./data/storage
tar czf storage-$(date +%F).tar.gz data/storage
```

注意：`./data` 目录不包含数据库数据，**不要**把它当成数据库备份。

## 7. 首次部署与升级的区别

| | 首次部署 | 升级 |
|---|---|---|
| 前置条件 | 已有可访问的 PostgreSQL 16+，目录中只有 compose 文件和 `.env` | 已有 `.env`、`./data` 和存有数据的数据库 |
| Postgres | 用户预先创建库/用户，应用自动建表 | 复用同一数据库 |
| 迁移 | 建表 + seed | 只应用新增迁移（幂等命令照常执行） |
| 命令 | `docker compose -f docker-compose.prod.yml up -d` | `pull` 后再 `up -d` |
| 数据 | 从零开始 | 保留，升级前建议 `pg_dump` |

## 8. 常见问题（自备数据库）

- **`ECONNREFUSED` / 连接超时**：确认 `DATABASE_URL` 的主机、端口正确。宿主机数据库若只监听 `127.0.0.1`，容器无法通过 `host.docker.internal` 连入；请把 `postgresql.conf` 的 `listen_addresses` 设为 `'*'`（或 Docker 网桥地址），并在 `pg_hba.conf` 中允许对应网段，然后重启 PostgreSQL。
- **认证失败**：检查密码是否需要 URL 编码；`pg_hba.conf` 的认证方式（`scram-sha-256` 等）与用户密码是否匹配。
- **`host.docker.internal` 解析失败**：生产 compose 已加入 `extra_hosts: ["host.docker.internal:host-gateway"]`，需 Docker 20.10+。若仍不可用，可直接在 `DATABASE_URL` 中填写宿主机的内网 IP。
- **权限不足 / 无法建表**：应用用户需要对目标 schema 有 `CREATE` 权限；若迁移日志提示 `pg_trgm unavailable`，请用管理员账号执行 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`。
- **TLS**：托管数据库通常要求加密连接，按服务商要求追加 `?sslmode=require`（或 `verify-full` 并提供 CA）。
- **数据库在另一个 Docker 网络中**：容器默认在 `otero-net` 桥接网络内，无法直接用别的 compose 项目的服务名。请改用宿主机地址、给两个网络建立连接，或把数据库暴露到可路由的地址。
