"""
Website screenshot + CLIP embedding service  •  Modal 1.0-compatible
– Pre-downloads CLIP weights into the image
– Keeps one warm container with model + Chromium
– FastAPI endpoints:
      POST   /          {"url": "<site>"}  → screenshot + embedding
      GET    /health    → {"status": "ok", …}
"""

import io, base64, modal
from typing import Dict, Any

# ───────────────────────── 0.  Build image (weights baked in)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        [
            "numpy==1.24.4",
            "fastapi[standard]==0.115.6",
            "playwright==1.41.0",
            "open-clip-torch==2.24.0",
            "torch==2.1.2",
            "torchvision==0.16.2",
            "timm>=0.9.16",
            "Pillow==10.2.0",
            "requests==2.31.0",
        ]
    )
    # download the ViT-B/32 checkpoint at build-time
    .run_commands(
        'python -c "import open_clip, torch; '
        'open_clip.create_model_and_transforms(\'ViT-B-32\', '
        'pretrained=\'laion2b_s34b_b79k\')"'
    )
    .run_commands("playwright install chromium && playwright install-deps chromium")
)

# ───────────────────────── 1.  App
app = modal.App("website-embed-service")

VIEWPORT = {"width": 1280, "height": 720}
JPEG_Q   = 80
SCREENSHOT_TIMEOUT = 6000  # ms

# ───────────────────────── 2.  Warm container
@app.cls(image=image, cpu=2.0, memory=2048, timeout=300, min_containers=1)
class Embedder:
    @modal.enter()                          # runs once per warm container
    async def setup(self):
        import torch, open_clip
        from playwright.async_api import async_playwright

        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        self.model.eval()

        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch()

    @modal.exit()
    async def teardown(self):
        await self.browser.close()
        await self.pw.stop()

    async def _screenshot(self, url: str) -> bytes | None:
        page = await self.browser.new_page(viewport=VIEWPORT)
        try:
            await page.goto(url, wait_until="domcontentloaded",
                            timeout=SCREENSHOT_TIMEOUT)
            await page.keyboard.press("Escape")          # quick modal dismiss
            return await page.screenshot(
                type="jpeg", quality=JPEG_Q,
                clip={**VIEWPORT, "x": 0, "y": 0}
            )
        finally:
            await page.close()

    @modal.method()
    async def generate(self, url: str) -> Dict[str, Any]:
        import torch
        from PIL import Image

        buf = await self._screenshot(url)
        if not buf:
            return {"success": False, "error": "Screenshot failed", "url": url}

        img = Image.open(io.BytesIO(buf)).convert("RGB")
        tens = self.preprocess(img).unsqueeze(0)
        with torch.no_grad():
            feat = self.model.encode_image(tens)
            feat = feat / feat.norm(dim=-1, keepdim=True)

        return {
            "success": True,
            "url": url,
            "screenshot": base64.b64encode(buf).decode(),
            "embedding": feat.squeeze().tolist(),
            "dimensions": feat.shape[-1],
            "screenshot_size": len(buf),
        }

# ───────────────────────── 3.  FastAPI endpoints
@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def web_generate_screenshot_and_embedding(item: dict):
    """POST /   – body: {"url": "<site>"}"""
    url = item.get("url")
    if not url:
        return {"success": False, "error": "URL parameter is required"}

    # synchronous call inside a sync handler
    return Embedder().generate.remote(url)

@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def web_health_check():
    """GET /health"""
    return {"status": "ok", "service": "website-embed-service"}

# ───────────────────────── 4.  Local test
@app.local_entrypoint()
def main(url: str = "https://example.com"):
    print(Embedder().generate.remote(url))
