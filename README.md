# PageLite

轻量网页存档工具 - 一键保存网页为离线 HTML，支持本地存储和云端同步。

## 功能特性

- 保存完整网页（内联样式、绝对路径资源）
- 本地保存：离线随时查看
- 云端上传：私有服务器存储
- 自动按年份归档
- Web 界面浏览存档

## 快速开始

### 安装扩展

1. 打开 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择本项目根目录

### 启动服务器

**Docker（推荐）：**

```bash
cd server
docker-compose up -d
```

**手动编译：**

```bash
cd server
go build -o pagelite-server main.go

# 设置环境变量后运行
USER=admin PASS=yourpassword ./pagelite-server
```

### 配置扩展

点击扩展图标 → ⚙️ 设置：
- 服务器地址：`http://your-server:8080`
- 用户名 / 密码：与服务器环境变量一致

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `USER` | 认证用户名 | ✅ |
| `PASS` | 认证密码 | ✅ |
| `PORT` | 监听端口 | 默认 `8080` |
| `MAX_UPLOAD_MB` | 最大上传大小 (MB) | 默认 `50` |

## 命令行上传

```bash
curl -u admin:yourpassword -F "file=@yourfile" http://your-server:8080/upload
```

## 项目结构

```
PageLite/
├── manifest.json       # 扩展配置
├── popup.html/js       # 弹出界面
├── options.html/js     # 设置页面
└── server/
    ├── main.go         # 后端服务
    ├── Dockerfile
    └── docker-compose.yml
```
