import http.server
import json
import subprocess


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            body = b'ready'
        elif self.path == '/value':
            value = subprocess.check_output(['psql', '-Atc', 'SELECT value FROM counter WHERE id=1']).decode().strip()
            body = json.dumps({'value': int(value)}).encode()
        else:
            body = b'<html><body>loading<script>fetch("/value").then(r=>r.json()).then(v=>document.body.textContent="database-value="+v.value)</script></body></html>'
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)


http.server.HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
