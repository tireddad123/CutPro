
#!/usr/bin/env python3
# apply_patches.py — patches CutPro Web files in-place
import os, re, json, sys

ROOT = os.getcwd()

print("Working directory:", ROOT)

paths = {
  'sw': os.path.join(ROOT, 'sw.js'),
  'manifest': os.path.join(ROOT, 'manifest.json'),
  'html_upper': os.path.join(ROOT, 'Index.html'),
  'html_lower': os.path.join(ROOT, 'index.html'),
}

summary = {}

# 1) Patch sw.js
sw_path = paths['sw']
if os.path.exists(sw_path):
    with open(sw_path, 'r', encoding='utf-8') as f:
        sw = f.read()
    orig = sw
    # Repair malformed short-circuit chains
    sw = re.sub(r"return\s+cached[\s\
]+await\s+networkPromise[\s\
]+offlineFallback\(request\);",
                "return cached || await networkPromise || offlineFallback(request);",
                sw)
    sw = re.sub(r"return\s+cached[\s\
]+offlineFallback\(request\);",
                "return cached || offlineFallback(request);",
                sw)
    sw = re.sub(r"const\s+fallback\s*=\s*await\s+cache\.match\('/index\.html'\)[\s\
]+await\s+cache\.match\('\/'\);",
                "const fallback = (await cache.match('/index.html')) || (await cache.match('/'));",
                sw)
    if sw != orig:
        with open(sw_path, 'w', encoding='utf-8') as f:
            f.write(sw)
        summary['sw.js'] = 'patched'
    else:
        summary['sw.js'] = 'no_change_needed'
else:
    summary['sw.js'] = 'missing'

# 2) Patch manifest.json
man_path = paths['manifest']
if os.path.exists(man_path):
    with open(man_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    changed = False
    if manifest.get('start_url') != '/index.html':
        manifest['start_url'] = '/index.html'
        changed = True
    if manifest.get('scope') != '/':
        manifest['scope'] = '/'
        changed = True
    if changed:
        with open(man_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
        summary['manifest.json'] = 'patched'
    else:
        summary['manifest.json'] = 'no_change_needed'
else:
    summary['manifest.json'] = 'missing'

# 3) Patch Index.html/index.html
html_path = paths['html_upper'] if os.path.exists(paths['html_upper']) else paths['html_lower']
if os.path.exists(html_path):
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    orig_html = html
    changed = False
    # Remove Google Fonts Lucida Grande import lines
    html = re.sub(r"^\s*@import\s+url\(['"]https://fonts.googleapis.com/.*Lucida\+Grande.*?\);\s*$",
                  "",
                  html, flags=re.MULTILINE)
    # Normalize links to lowercase index.html
    html = html.replace('/Index.html', '/index.html')

    # Remove second LUT section
    def remove_second_lut_section(text):
        pattern = re.compile(r'<div[^>]*id\s*=\s*"lut-section"[^>]*>', re.IGNORECASE)
        matches = list(pattern.finditer(text))
        if len(matches) <= 1:
            return text, False
        start = matches[1].start()
        # balance <div> ... </div>
        i = start
        depth = 0
        end = None
        while i < len(text):
            m = re.search(r'<(/)?div|<div|</div', text[i:], flags=re.IGNORECASE)
            if not m:
                break
            tag_start = i + m.start()
            closing = text[tag_start:tag_start+2].lower() == '</'
            if closing:
                depth -= 1
                if depth <= 0:
                    # move to end of current closing tag
                    close_gt = text.find('>', tag_start)
                    if close_gt != -1:
                        end = close_gt + 1
                        break
                    else:
                        break
            else:
                depth += 1
            i = tag_start + len(m.group(0))
        if end is None:
            # fallback: remove to next </div>
            m2 = re.search(r'</div\s*>', text[start:], flags=re.IGNORECASE)
            if m2:
                end = start + m2.end()
        if end is None:
            return text, False
        return text[:start] + text[end:], True

    html, removed = remove_second_lut_section(html)

    # Ensure SW registration snippet exists
    if 'navigator.serviceWorker.register' not in html:
        sw_snippet = """
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('sw-update-toast')?.classList.add('visible');
          }
        });
      });
    }).catch(err => console.error('SW registration failed', err));
  });
}
</script>
"""
        # insert before </body>
        html = re.sub(r"</body>\s*</html>\s*$", sw_snippet + "</body></html>", html, flags=re.IGNORECASE)

    if html != orig_html:
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html)
        changed = True

    # Rename Index.html to index.html
    upper = paths['html_upper']
    lower = paths['html_lower']
    if os.path.exists(upper):
        try:
            if os.path.exists(lower):
                os.remove(upper)
                summary['Index.html'] = 'removed (index.html already exists)'
            else:
                os.rename(upper, lower)
                summary['Index.html'] = 'renamed to index.html'
        except Exception as e:
            summary['Index.html_rename_error'] = str(e)

    summary['index.html'] = 'patched' if changed else 'no_change_needed'
else:
    summary['index.html'] = 'missing'

print("
Patch summary:")
for k,v in summary.items():
    print(f" - {k}: {v}")
