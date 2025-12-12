package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	dataDir     = "./data"
	maxFileSize = 50 * 1024 * 1024 // 50MB
)

var (
	username string
	password string
)

type UploadResponse struct {
	Success  bool   `json:"success"`
	Filename string `json:"filename"`
	Message  string `json:"message"`
}

func main() {
	// 从环境变量读取认证信息
	username = os.Getenv("USER")
	password = os.Getenv("PASS")

	if username == "" {
		username = "admin"
	}
	if password == "" {
		password = "admin"
	}

	// 确保数据目录存在
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("创建数据目录失败: %v", err)
	}

	// 注册路由
	http.HandleFunc("/upload", basicAuth(handleUpload))
	http.HandleFunc("/", handleIndex)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 PageLite 服务器启动")
	log.Printf("📡 监听端口: %s", port)
	log.Printf("👤 用户名: %s", username)
	log.Printf("🔐 密码: %s", strings.Repeat("*", len(password)))
	log.Printf("📁 存储目录: %s", dataDir)
	log.Println("✅ 准备就绪")

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("启动服务器失败: %v", err)
	}
}

// Basic Auth 中间件
func basicAuth(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 如果没有配置认证，直接通过
		if username == "" || password == "" {
			handler(w, r)
			return
		}

		auth := r.Header.Get("Authorization")
		if auth == "" {
			w.Header().Set("WWW-Authenticate", `Basic realm="PageLite"`)
			http.Error(w, "未授权", http.StatusUnauthorized)
			return
		}

		const prefix = "Basic "
		if !strings.HasPrefix(auth, prefix) {
			http.Error(w, "无效的认证格式", http.StatusUnauthorized)
			return
		}

		decoded, err := base64.StdEncoding.DecodeString(auth[len(prefix):])
		if err != nil {
			http.Error(w, "无效的认证信息", http.StatusUnauthorized)
			return
		}

		credentials := strings.SplitN(string(decoded), ":", 2)
		if len(credentials) != 2 || credentials[0] != username || credentials[1] != password {
			http.Error(w, "用户名或密码错误", http.StatusUnauthorized)
			return
		}

		handler(w, r)
	}
}

// 处理文件上传
func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "仅支持 POST 请求", http.StatusMethodNotAllowed)
		return
	}

	// 限制请求大小
	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize)

	// 解析 multipart form
	if err := r.ParseMultipartForm(maxFileSize); err != nil {
		log.Printf("解析表单失败: %v", err)
		respondJSON(w, http.StatusBadRequest, UploadResponse{
			Success: false,
			Message: "解析表单失败: " + err.Error(),
		})
		return
	}

	// 获取文件
	file, header, err := r.FormFile("file")
	if err != nil {
		log.Printf("获取文件失败: %v", err)
		respondJSON(w, http.StatusBadRequest, UploadResponse{
			Success: false,
			Message: "获取文件失败: " + err.Error(),
		})
		return
	}
	defer file.Close()

	// 获取额外字段
	title := r.FormValue("title")
	url := r.FormValue("url")
	timestamp := r.FormValue("timestamp")

	// 记录日志
	log.Printf("📥 接收上传: %s | 标题: %s | URL: %s | 时间: %s",
		header.Filename, title, url, timestamp)

	// 从时间戳中提取年份（格式: YYYY-MM-DD_HH-mm）
	year := time.Now().Format("2006")
	if timestamp != "" && len(timestamp) >= 4 {
		year = timestamp[:4]
	}

	// 创建年份目录
	yearDir := filepath.Join(dataDir, year)
	if err := os.MkdirAll(yearDir, 0755); err != nil {
		log.Printf("创建年份目录失败: %v", err)
		respondJSON(w, http.StatusInternalServerError, UploadResponse{
			Success: false,
			Message: "创建年份目录失败: " + err.Error(),
		})
		return
	}

	// 保存文件到年份目录
	destPath := filepath.Join(yearDir, header.Filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		log.Printf("创建文件失败: %v", err)
		respondJSON(w, http.StatusInternalServerError, UploadResponse{
			Success: false,
			Message: "创建文件失败: " + err.Error(),
		})
		return
	}
	defer destFile.Close()

	// 复制文件内容
	written, err := io.Copy(destFile, file)
	if err != nil {
		log.Printf("保存文件失败: %v", err)
		respondJSON(w, http.StatusInternalServerError, UploadResponse{
			Success: false,
			Message: "保存文件失败: " + err.Error(),
		})
		return
	}

	log.Printf("✅ 保存成功: %s (%.2f KB)", header.Filename, float64(written)/1024)

	respondJSON(w, http.StatusOK, UploadResponse{
		Success:  true,
		Filename: header.Filename,
		Message:  "上传成功",
	})
}

