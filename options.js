'use strict';

const form = document.getElementById('settingsForm');
const btnTest = document.getElementById('btnTest');
const statusDiv = document.getElementById('status');

// 显示状态消息
function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 4000);
  }
}

// 加载已保存的设置
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get(['serverUrl', 'username', 'password']);
    
    if (settings.serverUrl) {
      document.getElementById('serverUrl').value = settings.serverUrl;
    }
    if (settings.username) {
      document.getElementById('username').value = settings.username;
    }
    if (settings.password) {
      document.getElementById('password').value = settings.password;
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

// 保存设置
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!serverUrl) {
    showStatus('❌ 请输入服务器地址', 'error');
    return;
  }

  // 验证URL格式
  try {
    new URL(serverUrl);
  } catch (error) {
    showStatus('❌ 服务器地址格式不正确', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({
      serverUrl: serverUrl.replace(/\/$/, ''), // 移除末尾斜杠
      username,
      password
    });

    showStatus('✅ 设置已保存', 'success');
  } catch (error) {
    console.error('保存设置失败:', error);
    showStatus('❌ 保存失败: ' + error.message, 'error');
  }
});

// 测试连接
btnTest.addEventListener('click', async () => {
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!serverUrl) {
    showStatus('❌ 请先输入服务器地址', 'error');
    return;
  }

  try {
    showStatus('🔍 正在测试连接...', 'info');
    statusDiv.style.display = 'block';

    const headers = {};
    if (username && password) {
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(`${serverUrl}/`, {
      method: 'GET',
      headers: headers
    });

    if (response.ok) {
      showStatus('✅ 连接成功！服务器响应正常', 'success');
    } else if (response.status === 401) {
      showStatus('❌ 认证失败，请检查用户名和密码', 'error');
    } else {
      showStatus(`❌ 服务器返回错误: ${response.status}`, 'error');
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    showStatus('❌ 连接失败: ' + error.message, 'error');
  }
});

// 页面加载时加载设置
document.addEventListener('DOMContentLoaded', loadSettings); 