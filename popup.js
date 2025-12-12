
// popup.js - Pure JS Interface (Chinese Version)

// State
let tasks = [];
let announcements = [];
let isChecking = false;
let editingTaskId = null; // Track if we are editing an existing task

// DOM Elements
const views = {
  dashboard: document.getElementById('view-dashboard'),
  settings: document.getElementById('view-settings'),
  addTask: document.getElementById('view-add-task'),
};

const viewAddTaskTitle = document.getElementById('view-add-task-title');

const btnCheckNow = document.getElementById('btn-check-now');
const btnSettings = document.getElementById('btn-settings');
const btnAddTaskView = document.getElementById('btn-add-task-view');
const btnCancelAdd = document.getElementById('btn-cancel-add');
const btnClearAll = document.getElementById('btn-clear-all');
const formAddTask = document.getElementById('form-add-task');

// Data Management Elements
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const fileInputImport = document.getElementById('file-input-import');

// Test Selector Elements
const btnTestSelector = document.getElementById('btn-test-selector');
const previewContainer = document.getElementById('preview-container');
const previewResult = document.getElementById('preview-result');
const previewStatus = document.getElementById('preview-status');

const listAnnouncements = document.getElementById('announcements-list');
const listTasks = document.getElementById('tasks-list');
const statMonitored = document.getElementById('stat-monitored');
const statUnread = document.getElementById('stat-unread');

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  console.log("Popup Loaded");
  loadData();
});

function loadData() {
  chrome.storage.local.get(['tasks', 'announcements', 'isChecking'], (result) => {
    tasks = result.tasks || [];
    announcements = result.announcements || [];
    isChecking = result.isChecking || false;
    render();
  });

  // Real-time updates from background
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tasks) tasks = changes.tasks.newValue || [];
    if (changes.announcements) announcements = changes.announcements.newValue || [];
    if (changes.isChecking) isChecking = changes.isChecking.newValue || false;
    render();
  });
}

// --- Actions ---

// Toggle Settings View
btnSettings.addEventListener('click', () => {
  if (views.settings.classList.contains('active')) {
    switchView('dashboard');
  } else {
    switchView('settings');
  }
});

// Navigation
btnAddTaskView.addEventListener('click', () => {
  editingTaskId = null; // Reset edit mode
  formAddTask.reset();
  resetPreview();
  viewAddTaskTitle.textContent = "添加新监控";
  switchView('addTask');
});

btnCancelAdd.addEventListener('click', () => {
  editingTaskId = null;
  formAddTask.reset();
  resetPreview();
  switchView('settings');
});

function resetPreview() {
  previewContainer.classList.add('hidden');
  previewResult.textContent = '';
  previewStatus.textContent = '';
}

// Manual Check
btnCheckNow.addEventListener('click', () => {
  if (isChecking) return;
  btnCheckNow.classList.add('spin');
  // Send message to background
  chrome.runtime.sendMessage({ action: 'TRIGGER_CHECK' });
});

// Test Selector Action
btnTestSelector.addEventListener('click', async () => {
  const url = document.getElementById('input-url').value.trim();
  const selector = document.getElementById('input-selector').value.trim();

  if (!url || !selector) {
    alert('请先填写 URL 和 CSS 选择器');
    return;
  }

  // UI Loading
  const originalBtnText = btnTestSelector.textContent;
  btnTestSelector.textContent = '...';
  btnTestSelector.disabled = true;
  
  previewContainer.classList.remove('hidden');
  previewResult.textContent = '正在连接目标网页并抓取内容...';
  previewResult.style.color = 'var(--text-muted)';
  previewStatus.textContent = '';

  try {
    // Send message to background to perform ad-hoc scrape
    const response = await chrome.runtime.sendMessage({
      action: 'TEST_SCRAPE',
      payload: { url, selector }
    });

    // Handle Response
    btnTestSelector.textContent = originalBtnText;
    btnTestSelector.disabled = false;

    if (response.error) {
      previewResult.textContent = '抓取错误: ' + response.error;
      previewResult.style.color = '#ef4444';
      previewStatus.textContent = '❌ 失败';
    } else if (!response.html) {
      previewResult.innerHTML = `未找到匹配内容。<br><br>页面标题: <b>${escapeHtml(response.pageTitle)}</b><br>可能原因：<br>1. 选择器错误<br>2. 页面内容由 JS 动态生成（插件只能抓取原始 HTML）<br>3. 网站有反爬虫验证`;
      previewResult.style.color = '#f59e0b';
      previewStatus.textContent = '⚠️ 无结果';
    } else {
      // Use text for simple preview check, or slice HTML if it's too long
      previewResult.textContent = response.text || (response.html.substring(0, 300) + '...');
      previewResult.style.color = 'var(--text)';
      previewStatus.textContent = '✅ 成功匹配';
    }

  } catch (err) {
    btnTestSelector.textContent = originalBtnText;
    btnTestSelector.disabled = false;
    previewResult.textContent = '通信错误: ' + err.message;
    previewResult.style.color = '#ef4444';
  }
});

