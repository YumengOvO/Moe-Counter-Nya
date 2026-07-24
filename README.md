# Moe-Counter-Nya

<p align="center">
  <img
    src="https://count.getloli.com/@Moe-Counter-Nya?name=Moe-Counter-Nya&theme=rule34&padding=7&offset=0&align=top&scale=1&pixelated=1&darkmode=auto"
    alt="Moe-Counter-Nya"
  >
</p>

一个支持多种主题、显式创建计数器和单管理员 Web 管理端的萌系访问计数器。

Moe-Counter-Nya is a self-hosted SVG counter with themed digits, explicit counter creation, and a secure single-administrator dashboard.

## 项目简介

Moe-Counter-Nya 可以生成适合嵌入 Markdown、博客和个人主页的 SVG 访问计数器。公开计数链接无需登录，管理员则通过独立的 Web 管理端创建和维护计数器。

本分支在保留原有主题、SVG 路由和显示参数的基础上，加入了完整的计数器生命周期管理。未由管理员创建的 Name 不会再因公开访问被自动写入数据库，而是返回 HTTP 404。

## 本分支特色

- **单管理员管理端**：通过 `/admin/login` 登录，不提供注册、多用户或权限分级。
- **显式创建计数器**：新 Name 必须先在管理端创建，未知 Name 默认返回 HTTP 404。
- **完整管理操作**：创建、查看、复制公开链接、修改数值、清零和删除。
- **公开链接保持开放**：已创建计数器的 SVG 与 JSON 路由仍可直接嵌入网站。
- **安全会话**：SQLite 服务端 Session、CSRF Token、登录失败限流和安全 Cookie。
- **一致性保护**：处理并发递增、延迟写入、后台修改及删除之间的缓存一致性。
- **双数据库支持**：计数数据可使用 SQLite 或 MongoDB，二者遵循统一适配器语义。
- **生产部署支持**：Docker、Docker Compose、非 root 容器、HTTPS 反向代理和持久化数据卷。
- **自动化测试**：当前测试集包含 41 项测试，覆盖鉴权、管理操作、公开接口、缓存、数据适配器及部署配置。

## 快速部署

### 环境要求

- Git
- Docker Engine 或 Docker Desktop
- Docker Compose v2

### 1. 获取项目

Linux、macOS：

```bash
git clone https://github.com/YumengOvO/Moe-Counter-Nya.git
cd Moe-Counter-Nya
cp .env.example .env
```

Windows PowerShell：

```powershell
git clone https://github.com/YumengOvO/Moe-Counter-Nya.git
Set-Location Moe-Counter-Nya
Copy-Item .env.example .env
```

### 2. 设置管理员与站点配置

编辑 `.env`，至少替换以下内容：

```dotenv
ADMIN_USERNAME=replace-with-admin-username
ADMIN_PASSWORD=replace-with-a-long-random-password
SESSION_SECRET=replace-with-at-least-32-random-characters

NODE_ENV=production
APP_SITE=https://count.yumengovo.com
APP_PORT=3000
DB_TYPE=sqlite
SESSION_DB_PATH=data/admin-sessions.db
SESSION_COOKIE_SECURE=true
TRUST_PROXY=1
```

`ADMIN_PASSWORD` 与 `SESSION_SECRET` 必须是不同的秘密。不要将真实值写入 Compose、源码、日志、URL 或 Git。

上例中的 `TRUST_PROXY=1` 只适用于应用前方恰好有一层可信反向代理，且应用端口不直接暴露到公网的部署方式。如果应用直接对外提供 HTTP 服务，应保持 `TRUST_PROXY=false`。

### 3. 一条命令启动

```bash
docker compose up -d --build
```

检查容器状态：

```bash
docker compose ps
docker compose logs --tail=100 moe-counter
```

生产域名配置完成后，健康检查应返回 `alive`：

```bash
curl https://count.yumengovo.com/heart-beat
```

然后访问：

- 管理员登录：`https://count.yumengovo.com/admin/login`
- 公开首页：`https://count.yumengovo.com/`

首次登录后，请先在管理端创建 Name；创建成功后，对应的公开链接才会开始计数。

### 本地 HTTP 调试

如果只在本机通过 `http://localhost:3000` 测试，请改用：

```dotenv
NODE_ENV=development
APP_SITE=http://localhost:3000
SESSION_COOKIE_SECURE=false
TRUST_PROXY=false
```

这些设置不适合生产环境。

## 使用方法

### 创建计数器

1. 打开 `/admin/login`。
2. 使用 `.env` 中的管理员用户名和密码登录。
3. 在管理页输入一个新 Name 并创建。
4. 从列表复制生成的公开链接。

新 Name 必须满足：

- 长度为 1–32 个字符；
- 只包含 ASCII 字母、数字、连字符 `-`、下划线 `_` 或点号 `.`；
- 区分大小写；
- 在当前数据库中唯一。

历史数据库中的 Name 不会因为新规则而失效。删除一个计数器后，可以使用相同 Name 重新创建，新值从 `0` 开始。

