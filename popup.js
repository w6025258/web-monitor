
// popup.js - Vanilla JS implementation
// Replaces the React implementation to run natively in Chrome Extension Popup

// State Variables
let tasks = [];
let announcements = [];
let isChecking = false;

// DOM Elements
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

const emptyDashboard = document.getElementById('empty-state-dashboard');
const emptyNoTasks = document.getElementById('empty-state-no-tasks');
const emptySettings = document.getElementById('empty-state-settings');

const statMonitored = document.getElementById('stat-monitored');
const statUnread = document.getElementById('stat-unread');

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupListeners();
});

function loadData() {
  chrome.storage.local.get(['tasks', 'announcements', 'isChecking'], (result) => {
    tasks = result.tasks || [];
    announcements = result.announcements || [];
    isChecking = result.isChecking || false;
    render();
  });

  // Listen for updates from background script
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tasks) tasks = changes.tasks.newValue || [];
    if (changes.announcements) announcements = changes.announcements.newValue || [];
    if (changes.isChecking) isChecking = changes.isChecking.newValue || false;
    render();
  });
}

// --- Event Listeners ---

function setupListeners() {
  // Navigation
  btnSettings.addEventListener('click', () => toggleView('settings'));
  btnAddTaskView.addEventListener('click', () => switchView('addTask'));
  btnCancelAdd.addEventListener('click', () => switchView('settings'));

  // Main Actions
  btnCheckNow.addEventListener('click', () => {
    if (isChecking) return;
    updateCheckButton(true); // Immediate visual feedback
    chrome.runtime.sendMessage({ action: 'TRIGGER_CHECK' });
  });

  btnClearAll.addEventListener('click', () => {
    if(confirm('Clear all announcements?')) {
      announcements = [];
      chrome.storage.local.set({ announcements: [] });
      chrome.action.setBadgeText({ text: '' });
      render();
    }
  });

  // Form Submit: Add Task
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
        lastContentHash: '', // Empty hash ensures first run sets baseline
        status: 'active'
      };
      
      const updatedTasks = [...tasks, newTask];
      chrome.storage.local.set({ tasks: updatedTasks });
      
      // Reset and go back
      formAddTask.reset();
      switchView('settings');
    }
  });
}

// --- Rendering Logic ---

function render() {
  updateCheckButton(isChecking);
  renderStats();
  
  // Render Dashboard
  renderDashboardList();
  
  // Render Settings List
  renderSettingsList();
}

function renderStats() {
  statMonitored.textContent = `Monitored: ${tasks.length}`;
  const unreadCount = announcements.filter(a => !a.isRead).length;
  statUnread.textContent = `Unread: ${unreadCount}`;
}

function renderDashboardList() {
  listAnnouncements.innerHTML = '';
  
  // Case 1: No tasks at all
  if (tasks.length === 0) {
    emptyDashboard.classList.add('hidden');
    emptyNoTasks.classList.remove('hidden');
    btnClearAll.classList.add('hidden');
    return;
  }
  
  emptyNoTasks.classList.add('hidden');

  // Case 2: Tasks exist but no announcements
  if (announcements.length === 0) {
    emptyDashboard.classList.remove('hidden');
    btnClearAll.classList.add('hidden');
  } else {
    emptyDashboard.classList.add('hidden');
    btnClearAll.classList.remove('hidden');

    announcements.forEach(item => {
      const el = document.createElement('div');
      el.className = `p-3 rounded-lg border shadow-sm transition-all ${!item.isRead ? 'bg-white border-indigo-200 ring-1 ring-indigo-50' : 'bg-slate-50 border-slate-200 opacity-75'}`;
      
      el.innerHTML = `
        <div class="flex justify-between items-start">
          <span class="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600 mb-1 inline-block">${escapeHtml(item.taskName)}</span>
          <span class="text-[10px] text-slate-400">${new Date(item.foundAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
        <a href="${item.link}" target="_blank" class="link-item text-sm font-medium text-indigo-700 hover:underline block mt-1 mb-1 leading-snug">${escapeHtml(item.title)}</a>
        ${!item.isRead ? `<div class="flex justify-end mt-2"><button class="btn-mark-read text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 uppercase tracking-wide">Mark as Read</button></div>` : ''}
      `;

      // Handlers
      const link = el.querySelector('.link-item');
      const btnRead = el.querySelector('.btn-mark-read');

      const markRead = () => {
        item.isRead = true;
        chrome.storage.local.set({ announcements });
        
        // Update badge
        const unread = announcements.filter(a => !a.isRead).length;
        if (unread === 0) chrome.action.setBadgeText({ text: '' });
        render(); // Optimistic update
      };

      link.addEventListener('click', markRead);
      if (btnRead) btnRead.addEventListener('click', markRead);

      listAnnouncements.appendChild(el);
    });
  }
}

function renderSettingsList() {
  listTasks.innerHTML = '';
  
  if (tasks.length === 0) {
    emptySettings.classList.remove('hidden');
  } else {
    emptySettings.classList.add('hidden');
    tasks.forEach(task => {
      const el = document.createElement('div');
      el.className = 'bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center group';
      
      const statusIcon = task.status === 'error' 
        ? `<span class="text-red-500 cursor-help" title="${escapeHtml(task.errorMessage || 'Error')}">⚠️</span>` 
        : '<span class="text-green-500">✓</span>';

      el.innerHTML = `
        <div class="overflow-hidden flex-1 mr-2">
          <div class="flex items-center gap-2">
            <h3 class="font-medium text-slate-800 text-sm truncate">${escapeHtml(task.name)}</h3>
            ${statusIcon}
          </div>
          <p class="text-xs text-slate-400 truncate mt-0.5 font-mono">${escapeHtml(task.url)}</p>
          <p class="text-[10px] text-slate-400 mt-1">Selector: <code class="bg-slate-100 px-1 rounded">${escapeHtml(task.selector)}</code></p>
        </div>
        <button class="btn-delete p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Delete Task">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      `;

      el.querySelector('.btn-delete').addEventListener('click', () => {
        if (confirm(`Stop monitoring "${task.name}"?`)) {
          const newTasks = tasks.filter(t => t.id !== task.id);
          chrome.storage.local.set({ tasks: newTasks });
        }
      });

      listTasks.appendChild(el);
    });
  }
}

// --- Helper Functions ---

function switchView(viewName) {
  Object.values(views).forEach(el => el.classList.remove('active'));
  views[viewName].classList.add('active');
  
  // Toggle header active state
  if (viewName === 'settings' || viewName === 'addTask') {
    btnSettings.classList.add('bg-indigo-50', 'text-indigo-600');
  } else {
    btnSettings.classList.remove('bg-indigo-50', 'text-indigo-600');
  }
}

function toggleView(viewName) {
  if (views[viewName].classList.contains('active')) {
    switchView('dashboard');
  } else {
    switchView(viewName);
  }
}

function updateCheckButton(spinning) {
  if (spinning) {
    btnCheckNow.classList.add('animate-spin', 'text-indigo-500');
  } else {
    btnCheckNow.classList.remove('animate-spin', 'text-indigo-500');
  }
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
