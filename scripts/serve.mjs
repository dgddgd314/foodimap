// 로컬 미리보기 전용. 배포 서버는 GitHub Pages가 제공합니다.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    // GitHub Pages의 /food/ 배포 경로도 같은 서버에서 확인합니다.
    if (pathname === "/food") {
      response.writeHead(302, { Location: "/food/" });
      response.end();
      return;
    }
    if (pathname.startsWith("/food/")) pathname = pathname.slice(5);
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith("."))) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
    if (!(await stat(target)).isFile()) throw new Error("Not a file");
    const content = await readFile(target);
    response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    response.end(content);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Local: http://127.0.0.1:${port}/food/`));
