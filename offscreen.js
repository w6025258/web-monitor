
console.log("[Offscreen] Loaded and ready to scrape");

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPE_URL') {
    const { url, selector } = msg.payload;
    
    scrapeAndParse(url, selector)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.toString() }));

    return true; // Indicates async response
  }
});

async function scrapeAndParse(url, selector) {
  try {
    // Set a timeout for the fetch request (15 seconds)
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    // Mimic standard browser headers
    const response = await fetch(url, { 
      signal: controller.signal,
      cache: 'no-cache',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const htmlString = await response.text();
    
    // Parse
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    
    const pageTitle = doc.title || 'No Title';

    // Find element
    const element = doc.querySelector(selector);
    
    if (!element) {
      // Return empty text but include pageTitle for debugging in background.js
      // This helps users know if they are on the right page or blocked (e.g., "403 Forbidden", "Login")
      return { text: '', href: undefined, pageTitle };
    }

    // Extract Text (normalize whitespace)
    const text = (element.textContent || '').trim().replace(/\s+/g, ' ');

    // Extract Link if available
    let href = undefined;
    
    if (element.tagName === 'A') {
      href = element.getAttribute('href') || undefined;
    } else {
      // Try to find a link inside the selected element
      const childLink = element.querySelector('a');
      if (childLink) {
        href = childLink.getAttribute('href') || undefined;
      }
    }

    // Resolve relative URLs
    if (href) {
      try {
        href = new URL(href, url).href;
      } catch (e) {
        // Keep original if resolution fails
      }
    }

    return { text, href, pageTitle };

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out (15s)');
    }
    console.error(`[Offscreen] Fetch failed for ${url}:`, error);
    throw new Error(error.message || 'Network/CORS Error');
  }
}
