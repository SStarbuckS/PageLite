# 构建阶段
FROM --platform=$BUILDPLATFORM golang:1.25.3-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY main.go ./

# 安装时区数据和 CA 证书
RUN apk --no-cache add tzdata ca-certificates

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -ldflags="-w -s" -o pagelite-server main.go

# 运行阶段
FROM scratch

# 从 builder 复制时区数据和 CA 证书
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

WORKDIR /app
COPY --from=builder /app/pagelite-server .

EXPOSE 8080
CMD ["./pagelite-server"]