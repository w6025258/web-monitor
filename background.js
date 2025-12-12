
const ALARM_NAME = 'monitor_check';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

console.log("[Web Monitor] Service Worker Initialized");

// 1. Initialize Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("[Web Monitor] Alarm triggered");
    await checkAllTasks();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Web Monitor] Installed");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  await checkAllTasks();
});

// 2. Offscreen Helper
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
      justification: 'Scrape websites',
    });
    
    try {
      await creatingOffscreen;
    } catch (err) {
      if (!err.message.startsWith('Only a single offscreen')) {
         console.warn("Offscreen creation warning:", err);
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

// 3. Logic
async function checkAllTasks() {
  await chrome.storage.local.set({ isChecking: true });
  
  try {
    const data = await chrome.storage.local.get(['tasks', 'announcements']);
    const tasks = data.tasks || [];
    let announcements = data.announcements || [];
    let hasNewUpdates = false;

    if (tasks.length === 0) {
      console.log("[Web Monitor] No tasks configured. Please add a task via the extension popup.");
      await chrome.storage.local.set({ isChecking: false });
      return;
    }

    console.log(`[Web Monitor] Checking ${tasks.length} tasks...`);

    const updatedTasks = await Promise.all(tasks.map(async (task) => {
      try {
        console.log(`[Web Monitor] Fetching ${task.url}`);
        const result = await sendMessageToOffscreen({
          type: 'SCRAPE_URL',
          payload: { url: task.url, selector: task.selector }
        });

        if (result.error) throw new Error(result.error);

        const currentContent = result.text || '';
        const contentHash = await generateHash(currentContent);

        // Detect Change: Must have content, hash different from last
        // If lastContentHash is empty, it's the first run, so we just cache it without alerting.
        const isFirstRun = task.lastContentHash === '';
        
        if (currentContent && task.lastContentHash !== contentHash) {
          if (!isFirstRun) {
            console.log(`[Web Monitor] Update found for: ${task.name}`);
            announcements.unshift({
              id: crypto.randomUUID(),
              taskId: task.id,
              taskName: task.name,
              title: currentContent.substring(0, 100),
              link: result.href || task.url,
              foundAt: Date.now(),
              isRead: false,
            });
            hasNewUpdates = true;
          } else {
            console.log(`[Web Monitor] Initial baseline set for: ${task.name}`);
          }
        } else {
          console.log(`[Web Monitor] No change for: ${task.name}`);
        }

        return {
          ...task,
          lastChecked: Date.now(),
          lastContentHash: contentHash,
          status: 'active',
          errorMessage: undefined
        };
      } catch (e) {
        console.error(`[Web Monitor] Error on ${task.name}:`, e);
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
    console.error('[Web Monitor] Global check failed', err);
    await chrome.storage.local.set({ isChecking: false });
  }
}

async function generateHash(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'TRIGGER_CHECK') {
    console.log("[Web Monitor] Manual check triggered");
    checkAllTasks().then(() => sendResponse({ status: 'done' }));
    return true; 
  }
});
