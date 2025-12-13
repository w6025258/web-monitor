

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

// Settings Elements
const selectInterval = document.getElementById('select-interval');

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
  setupEventListeners();
});

function loadData() {
  chrome.storage.local.get(['tasks', 'announcements', 'isChecking', 'checkInterval'], (result) => {
    tasks = result.tasks || [];
    announcements = result.announcements || [];
    isChecking = result.isChecking || false;
    
    // Set Interval Selector
    if (selectInterval) {
      const currentInterval = result.checkInterval !== undefined ? result.checkInterval : 60;
      selectInterval.value = currentInterval;
    }

    render();
  });

  // Real-time updates from background
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tasks) tasks = changes.tasks.newValue || [];
    if (changes.announcements) announcements = changes.announcements.newValue || [];
    if (changes.isChecking) isChecking = changes.isChecking.newValue || false;
    if (changes.checkInterval && selectInterval) {
       const newVal = changes.checkInterval.newValue;
       selectInterval.value = (newVal !== undefined) ? newVal : 60;
    }
    render();
  });
}

// --- Event Listeners Setup (Event Delegation) ---
function setupEventListeners() {
  // 1. Task List Actions (Move, Edit, Delete)
  listTasks.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (!action || !id) return;

    e.stopPropagation(); // Stop propagation just in case

    if (action === 'move-up') moveTask(id, -1);
    else if (action === 'move-down') moveTask(id, 1);
    else if (action === 'edit') editTask(id);
    else if (action === 'delete') deleteTask(id);
  });

  // 2. Announcements List Actions (Mark Read / Open Link)
  listAnnouncements.addEventListener('click', (e) => {
    const card = e.target.closest('.announcement-item');
    if (!card) return;

    const id = card.dataset.id;
    const link = card.dataset.link;

    if (id) markRead(id, link);
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

// Interval Change
if (selectInterval) {
  selectInterval.addEventListener('change', (e) => {
     const val = parseInt(e.target.value);
     chrome.storage.local.set({ checkInterval: val });
  });
}

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
  // Change: Switch to dashboard immediately when clicked
  switchView('dashboard');
  btnCheckNow.classList.add('spin');
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

  const originalBtnText = btnTestSelector.textContent;
  btnTestSelector.textContent = '...';
  btnTestSelector.disabled = true;
  
  previewContainer.classList.remove('hidden');
  previewResult.textContent = '正在连接目标网页并抓取内容...';
  previewResult.style.color = 'var(--text-muted)';
  previewStatus.textContent = '';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'TEST_SCRAPE',
      payload: { url, selector }
    });

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
btnExport.addEventListener('click', () => {
  if (tasks.length === 0) {
    alert('暂无配置可导出');
    return;
  }
  
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

btnImport.addEventListener('click', () => {
  fileInputImport.click();
});

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
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
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
        alert('未找到有效的监控配置。');
        return;
      }

      if (confirm(`解析成功，发现 ${count} 个有效配置。\n点击确定将把这些任务添加到现有列表中。`)) {
         const combinedTasks = [...tasks, ...newTasks];
         chrome.storage.local.set({ tasks: combinedTasks }, () => {
            alert('导入成功！');
            fileInputImport.value = '';
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
    const finish = () => {
      formAddTask.reset();
      resetPreview();
      editingTaskId = null;
      switchView('settings');
      // Change: Removed auto TRIGGER_CHECK here.
    };

    if (editingTaskId) {
      const oldTaskIndex = tasks.findIndex(t => t.id === editingTaskId);
      if (oldTaskIndex > -1) {
        const oldTask = tasks[oldTaskIndex];
        const isCriticalChange = oldTask.url !== url || oldTask.selector !== selector;
        const updatedTask = {
          ...oldTask,
          name,
          url,
          selector,
          lastContentHash: isCriticalChange ? '' : oldTask.lastContentHash,
          status: 'active',
          errorMessage: undefined
        };
        const newTasks = [...tasks];
        newTasks[oldTaskIndex] = updatedTask;
        chrome.storage.local.set({ tasks: newTasks }, finish);
      } else {
        finish();
      }
    } else {
      const newTask = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        name,
        url,
        selector,
        lastChecked: 0,
        lastContentHash: '',
        status: 'active'
      };
      const updatedTasks = [...tasks, newTask];
      chrome.storage.local.set({ tasks: updatedTasks }, finish);
    }
  }
});

// --- Logic Functions (Not global anymore, called by Event Listeners) ---

function moveTask(id, direction) {
  const index = tasks.findIndex(t => t.id === id);
  if (index === -1) return;

  const newTasks = [...tasks];

  // Logic: 1 = Down (Next), -1 = Up (Prev)
  if (direction === -1 && index > 0) {
    [newTasks[index], newTasks[index - 1]] = [newTasks[index - 1], newTasks[index]];
  } else if (direction === 1 && index < newTasks.length - 1) {
    [newTasks[index], newTasks[index + 1]] = [newTasks[index + 1], newTasks[index]];
  } else {
    return;
  }

  tasks = newTasks; // Optimistic update
  render();
  chrome.storage.local.set({ tasks: newTasks });
}