// 处理索引页请求
func handleIndex(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// 目录路径（以斜杠结尾）：显示目录列表
	if len(path) == 0 || path[len(path)-1] == '/' {
		// 根路径
		if path == "/" {
			if err := generateDirIndex(w, "", "/"); err != nil {
				http.Error(w, "生成索引页失败", http.StatusInternalServerError)
				return
			}
			return
		}

		// ALL 路径：显示所有文件
		if path == "/all/" || path == "/ALL/" {
			if err := generateAllFilesIndex(w); err != nil {
				http.Error(w, "生成索引页失败", http.StatusInternalServerError)
				return
			}
			return
		}

		// 子目录路径
		subPath := strings.Trim(path, "/")
		dirPath := filepath.Join(dataDir, subPath)
		if info, err := os.Stat(dirPath); err == nil && info.IsDir() {
			if err := generateDirIndex(w, subPath, path); err != nil {
				http.Error(w, "生成索引页失败", http.StatusInternalServerError)
				return
			}
			return
		}
	}

	// 文件路径（不以斜杠结尾）：直接提供文件
	if len(path) > 1 && path[len(path)-1] != '/' {
		filePath := filepath.Join(dataDir, strings.TrimPrefix(path, "/"))

		// 检查文件是否存在
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}
	}

	http.NotFound(w, r)
}

// 生成所有文件的汇总索引页
func generateAllFilesIndex(w http.ResponseWriter) error {
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return fmt.Errorf("读取目录失败: %w", err)
	}

	type FileEntry struct {
		Name    string
		Year    string
		Size    string
		ModTime time.Time
	}

	var allFiles []FileEntry

	// 扫描所有年份目录
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		yearPath := filepath.Join(dataDir, entry.Name())
		yearFiles, err := os.ReadDir(yearPath)
		if err != nil {
			continue
		}

		for _, file := range yearFiles {
			if file.IsDir() {
				continue
			}

			info, err := file.Info()
			if err != nil {
				continue
			}

			allFiles = append(allFiles, FileEntry{
				Name:    file.Name(),
				Year:    entry.Name(),
				Size:    formatSize(info.Size()),
				ModTime: info.ModTime(),
			})
		}
	}

	// 按修改时间倒序排列
	sort.Slice(allFiles, func(i, j int) bool {
		return allFiles[i].ModTime.After(allFiles[j].ModTime)
	})

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	tmpl := template.Must(template.New("allFiles").Parse(allFilesTemplate))
	data := map[string]interface{}{
		"Files":     allFiles,
		"Count":     len(allFiles),
		"Generated": time.Now().Format("2006-01-02 15:04:05"),
	}

	return tmpl.Execute(w, data)
}

// 生成目录索引页（nginx 风格）
func generateDirIndex(w http.ResponseWriter, subPath string, urlPath string) error {
	dirPath := dataDir
	if subPath != "" {
		dirPath = filepath.Join(dataDir, subPath)
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return fmt.Errorf("读取目录失败: %w", err)
	}

	type Entry struct {
		Name    string
		IsDir   bool
		Size    string
		ModTime time.Time
	}

	var items []Entry

	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		size := "-"
		if !entry.IsDir() {
			size = formatSize(info.Size())
		}

		items = append(items, Entry{
			Name:    entry.Name(),
			IsDir:   entry.IsDir(),
			Size:    size,
			ModTime: info.ModTime(),
		})
	}

	// 排序：目录在前（按名称），文件在后（按修改时间倒序）
	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir // 目录优先
		}
		if items[i].IsDir {
			return items[i].Name < items[j].Name // 目录按名称升序
		}
		return items[i].ModTime.After(items[j].ModTime) // 文件按时间倒序
	})

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	tmpl := template.Must(template.New("dirIndex").Parse(dirIndexTemplate))
	data := map[string]interface{}{
		"Path":      urlPath,
		"Items":     items,
		"Count":     len(items),
		"Generated": time.Now().Format("2006-01-02 15:04:05"),
	}

	return tmpl.Execute(w, data)
}

