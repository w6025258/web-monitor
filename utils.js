// utils.js - Shared utility functions for Web Monitor extension

/**
 * Logging levels
 */
export const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

/**
 * Current log level (can be adjusted based on environment)
 */
let currentLogLevel = LOG_LEVELS.INFO;

/**
 * Set log level
 * @param {number} level - Log level from LOG_LEVELS
 */
export function setLogLevel(level) {
  currentLogLevel = level;
}

/**
 * Logger function
 * @param {number} level - Log level
 * @param {string} module - Module name
 * @param {string} message - Log message
 * @param {any} [data] - Optional data to log
 */
export function log(level, module, message, data = null) {
  if (level > currentLogLevel) return;
  
  const timestamp = new Date().toLocaleTimeString();
  const levelNames = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
  const levelName = levelNames[level] || 'INFO';
  
  const logMessage = `[${timestamp}] [${levelName}] [${module}] ${message}`;
  
  if (data) {
    console[levelName.toLowerCase()](logMessage, data);
  } else {
    console[levelName.toLowerCase()](logMessage);
  }
}

/**
 * Generate a unique ID
 * @returns {string} Unique identifier
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
export function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate SHA-256 hash for a string
 * @param {string} str - String to hash
 * @returns {Promise<string>} SHA-256 hash
 */
export async function generateHash(str) {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Clean and process HTML content
 * @param {HTMLElement} element - DOM element to process
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {{text: string, html: string, href: string|undefined}} Processed content
 */
export function processHtmlContent(element, baseUrl) {
  if (!element) {
    return { text: '', html: '', href: undefined };
  }

  // Create a clone to avoid modifying the original
  const clone = element.cloneNode(true);
  const base = new URL(baseUrl);

  // Process links
  clone.querySelectorAll('a').forEach(a => {
    try {
      if (a.getAttribute('href')) {
        a.href = new URL(a.getAttribute('href'), base).href;
        a.target = "_blank";
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  });

  // Process images
  clone.querySelectorAll('img').forEach(img => {
    try {
      if (img.getAttribute('src')) {
        img.src = new URL(img.getAttribute('src'), base).href;
        img.style.maxWidth = '100%';
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  });

  // Remove dangerous or noisy tags
  clone.querySelectorAll('script, style, iframe, frame, object, embed, form, button, input').forEach(el => el.remove());
  
  // Remove inline event handlers and unnecessary attributes
  clone.querySelectorAll('*').forEach(el => {
    const attrs = el.attributes;
    for (let i = attrs.length - 1; i >= 0; i--) {
      const name = attrs[i].name;
      if (name.startsWith('on') || name === 'class' || name === 'id') {
        el.removeAttribute(name);
      }
    }
  });

  // Extract text and HTML content
  const text = clone.textContent.trim().replace(/\s+/g, ' ');
  const html = clone.innerHTML.trim();

  // Extract primary link
  let href = undefined;
  if (clone.tagName === 'A') {
    href = clone.getAttribute('href') || undefined;
  } else {
    const childLink = clone.querySelector('a');
    if (childLink) {
      href = childLink.getAttribute('href') || undefined;
    }
  }

  return { text, html, href };
}

/**
 * Create a promise with timeout
 * @param {Promise} promise - Promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Timeout message
 * @returns {Promise} Wrapped promise
 */
export function withTimeout(promise, ms, message = 'Operation timed out') {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Create a Promise pool with limited concurrency
 * @param {Array<Function>} tasks - Array of async functions to execute
 * @param {number} limit - Maximum number of concurrent tasks
 * @returns {Promise<Array>} Results of all tasks
 */
export async function promisePool(tasks, limit) {
  const results = [];
  const executing = new Set();

  async function executeNext() {
    if (tasks.length === 0) return;

    const task = tasks.shift();
    const promise = task();
    executing.add(promise);

    try {
      const result = await promise;
      results.push(result);
    } finally {
      executing.delete(promise);
      await executeNext();
    }
  }

  // Start initial batch
  const initialTasks = Array(Math.min(limit, tasks.length)).fill(null);
  await Promise.all(initialTasks.map(executeNext));

  // Wait for all executing tasks to complete
  await Promise.all(executing);

  return results;
}

/**
 * Error handler
 * @param {Error} error - Error object
 * @param {string} module - Module name
 * @param {string} context - Context information
 * @returns {string} Formatted error message
 */
export function handleError(error, module, context) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log(LOG_LEVELS.ERROR, module, `${context}: ${errorMessage}`, error);
  return errorMessage;
}
