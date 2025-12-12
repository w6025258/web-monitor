
// Listen for messages from the background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PARSE_HTML') {
    const { html, selector, url } = msg.payload;
    const result = parseHTML(html, selector, url);
    sendResponse(result);
  }
  // Return true if we needed to do async work, but parsing is synchronous here
});

function parseHTML(htmlString, selector, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  
  // Find element
  const element = doc.querySelector(selector);
  
  if (!element) {
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
      href = new URL(href, baseUrl).href;
    } catch (e) {
      // Keep original if resolution fails
    }
  }

  return { text, href };
}
