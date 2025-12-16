
const ALARM_NAME = 'monitor_check';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

console.log("[Web Monitor] 后台服务初始化中...");

// 1. Initialize Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("[Web Monitor] ⏰ 自动定时检查触发");
    await checkAllTasks();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Web Monitor] ✅ 插件已安装，系统就绪。");
  
  // Load interval from storage or default to 60
  // Handle '0' specifically to allow disabling
  const data = await chrome.storage.local.get('checkInterval');
  const interval = data.checkInterval !== undefined ? parseInt(data.checkInterval) : 60;
  
  if (interval > 0) {
    console.log(`[Web Monitor] 设置初始检查频率: ${interval} 分钟`);
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
  } else {
    console.log(`[Web Monitor] 初始检查频率为 0 (关闭)`);
  }
  
  // Initial check
  await checkAllTasks();
});

// Watch for interval changes
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.checkInterval) {
    const newVal = changes.checkInterval.newValue;
    const newInterval = (newVal !== undefined) ? parseInt(newVal) : 60;
    
    console.log(`[Web Monitor] ⏱️ 更新检查频率: ${newInterval} 分钟`);
    
    // Reset alarm
    await chrome.alarms.clear(ALARM_NAME);
    
    if (newInterval > 0) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: newInterval });
    } else {
      console.log(`[Web Monitor] 自动检查已关闭`);
    }
  }
});

// 2. Offscreen Document Management (For Static Sites)
let creatingOffscreen; 

async function setupOffscreenDocument(path) {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(path)]
    });
    if (contexts.length > 0) return;
  } else {
    const clients = await self.clients.matchAll();
    if (clients.some(c => c.url === chrome.runtime.getURL(path))) return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER', 'BLOBS'],
      justification: 'Scrape and parse HTML content',
    });
    
    try {
      await creatingOffscreen;
    } catch (err) {
      if (!err.message.startsWith('Only a single offscreen')) {
         console.warn("[Web Monitor] Offscreen 创建警告:", err);
      }
    } finally {
      creatingOffscreen = null;
    }
  }
}

async function sendMessageToOffscreen(message) {
  await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ text: '', html: '', error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// 3. Dynamic Scraping Logic (For JS Sites)
async function scrapeDynamicContent(url, selector) {
  console.log(`[Web Monitor] 🚀 启动动态渲染抓取: ${url}`);
  
  let windowId = null;

  try {
    const win = await chrome.windows.create({
      url: url,
      state: 'minimized',
      focused: false,
      type: 'popup'
    });
    windowId = win.id;

    const tabId = win.tabs[0].id;
    await new Promise((resolve, reject) => {
      const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 2000); 
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); 
      }, 15000);
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { text: '', html: '', href: undefined, title: document.title };
        
        // --- Same HTML Processing Logic as Offscreen (Simplified for content script) ---
        const base = new URL(document.location.href);

        el.querySelectorAll('a').forEach(a => { a.target = "_blank"; a.href = a.href; }); // .href access resolves absolute
        el.querySelectorAll('img').forEach(img => { img.src = img.src; img.style.maxWidth = '100%'; });
        el.querySelectorAll('script, style, iframe, button').forEach(n => n.remove());
        
        // Remove event handlers
        el.querySelectorAll('*').forEach(e => {
            const attrs = e.attributes;
            for (let i = attrs.length - 1; i >= 0; i--) {
                if (attrs[i].name.startsWith('on')) e.removeAttribute(attrs[i].name);
            }
        });

        let text = el.innerText || el.textContent || '';
        let html = el.innerHTML.trim(); // Capture HTML
        
        let href = undefined;
        if (el.tagName === 'A') href = el.href;
        else if (el.querySelector('a')) href = el.querySelector('a').href;

        return {
          text: text.trim(),
          html: html,
          href: href,
          title: document.title
        };
      },
      args: [selector]
    });

    if (windowId) await chrome.windows.remove(windowId);
    
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    return { text: '', html: '', error: 'Script injection failed' };

  } catch (err) {
    if (windowId) try { await chrome.windows.remove(windowId); } catch(e){}
    console.error("[Web Monitor] Dynamic scrape failed:", err);
    return { text: '', html: '', error: err.message };
  }
}


