# 生产部署（Docker 镜像）

本文介绍如何在一台干净的服务器上用 **Docker Hub 上的预构建镜像** 部署 Otero。服务器只需要 Docker Engine 和 Docker Compose 插件，**不需要安装 Node.js，也不需要 `git clone` 源码或在本地构建镜像**。

镜像由 GitHub Actions 在每次推送到 `main` 或打 `v*` 标签时自动构建，并同时发布 `linux/amd64` 与 `linux/arm64` 两个架构；服务器是 x86 还是 ARM（如 Oracle Cloud aarch64）都会自动拉取匹配的版本。

- 镜像：`sitdownkevin/otero`
- 标签：`latest`、`main`、`sha-<短 SHA>`，以及 `1.2.3` / `1.2` / `1` 等语义化版本（由 git tag `v1.2.3` 生成，镜像标签会去掉 `v`）

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

- `POSTGRES_PASSWORD`：数据库密码，建议 `openssl rand -hex 24`
- `OTERO_AUTH_SECRET`：**必须**替换，用 `openssl rand -hex 32` 生成
- `STORAGE_TYPE` 与 `S3_*`：使用 R2 时填 S3 API 端点（不是公共域名）
- `OTERO_MINERU_TOKEN`：全文解析所需
- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`：LLM 能力所需
- `OTERO_EDITOR_WHITELIST`：可写钱包地址，逗号分隔
- `PUBLIC_BASE_URL`：站点对外地址

`DATABASE_URL` 不需要填写，compose 会用 `POSTGRES_*` 自动拼装并注入容器。仓库里只有 `.env.prod.example` 模板，切勿把填好的 `.env` 提交回仓库。

## 3. 首次部署

```bash
cd /opt/otero
docker compose -f docker-compose.prod.yml up -d
```

Compose 会：

1. 启动 `postgres:16-alpine`（数据落在 `./data/postgres`），等待健康检查通过；
2. 拉取并启动 `otero` 镜像（端口 `4321` → 容器 `3000`，数据落在 `./data`）。

**数据库迁移是自动的。** 容器入口脚本 `docker-entrypoint.sh` 会在启动服务前依次执行 `node src/db/migrate.js` 和 `node src/db/seed.js`，因此首次部署不需要手动建表或跑迁移；这两个命令都是幂等的。

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

- `./data` 与 `./data/postgres` 是宿主机目录，容器重建不会丢数据；
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

```bash
# 元数据（在部署目录执行）
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql

# PDF / 全文：使用 R2 时走 R2 侧备份；使用 filesystem 时打包 ./data/storage
tar czf storage-$(date +%F).tar.gz data/storage
```

## 7. 首次部署与升级的区别

| | 首次部署 | 升级 |
|---|---|---|
| 前置条件 | 目录中只有 compose 文件和 `.env` | 已有 `.env` 与 `./data` 数据 |
| Postgres | 初始化空数据目录并创建用户/库 | 复用现有数据目录 |
| 迁移 | 建表 + seed | 只应用新增迁移（幂等命令照常执行） |
| 命令 | `docker compose -f docker-compose.prod.yml up -d` | `pull` 后再 `up -d` |
| 数据 | 从零开始 | 保留，升级前建议 `pg_dump` |
