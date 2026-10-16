"""Every proxied location sends the visitor's address to the app (2026-10-16).

Locations without X-Forwarded-For made every visitor look like 127.0.0.1 to the app/MCP server,
so per-IP limits there (MCP /token, /register, /revoke) counted everyone as one visitor.
Usage on a server: sudo python3 add-forwarded-headers.py /etc/nginx/sites-available/pm-app
then: sudo nginx -t && sudo systemctl reload nginx
Idempotent: a location that already sends X-Forwarded-For is left alone. Keeps <file>.bak.
Refuses (changes nothing) when a location's proxy_pass sits inside an `if` — nginx does not
allow proxy_set_header there; add the two lines by hand.
"""
import re, shutil, sys

path = sys.argv[1]
src = open(path).read()
out, changed = [], 0
for block in re.split(r'(?=\n[ \t]*location )', src):
    body = re.split(r'\n[ \t]*}[ \t]*\n[ \t]*(?:#[^\n]*\n[ \t]*)*(?:location |server|}|$)', block)[0]
    m = re.search(r'\n([ \t]*)proxy_pass [^\n]*;', block)
    if not m or 'X-Forwarded-For' in body:
        out.append(block); continue
    if re.search(r'\bif\s*\([^)]*\)\s*{[^}]*proxy_pass', block):
        sys.exit(f'REFUSED: proxy_pass inside an if in: {block.strip().splitlines()[0]} - nothing changed')
    ind = m.group(1)
    add = f"{m.group(0)}\n{ind}proxy_set_header X-Real-IP $remote_addr;\n{ind}proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    out.append(block.replace(m.group(0), add, 1)); changed += 1
if changed:
    shutil.copy(path, path + '.bak')
    open(path, 'w').write(''.join(out))
print(f'{changed} location(s) given forwarded headers')