// Clear History
btnClearAll.addEventListener('click', () => {
  if (confirm('确定要清空所有更新记录吗？')) {
    chrome.storage.local.set({ announcements: [] });
    chrome.action.setBadgeText({ text: '' });
  }
});

// --- Data Management (Export/Import) ---

// Export
btnExport.addEventListener('click', () => {
  if (tasks.length === 0) {
    alert('暂无配置可导出');
    return;
  }
  
  // Clean data for export (remove internal state if needed, but keeping basic fields is fine)
  const exportData = tasks.map(t => ({
    name: t.name,
    url: t.url,
    selector: t.selector
  }));

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `web-monitor-config-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Import Click Trigger
btnImport.addEventListener('click', () => {
  fileInputImport.click();
});

// Import File Handler
fileInputImport.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedData = JSON.parse(event.target.result);
      
      if (!Array.isArray(importedData)) {
        throw new Error('无效的文件格式: 根元素应为数组');
      }

      let count = 0;
      const newTasks = [];

      importedData.forEach(item => {
        if (item.name && item.url && item.selector) {
          newTasks.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2), // Generate new ID
            name: item.name,
            url: item.url,
            selector: item.selector,
            lastChecked: 0,
            lastContentHash: '',
            status: 'active'
          });
          count++;
        }
      });

      if (count === 0) {
        alert('未找到有效的监控配置。请检查文件格式。');
        return;
      }

      if (confirm(`解析成功，发现 ${count} 个有效配置。\n点击确定将把这些任务添加到现有列表中。`)) {
         const combinedTasks = [...tasks, ...newTasks];
         chrome.storage.local.set({ tasks: combinedTasks }, () => {
            alert('导入成功！');
            fileInputImport.value = ''; // Reset input
         });
      }

    } catch (err) {
      alert('导入失败: ' + err.message);
    }
  };
  reader.readAsText(file);
});


// Add/Edit Task Submit
formAddTask.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('input-name').value.trim();
  const url = document.getElementById('input-url').value.trim();
  const selector = document.getElementById('input-selector').value.trim();

  if (name && url && selector) {
    
    // Helper to finish up
    const finish = () => {
      formAddTask.reset();
      resetPreview();
      editingTaskId = null;
      switchView('settings');
      // Use setTimeOut to ensure UI update logic doesn't block message sending
      setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'TRIGGER_CHECK' });
      }, 100);
    };

    if (editingTaskId) {
      // --- Update Existing Task ---
      const oldTaskIndex = tasks.findIndex(t => t.id === editingTaskId);
      if (oldTaskIndex > -1) {
        const oldTask = tasks[oldTaskIndex];
        
        // Check if critical fields changed to reset hash
        const isCriticalChange = oldTask.url !== url || oldTask.selector !== selector;
        
        const updatedTask = {
          ...oldTask,
          name,
          url,
          selector,
          // If URL or Selector changed, reset hash so we get a fresh baseline next check
          lastContentHash: isCriticalChange ? '' : oldTask.lastContentHash,
          status: 'active', // Reset error status on edit
          errorMessage: undefined
        };
        
        const newTasks = [...tasks];
        newTasks[oldTaskIndex] = updatedTask;
        
        // Wait for storage set to complete before triggering check
        chrome.storage.local.set({ tasks: newTasks }, finish);
      } else {
        finish();
      }
    } else {
      // --- Create New Task ---
      const newTask = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        name,
        url,
        selector,
        lastChecked: 0,
        lastContentHash: '', // Empty means first run establishes baseline
        status: 'active'
      };
      
      const updatedTasks = [...tasks, newTask];
      
      // Wait for storage set to complete before triggering check
      chrome.storage.local.set({ tasks: updatedTasks }, finish);
    }
  }
});

// --- Rendering ---

function switchView(name) {
  Object.values(views).forEach(el => el.classList.remove('active'));
  views[name].classList.add('active');
  
  if (name === 'settings' || name === 'addTask') {
    btnSettings.classList.add('active');
  } else {
    btnSettings.classList.remove('active');
  }
}

function render() {
  // 1. Update Spinner
  if (isChecking) {
    btnCheckNow.classList.add('spin');
  } else {
    btnCheckNow.classList.remove('spin');
  }

  // 2. Update Stats
  statMonitored.textContent = `已监控: ${tasks.length}`;
  const unreadCount = announcements.filter(a => !a.isRead).length;
  statUnread.textContent = `未读: ${unreadCount}`;

  // 3. Render Dashboard
  renderDashboard();

  // 4. Render Settings
  renderSettings();
}

function renderDashboard() {
  listAnnouncements.innerHTML = '';
  
  const emptyDash = document.getElementById('empty-state-dashboard');
  const emptyTasks = document.getElementById('empty-state-no-tasks');

  // Case: No tasks configured
  if (tasks.length === 0) {
    emptyTasks.classList.remove('hidden');
    emptyDash.classList.add('hidden');
    listAnnouncements.classList.add('hidden');
    btnClearAll.classList.add('hidden');
    return;
  }
  
  emptyTasks.classList.add('hidden');
  
  // Case: No updates found yet
  if (announcements.length === 0) {
    emptyDash.classList.remove('hidden');
    listAnnouncements.classList.add('hidden');
    btnClearAll.classList.add('hidden');
    return;
  }

  // Case: Updates exist
  emptyDash.classList.add('hidden');
  listAnnouncements.classList.remove('hidden');
  btnClearAll.classList.remove('hidden');

  announcements.forEach(item => {
    const div = document.createElement('div');
    div.className = `card announcement-item ${item.isRead ? 'read' : 'unread'}`;
    
    const time = new Date(item.foundAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Use HTML rendering instead of text
    // Note: 'item.title' now actually contains the HTML string from background.js
    div.innerHTML = `
      <div class="meta">
        <span class="task-tag">${escapeHtml(item.taskName)}</span>
        <div style="display:flex; gap:8px;">
          <span>${time}</span>
          ${!item.isRead ? `<button class="btn-action">已读</button>` : ''}
        </div>
      </div>
      <div class="html-content">
        ${item.title} 
      </div>
    `;
    
    // Note: We are relying on the backend (offscreen.js) to have stripped scripts
    // But for extra safety in the popup context, we could run a pass here, 
    // but innerHTML assignments in Extensions are generally safer than eval.
    // However, clicking links inside the HTML needs to work.

    // Event Handlers
    const btn = div.querySelector('.btn-action');
    
    const handleRead = () => {
      const currentAnnouncements = announcements.map(a => 
        a.id === item.id ? { ...a, isRead: true } : a
      );
      
      chrome.storage.local.set({ announcements: currentAnnouncements });
      const count = currentAnnouncements.filter(a => !a.isRead).length;
      if (count === 0) chrome.action.setBadgeText({ text: '' });
    };

    if(btn) btn.onclick = handleRead;
    
    // Make main clicks (if it was a simple link) mark as read? 
    // Since it's HTML content now, user might click links inside.
    // Let's attach a listener to any link inside to mark as read
    div.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', handleRead);
    });

    listAnnouncements.appendChild(div);
  });
}

function renderSettings() {
  listTasks.innerHTML = '';
  const empty = document.getElementById('empty-state-settings');

  if (tasks.length === 0) {
    empty.classList.remove('hidden');
    listTasks.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  listTasks.classList.remove('hidden');

  tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = 'card task-item';
    
    let statusHtml = '<span class="text-green">● 正常</span>';
    if (task.status === 'error') {
      statusHtml = `<span class="text-red" title="${escapeHtml(task.errorMessage)}">● 错误</span>`;
    }

    const lastResultPreview = task.lastResult ? 
      `<div style="font-size:10px; color:#94a3b8; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">最新抓取: ${escapeHtml(task.lastResult)}</div>` 
      : '';

    div.innerHTML = `
      <div class="task-info">
        <div class="task-name">${escapeHtml(task.name)}</div>
        <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(task.url)}</div>
        ${lastResultPreview}
        <div style="margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
           <span class="task-selector">${escapeHtml(task.selector)}</span>
           <span style="font-size:10px;">${statusHtml}</span>
        </div>
      </div>
      <div class="action-group">
        <button class="task-btn edit-btn" title="编辑">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="task-btn delete-btn" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // Delete Action
    div.querySelector('.delete-btn').onclick = () => {
      if(confirm(`确定要删除监控 "${task.name}" 吗？`)) {
        const newTasks = tasks.filter(t => t.id !== task.id);
        chrome.storage.local.set({ tasks: newTasks });
      }
    };

    // Edit Action
    div.querySelector('.edit-btn').onclick = () => {
      startEditing(task);
    };

    listTasks.appendChild(div);
  });
}

function startEditing(task) {
  editingTaskId = task.id;
  
  // Pre-fill form
  document.getElementById('input-name').value = task.name;
  document.getElementById('input-url').value = task.url;
  document.getElementById('input-selector').value = task.selector;
  
  resetPreview();

  // Change Title
  viewAddTaskTitle.textContent = "编辑监控任务";
  
  switchView('addTask');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/"/g, "&#039;");
}
