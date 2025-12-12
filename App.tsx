import React, { useState, useEffect, useCallback } from 'react';
import { MonitorTask, Announcement } from './types';
import { Activity, Plus, Trash2, ExternalLink, Settings, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

declare var chrome: any;

// Enum for tabs
enum Tab {
  DASHBOARD = 'DASHBOARD',
  SETTINGS = 'SETTINGS',
  ADD_TASK = 'ADD_TASK'
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.DASHBOARD);
  const [tasks, setTasks] = useState<MonitorTask[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load data from storage on mount
  useEffect(() => {
    loadData();
    
    // Listen for storage changes (updates from background script)
    const handleStorageChange = (changes: { [key: string]: any }) => {
      if (changes.tasks) setTasks(changes.tasks.newValue);
      if (changes.announcements) setAnnouncements(changes.announcements.newValue);
      if (changes.isChecking) setIsChecking(changes.isChecking.newValue);
    };

    if (chrome.storage) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      if (chrome.storage) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  const loadData = useCallback(() => {
    if (!chrome.storage) return;
    chrome.storage.local.get(['tasks', 'announcements', 'isChecking'], (result: any) => {
      if (result.tasks) setTasks(result.tasks);
      if (result.announcements) setAnnouncements(result.announcements);
      if (result.isChecking) setIsChecking(result.isChecking);
      setLoading(false);
    });
  }, []);

  // Manual Trigger
  const handleCheckNow = () => {
    setIsChecking(true);
    chrome.runtime.sendMessage({ action: 'TRIGGER_CHECK' }, () => {
      // Response handled via storage listener usually, but we can set timeout fallback
    });
  };

  const markAsRead = (id: string) => {
    const updated = announcements.map(a => a.id === id ? { ...a, isRead: true } : a);
    setAnnouncements(updated);
    chrome.storage.local.set({ announcements: updated });
    
    // Clear badge if no unread
    const unreadCount = updated.filter(a => !a.isRead).length;
    if (unreadCount === 0) {
      chrome.action.setBadgeText({ text: '' });
    }
  };

  const deleteTask = (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    const updatedTasks = tasks.filter(t => t.id !== taskId);
    setTasks(updatedTasks);
    chrome.storage.local.set({ tasks: updatedTasks });
  };

  const clearAllAnnouncements = () => {
    setAnnouncements([]);
    chrome.storage.local.set({ announcements: [] });
    chrome.action.setBadgeText({ text: '' });
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-600" />
          <h1 className="font-bold text-slate-800 text-lg">Web Monitor</h1>
        </div>
        <div className="flex items-center gap-2">
           <button 
            onClick={handleCheckNow}
            disabled={isChecking}
            className={`p-2 rounded-full hover:bg-slate-100 transition-colors ${isChecking ? 'animate-spin text-indigo-500' : 'text-slate-600'}`}
            title="Check Now"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setActiveTab(activeTab === Tab.DASHBOARD ? Tab.SETTINGS : Tab.DASHBOARD)}
            className={`p-2 rounded-full transition-colors ${activeTab !== Tab.DASHBOARD ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-100'}`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        {activeTab === Tab.DASHBOARD && (
          <DashboardView 
            announcements={announcements} 
            markAsRead={markAsRead} 
            clearAll={clearAllAnnouncements}
            tasks={tasks}
          />
        )}
        {activeTab === Tab.SETTINGS && (
          <SettingsView 
            tasks={tasks} 
            onDelete={deleteTask} 
            onAdd={() => setActiveTab(Tab.ADD_TASK)} 
          />
        )}
        {activeTab === Tab.ADD_TASK && (
          <AddTaskView 
            onSave={(newTask) => {
              const updated = [...tasks, newTask];
              setTasks(updated);
              chrome.storage.local.set({ tasks: updated });
              setActiveTab(Tab.SETTINGS);
            }} 
            onCancel={() => setActiveTab(Tab.SETTINGS)} 
          />
        )}
      </main>

      {/* Footer / Status Bar */}
      <footer className="bg-white border-t border-slate-200 px-4 py-2 text-xs text-slate-500 flex justify-between items-center">
        <span>Monitored: {tasks.length}</span>
        <span>Unread: {announcements.filter(a => !a.isRead).length}</span>
      </footer>
    </div>
  );
};

// --- Sub Components ---

const DashboardView: React.FC<{
  announcements: Announcement[];
  markAsRead: (id: string) => void;
  clearAll: () => void;
  tasks: MonitorTask[];
}> = ({ announcements, markAsRead, clearAll, tasks }) => {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <div className="bg-slate-100 p-4 rounded-full mb-4">
          <Activity className="w-8 h-8 text-slate-400" />
        </div>
        <p className="text-slate-600 mb-2">No active monitors.</p>
        <p className="text-slate-400 text-xs">Go to settings to add a website to monitor.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-semibold text-slate-700">Latest Updates</h2>
        {announcements.length > 0 && (
          <button onClick={clearAll} className="text-xs text-slate-400 hover:text-red-500">
            Clear All
          </button>
        )}
      </div>

      {announcements.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
          No new announcements found.
        </div>
      ) : (
        announcements.map((item) => (
          <div 
            key={item.id} 
            className={`p-3 rounded-lg border shadow-sm transition-all ${
              !item.isRead ? 'bg-white border-indigo-200 ring-1 ring-indigo-50' : 'bg-slate-50 border-slate-200 opacity-75'
            }`}
          >
            <div className="flex justify-between items-start">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600 mb-1 inline-block">
                {item.taskName}
              </span>
              <span className="text-[10px] text-slate-400">
                {new Date(item.foundAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </span>
            </div>
            
            <a 
              href={item.link} 
              target="_blank" 
              rel="noreferrer"
              onClick={() => markAsRead(item.id)}
              className="text-sm font-medium text-indigo-700 hover:underline block mt-1 mb-1 leading-snug"
            >
              {item.title}
            </a>

            {!item.isRead && (
               <div className="flex justify-end mt-2">
                 <button 
                  onClick={() => markAsRead(item.id)}
                  className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 uppercase tracking-wide"
                 >
                   Mark as Read
                 </button>
               </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

const SettingsView: React.FC<{
  tasks: MonitorTask[];
  onDelete: (id: string) => void;
  onAdd: () => void;
}> = ({ tasks, onDelete, onAdd }) => {
  return (
    <div className="space-y-4">
       <div className="flex justify-between items-center">
        <h2 className="font-semibold text-slate-700">Monitored Sites</h2>
        <button 
          onClick={onAdd}
          className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-3 h-3" /> Add Task
        </button>
      </div>

      <div className="space-y-2">
        {tasks.map(task => (
          <div key={task.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center group">
            <div className="overflow-hidden">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-slate-800 text-sm truncate">{task.name}</h3>
                {task.status === 'error' && (
                  <AlertCircle className="w-3 h-3 text-red-500" title={task.errorMessage} />
                )}
                {task.status === 'active' && (
                  <CheckCircle2 className="w-3 h-3 text-green-500" title="Active" />
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5 font-mono">{task.url}</p>
              <p className="text-[10px] text-slate-400 mt-1">
                Selector: <code className="bg-slate-100 px-1 rounded">{task.selector}</code>
              </p>
            </div>
            <button 
              onClick={() => onDelete(task.id)}
              className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-xs">
            No monitoring tasks set up.
          </div>
        )}
      </div>
    </div>
  );
};

const AddTaskView: React.FC<{
  onSave: (task: MonitorTask) => void;
  onCancel: () => void;
}> = ({ onSave, onCancel }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selector, setSelector] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url || !selector) {
      setError('All fields are required');
      return;
    }

    try {
      new URL(url); // Validate URL
    } catch {
      setError('Invalid URL format');
      return;
    }

    const newTask: MonitorTask = {
      id: crypto.randomUUID(),
      name,
      url,
      selector,
      lastChecked: 0,
      lastContentHash: '', // Empty means first run will just cache, won't alert (optional logic)
      status: 'active'
    };
    onSave(newTask);
  };

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-slate-700">New Monitor Task</h2>
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Task Name</label>
          <input 
            type="text" 
            className="w-full text-sm p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            placeholder="e.g. Company News"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Target URL</label>
          <input 
            type="url" 
            className="w-full text-sm p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            placeholder="https://example.com/news"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">CSS Selector</label>
          <input 
            type="text" 
            className="w-full text-sm p-2 border border-slate-300 rounded font-mono bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            placeholder=".news-item h3"
            value={selector}
            onChange={e => setSelector(e.target.value)}
          />
          <p className="text-[10px] text-slate-500 mt-1">Identifies the text content to monitor for changes.</p>
        </div>

        {error && <div className="text-red-500 text-xs">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button 
            type="button" 
            onClick={onCancel}
            className="flex-1 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="flex-1 py-2 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 shadow-sm"
          >
            Save Task
          </button>
        </div>
      </form>
    </div>
  );
};

export default App;