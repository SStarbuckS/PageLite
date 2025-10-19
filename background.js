'use strict';

// PageLite 后台服务工作线程（Manifest V3）
// 监听工具栏图标点击事件，捕获当前标签页的 HTML + CSS 并保存为可离线浏览的 HTML 文件。

/**
 * 入口：处理浏览器工具栏图标的点击。
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    console.warn('PageLite：无法处理缺少 ID 的标签页。');
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePageContent
    });

    if (!result || !result.html) {
      console.error('PageLite：捕获脚本未返回内容。');
      return;
    }

    const timestamp = formatTimestamp(new Date());
    const pageTitle = result.title ? result.title.trim() : 'page';
    const fileName = `${sanitizeFilename(pageTitle)}_${timestamp}.html`;

    nextSuggestedFilename = fileName;

    await chrome.downloads.download({
      url: `data:text/html;charset=utf-8,${encodeURIComponent(result.html)}`,
      filename: fileName,
      saveAs: false
    });

    console.info(`PageLite：已保存 ${fileName}`);
  } catch (error) {
    console.error('PageLite：保存页面失败。', error);
  }
});

/**
 * 缓存下一次下载的文件名，配合 onDeterminingFilename 进行强制命名。
 * @type {string|null}
 */
let nextSuggestedFilename = null;

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (downloadItem.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }

  if (!nextSuggestedFilename) {
    suggest();
    return;
  }

  suggest({
    filename: nextSuggestedFilename,
    conflictAction: 'uniquify'
  });

  nextSuggestedFilename = null;
});

/**
 * 处理来自 popup 的消息（用于下载文件）
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadPage') {
    handleDownloadFromPopup(request.html, request.filename)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('PageLite：下载失败', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开启以支持异步响应
  }
});

/**
 * 处理从 popup 发起的下载请求
 * @param {string} html - HTML 内容
 * @param {string} filename - 文件名
 */
async function handleDownloadFromPopup(html, filename) {
  nextSuggestedFilename = filename;

  await chrome.downloads.download({
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    filename: filename,
    saveAs: false
  });
}

/**
 * 将日期对象格式化为 YYYY-MM-DD_HH-mm。
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  const pad = (value) => value.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}_${hours}-${minutes}`;
}

/**
 * 将文件系统不允许的字符替换为下划线。
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120) || 'page';
}

/**
 * 在页面上下文中运行的函数，用于捕获 HTML + CSS。
 * 移除脚本并内联可访问的样式表，以确保离线时安全且结构完整。
 * @returns {{ html: string, title: string }}
 */
async function capturePageContent() {
  const originalDoctype = document.doctype;
  const docClone = document.cloneNode(true);

  // 移除所有 <script> 标签，避免离线时执行脚本。
  docClone.querySelectorAll('script').forEach((node) => node.remove());

  // 移除 noscript 标签，以减少重复内容。
  docClone.querySelectorAll('noscript').forEach((node) => node.remove());

  // 将样式表链接转换为内联样式，保证离线布局。
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
      // 无法获取样式表时（例如 CORS 或网络问题）直接移除，避免引用失效。
      linkEl.remove();
      console.warn('PageLite：无法内联样式表', href, fetchError);
    }
  }

  // 确保 <head> 顶部存在 UTF-8 编码声明。
  const headEl = docClone.querySelector('head');
  if (headEl && !headEl.querySelector('meta[charset]')) {
    const metaCharset = docClone.createElement('meta');
    metaCharset.setAttribute('charset', 'UTF-8');
    headEl.prepend(metaCharset);
  }

  // 添加生成器注释，便于追踪来源。
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
    title: document.title || 'page'
  };
} 