
const ALARM_NAME = 'monitor_check';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

console.log("[Web Monitor] Service Worker Loading...");

// 1. Initialize Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("[Web Monitor] Alarm triggered: " + new Date().toISOString());
    await checkAllTasks();
  }
});

// Setup default alarm on install and run an immediate check
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Web Monitor] Extension Installed/Updated");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  // Run a check immediately for testing/feedback
  await checkAllTasks();
});

// 2. Offscreen Document Management
let creatingOffscreen; 

async function setupOffscreenDocument(path) {
  // Check existence (Modern API)
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(path)]
    });
    if (contexts.length > 0) return;
  } else {
    // Fallback for older Chrome versions (check clients)
    const clients = await clients.matchAll();
    if (clients.some(c => c.url === chrome.runtime.getURL(path))) return;
  }

  // Create if not exists (with concurrency lock)
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER', 'BLOBS'], // Added BLOBS if needed for fetch
      justification: 'Scrape and parse HTML to detect website updates',
    });
    
    try {
      await creatingOffscreen;
      console.log("[Web Monitor] Offscreen document created");
    } catch (err) {
      if (!err.message.startsWith('Only a single offscreen')) {
         console.error("[Web Monitor] Offscreen creation failed", err);
      }
    } finally {
      creatingOffscreen = null;
    }
  }
}

// 3. Core Logic: Check Updates
async function checkAllTasks() {
  console.log("[Web Monitor] Starting checkAllTasks...");
  
  // Notify UI we are checking
  await chrome.storage.local.set({ isChecking: true });

  try {
    const data = await chrome.storage.local.get(['tasks', 'announcements']);
    const tasks = data.tasks || [];
    let announcements = data.announcements || [];
    let hasNewUpdates = false;

    console.log(`[Web Monitor] Found ${tasks.length} tasks.`);

    if (tasks.length === 0) {
      console.log("[Web Monitor] No tasks to check.");
      await chrome.storage.local.set({ isChecking: false });
      return;
    }

    // Ensure offscreen is ready
    await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

    const updatedTasks = await Promise.all(
      tasks.map(async (task) => {
        console.log(`[Web Monitor] Checking task: ${task.name} (${task.url})`);
        try {
          // Offload BOTH Fetch and Parse to offscreen to avoid message size limits
          // and keep scraping logic unified.
          const result = await sendMessageToOffscreen({
            type: 'SCRAPE_URL',
            payload: { 
              url: task.url, 
              selector: task.selector 
            },
          });

          if (result.error) throw new Error(result.error);
          
          const currentContent = result.text ? result.text.trim() : '';
          console.log(`[Web Monitor] Task ${task.name} content length: ${currentContent.length}`);

          const contentHash = await generateHash(currentContent);

          if (currentContent && task.lastContentHash !== contentHash) {
             console.log(`[Web Monitor] Change detected for ${task.name}`);
            // New Content Found
            if (task.lastContentHash !== '') {
              const newAnnouncement = {
                id: crypto.randomUUID(),
                taskId: task.id,
                taskName: task.name,
                title: currentContent.substring(0, 100) + (currentContent.length > 100 ? '...' : ''),
                link: result.href || task.url,
                foundAt: Date.now(),
                isRead: false,
              };
              announcements.unshift(newAnnouncement);
              hasNewUpdates = true;
            }
          } else {
             console.log(`[Web Monitor] No change for ${task.name}`);
          }

          return {
            ...task,
            lastChecked: Date.now(),
            lastContentHash: contentHash,
            lastResult: currentContent,
            status: 'active',
            errorMessage: undefined,
          };
        } catch (error) {
          console.error(`[Web Monitor] Error checking ${task.name}:`, error);
          return {
            ...task,
            lastChecked: Date.now(),
            status: 'error',
            errorMessage: error.message || 'Unknown error',
          };
        }
      })
    );

    // D. Save Data
    await chrome.storage.local.set({
      tasks: updatedTasks,
      announcements,
      isChecking: false,
    });

    if (hasNewUpdates) {
      chrome.action.setBadgeText({ text: 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }

  } catch (err) {
    console.error('[Web Monitor] Global check failed', err);
    await chrome.storage.local.set({ isChecking: false });
  } 
}

// Helper: Send message to offscreen with timeout
async function sendMessageToOffscreen(message) {
  return new Promise((resolve) => {
    // Set a timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      resolve({ error: 'Timeout waiting for offscreen response' });
    }, 30000); // 30s timeout for fetch

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// Helper: Simple Hash
async function generateHash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Listen for manual trigger from Popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[Web Monitor] Message received:", msg);
  if (msg.action === 'TRIGGER_CHECK') {
    checkAllTasks().then(() => sendResponse({ status: 'done' }));
    return true; // async response
  }
});