// 格式化文件大小
func formatSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

// 响应 JSON
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// 目录索引模板（nginx 风格）
const dirIndexTemplate = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of {{.Path}}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: white;
      color: #333;
      margin: 0;
      padding: 16px;
      font-size: 16px;
      line-height: 1.5;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      border-bottom: 2px solid #eaeaea;
      padding-bottom: 12px;
      margin: 0 0 20px 0;
      word-break: break-all;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      border-spacing: 0;
    }
    th {
      text-align: left;
      padding: 12px 0;
      border-bottom: 2px solid #eaeaea;
      font-weight: 600;
      color: #666;
    }
    td {
      padding: 12px 8px 12px 0;
      font-size: 16px;
      border-bottom: 1px solid #f0f0f0;
    }
    td.size {
      text-align: right;
      white-space: nowrap;
      font-size: 14px;
      color: #888;
      padding-right: 0;
    }
    a {
      color: #0366d6;
      text-decoration: none;
      font-size: 16px;
      display: inline-block;
      padding: 4px 0;
    }
    a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 20px;
      font-size: 12px;
      color: #666;
    }
    .empty {
      font-style: italic;
      padding: 10px 0;
    }
    .back {
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
{{if ne .Path "/"}}<div class="back"><a href="/">⬆️ Parent Directory</a></div>{{end}}
<h1>Index of {{.Path}}</h1>
<table>
<tr><th>Name</th><th style="text-align: right;">Size</th></tr>
{{if eq .Path "/"}}<tr><td>📄 <a href="/all/">ALL</a></td><td class="size">-</td></tr>{{end}}
{{if .Items}}{{range .Items}}<tr>
<td>{{if .IsDir}}📁 <a href="{{.Name}}/">{{.Name}}/</a>{{else}}<a href="{{.Name}}" target="_blank">{{.Name}}</a>{{end}}</td>
<td class="size">{{.Size}}</td>
</tr>
{{end}}{{else}}{{if ne .Path "/"}}<tr><td colspan="2" class="empty">Directory is empty</td></tr>{{end}}
{{end}}</table>
<div class="footer">PageLite Archive Server | {{.Count}} items | Generated: {{.Generated}}</div>
</body>
</html>
`

// 所有文件汇总页面模板
const allFilesTemplate = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>All Files</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: white;
      color: #333;
      margin: 0;
      padding: 16px;
      font-size: 16px;
      line-height: 1.5;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      border-bottom: 2px solid #eaeaea;
      padding-bottom: 12px;
      margin: 0 0 20px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      border-spacing: 0;
    }
    th {
      text-align: left;
      padding: 12px 0;
      border-bottom: 2px solid #eaeaea;
      font-weight: 600;
      color: #666;
    }
    td {
      padding: 12px 8px 12px 0;
      font-size: 16px;
      border-bottom: 1px solid #f0f0f0;
    }
    td.size {
      text-align: right;
      white-space: nowrap;
      font-size: 14px;
      color: #888;
      padding-right: 0;
    }
    a {
      color: #0366d6;
      text-decoration: none;
      font-size: 16px;
      display: inline-block;
      padding: 4px 0;
    }
    a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 20px;
      font-size: 12px;
      color: #666;
    }
    .back {
      margin-bottom: 10px;
    }
    .year {
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
<div class="back"><a href="/">⬆️ Parent Directory</a></div>
<h1>All Files</h1>
<table>
<tr><th>Name</th><th>Year</th><th style="text-align: right;">Size</th></tr>
{{if .Files}}{{range .Files}}<tr>
<td><a href="/{{.Year}}/{{.Name}}" target="_blank">{{.Name}}</a></td>
<td class="year">{{.Year}}</td>
<td class="size">{{.Size}}</td>
</tr>
{{end}}{{else}}<tr><td colspan="3" class="empty">No files yet</td></tr>
{{end}}</table>
<div class="footer">PageLite Archive Server | {{.Count}} files | Generated: {{.Generated}}</div>
</body>
</html>
`
