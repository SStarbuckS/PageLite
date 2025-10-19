'use strict';

const btnSave = document.getElementById('btnSave');
const btnUpload = document.getElementById('btnUpload');
const btnSettings = document.getElementById('btnSettings');
const statusDiv = document.getElementById('status');

// 显示状态消息
function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}

// 获取当前标签页
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 在页面上下文中捕获HTML内容
async function capturePageContent() {
  const originalDoctype = document.doctype;
  const docClone = document.cloneNode(true);

  // 移除所有 <script> 标签
  docClone.querySelectorAll('script').forEach((node) => node.remove());
  docClone.querySelectorAll('noscript').forEach((node) => node.remove());

  // 内联样式表
  const stylesheetLinks = Array.from(
    docClone.querySelectorAll('link[rel~="stylesheet"][href]')
  );

  for (const linkEl of stylesheetLinks) {
    const href = linkEl.getAttribute('href');
    if (!href) {
      linkEl.remove();
      continue;
    }

    try {
      const absoluteUrl = new URL(href, document.baseURI).href;
      const response = await fetch(absoluteUrl, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const cssText = await response.text();
      const styleEl = docClone.createElement('style');
      styleEl.setAttribute('data-pagelite-source', absoluteUrl);
      styleEl.textContent = cssText;
      linkEl.replaceWith(styleEl);
    } catch (fetchError) {
      linkEl.remove();
      console.warn('PageLite：无法内联样式表', href, fetchError);
    }
  }

  // 确保 UTF-8 编码
  const headEl = docClone.querySelector('head');
  if (headEl && !headEl.querySelector('meta[charset]')) {
    const metaCharset = docClone.createElement('meta');
    metaCharset.setAttribute('charset', 'UTF-8');
    headEl.prepend(metaCharset);
  }

  // 添加生成器注释
  if (headEl) {
    const comment = docClone.createComment(
      ' 由 PageLite 保存 - 轻量网页存档工具 '
    );
    headEl.insertBefore(comment, headEl.firstChild);
  }

  const serializedHtml = docClone.documentElement.outerHTML;
  const doctypeString = originalDoctype
    ? `<!DOCTYPE ${originalDoctype.name}${
        originalDoctype.publicId ? ` PUBLIC "${originalDoctype.publicId}"` : ''
      }${
        originalDoctype.systemId
          ? `${originalDoctype.publicId ? '' : ' SYSTEM'} "${originalDoctype.systemId}"`
          : ''
      }>`
    : '<!DOCTYPE html>';

  const htmlOutput = `${doctypeString}\n${serializedHtml}`;

  return {
    html: htmlOutput,
    title: document.title || 'page',
    url: document.URL
  };
}

// 格式化时间戳
function formatTimestamp(date) {
  const pad = (value) => value.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}_${hours}-${minutes}`;
}

// 清理文件名
function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120) || 'page';
}

// 保存到本地
btnSave.addEventListener('click', async () => {
  try {
    btnSave.disabled = true;
    showStatus('正在捕获页面...', 'info');

    const tab = await getCurrentTab();
    if (!tab.id) {
      throw new Error('无法获取当前标签页');
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePageContent
    });

    if (!result || !result.html) {
      throw new Error('捕获脚本未返回内容');
    }

    const timestamp = formatTimestamp(new Date());
    const pageTitle = result.title ? result.title.trim() : 'page';
    const fileName = `${sanitizeFilename(pageTitle)}_${timestamp}.html`;

    // 通过 background.js 下载文件以确保文件名正确
    const response = await chrome.runtime.sendMessage({
      action: 'downloadPage',
      html: result.html,
      filename: fileName
    });

    if (response && response.success) {
      showStatus('✅ 已保存到本地', 'success');
    } else {
      throw new Error(response?.error || '下载失败');
    }
  } catch (error) {
    console.error('保存失败:', error);
    showStatus('❌ 保存失败: ' + error.message, 'error');
  } finally {
    btnSave.disabled = false;
  }
});

// 上传到云端
btnUpload.addEventListener('click', async () => {
  try {
    btnUpload.disabled = true;
    showStatus('正在捕获页面...', 'info');

    const tab = await getCurrentTab();
    if (!tab.id) {
      throw new Error('无法获取当前标签页');
    }

    // 获取云端配置
    const config = await chrome.storage.sync.get(['serverUrl', 'username', 'password']);
    
    if (!config.serverUrl) {
      showStatus('❌ 请先在设置中配置服务器地址', 'error');
      btnUpload.disabled = false;
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePageContent
    });

    if (!result || !result.html) {
      throw new Error('捕获脚本未返回内容');
    }

    showStatus('正在上传到云端...', 'info');

    const timestamp = formatTimestamp(new Date());
    const pageTitle = result.title ? result.title.trim() : 'page';
    const fileName = `${sanitizeFilename(pageTitle)}_${timestamp}.html`;

    // 创建 FormData
    const formData = new FormData();
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
    formData.append('file', blob, fileName);
    formData.append('title', result.title || 'Untitled');
    formData.append('url', result.url || '');
    formData.append('timestamp', timestamp);

    // 准备请求头
    const headers = {};
    if (config.username && config.password) {
      const credentials = btoa(`${config.username}:${config.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(`${config.serverUrl}/upload`, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`上传失败 (${response.status}): ${errorText}`);
    }

    const responseData = await response.json();
    showStatus('✅ 已上传至云端', 'success');
    console.log('上传成功:', responseData);
  } catch (error) {
    console.error('上传失败:', error);
    showStatus('❌ 上传失败: ' + error.message, 'error');
  } finally {
    btnUpload.disabled = false;
  }
});

// 打开设置页面
btnSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
}); 