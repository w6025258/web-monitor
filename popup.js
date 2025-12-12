
// popup.js - Pure JS

// State
let tasks = [];
let announcements = [];
let isChecking = false;

// Elements
const views = {
  dashboard: document.getElementById('view-dashboard'),
  settings: document.getElementById('view-settings'),
  addTask: document.getElementById('view-add-task'),
};

const btnCheckNow = document.getElementById('btn-check-now');
const btnSettings = document.getElementById('btn-settings');
const btnAddTaskView = document.getElementById('btn-add-task-view');
const btnCancelAdd = document.getElementById('btn-cancel-add');
const btnClearAll = document.getElementById('btn-clear-all');
const formAddTask = document.getElementById('form-add-task');

const listAnnouncements = document.getElementById('announcements-list');
const listTasks = document.getElementById('tasks-list');

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});

function loadData() {
  chrome.storage.local.get(['tasks', 'announcements', 'isChecking'], (result) => {
    tasks = result.tasks || [];
    announcements = result.announcements || [];
    isChecking = result.isChecking || false;
    render();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tasks) tasks = changes.tasks.newValue || [];
    if (changes.announcements) announcements = changes.announcements.newValue || [];
    if (changes.isChecking) isChecking = changes.isChecking.newValue || false;
    render();
  });
}

// Actions
btnSettings.addEventListener('click', () => {
  if (views.settings.classList.contains('active')) {
    switchView('dashboard');
  } else {
    switchView('settings');
  }
});

btnAddTaskView.addEventListener('click', () => switchView('addTask'));
btnCancelAdd.addEventListener('click', () => switchView('settings'));

btnCheckNow.addEventListener('click', () => {
  if (isChecking) return;
  triggerBackgroundCheck();
});

btnClearAll.addEventListener('click', () => {
  if (confirm('Clear all history?')) {
    chrome.storage.local.set({ announcements: [] });
    chrome.action.setBadgeText({ text: '' });
  }
});

formAddTask.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('input-name').value.trim();
  const url = document.getElementById('input-url').value.trim();
  const selector = document.getElementById('input-selector').value.trim();

  if (name && url && selector) {
    const newTask = {
      id: crypto.randomUUID(),
      name,
      url,
      selector,
      lastChecked: 0,
      lastContentHash: '', 
      status: 'active'
    };
    
    // Optimistic UI
    const updatedTasks = [...tasks, newTask];
    chrome.storage.local.set({ tasks: updatedTasks }, () => {
      // Trigger check immediately so user sees log in background
      triggerBackgroundCheck();
    });
    
    formAddTask.reset();
    switchView('settings');
  }
});

function triggerBackgroundCheck() {
  btnCheckNow.classList.add('spin');
  chrome.runtime.sendMessage({ action: 'TRIGGER_CHECK' });
}

// Rendering
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
  // Update Check Button
  if (isChecking) {
    btnCheckNow.classList.add('spin');
  } else {
    btnCheckNow.classList.remove('spin');
  }

  // Stats
  document.getElementById('stat-monitored').textContent = `Monitored: ${tasks.length}`;
  const unreadCount = announcements.filter(a => !a.isRead).length;
  document.getElementById('stat-unread').textContent = `Unread: ${unreadCount}`;

  // Dashboard
  renderDashboard();

  // Settings
  renderSettings();
}

function renderDashboard() {
  const container = listAnnouncements;
  container.innerHTML = '';
  
  const emptyDash = document.getElementById('empty-state-dashboard');
  const emptyTasks = document.getElementById('empty-state-no-tasks');

  if (tasks.length === 0) {
    emptyTasks.classList.remove('hidden');
    emptyDash.classList.add('hidden');
    container.classList.add('hidden');
    btnClearAll.classList.add('hidden');
    return;
  }
  
  emptyTasks.classList.add('hidden');
  
  if (announcements.length === 0) {
    emptyDash.classList.remove('hidden');
    container.classList.add('hidden');
    btnClearAll.classList.add('hidden');
    return;
  }

  emptyDash.classList.add('hidden');
  container.classList.remove('hidden');
  btnClearAll.classList.remove('hidden');

  announcements.forEach(item => {
    const div = document.createElement('div');
    div.className = `card announcement-item ${item.isRead ? 'read' : 'unread'}`;
    
    const time = new Date(item.foundAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    div.innerHTML = `
      <div class="meta">
        <span class="task-tag">${escape(item.taskName)}</span>
        <span>${time}</span>
      </div>
      <a href="${item.link}" target="_blank" class="link-title">${escape(item.title)}</a>
      ${!item.isRead ? `<div style="text-align:right;"><button class="btn-action">Mark Read</button></div>` : ''}
    `;

    const btn = div.querySelector('.btn-action');
    const link = div.querySelector('.link-title');
    
    const handleRead = () => {
      item.isRead = true;
      chrome.storage.local.set({ announcements });
      const count = announcements.filter(a => !a.isRead).length;
      if (count === 0) chrome.action.setBadgeText({ text: '' });
    };

    if(btn) btn.onclick = handleRead;
    link.onclick = handleRead;

    container.appendChild(div);
  });
}

function renderSettings() {
  const container = listTasks;
  container.innerHTML = '';
  const empty = document.getElementById('empty-state-settings');

  if (tasks.length === 0) {
    empty.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  container.classList.remove('hidden');

  tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = 'card task-item';
    
    let statusHtml = '<span class="text-green">●</span>';
    if (task.status === 'error') {
      statusHtml = `<span class="text-red" title="${escape(task.errorMessage)}">● Error</span>`;
    }

    div.innerHTML = `
      <div class="task-info">
        <div class="task-name">${escape(task.name)} ${statusHtml}</div>
        <div class="task-url">${escape(task.url)}</div>
        <div style="margin-top:4px;"><span class="task-selector">${escape(task.selector)}</span></div>
      </div>
      <button class="icon-btn delete-btn" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;

    div.querySelector('.delete-btn').onclick = () => {
      if(confirm('Delete this task?')) {
        const newTasks = tasks.filter(t => t.id !== task.id);
        chrome.storage.local.set({ tasks: newTasks });
      }
    };

    container.appendChild(div);
  });
}

function escape(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
