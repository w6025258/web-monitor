
console.log("[Offscreen] Loaded");

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPE_URL') {
    const { url, selector } = msg.payload;
    console.log(`[Offscreen] Scraping: ${url} with selector: ${selector}`);
    
    scrapeAndParse(url, selector)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.toString() }));

    return true; // Indicates async response
  }
});

async function scrapeAndParse(url, selector) {
  try {
    const response = await fetch(url, { 
      cache: 'no-cache',
      // Optional: Add headers if needed, but simple fetch usually works for public sites
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const htmlString = await response.text();
    
    // Parse
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    
    // Find element
    const element = doc.querySelector(selector);
    
    if (!element) {
      console.warn(`[Offscreen] Selector "${selector}" not found on ${url}`);
      return { text: '', href: undefined };
    }

    // Extract Text
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
    console.error(`[Offscreen] Error fetching/parsing ${url}:`, error);
    throw error;
  }
}
