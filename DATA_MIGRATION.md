# 数据迁移指南（迁移到 Oracle ARM 服务器）

本文档只讲**如何把数据从本地搬到服务器**。代码拉取、Docker 安装、防火墙、Nginx 等部署步骤请自行处理。

---

## 需要迁移的三样东西

| # | 内容 | 本地路径 | 大小 | 说明 |
|---|------|---------|------|------|
| 1 | SQLite 数据库 | `data/otero.db` | ~32 MB | 所有条目/元数据 |
| 2 | MinIO 对象数据 | `data/minio/` | ~44 GB | PDF 原文件 + MinerU 全文资产 |
| 3 | 环境变量 | `.env` | ~2 KB | 含密钥，被 git 忽略，**必须手动传** |

> **不需要迁移** `data/storage/`：里面的 PDF 和全文都已经上传到 MinIO 了（在 `data/minio/` 内），迁移后服务器不再从本地文件系统读取。
>
> **不需要迁移** Docker 镜像：服务器是 ARM 架构，本地是 x86。镜像必须在服务器上现场 `docker compose build`，不要传本地构建的镜像。

---

## 迁移前：干净停掉本地服务

迁移前务必先停掉本地正在运行的服务，让 SQLite 的 WAL 日志（`otero.db-wal` / `otero.db-shm`）合并回主库文件，否则拷贝过去的数据库可能不完整。

```bash
# 如果本地在用 docker compose 跑：
docker compose down

# 如果本地是 node 直接跑：
# 找到并停掉 `node src/index.js --serve` 进程
```

停掉后确认 `data/` 下的 `otero.db-wal` 文件已消失或变为 0 字节，此时 `otero.db` 就是完整的。

---

## 第 1 步：传 SQLite 数据库

只传主库文件 `otero.db`，**不要**传 `-wal` / `-shm` 临时文件，也不要传 `.bak` 备份文件。

```bash
# 在本地项目根目录执行（替换 <USER> 和 <SERVER_IP>）
rsync -avz --progress \
  data/otero.db \
  <USER>@<SERVER_IP>:~/otero/data/otero.db
```

---

## 第 2 步：传 MinIO 数据（44 GB，最耗时）

这是大头。用 `rsync` 传，它支持断点续传——中途断了，重跑**同一条命令**即可从断点继续，不会重传已完成的部分。

```bash
# 注意 data/minio/ 结尾的斜杠不能少（表示传目录内容而非目录本身）
rsync -avz --progress --partial \
  data/minio/ \
  <USER>@<SERVER_IP>:~/otero/data/minio/
```

参数说明：
- `-a` 保留权限/时间戳等属性
- `-z` 传输时压缩（省带宽，但 MinIO 里多是 PDF/图片等已压缩格式，压缩收益有限）
- `--progress` 显示进度
- `--partial` 保留未传完的部分文件，支持断点续传

> **如果上行带宽很小**，44 GB 可能要传几个小时。可以先本地打包再传：
> ```bash
> # 本地：打包（不额外压缩，minio 内容多为已压缩格式）
> tar -cf minio-data.tar -C data minio
> rsync -avz --progress --partial minio-data.tar <USER>@<SERVER_IP>:~/otero/data/
> # 服务器：解包
> cd ~/otero/data && tar -xf minio-data.tar && rm minio-data.tar
> ```

---

## 第 3 步：传 .env（含密钥）

`.env` 被 git 忽略，`git clone` **不会**把它带过去，必须手动传。它必须和 `docker-compose.yml` 在同一目录（项目根目录）。

```bash
scp .env <USER>@<SERVER_IP>:~/otero/.env
```

> `.env` 里的 `MINIO_ENDPOINT=127.0.0.1` **不用改**。`docker-compose.yml` 已经用 `environment` 覆盖成容器服务名 `minio`，只有容器外的本机工具才会用到 `.env` 里的 `127.0.0.1`。

---

## 第 4 步：核对服务器目录结构

传完后，服务器上的目录应该是这样：

```
~/otero/
├── docker-compose.yml      # 来自 git clone
├── Dockerfile              # 来自 git clone
├── .env                    # 手动 scp（第 3 步）
├── src/ ...                # 来自 git clone
└── data/
    ├── otero.db            # rsync（第 1 步）
    └── minio/              # rsync（第 2 步）
        ├── .minio.sys/
        └── otero-pdfs/     # bucket 目录，里面是分片的对象
```

确认 `data/minio/otero-pdfs/` 存在且非空：

```bash
# 服务器上执行
ls ~/otero/data/minio/otero-pdfs/ | head
du -sh ~/otero/data/minio/
```

`du` 显示的大小应该和本地的 ~44 GB 接近。

---

## 第 5 步：MinIO 数据目录权限

MinIO 容器内以 root 运行，数据目录是 bind mount（`./data/minio:/data`）。如果 rsync 后遇到 MinIO 起不来或读不到数据，通常是属主问题，修一下：

```bash
# 服务器上执行
sudo chown -R root:root ~/otero/data/minio
```

---

## 迁移完成后：验证数据完整性

启动服务后（`docker compose up -d --build`），在**服务器本机**用 curl 验证 MinIO 数据能被读到（绕开防火墙，先确认应用本身正常）：

```bash
# 全文（markdown）——errMsg 应为 null，markdown 字段有内容
curl -s http://127.0.0.1:3001/api/items/A86URPKQ/fulltext | head -c 300

# PDF 附件——应返回 HTTP 200 + application/pdf
curl -s -o /dev/null -w "HTTP %{http_code}  %{content_type}\n" \
  http://127.0.0.1:3001/api/attachments/VEP7B56N/file
```

预期：
- 全文接口返回的 JSON 里 `errMsg` 为 `null`，且有 `markdown` 内容
- PDF 接口返回 `HTTP 200  application/pdf`

如果 `errMsg` 出现 `getaddrinfo EAI_AGAIN minio` 或 `EAI_AGAIN`，说明 otero 容器连不上 MinIO 容器——用 `docker compose down && docker compose up -d` 让两个容器由 compose 一起重建（不要单独 `docker start` 某一个容器，会导致网络别名丢失）。

---

## 常见问题

**Q: 传输中途断了怎么办？**
重跑第 2 步那条完全一样的 `rsync` 命令，`--partial` 会从断点继续。

**Q: 服务器上数据库能打开但查不到条目？**
检查是不是把 `otero.db-wal` 也传过去了、或者本地停服务前 WAL 没合并。重新在本地干净停服务，确认 `otero.db-wal` 消失后再传 `otero.db`。

**Q: 能不能不迁 MinIO，在服务器上重新解析？**
可以，但要重新跑 MinerU（消耗 token + 时间），且 PDF 原文件也得先在服务器上有。直接迁 `data/minio/` 是最省事的方式。

**Q: `data/storage/` 要不要传？**
不用。数据都在 MinIO 里了。本地这个目录可以在确认服务器一切正常后删除以释放空间。
