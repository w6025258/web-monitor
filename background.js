
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

// 2. Offscreen Document Management
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
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// 3. Core Logic
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
        console.log(`[Web Monitor] 抓取中: ${task.url}`);
        
        const result = await sendMessageToOffscreen({
          type: 'SCRAPE_URL',
          payload: { url: task.url, selector: task.selector }
        });

        if (result.error) throw new Error(result.error);

        const currentContent = result.text || '';
        
        // Debugging Aid: If content is empty, log the page title
        if (!currentContent) {
           console.warn(`[Web Monitor] ⚠️ 警告: 未找到内容 "${task.name}"`);
           console.warn(`   └─ 目标页面标题: "${result.pageTitle}" (如果标题是 Login/Forbidden，说明被拦截)`);
           console.warn(`   └─ 当前选择器: ${task.selector}`);
           console.warn(`   └─ 建议: 右键网页 -> "查看网页源代码"，确认该元素是否存在于原始 HTML 中，并简化选择器。`);
        }

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
    console.log("[Web Monitor] 👆 收到手动触发检查请求");
    checkAllTasks().then(() => sendResponse({ status: 'done' }));
    return true; 
  }
  
  // NEW: Handle ad-hoc test scraping from popup
  if (msg.action === 'TEST_SCRAPE') {
    console.log("[Web Monitor] 🧪 测试抓取:", msg.payload.url);
    sendMessageToOffscreen({
      type: 'SCRAPE_URL',
      payload: msg.payload
    }).then(result => sendResponse(result));
    return true; // async response
  }
});
