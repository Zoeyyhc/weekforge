# 部署指南（Railway · 后端）

WeekForge 由两部分组成，**分开部署**：

- **后端**（FastAPI / Python，仓库根目录的 `Dockerfile`）→ 部署到 **Railway**。
- **前端**（Next.js，`frontend/`）→ 部署到 Vercel 之类的平台（`.dockerignore` 已把 `frontend` 排除，Railway 镜像里不含前端）。

本文聚焦后端在 Railway 的部署。

---

## 1. Railway 构建方式

仓库根目录有 `Dockerfile`，Railway 连接 GitHub 后会**自动用它构建**，无需 `railway.json` 或 Nixpacks。

镜像要点（已在 `Dockerfile` 里写好，无需改动）：

- 基于 `python:3.12-slim`，用 `uv sync --frozen --no-dev` 装依赖；
- `ENV WEEKFORGE_HOST=0.0.0.0`（容器内必须监听 `0.0.0.0`，否则 Railway 访问不到）；
- 端口：`server.py` 里 `port = PORT or 8001`，Railway 会自动注入 `PORT`，**不用手动设端口**；
- 启动命令 `uv run weekforge-api`。

---

## 2. 持久化卷（Volume）—— 为什么要挂 `/app/data`

Railway 容器文件系统是**临时的**：每次重新部署/重启，写进容器的文件都会被清空。

WeekForge 后端会往磁盘写一个有状态文件：

| 文件 | 作用 | 控制它的 env |
|---|---|---|
| SQLite DB | LangGraph checkpointer + 会话数据 | `WEEKFORGE_DB_PATH` |

不挂卷 → 每次部署后用户会话全丢。

**做法：**

1. Railway 服务里新增一个 **Volume**，**Mount path 填 `/app/data`**；
2. 在 env 里把路径指进 `/app/data`（见下一节）。

---

## 3. 环境变量

在 Railway 服务的 **Variables** 里设置。

### 必填

| 变量 | 值 / 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key（辩论收敛 + validate 解析都要用） |
| `WEEKFORGE_DB_PATH` | `/app/data/weekforge_api.db` —— 指到持久化卷 |
| `WEEKFORGE_FRONTEND_URL` | 前端线上地址，如 `https://weekforge.vercel.app`（CORS 白名单 origin） |

### 可选（调模型 / 调端口）

| 变量 | 默认 | 说明 |
|---|---|---|
| `WEEKFORGE_MODEL` | Haiku | 议员（Council）/ 仲裁者默认模型 |
| `WEEKFORGE_ARBITER_MODEL` | 跟随 `WEEKFORGE_MODEL` | 仅给仲裁者用；建议设更强的模型（如 Sonnet）以减少 validation 重试 |
| `WEEKFORGE_HOST` | `0.0.0.0`（Dockerfile 已设） | 容器绑定地址，**别改** |
| `WEEKFORGE_PORT` / `PORT` | Railway 自动注入 `PORT` | **不用手动设** |

---

## 4. 部署步骤清单

1. **连接 GitHub**：Railway → New Project → Deploy from GitHub repo → 选 `Zoeyyhc/weekforge`。
2. **加 Volume**：服务里 New Volume，Mount path = `/app/data`。
3. **填 Variables**：按上面第 3 节填，DB 路径指向 `/app/data/weekforge_api.db`。
4. **生成域名**：Settings → Networking → Generate Domain，拿到 `https://<xxx>.up.railway.app`。
5. **触发部署**：保存变量后 Railway 会自动重新部署。
6. **验证**：
   - 访问 `https://<域名>/docs` 看 FastAPI 文档是否能打开；
   - 前端的 `NEXT_PUBLIC_API_BASE_URL` 设成这个 Railway 域名，确认能联通。

---

## 5. 前端（简要）

前端单独部署（如 Vercel，根目录设为 `frontend/`），只需一个环境变量：

| 变量 | 值 |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | 后端 Railway 域名，如 `https://<xxx>.up.railway.app` |

部署完前端，把它的线上地址回填到后端的 `WEEKFORGE_FRONTEND_URL`（用于 CORS）。两边互相指一次即可。

---

## 6. 常见坑

- **前端请求被 CORS 拦** → `WEEKFORGE_FRONTEND_URL` 没设成前端真实 origin（CORS 白名单就取这个值）。
- **服务起不来 / Railway 探活失败** → 确认监听 `0.0.0.0` 且用了注入的 `PORT`（默认配置已正确，通常是手动覆盖了 `WEEKFORGE_HOST`/`WEEKFORGE_PORT` 导致）。
- **日历导出失败** → `ANTHROPIC_API_KEY` 未设或过期（导出本身是 API-free，但辩论过程需要 Claude）。
