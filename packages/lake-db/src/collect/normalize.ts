import { sha256 } from '../sha256.js';

// Tracking parameters to remove from URLs
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'source',
]);

/**
 * Normalize a URL for use as canonical_uri
 * - Lowercase scheme and host
 * - Remove default ports
 * - Remove fragment
 * - Sort query parameters alphabetically
 * - Remove tracking parameters
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // Lowercase scheme and host
    const scheme = parsed.protocol.toLowerCase();
    let host = parsed.hostname.toLowerCase();
    let port = parsed.port;
    
    // Remove default ports
    if ((scheme === 'https:' && port === '443') || 
        (scheme === 'http:' && port === '80')) {
      port = '';
    }
    
    // Build pathname (keep as-is but ensure it starts with /)
    let pathname = parsed.pathname;
    if (!pathname.startsWith('/')) {
      pathname = '/' + pathname;
    }
    
    // Normalize trailing slash (avoid / vs empty path dedupe fracture)
    // Remove trailing slash from all paths, including root
    // This ensures "example.com" and "example.com/" normalize to the same canonical URI
    if (pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    
    // For root path (now empty after removing trailing slash), set to empty string
    // The final URL construction will handle this correctly
    if (pathname === "") {
      pathname = "";
    } else if (!pathname.startsWith('/')) {
      // Re-add leading slash if we somehow lost it (shouldn't happen, but safety)
      pathname = '/' + pathname;
    }
    
    // Sort query parameters alphabetically and remove tracking params
    const params = new URLSearchParams(parsed.search);
    const filteredParams: [string, string][] = [];
    
    for (const [key, value] of params) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) {
        filteredParams.push([key, value]);
      }
    }
    
    // Sort by key, then by value
    filteredParams.sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      if (a[1] < b[1]) return -1;
      if (a[1] > b[1]) return 1;
      return 0;
    });
    
    // Rebuild query string
    const search = filteredParams.length > 0
      ? '?' + filteredParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    
    // Build final URL (no fragment)
    const portPart = port ? `:${port}` : '';
    return `${scheme}//${host}${portPart}${pathname}${search}`;
  } catch {
    // If URL parsing fails, return original in lowercase
    return url.toLowerCase();
  }
}

/**
 * Extract text content from HTML
 * Simple approach: remove script and style tags, then strip all remaining tags
 */
export function extractTextFromHtml(html: string): string {
  // Remove script tags and their content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  
  // Remove style tags and their content
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode common HTML entities
  text = text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#\d+;/g, match => {
      const code = parseInt(match.slice(2, -1), 10);
      return String.fromCharCode(code);
    })
    .replace(/&nbsp;/g, ' ');
  
  return text;
}

/**
 * Normalize text for content_sha256 computation
 * - Extract text from HTML if needed
 * - Normalize whitespace
 * - Trim
 * - Lowercase
 */
export function normalizeText(input: string, isHtml = true): string {
  let text = isHtml ? extractTextFromHtml(input) : input;
  
  // Normalize whitespace (collapse multiple spaces/newlines to single space)
  text = text.replace(/\s+/g, ' ');
  
  // Trim and lowercase
  text = text.trim().toLowerCase();
  
  return text;
}

/**
 * Compute content_sha256 for normalized text
 */
export function computeContentSha256(input: string, isHtml = true): string {
  const normalized = normalizeText(input, isHtml);
  const bytes = Buffer.from(normalized, 'utf-8');
  return sha256(bytes);
}