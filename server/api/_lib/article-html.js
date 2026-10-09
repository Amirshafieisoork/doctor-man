import sanitizeHtml from './vendor/article-sanitizer.mjs';

// Published rich text remains readable while active content and unsafe URLs
// never become part of an article response, including malformed HTML.
export function cleanArticleHtml(value = '') {
  return sanitizeHtml(String(value), {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'code'],
    allowedAttributes: { a: ['href', 'rel'], th: ['scope'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_name, attrs) => {
        let href;
        try {
          const url = new URL(attrs.href);
          if (url.protocol === 'https:') href = url.href;
        } catch {}
        return { tagName: 'a', attribs: href ? { href, rel: 'noopener noreferrer nofollow' } : {} };
      }
    }
  });
}
