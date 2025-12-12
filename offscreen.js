
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
    // Set a timeout for the fetch request (10 seconds)
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { 
      signal: controller.signal,
      cache: 'no-cache',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml'
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
    
    // Find element
    const element = doc.querySelector(selector);
    
    if (!element) {
      // Element not found - Return empty result so background knows
      // Note: We don't throw error here to distinguish between "Network Error" and "Selector Error"
      return { text: '', href: undefined };
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

    return { text, href };

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out (10s)');
    }
    // Network errors (CORS, offline) usually appear here
    console.error(`[Offscreen] Fetch failed for ${url}:`, error);
    throw new Error(error.message || 'Network/CORS Error');
  }
}
