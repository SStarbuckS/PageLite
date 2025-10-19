# 构建阶段
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# 复制 go.mod
COPY go.mod ./

# 下载依赖（如果有的话）
RUN go mod download

# 复制源代码
COPY main.go ./

# 编译多平台二进制
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -ldflags="-w -s" -o pagelite-server main.go

# 运行阶段
FROM alpine:latest

# 安装必要工具和时区数据
RUN apk --no-cache add ca-certificates tzdata

# 设置时区为上海
ENV TZ=Asia/Shanghai

WORKDIR /app

# 从构建阶段复制可执行文件
COPY --from=builder /app/pagelite-server .

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 8080

# 设置环境变量默认值
ENV USER=admin
ENV PASS=admin

# 运行
CMD ["./pagelite-server"] 