// 4. Core Logic
async function checkAllTasks() {
  await chrome.storage.local.set({ isChecking: true });
  
  try {
    const data = await chrome.storage.local.get(['tasks']); // Don't get 'announcements', we will clear it
    const tasks = data.tasks || [];
    let announcements = []; // Clear history: Start with fresh array
    let hasNewUpdates = false;

    if (tasks.length === 0) {
      console.log("[Web Monitor] ℹ️ 任务列表为空，等待用户添加。");
      await chrome.storage.local.set({ isChecking: false });
      return;
    }

    console.log(`[Web Monitor] 🔍 正在检查 ${tasks.length} 个任务...`);

    const updatedTasks = await Promise.all(tasks.map(async (task) => {
      try {
        console.log(`[Web Monitor] 尝试抓取: ${task.url}`);
        
        // Strategy 1: Static
        let result = await sendMessageToOffscreen({
          type: 'SCRAPE_URL',
          payload: { url: task.url, selector: task.selector }
        });

        // Strategy 2: Dynamic
        if (!result.html) { // Check HTML emptiness
           console.log(`[Web Monitor] ⚠️ 静态抓取为空，尝试动态渲染模式... (${task.name})`);
           const dynamicResult = await scrapeDynamicContent(task.url, task.selector);
           if (dynamicResult.html) {
             result = dynamicResult;
           } else if (dynamicResult.error) {
               throw new Error(dynamicResult.error);
           }
        }

        if (!result.html || result.html.length === 0) {
            throw new Error("未找到匹配内容 (HTML Empty)");
        }

        // Use text content for hash generation to detect meaningful changes, 
        // but store HTML for display.
        const contentHash = await generateHash(result.text || result.html);
        
        // 始终推送到“最新动态”列表 (Requested feature)
        // Store HTML content in the 'title' field (or we could add a content field, but reusing title is easier for now)
        // NOTE: We limit HTML length to 2000 chars to avoid storage quota issues, though local storage is 5MB.
        const displayContent = result.html; 
        
        announcements.unshift({
          id: generateId(),
          taskId: task.id,
          taskName: task.name,
          title: displayContent, // We are storing HTML here now
          link: result.href || task.url,
          foundAt: Date.now(),
          isRead: false,
          isHtml: true // Flag to tell UI to render as HTML
        });
        hasNewUpdates = true;

        return {
          ...task,
          lastChecked: Date.now(),
          lastContentHash: contentHash, 
          lastResult: result.text.substring(0, 50) + "...", 
          status: 'active',
          errorMessage: undefined
        };
      } catch (e) {
        console.error(`[Web Monitor] ❌ 任务错误 ${task.name}:`, e.message);
        return {
          ...task,
          lastChecked: Date.now(),
          status: 'error',
          errorMessage: e.message
        };
      }
    }));

    // Keep last 50
    if (announcements.length > 50) {
      announcements = announcements.slice(0, 50);
    }

    await chrome.storage.local.set({ tasks: updatedTasks, announcements, isChecking: false });
    
    if (hasNewUpdates) {
      chrome.action.setBadgeText({ text: 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    } else {
      // Clear badge if we cleared history and found nothing new (though logically logic above adds everything)
      chrome.action.setBadgeText({ text: '' }); 
    }

  } catch (err) {
    console.error('[Web Monitor] 全局检查失败', err);
    await chrome.storage.local.set({ isChecking: false });
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function generateHash(str) {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'TRIGGER_CHECK') {
    checkAllTasks().then(() => sendResponse({ status: 'done' }));
    return true; 
  }
  
  if (msg.action === 'TEST_SCRAPE') {
    console.log("[Web Monitor] 🧪 测试抓取:", msg.payload.url);
    (async () => {
      let result = await sendMessageToOffscreen({
        type: 'SCRAPE_URL',
        payload: msg.payload
      });
      if (!result.html) {
        const dynamicResult = await scrapeDynamicContent(msg.payload.url, msg.payload.selector);
        if (dynamicResult.html || dynamicResult.error) {
           result = dynamicResult;
        }
      }
      // For test preview, we prefer text, but return HTML too
      sendResponse({ ...result, text: result.text || "Found content but no text" }); 
    })();
    return true; 
  }
});
