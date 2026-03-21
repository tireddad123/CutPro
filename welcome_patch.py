#!/usr/bin/env python3
import re, sys
from pathlib import Path

p = Path('index.html')
if not p.exists():
    print('ERROR: index.html not found in current folder.')
    sys.exit(1)
html = p.read_text(encoding='utf-8')
changed = False

# Ensure .hidden rule exists (adds once inside first </style>)
if '.hidden{display:none' not in html and '.hidden { display:' not in html:
    html = html.replace('</style>', '\n.hidden{display:none !important;}\n</style>', 1)
    changed = True

# Inject welcome overlay handlers if not present
if 'cutpro.welcomeDismissed' not in html:
    snippet = """
<script>
// Welcome overlay handlers — dismiss + persist preference
(function(){
  const overlay  = document.getElementById('welcome-overlay');
  const startBtn = document.getElementById('welcome-start');
  const dontShow = document.getElementById('welcome-dont-show');
  try {
    if (localStorage.getItem('cutpro.welcomeDismissed') === '1') {
      overlay?.classList.add('hidden');
    }
  } catch(e) {}
  const dismiss = () => {
    overlay?.classList.add('hidden');
    try { localStorage.setItem('cutpro.welcomeDismissed','1'); } catch(e) {}
  };
  startBtn?.addEventListener('click', dismiss);
  dontShow?.addEventListener('click', dismiss);
})();
</script>
"""
    html = re.sub(r"</body>\s*</html>\s*$", snippet + "</body></html>", html, flags=re.IGNORECASE)
    changed = True

if changed:
    out = Path('index.html')
    out.write_text(html, encoding='utf-8')
    print('Patched index.html successfully.')
else:
    print('No changes needed; handlers already present.')