function deleteTask(id) {
  if (confirm('确定要删除这个监控任务吗？')) {
    const newTasks = tasks.filter(t => t.id !== id);
    chrome.storage.local.set({ tasks: newTasks });
  }
}

function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    editingTaskId = id;
    document.getElementById('input-name').value = task.name;
    document.getElementById('input-url').value = task.url;
    document.getElementById('input-selector').value = task.selector;
    
    viewAddTaskTitle.textContent = "编辑监控";
    switchView('addTask');
  }
}

function markRead(id, link) {
  const item = announcements.find(a => a.id === id);
  if (item && !item.isRead) {
    item.isRead = true;
    chrome.storage.local.set({ announcements });
  }
  if (link && link !== 'undefined') {
    chrome.tabs.create({ url: link });
  }
}

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

  // 3. Render Announcements (Dashboard)
  if (announcements.length === 0) {
    listAnnouncements.innerHTML = '';
    
    if (tasks.length === 0) {
        document.getElementById('empty-state-dashboard').classList.add('hidden');
        document.getElementById('empty-state-no-tasks').classList.remove('hidden');
    } else {
        document.getElementById('empty-state-no-tasks').classList.add('hidden');
        document.getElementById('empty-state-dashboard').classList.remove('hidden');
    }
    
    btnClearAll.classList.add('hidden');
  } else {
    document.getElementById('empty-state-dashboard').classList.add('hidden');
    document.getElementById('empty-state-no-tasks').classList.add('hidden');
    btnClearAll.classList.remove('hidden');
    
    const taskOrderMap = new Map();
    tasks.forEach((t, i) => taskOrderMap.set(t.id, i));
    
    const sortedAnnouncements = [...announcements].sort((a, b) => {
      const idxA = taskOrderMap.has(a.taskId) ? taskOrderMap.get(a.taskId) : 99999;
      const idxB = taskOrderMap.has(b.taskId) ? taskOrderMap.get(b.taskId) : 99999;
      
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      return b.foundAt - a.foundAt;
    });

    // IMPORTANT: removed onclick, added data-id and data-link for Event Delegation
    listAnnouncements.innerHTML = sortedAnnouncements.map(item => `
      <div class="announcement-item ${item.isRead ? 'read' : 'unread'} card" data-id="${item.id}" data-link="${item.link}">
        <div class="meta">
           <div class="task-tag">${escapeHtml(item.taskName)}</div>
           <span>${new Date(item.foundAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="html-content">${item.title}</div> 
      </div>
    `).join('');
  }

  // 4. Render Tasks (Settings)
  if (tasks.length === 0) {
    listTasks.innerHTML = '';
    document.getElementById('empty-state-settings').classList.remove('hidden');
  } else {
    document.getElementById('empty-state-settings').classList.add('hidden');
    listTasks.innerHTML = tasks.map((task, index) => {
      let statusDot = '';
      if (task.status === 'error') statusDot = `<span style="color:#ef4444;" title="${escapeHtml(task.errorMessage)}">● 错误</span>`;
      else if (task.lastChecked > 0) statusDot = `<span class="text-green">● 正常</span>`;
      else statusDot = `<span style="color:#cbd5e1;">● 未检测</span>`;

      const disableUp = index === 0 ? 'disabled' : '';
      const disableDown = index === tasks.length - 1 ? 'disabled' : '';

      // IMPORTANT: removed onclick, added data-action and data-id for Event Delegation
      return `
      <div class="task-item card">
        <div class="task-info">
          <div class="task-name">
             ${escapeHtml(task.name)} 
             <span style="font-size:10px; font-weight:400; margin-left:8px;">${statusDot}</span>
          </div>
          <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(task.url)}</div>
          <div style="margin-top:4px; display:flex; gap:6px; align-items:center;">
             <span class="task-selector" title="Selector">${escapeHtml(task.selector)}</span>
          </div>
        </div>
        <div class="action-group">
          <button class="task-btn move-btn" title="上移" data-action="move-up" data-id="${task.id}" ${disableUp}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;pointer-events:none;"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
          </button>
          <button class="task-btn move-btn" title="下移" data-action="move-down" data-id="${task.id}" ${disableDown}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;pointer-events:none;"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
          </button>
          <div style="width:1px; height:16px; background:#e2e8f0; margin:0 4px;"></div>
          <button class="task-btn edit-btn" title="编辑" data-action="edit" data-id="${task.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;pointer-events:none;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="task-btn delete-btn" title="删除" data-action="delete" data-id="${task.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;pointer-events:none;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
    }).join('');
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