### 嵌入 Markdown

```markdown
![访问计数](https://count.yumengovo.com/@my-homepage?theme=moebooru)
```

### 嵌入 HTML

```html
<img
  src="https://count.yumengovo.com/@my-homepage?theme=moebooru"
  alt="访问计数"
>
```

每次请求已创建计数器的公开 SVG 或 JSON 路由都会使计数加一。

### 获取 JSON

```bash
curl https://count.yumengovo.com/record/@my-homepage
```

响应示例：

```json
{
  "name": "my-homepage",
  "num": 42
}
```

## 显示参数

SVG 路由支持以下查询参数：

| 参数 | 默认值 | 范围或可选值 | 说明 |
| --- | --- | --- | --- |
| `theme` | `moebooru` | 已安装主题名或 `random` | 数字主题 |
| `padding` | `7` | `0`–`16` 的整数 | 数字间距 |
| `offset` | `0` | `-500`–`500` | 垂直偏移 |
| `align` | `top` | `top`、`center`、`bottom` | 数字对齐方式 |
| `scale` | `1` | `0.1`–`2` | 缩放比例 |
| `pixelated` | `1` | `0`、`1` | 是否使用像素化渲染 |
| `darkmode` | `auto` | `0`、`1`、`auto` | 深色模式 |
| `num` | `0` | `0`–`1000000000000000` 的整数 | 大于 `0` 时临时渲染指定数字，不读写计数器 |
| `prefix` | `-1` | `-1`–`999999` 的整数 | 显示前缀 |

示例：

```text
https://count.yumengovo.com/@my-homepage?theme=rule34&padding=7&align=center&scale=1
```

`num` 大于 `0` 时是无持久化预览例外，因此即使 Name 不存在也可以返回 SVG。`num=0` 不会启用预览模式，仍按正常计数器请求处理。

项目内置主题位于 `assets/theme/`。主题素材不属于本仓库 MIT License 的授权范围。

## 公开接口概览

| 方法与路径 | 响应 | 行为 |
| --- | --- | --- |
| `GET /@:name` | SVG | 对已存在 Name 加一并渲染 |
| `GET /get/@:name` | SVG | 与 `/@:name` 相同的兼容入口 |
| `GET /record/@:name` | JSON | 对已存在 Name 加一并返回 `{ name, num }` |
| `GET /heart-beat` | 文本 | 返回 `alive`，用于健康检查 |

补充行为：

- 未创建的 Name 返回 HTTP 404，且不会创建数据库记录。
- `demo` 是特殊展示计数器，保持原有主题预览行为。
- 正数 `?num=` 可以临时渲染指定数字，不创建或更新计数器。
- 管理端使用服务端 Session 和 CSRF 保护的 HTML 表单，不是公开 JSON 管理 API。

## Docker 部署

### Docker Compose

仓库内的 `docker-compose.yml` 默认从当前源码构建镜像，并将 `./data` 挂载到容器的 `/app/data`：

```bash
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

更新代码后重新构建：

```bash
git pull --ff-only
docker compose up -d --build
```

`docker compose down` 不会删除宿主机的 `./data`。不要在未备份的情况下手动删除该目录。

### GitHub Container Registry

GitHub Actions 会根据当前仓库名构建：

```text
ghcr.io/yumengovo/moe-counter-nya:latest
```

GHCR 包的公开可见性由 GitHub Packages 设置控制。如果包已设为 Public，可直接使用；私有包必须先通过具备 `read:packages` 权限的 Token 登录 GHCR。

包可用时，可以运行：

```bash
docker run -d \
  --name moe-counter-nya \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/yumengovo/moe-counter-nya:latest
```

在确认 GHCR 包可匿名拉取前，推荐使用仓库自带的 Docker Compose 源码构建方式。

### 数据目录权限

容器以非特权 `node` 用户运行，UID/GID 为 `1000`。宿主机的 `./data` 必须允许该用户写入。

SQLite 默认使用：

- `data/count.db`：计数数据；
- `data/admin-sessions.db`：管理员 Session。

部署更新和迁移前应先停止写入并备份 `data/count.db`。丢失 Session 数据库只会使管理员退出登录，丢失计数数据库则会丢失计数器记录。

## MongoDB

使用 MongoDB 存储计数数据时：

```dotenv
DB_TYPE=mongodb
DB_URL=mongodb://mongo:27017/moe-counter
```

在 Compose 网络中，`127.0.0.1` 指向应用容器自身，应使用 MongoDB 服务名或可访问的外部主机，并在生产 URI 中指定数据库名。

即使计数数据使用 MongoDB，管理员 Session 仍默认保存在 `SESSION_DB_PATH` 指定的 SQLite 文件中，因此 `/app/data` 仍需要持久化。

升级已有 MongoDB 数据前，应先检查是否存在重复 Name；重复数据会导致唯一索引创建失败。

## 环境变量

| 变量 | 必填 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | 是 | — | 单管理员用户名 |
| `ADMIN_PASSWORD` | 是 | — | 管理员密码 |
| `SESSION_SECRET` | 是 | — | Session 签名秘密，至少 32 个字符 |
| `NODE_ENV` | 否 | — | 生产环境使用 `production` |
| `APP_SITE` | 否 | 请求来源 | 对外公开站点地址 |
| `APP_PORT` | 否 | `3000` | HTTP 监听端口 |
| `DB_TYPE` | 否 | `sqlite` | `sqlite` 或 `mongodb` |
| `DB_URL` | MongoDB 时 | `mongodb://127.0.0.1:27017` | MongoDB URI |
| `DB_INTERVAL` | 否 | 应用 `0`；Compose `60` | 延迟写入间隔，单位为秒 |
| `SESSION_DB_PATH` | 否 | `data/admin-sessions.db` | 管理员 Session 数据库 |
| `SESSION_COOKIE_SECURE` | 否 | 取决于 `NODE_ENV` | 是否只通过 HTTPS 发送 Cookie |
| `TRUST_PROXY` | 否 | `false` | 可信代理跳数、地址或 CIDR |
| `LOG_LEVEL` | 否 | `info` | `debug`、`info`、`warn`、`error`、`none` |
| `GA_ID` | 否 | — | 可选 Google Analytics G-Tag ID |

