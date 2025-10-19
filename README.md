# PageLite

轻量网页存档工具 - 保存网页为离线HTML，支持云端存储

## 功能

- 保存网页到本地（离线可用）
- 上传网页到私有服务器
- 按年份自动归档
- Web界面浏览所有存档

## 安装

### 1. 安装浏览器扩展

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目根目录

### 2. 启动服务器

```bash
cd server
go build -o pagelite-server.exe main.go   # Windows
go build -o pagelite-server main.go       # Linux/Mac

# 运行
.\pagelite-server.exe    # Windows
./pagelite-server        # Linux/Mac
```

或使用 Docker：

```bash
cd server
docker-compose up -d
```

## 使用

### 配置扩展

1. 点击扩展图标 → 设置
2. 填写服务器地址：`http://localhost:8080`
3. 填写用户名：`admin`，密码：`admin`
4. 保存设置

### 保存网页

- **本地保存**：点击扩展图标 → 保存到本地
- **云端上传**：点击扩展图标 → 上传到云端

### 查看存档

访问 `http://localhost:8080`：
- 首页显示年份目录和 ALL 入口
- 点击年份查看该年的文件
- 点击 ALL 查看所有文件

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `USER` | 用户名 | `admin` |
| `PASS` | 密码 | `admin` |

**Windows:**
```powershell
$env:USER="myuser"
$env:PASS="mypass"
.\pagelite-server.exe
```

**Linux/Mac:**
```bash
export USER=myuser
export PASS=mypass
./pagelite-server
```

## 项目结构

```
PageLite/
├── .gitignore
├── manifest.json          # 扩展配置
├── background.js          # 后台服务
├── popup.html             # 弹出界面
├── popup.js               # 弹出界面逻辑
├── options.html           # 设置页面
├── options.js             # 设置页面逻辑
├── README.md
└── server/                # 服务器后端
    ├── .dockerignore
    ├── main.go            # 主程序
    ├── go.mod             # Go模块
    ├── Dockerfile         # Docker镜像
    ├── docker-compose.yml # Docker配置
    └── data/              # 存档目录（上传自动创建）
```
