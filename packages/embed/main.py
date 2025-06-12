"""
Website screenshot + CLIP embedding service  •  Modal 1.0-compatible
– Pre-downloads CLIP weights into the image
– Keeps one warm container with model + Chromium
– FastAPI endpoints:
      POST   /          {"url": "<site>"}  → screenshot + embedding
      POST   /image     {"image": "<base64>"}  → embedding
      GET    /health    → {"status": "ok", …}
"""

import io, base64, modal
from typing import Dict, Any, Optional
from PIL import Image
import torch
import open_clip

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

class CLIPEmbedder:
    def __init__(self):
        self.model = None
        self.preprocess = None
        self.setup()

    def setup(self):
        """Initialize the CLIP model and preprocessing transform"""
        if self.model is None:
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                "ViT-B-32", pretrained="laion2b_s34b_b79k"
            )
            self.model.eval()

    def embed_image(self, img: Image.Image) -> torch.Tensor:
        """Generate embedding for a PIL Image"""
        if not isinstance(img, Image.Image):
            raise ValueError("Input must be a PIL Image")
        
        img = img.convert("RGB")
        tens = self.preprocess(img).unsqueeze(0)
        
        with torch.no_grad():
            feat = self.model.encode_image(tens)
            feat = feat / feat.norm(dim=-1, keepdim=True)
        
        return feat.squeeze()

    def embed_buffer(self, buffer: bytes) -> torch.Tensor:
        """Generate embedding for an image buffer"""
        img = Image.open(io.BytesIO(buffer)).convert("RGB")
        return self.embed_image(img)

# ───────────────────────── 2.  Warm container
@app.cls(image=image, cpu=2.0, memory=2048, timeout=300, min_containers=1)
class Embedder:
    @modal.enter()                          # runs once per warm container
    async def setup(self):
        from playwright.async_api import async_playwright
        
        # Initialize CLIP embedder
        self.embedder = CLIPEmbedder()
        
        # Initialize browser
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch()

    @modal.exit()
    async def teardown(self):
        await self.browser.close()
        await self.pw.stop()

    async def _screenshot(self, url: str) -> Optional[bytes]:
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
        buf = await self._screenshot(url)
        if not buf:
            return {"success": False, "error": "Screenshot failed", "url": url}

        try:
            feat = self.embedder.embed_buffer(buf)
            return {
                "success": True,
                "url": url,
                "screenshot": base64.b64encode(buf).decode(),
                "embedding": feat.tolist(),
                "dimensions": feat.shape[-1],
                "screenshot_size": len(buf),
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Embedding failed: {str(e)}",
                "url": url
            }

    @modal.method()
    async def embed_image(self, image_base64: str) -> Dict[str, Any]:
        try:
            # Decode base64 image
            image_data = base64.b64decode(image_base64)
            
            # Generate embedding
            feat = self.embedder.embed_buffer(image_data)
            
            return {
                "success": True,
                "embedding": feat.tolist(),
                "dimensions": feat.shape[-1],
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Embedding failed: {str(e)}"
            }

# ───────────────────────── 3.  FastAPI endpoints
@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def web_generate_screenshot_and_embedding(item: dict):
    """POST /   – body: {"url": "<site>"} or {"image": "<base64>"}"""
    url = item.get("url")
    image = item.get("image")
    
    if url:
        return Embedder().generate.remote(url)
    elif image:
        return Embedder().embed_image.remote(image)
    else:
        return {"success": False, "error": "Either URL or image parameter is required"}

@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def web_health_check():
    """GET /health"""
    return {"status": "ok", "service": "website-embed-service"}

# ───────────────────────── 4.  Local test
@app.local_entrypoint()
def main(url: str = "https://example.com"):
    print(Embedder().generate.remote(url))
