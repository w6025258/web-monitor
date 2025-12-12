
const ALARM_NAME = 'monitor_check';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

console.log("[Web Monitor] Service Worker Initializing...");

// 1. Initialize Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("[Web Monitor] Alarm triggered");
    await checkAllTasks();
  }
});

// Setup default alarm on install
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Web Monitor] Extension Installed");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
});

// 2. Offscreen Document Management
let creatingOffscreen; // Global promise to prevent race conditions

async function setupOffscreenDocument(path) {
  // Check existence (Modern API)
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(path)]
    });
    if (contexts.length > 0) return;
  }

  // Create if not exists (with concurrency lock)
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER'],
      justification: 'Parse HTML to detect website updates',
    });
    
    try {
      await creatingOffscreen;
    } catch (err) {
      // Ignore error if it says it already exists
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
  // Notify UI we are checking
  await chrome.storage.local.set({ isChecking: true });

  try {
    const data = await chrome.storage.local.get(['tasks', 'announcements']);
    const tasks = data.tasks || [];
    let announcements = data.announcements || [];
    let hasNewUpdates = false;

    // Ensure offscreen is ready
    await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

    const updatedTasks = await Promise.all(
      tasks.map(async (task) => {
        try {
          // A. Fetch HTML
          const response = await fetch(task.url, { cache: 'no-cache' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await response.text();

          // B. Parse via Offscreen
          const parseResult = await sendMessageToOffscreen({
            type: 'PARSE_HTML',
            payload: { html, selector: task.selector, url: task.url },
          });

          if (!parseResult) throw new Error("Parsing failed (no result)");

          // C. Compare Content
          const currentContent = parseResult.text ? parseResult.text.trim() : '';
          const contentHash = await generateHash(currentContent);

          if (currentContent && task.lastContentHash !== contentHash) {
            // New Content Found
            if (task.lastContentHash !== '') {
              const newAnnouncement = {
                id: crypto.randomUUID(),
                taskId: task.id,
                taskName: task.name,
                title: currentContent.substring(0, 100) + (currentContent.length > 100 ? '...' : ''),
                link: parseResult.href || task.url,
                foundAt: Date.now(),
                isRead: false,
              };
              announcements.unshift(newAnnouncement);
              hasNewUpdates = true;
            }
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

// Helper: Send message to offscreen
async function sendMessageToOffscreen(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
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
  if (msg.action === 'TRIGGER_CHECK') {
    checkAllTasks().then(() => sendResponse({ status: 'done' }));
    return true; // async response
  }
});
