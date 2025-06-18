"""
Website screenshot + DreamSim embedding service  •  Modal 1.0-compatible
– Pre-downloads DreamSim weights into the image
– Keeps one warm container with model + Chromium
– FastAPI endpoints:
      POST   /          {"url": "<site>"}  → screenshot + embedding
      POST   /image     {"image": "<base64>"}  → embedding
      POST   /dom       {"dom": "<html>"}  → dom embedding
      GET    /health    → {"status": "ok", …}
"""

import io, base64, modal
from typing import Dict, Any, Optional
from PIL import Image
import torch
import warnings
from contextlib import contextmanager
import os
import sys

@contextmanager
def suppress_stdout():
    """Context manager to suppress stdout during model loading"""
    with open(os.devnull, "w") as devnull:
        old_stdout = sys.stdout
        sys.stdout = devnull
        try:
            yield
        finally:
            sys.stdout = old_stdout

# ───────────────────────── 0.  Build image (weights baked in)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        [
            "numpy==1.24.4",
            "fastapi[standard]==0.115.6",
            "playwright==1.41.0",
            "torch>=2.6.0",
            "torchvision>=0.19.0",
            "timm>=0.9.16",
            "Pillow==10.2.0",
            "requests==2.31.0",
            "dreamsim",
            "transformers>=4.44.0",
            "beautifulsoup4==4.12.2",
        ]
    )
    # download the DreamSim checkpoint at build-time
    .run_commands(
        'python -c "from dreamsim import dreamsim; '
        'dreamsim(pretrained=True, device=\'cpu\', dreamsim_type=\'open_clip_vitb32\')"'
    )
    # download the MarkupLM checkpoint at build-time
    .run_commands(
        'python -c "from transformers import MarkupLMProcessor, MarkupLMModel; '
        'MarkupLMProcessor.from_pretrained(\'microsoft/markuplm-base\'); '
        'MarkupLMModel.from_pretrained(\'microsoft/markuplm-base\')"'
    )
    .run_commands("playwright install chromium && playwright install-deps chromium")
)

# ───────────────────────── 1.  App
app = modal.App("website-embed-service")

VIEWPORT = {"width": 1280, "height": 720}
JPEG_Q   = 80
SCREENSHOT_TIMEOUT = 6000  # ms

class DreamSimEmbedder:
    def __init__(self):
        self.model = None
        self.preprocess = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.setup()

    def setup(self):
        """Initialize the DreamSim model and preprocessing transform"""
        if self.model is None:
            from dreamsim import dreamsim
            
            # Use OpenCLIP single-branch model for ~3x speedup over ensemble
            self.model, self.preprocess = dreamsim(
                pretrained=True, 
                device=self.device,
                dreamsim_type="open_clip_vitb32"
            )
            self.model.eval()

    def embed_image(self, img: Image.Image) -> torch.Tensor:
        """Generate embedding for a PIL Image using DreamSim"""
        if not isinstance(img, Image.Image):
            raise ValueError("Input must be a PIL Image")
        
        img = img.convert("RGB")
        img_tensor = self.preprocess(img).to(self.device)
        
        with torch.no_grad():
            # Use DreamSim's embed method to get single image embedding
            embedding = self.model.embed(img_tensor)
        
        return embedding.squeeze().cpu()

    def embed_buffer(self, buffer: bytes) -> torch.Tensor:
        """Generate embedding for an image buffer"""
        img = Image.open(io.BytesIO(buffer))
        return self.embed_image(img)

class DOMEmbedder:
    def __init__(self):
        self.processor = None
        self.model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.setup()

    def setup(self):
        """Initialize the MarkupLM model and tokenizer"""
        if self.model is None:
            # Suppress warnings and stdout during model loading
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                with suppress_stdout():
                    from transformers import MarkupLMProcessor, MarkupLMModel
                    
                    # Load MarkupLM processor (feature extractor + tokenizer) and model
                    self.processor = MarkupLMProcessor.from_pretrained("microsoft/markuplm-base")
                    self.model = MarkupLMModel.from_pretrained("microsoft/markuplm-base")
                    self.model.to(self.device)
                    self.model.eval()

    def embed_dom(self, html_content: str) -> torch.Tensor:
        """Generate embedding for DOM tree using MarkupLM with Processor"""
        # Processor handles HTML parsing and tokenization
        encoding = self.processor(
            html_content,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512
        )

        # Move tensors to device
        encoding = {k: v.to(self.device) for k, v in encoding.items()}

        # Generate embeddings
        with torch.no_grad():
            outputs = self.model(**encoding)
            embedding = outputs.last_hidden_state[:, 0, :]  # CLS token

        return embedding.squeeze().cpu()

    def embed_base64(self, base64_html: str) -> torch.Tensor:
        """Generate embedding for a base64-encoded HTML string"""
        # Decode base64 HTML content
        html_content = base64.b64decode(base64_html).decode('utf-8')
        return self.embed_dom(html_content)

# ───────────────────────── 2.  Warm container
@app.cls(image=image, cpu=2.0, memory=2048, timeout=300, min_containers=1)
class Embedder:
    @modal.enter()                          # runs once per warm container
    async def setup(self):
        from playwright.async_api import async_playwright
        
        # Initialize DreamSim embedder
        self.embedder = DreamSimEmbedder()
        
        # Initialize DOM embedder
        self.dom_embedder = DOMEmbedder()
        
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

    @modal.method()
    async def embed_dom(self, html_content: str = None, html_base64: str = None) -> Dict[str, Any]:
        try:
            if html_base64:
                # Generate embedding from base64-encoded HTML
                feat = self.dom_embedder.embed_base64(html_base64)
            elif html_content:
                # Generate embedding from HTML string
                feat = self.dom_embedder.embed_dom(html_content)
            else:
                return {
                    "success": False,
                    "error": "Either html_content or html_base64 parameter is required"
                }
            
            return {
                "success": True,
                "embedding": feat.tolist(),
                "dimensions": feat.shape[-1],
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"DOM embedding failed: {str(e)}"
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
@modal.fastapi_endpoint(method="POST")
def web_embed_dom(item: dict):
    """POST /dom   – body: {"dom": "<html>"} or {"dom_base64": "<base64_html>"}"""
    dom_content = item.get("dom")
    dom_base64 = item.get("dom_base64")
    
    if dom_content or dom_base64:
        return Embedder().embed_dom.remote(html_content=dom_content, html_base64=dom_base64)
    else:
        return {"success": False, "error": "Either dom or dom_base64 parameter is required"}

@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def web_health_check():
    """GET /health"""
    return {"status": "ok", "service": "website-embed-service"}

# ───────────────────────── 4.  Local test
@app.local_entrypoint()
def main(url: str = "https://example.com"):
    print(Embedder().generate.remote(url))
