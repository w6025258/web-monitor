export interface MonitorTask {
  id: string;
  name: string;
  url: string;
  selector: string;
  lastChecked: number;
  lastContentHash: string; // Used to detect changes
  lastResult?: string; // The text content found
  status: 'active' | 'error';
  errorMessage?: string;
}

export interface Announcement {
  id: string; // Unique ID for the specific update
  taskId: string;
  taskName: string;
  title: string;
  link: string; // Usually the task URL, or a specific link if parsed
  foundAt: number;
  isRead: boolean;
}

export interface AppState {
  tasks: MonitorTask[];
  announcements: Announcement[];
  isChecking: boolean;
}

// Message types for communication between Background and Offscreen
export type OffscreenMessage = {
  type: 'PARSE_HTML';
  payload: {
    html: string;
    selector: string;
    url: string;
  };
};

export type ParseResult = {
  text: string;
  href?: string; // If the selector points to an <a> tag
};