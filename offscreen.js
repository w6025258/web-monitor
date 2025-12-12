
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
      return { text: '', href: undefined, pageTitle };
    }

    // --- ENHANCED TEXT EXTRACTION ---
    const text = formatElementText(element);
    
    // Extract Link if available
    let href = undefined;
    if (element.tagName === 'A') {
      href = element.getAttribute('href') || undefined;
    } else {
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

/**
 * Formats DOM element text to be human-readable.
 * Preserves newlines for block elements, removes scripts, normalizes whitespace.
 */
function formatElementText(element) {
  if (!element) return '';
  
  // 1. Clone node to avoid modifying the parsed document structure (if we needed it later)
  const clone = element.cloneNode(true);

  // 2. Remove noise tags
  const junkTags = clone.querySelectorAll('script, style, noscript, iframe, svg, img, video, audio');
  junkTags.forEach(el => el.remove());

  // 3. Replace <br> with newline
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

  // 4. Inject newlines around block elements to ensure separation
  //    DOMParser nodes are not rendered, so we manually simulate layout structure.
  const blockTags = [
    'DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 
    'ARTICLE', 'SECTION', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE'
  ];
  
  blockTags.forEach(tagName => {
    const blocks = clone.querySelectorAll(tagName);
    blocks.forEach(blk => {
      // Prepend and append a newline text node
      blk.before(document.createTextNode('\n'));
      blk.after(document.createTextNode('\n'));
    });
  });

  // 5. Get raw text content (now contains injected newlines)
  let rawText = clone.textContent || '';

  // 6. Clean up whitespace
  // - Replace non-breaking spaces with normal spaces
  // - Collapse multiple spaces/tabs into one space
  // - Collapse multiple newlines into one newline
  // - Trim edges
  return rawText
    .replace(/\u00A0/g, ' ') 
    .replace(/[ \t]+/g, ' ')      // Collapse horizontal whitespace
    .replace(/\n\s*/g, '\n')      // Collapse whitespace at start of line
    .replace(/\s*\n/g, '\n')      // Collapse whitespace at end of line
    .replace(/\n+/g, '\n')        // Collapse multiple empty lines
    .trim();
}
