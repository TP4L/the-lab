/* THE LAB rich text: a small, safe Markdown subset for posts and lessons.
   Shared by the app (window.LabMarkdown) and the server (public API body_html).
   Everything is escaped first; only these constructs become HTML:
     ## Heading / ### Subheading      paragraphs (blank line between)
     - item / * item / 1. item        > quote        ---
     **bold**  _italic_  *italic*     [text](https://…) links
     ![caption](media:ID)             a photo or video uploaded to the post */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function safeUrl(u) {
    u = String(u).trim();
    if (/^(https?:\/\/|mailto:)/i.test(u) || /^#\//.test(u)) return u;
    return null;
  }
  /* Inline formatting on raw text; returns HTML. */
  function inline(text) {
    var out = '', i = 0, m;
    var re = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|\*\*([^*\n]{1,500})\*\*|(?:^|(?<=[\s(]))_([^_\n]{1,300})_(?=$|[\s.,;:!?)])|(?:^|(?<=[\s(]))\*([^*\n]{1,300})\*(?=$|[\s.,;:!?)])/g;
    while ((m = re.exec(text))) {
      out += esc(text.slice(i, m.index));
      if (m[1] !== undefined) {
        var url = safeUrl(m[2]);
        out += url ? '<a href="' + esc(url) + '"' + (/^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + inline(m[1]) + '</a>' : esc(m[0]);
      } else if (m[3] !== undefined) out += '<strong>' + inline(m[3]) + '</strong>';
      else out += '<em>' + inline(m[4] !== undefined ? m[4] : m[5]) + '</em>';
      i = m.index + m[0].length;
    }
    return out + esc(text.slice(i));
  }
  /* opts.media: { id: mime } for media belonging to this post or lesson.
     opts.mediaUrl: id => url (default /api/media/<id>). */
  function render(src, opts) {
    opts = opts || {};
    var media = opts.media || {}, mediaUrl = opts.mediaUrl || function (id) { return '/api/media/' + id; };
    var used = [];
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var html = [], para = [], list = null, quote = [];
    function flushPara() { if (para.length) { html.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<' + list.tag + '>' + list.items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    function flushQuote() { if (quote.length) { html.push('<blockquote><p>' + quote.map(inline).join('<br>') + '</p></blockquote>'); quote = []; } }
    function flush() { flushPara(); flushList(); flushQuote(); }
    lines.forEach(function (line) {
      var t = line.trim(), m;
      if (!t) { flush(); return; }
      if ((m = /^!\[([^\]]{0,200})\]\(media:([A-Za-z0-9-]{8,40})\)$/.exec(t))) {
        flush();
        var id = m[2], mime = media[id];
        if (!mime) return; // not this post's media: drop it rather than link out
        used.push(id);
        var cap = m[1] ? '<figcaption>' + esc(m[1]) + '</figcaption>' : '';
        html.push(mime.indexOf('video/') === 0
          ? '<figure><video controls playsinline preload="metadata" src="' + esc(mediaUrl(id)) + '"></video>' + cap + '</figure>'
          : '<figure><img alt="' + esc(m[1]) + '" loading="lazy" src="' + esc(mediaUrl(id)) + '">' + cap + '</figure>');
        return;
      }
      if ((m = /^(#{2,3})\s+(.+)$/.exec(t))) { flush(); html.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); return; }
      if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); html.push('<hr>'); return; }
      if ((m = /^>\s?(.*)$/.exec(t))) { flushPara(); flushList(); quote.push(m[1]); return; }
      if ((m = /^[-*]\s+(.+)$/.exec(t)) || (m = /^\d{1,3}[.)]\s+(.+)$/.exec(t))) {
        var tag = /^\d/.test(t) ? 'ol' : 'ul';
        flushPara(); flushQuote();
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag: tag, items: [] };
        list.items.push(m[1]); return;
      }
      flushList(); flushQuote(); para.push(t);
    });
    flush();
    return opts.withUsed ? { html: html.join('\n'), used: used } : html.join('\n');
  }
  return { render: render, escape: esc };
});