应用缺少 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 或有效的 `SESSION_SECRET` 时会在启动阶段直接失败。

## HTTPS 与反向代理

生产环境应通过 HTTPS 提供服务。以单层 Nginx 反向代理为例：

```dotenv
NODE_ENV=production
APP_SITE=https://count.yumengovo.com
SESSION_COOKIE_SECURE=true
TRUST_PROXY=1
```

Nginx 配置示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

只有在代理拓扑与配置确实可信时才能设置 `TRUST_PROXY`。应用会拒绝无条件信任全部代理的 `TRUST_PROXY=true`。

## 源码运行

需要 Node.js 22 或更高版本，以及 pnpm 10：

```bash
git clone https://github.com/YumengOvO/Moe-Counter-Nya.git
cd Moe-Counter-Nya
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# 编辑 .env，替换管理员配置
pnpm start
```

Windows PowerShell 中复制配置文件：

```powershell
Copy-Item .env.example .env
```

开发环境可使用：

```dotenv
NODE_ENV=development
APP_SITE=http://localhost:3000
SESSION_COOKIE_SECURE=false
TRUST_PROXY=false
```

## 项目结构

```text
Moe-Counter-Nya/
├─ assets/                 # 公共样式、脚本、图片与主题素材
├─ config/admin.js         # 管理员和 Session 环境配置
├─ data/                   # SQLite 计数与 Session 数据
├─ db/                     # SQLite/MongoDB 数据适配器
├─ routes/admin.js         # 登录、退出和计数器管理路由
├─ services/counter.js     # 计数、缓存与一致性服务
├─ services/session-store.js
├─ test/                   # 自动化测试
├─ views/                  # Pug 页面
├─ docker-compose.yml
├─ Dockerfile
└─ index.js                # Express 应用装配与公开路由
```

## 开发与测试

安装依赖：

```bash
corepack pnpm install --frozen-lockfile
```

运行完整测试：

```bash
corepack pnpm test
```

检查生产依赖：

```bash
corepack pnpm audit --prod
```

当前测试覆盖：

- 管理员配置、登录、退出、Session 过期和登录限流；
- CSRF 与未授权管理操作；
- Name 校验、大小写、重复创建和历史 Name；
- SVG、JSON、404 与临时数字预览；
- 并发递增、缓存刷新、修改、清零和删除一致性；
- SQLite 真实适配器与 MongoDB 契约；
- Docker、Compose 和生产部署配置。

## 从旧版本升级

1. 停止旧实例。
2. 备份 `data/count.db` 或 MongoDB。
3. 拉取新代码或新镜像。
4. 配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和独立的 `SESSION_SECRET`。
5. 检查 `APP_SITE`、HTTPS、Secure Cookie、可信代理和持久化目录。
6. 启动后验证 `/heart-beat`、`/admin/login` 和一个已有计数器。

SQLite 不需要额外的计数表迁移。已有 Name 会继续有效，即使它不符合新的创建规则。

需要特别注意：旧版本中首次访问可以自动创建计数器；本分支要求管理员显式创建，未知 Name 会返回 HTTP 404。

## 上游与许可

原始项目作者：[journey-ad](https://github.com/journey-ad)。

Copyright (c) 2020 journey-ad。

本项目的软件代码依据仓库中的 [MIT License](./LICENSE) 授权。MIT License 的核心许可条件是：在软件副本或实质性部分中保留原版权声明和许可声明；软件按“原样”提供，不附带任何形式的保证，作者或版权持有人不对使用软件产生的索赔、损害或其他责任负责。完整条款以 [LICENSE](./LICENSE) 文件为准。

> **重要：MIT License 不包括 `assets/theme/` 下的全部主题素材。使用、复制或分发主题前，请自行确认对应素材的来源和授权条件。**
