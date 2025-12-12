
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
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  
  // Initial check
  await checkAllTasks();
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
        // If offscreen fails, we resolve with null text so we can try fallback
        resolve({ text: '', error: chrome.runtime.lastError.message });
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
    // Create a minimized window to load the page
    const win = await chrome.windows.create({
      url: url,
      state: 'minimized', // Minimize to be less intrusive
      focused: false,
      type: 'popup'
    });
    windowId = win.id;

    // Wait for the tab to complete loading
    const tabId = win.tabs[0].id;
    await new Promise((resolve, reject) => {
      const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          // Give an extra 2 seconds for JS frameworks (React/Vue) to hydrate DOM
          setTimeout(resolve, 2000); 
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout fallback in case onload hangs
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // Try scraping anyway after 15s
      }, 15000);
    });

    // Inject script to extract content
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { text: '', href: undefined, title: document.title };
        
        let href = undefined;
        if (el.tagName === 'A') href = el.href;
        else if (el.querySelector('a')) href = el.querySelector('a').href;

        return {
          text: (el.textContent || '').trim().replace(/\s+/g, ' '),
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
    return { text: '', error: 'Script injection failed' };

  } catch (err) {
    if (windowId) try { await chrome.windows.remove(windowId); } catch(e){}
    console.error("[Web Monitor] Dynamic scrape failed:", err);
    return { text: '', error: err.message };
  }
}


// 4. Core Logic
async function checkAllTasks() {
  await chrome.storage.local.set({ isChecking: true });
  
  try {
    const data = await chrome.storage.local.get(['tasks', 'announcements']);
    const tasks = data.tasks || [];
    let announcements = data.announcements || [];
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
        
        // Strategy 1: Try Fast Static Fetch (Offscreen) first
        let result = await sendMessageToOffscreen({
          type: 'SCRAPE_URL',
          payload: { url: task.url, selector: task.selector }
        });

        // Strategy 2: If Static failed (empty text), try Dynamic (Window)
        if (!result.text) {
           console.log(`[Web Monitor] ⚠️ 静态抓取为空，尝试动态渲染模式... (${task.name})`);
           const dynamicResult = await scrapeDynamicContent(task.url, task.selector);
           
           // If dynamic found something, use it
           if (dynamicResult.text) {
             result = dynamicResult;
             console.log(`[Web Monitor] ✅ 动态抓取成功!`);
           } else {
             // Both failed
             console.warn(`[Web Monitor] ❌ 动态抓取也未找到内容。可能选择器错误。`);
             result.pageTitle = dynamicResult.title || result.pageTitle;
           }
        }

        if (result.error && !result.text) throw new Error(result.error);

        const currentContent = result.text || '';
        const contentHash = await generateHash(currentContent);
        
        const isFirstRun = task.lastContentHash === '';
        const hasChanged = currentContent.length > 0 && task.lastContentHash !== contentHash;
        
        if (hasChanged) {
          if (!isFirstRun) {
            console.log(`[Web Monitor] 🎉 发现更新: ${task.name}`);
            announcements.unshift({
              id: generateId(),
              taskId: task.id,
              taskName: task.name,
              title: currentContent.substring(0, 100).replace(/\s+/g, ' '),
              link: result.href || task.url,
              foundAt: Date.now(),
              isRead: false,
            });
            hasNewUpdates = true;
          } else {
            console.log(`[Web Monitor] 🏁 基准已建立: ${task.name}`);
          }
        }

        return {
          ...task,
          lastChecked: Date.now(),
          lastContentHash: currentContent.length > 0 ? contentHash : task.lastContentHash,
          lastResult: currentContent.substring(0, 50),
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

    await chrome.storage.local.set({ tasks: updatedTasks, announcements, isChecking: false });
    
    if (hasNewUpdates) {
      chrome.action.setBadgeText({ text: 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
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
    
    // Test uses the same fallback logic
    (async () => {
      // 1. Try Static
      let result = await sendMessageToOffscreen({
        type: 'SCRAPE_URL',
        payload: msg.payload
      });
      
      // 2. Try Dynamic if Static fails
      if (!result.text) {
        // Notify user via console or just wait
        const dynamicResult = await scrapeDynamicContent(msg.payload.url, msg.payload.selector);
        if (dynamicResult.text || dynamicResult.error) {
           result = dynamicResult;
        }
      }
      
      sendResponse(result);
    })();
    
    return true; 
  }
});
