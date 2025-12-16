# System Agents Architecture

This Chrome Extension operates using a multi-agent architecture to securely monitor web content.

## 1. UI Agent (Popup)
- **File:** `popup.js` / `index.html`
- **Type:** User Interface
- **Responsibilities:**
  - Rendering the monitoring dashboard and settings.
  - Handling user inputs (Add/Edit/Delete tasks).
  - Reading from `chrome.storage.local` to display data.
  - Sending command messages (e.g., `TRIGGER_CHECK`, `TEST_SCRAPE`) to the Orchestrator.

## 2. Orchestrator Agent (Background)
- **File:** `background.js`
- **Type:** Service Worker
- **Responsibilities:**
  - **Scheduling:** Manages `chrome.alarms` for periodic checks.
  - **Coordination:** Receives messages from the UI and delegates scraping tasks.
  - **Decision Making:** Decides whether to use the Static or Dynamic scraping strategy based on the target URL's behavior.
  - **State Management:** Updates the extension badge and saves results to storage.

## 3. Static Scraper Agent (Offscreen)
- **File:** `offscreen.js` / `offscreen.html`
- **Type:** Offscreen Document
- **Responsibilities:**
  - Fetching raw HTML from URLs.
  - Using the standard DOM Parser API (unavailable in Service Workers) to parse HTML.
  - Sanitizing content (removing scripts, resolving absolute URLs) before returning data.
  - **Use Case:** Standard static websites.

## 4. Dynamic Scraper Agent (Scripting)
- **File:** `background.js` (Function: `scrapeDynamicContent`)
- **Type:** Script Injection
- **Responsibilities:**
  - Handling JavaScript-heavy (SPA) websites.
  - Creating a hidden popup window to allow the target page to hydrate/render.
  - Injecting a content script to extract the rendered DOM.
  - **Use Case:** Sites that require JS to display content (e.g., React/Vue apps).
