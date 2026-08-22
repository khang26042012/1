#!/bin/bash
# ============================================================
# 3proxy Home Router Setup Script
# Biến laptop cũ thành HTTP/SOCKS5 proxy server cho 9router
# Chạy trên: Ubuntu/Debian terminal-only, RAM 2GB OK
# ============================================================

set -e

PROXY_PORT_HTTP=3128
PROXY_PORT_SOCKS=1080
BIND_IP="0.0.0.0"

echo "=== Cài đặt 3proxy trên Linux (Terminal Only) ==="

# 1. Install 3proxy
if ! command -v 3proxy &> /dev/null; then
    echo "[1/4] Đang cài 3proxy..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq 3proxy || {
        echo "3proxy không có trong repo, build từ source..."
        cd /tmp
        git clone --depth 1 https://github.com/z3APA3A/3proxy.git
        cd 3proxy
        make -f Makefile.Linux
        sudo cp bin/3proxy /usr/local/bin/
        cd -
    }
else
    echo "[1/4] 3proxy đã cài sẵn."
fi

# 2. Tạo config
CONFIG_FILE="/etc/3proxy/3proxy.cfg"
echo "[2/4] Tạo config tại $CONFIG_FILE ..."
sudo mkdir -p /etc/3proxy
sudo tee "$CONFIG_FILE" > /dev/null << 'CFGEOF'
# 3proxy config - Home VN Proxy for 9router
nserver 8.8.8.8
nserver 1.1.1.1
nscache 65536

# Auth: không cần user/pass (chỉ dùng trong mạng nhà)
auth none

# Logging
log /var/log/3proxy.log D
rotate 3

# HTTP Proxy
proxy -p3128 -i0.0.0.0

# SOCKS5 Proxy
socks -p1080 -i0.0.0.0

# Giới hạn băng thông per-connection (512KB/s = đủ API calls)
bandlimin 524288
bandlimout 524288
CFGEOF

# 3. Tạo systemd service
echo "[3/4] Tạo systemd service..."
sudo tee /etc/systemd/system/3proxy.service > /dev/null << 'SVCEOF'
[Unit]
Description=3proxy Lightweight Proxy Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/3proxy /etc/3proxy/3proxy.cfg
Restart=always
RestartSec=5
MemoryMax=256M

[Install]
WantedBy=multi-user.target
SVCEOF

# Fix binary path if installed from apt
if [ -f /usr/bin/3proxy ] && [ ! -f /usr/local/bin/3proxy ]; then
    sudo sed -i 's|/usr/local/bin/3proxy|/usr/bin/3proxy|' /etc/systemd/system/3proxy.service
fi

# 4. Start service
echo "[4/4] Khởi động 3proxy..."
sudo systemctl daemon-reload
sudo systemctl enable 3proxy
sudo systemctl restart 3proxy

sleep 1
if systemctl is-active --quiet 3proxy; then
    MY_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "============================================"
    echo "  ✅ 3proxy ĐÃ CHẠY THÀNH CÔNG!"
    echo "============================================"
    echo "  HTTP Proxy:  http://${MY_IP}:${PROXY_PORT_HTTP}"
    echo "  SOCKS5:      socks5://${MY_IP}:${PROXY_PORT_SOCKS}"
    echo ""
    echo "  Thêm vào 9router proxy list:"
    echo "    ${MY_IP}:${PROXY_PORT_HTTP}"
    echo ""
    echo "  Kiểm tra: curl -x http://${MY_IP}:${PROXY_PORT_HTTP} http://httpbin.org/ip"
    echo "  Log:      sudo tail -f /var/log/3proxy.log"
    echo "  Stop:     sudo systemctl stop 3proxy"
    echo "============================================"
else
    echo "❌ Lỗi khởi động! Xem log:"
    sudo journalctl -u 3proxy --no-pager -n 20
    exit 1
fi

