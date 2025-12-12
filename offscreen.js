
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
      return { text: '', html: '', href: undefined, pageTitle };
    }

    // --- HTML PRE-PROCESSING ---
    // 1. Resolve Relative URLs to Absolute URLs
    // We modify the DOM element directly before extracting innerHTML
    const base = new URL(url);

    element.querySelectorAll('a').forEach(a => {
      try {
        if (a.getAttribute('href')) {
          a.href = new URL(a.getAttribute('href'), base).href;
          a.target = "_blank"; // Force open in new tab
        }
      } catch(e) {}
    });

    element.querySelectorAll('img').forEach(img => {
      try {
        if (img.getAttribute('src')) {
          img.src = new URL(img.getAttribute('src'), base).href;
          img.style.maxWidth = '100%'; // Prevent overflow
        }
      } catch(e) {}
    });

    // 2. Remove dangerous or noisy tags
    element.querySelectorAll('script, style, iframe, frame, object, embed, form, button, input').forEach(el => el.remove());
    
    // 3. Remove inline event handlers (security) and classes (style isolation)
    const allElements = element.querySelectorAll('*');
    allElements.forEach(el => {
      const attrs = el.attributes;
      for (let i = attrs.length - 1; i >= 0; i--) {
        const name = attrs[i].name;
        if (name.startsWith('on') || name === 'class' || name === 'id') {
          el.removeAttribute(name);
        }
      }
    });

    // Get Cleaned HTML
    let cleanHtml = element.innerHTML.trim();
    
    // Also get text for summary/hash purposes
    const cleanText = element.textContent.trim().replace(/\s+/g, ' ');

    // Extract Link if available (Primary link for the card header)
    let href = undefined;
    if (element.tagName === 'A') {
      href = element.getAttribute('href') || undefined;
    } else {
      const childLink = element.querySelector('a');
      if (childLink) {
        href = childLink.getAttribute('href') || undefined;
      }
    }

    return { text: cleanText, html: cleanHtml, href, pageTitle };

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out (15s)');
    }
    console.error(`[Offscreen] Fetch failed for ${url}:`, error);
    throw new Error(error.message || 'Network/CORS Error');
  }
}
