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

  // 将资源的相对路径转换为绝对路径
  const resourceSelectors = [
    'img[src]',
    'video[src]',
    'audio[src]',
    'source[src]',
    'video[poster]',
    'iframe[src]'
  ];
  docClone.querySelectorAll(resourceSelectors.join(',')).forEach((el) => {
    // 处理 src 属性
    const src = el.getAttribute('src');
    if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
      try {
        el.setAttribute('src', new URL(src, document.baseURI).href);
      } catch (e) {
        // 忽略无效 URL
      }
    }
    // 处理 poster 属性（视频封面）
    const poster = el.getAttribute('poster');
    if (poster && !poster.startsWith('data:') && !poster.startsWith('blob:')) {
      try {
        el.setAttribute('poster', new URL(poster, document.baseURI).href);
      } catch (e) {
        // 忽略无效 URL
      }
    }
  });

  // 处理 srcset 属性（响应式图片）
  docClone.querySelectorAll('[srcset]').forEach((el) => {
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const newSrcset = srcset.split(',').map((part) => {
        const [url, descriptor] = part.trim().split(/\s+/);
        if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
          try {
            const absoluteUrl = new URL(url, document.baseURI).href;
            return descriptor ? `${absoluteUrl} ${descriptor}` : absoluteUrl;
          } catch (e) {
            return part;
          }
        }
        return part;
      }).join(', ');
      el.setAttribute('srcset', newSrcset);
    }
  });

  // 在 <body> 顶部插入可见的 URL 信息栏
  const bodyEl = docClone.querySelector('body');
  if (bodyEl) {
    const urlBar = docClone.createElement('div');
    urlBar.setAttribute('data-pagelite-url-bar', 'true');
    const saveTime = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    urlBar.innerHTML = `
      <style>
        [data-pagelite-url-bar] {
          background: #f5f5f5;
          border-bottom: 1px solid #e0e0e0;
          padding: 8px 12px;
          font-size: 12px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #666;
          line-height: 1.6;
        }
        [data-pagelite-url-bar] a {
          color: #1a73e8;
          text-decoration: none;
          word-break: break-all;
        }
        [data-pagelite-url-bar] a:hover {
          text-decoration: underline;
        }
        [data-pagelite-url-bar] .pagelite-row {
          display: block;
        }
        [data-pagelite-url-bar] .pagelite-label {
          color: #999;
        }
      </style>
      <span class="pagelite-row"><span class="pagelite-label">原始网页：</span><a href="${document.URL}" target="_blank" rel="noopener noreferrer">${document.URL}</a></span>
      <span class="pagelite-row"><span class="pagelite-label">保存时间：</span>${saveTime}</span>
    `;
    bodyEl.prepend(urlBar);
  }

  const serializedHtml = docClone.documentElement.outerHTML;
  const doctypeString = originalDoctype
    ? `<!DOCTYPE ${originalDoctype.name}${originalDoctype.publicId ? ` PUBLIC "${originalDoctype.publicId}"` : ''
    }${originalDoctype.systemId
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

    const pageTitle = result.title ? result.title.trim() : 'page';
    const fileName = `${sanitizeFilename(pageTitle)}.html`;

    // 使用 <a> 标签下载，确保文件名正确
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // 延迟清理 Blob URL
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    showStatus('✅ 已保存到本地', 'success');
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

    const pageTitle = result.title ? result.title.trim() : 'page';
    const fileName = `${sanitizeFilename(pageTitle)}.html`;

    // 创建 FormData
    const formData = new FormData();
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
    formData.append('file', blob, fileName);

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