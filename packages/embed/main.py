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
    async def embed_dom(self, url: str) -> Dict[str, Any]:
        try:
            # Fetch DOM content from URL using playwright
            dom_content = await self._get_dom_from_url(url)
            if not dom_content:
                return {
                    "success": False,
                    "error": f"Failed to fetch DOM content from URL: {url}"
                }
            
            # Generate embedding from fetched HTML
            feat = self.dom_embedder.embed_dom(dom_content)
            
            return {
                "success": True,
                "url": url,
                "embedding": feat.tolist(),
                "dimensions": feat.shape[-1],
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"DOM embedding failed: {str(e)}",
                "url": url
            }

    async def _get_dom_from_url(self, url: str) -> Optional[str]:
        """Fetch DOM content from a URL using playwright with modal dismissal"""
        page = await self.browser.new_page(viewport=VIEWPORT)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=SCREENSHOT_TIMEOUT)
            
            # Dismiss modals and popups similar to seed.ts
            await self._dismiss_modals(page)
            
            # Get DOM content
            dom_content = await page.content()
            return dom_content
            
        except Exception as e:
            print(f"Error fetching DOM from {url}: {str(e)}")
            return None
        finally:
            await page.close()

    async def _dismiss_modals(self, page):
        """Dismiss modals and popups similar to seed.ts implementation"""
        try:
            # Strategy 1: Try ESC key first
            await page.keyboard.press('Escape')
            await page.wait_for_timeout(300)
            
            # Strategy 2: Comprehensive selector-based dismissal
            close_selectors = [
                # Cookie banners
                '.cookie-banner button:not([class*="accept"]):not([class*="allow"])',
                '.cookie-notice button:not([class*="accept"]):not([class*="allow"])',
                '.gdpr-banner button:not([class*="accept"]):not([class*="allow"])',
                '[data-cookie-banner] button:not([class*="accept"]):not([class*="allow"])',
                'button[class*="cookie"]:not([class*="accept"]):not([class*="allow"])',
                '.consent-banner button:not([class*="accept"]):not([class*="allow"])',
                
                # Generic close buttons
                'button[aria-label*="close"]',
                'button[aria-label*="dismiss"]',
                'button[aria-label*="cancel"]',
                'button[title*="close"]',
                'button[title*="dismiss"]',
                
                # Modal close buttons
                '.modal-close',
                '.popup-close',
                '.dialog-close',
                '.overlay-close',
                '.lightbox-close',
                '[data-dismiss="modal"]',
                '[data-close="modal"]',
                '[data-modal-close]',
                
                # X buttons and icons
                'button[class*="close"]',
                '.close-button',
                '.btn-close',
                '.close-btn',
                'button.close',
                '[role="button"][aria-label*="close"]',
            ]
            
            dismissed = False
            for selector in close_selectors:
                try:
                    elements = await page.query_selector_all(selector)
                    for element in elements:
                        is_visible = await element.is_visible()
                        if is_visible:
                            await element.click()
                            await page.wait_for_timeout(200)
                            dismissed = True
                            break
                    if dismissed:
                        break
                except Exception:
                    continue
            
            # Strategy 3: Click outside modal area (click on backdrop)
            if not dismissed:
                try:
                    backdrop = await page.query_selector('.modal-backdrop, .overlay, .backdrop, [data-backdrop]')
                    if backdrop and await backdrop.is_visible():
                        await backdrop.click()
                        await page.wait_for_timeout(200)
                except Exception:
                    pass
            
            # Strategy 4: Try ESC key again
            await page.keyboard.press('Escape')
            await page.wait_for_timeout(200)
            
            # Final wait for any animations to complete
            await page.wait_for_timeout(500)
            
        except Exception as e:
            print(f"Modal dismissal warning: {str(e)}")

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
    """POST /dom   – body: {"url": "<url>"}"""
    url = item.get("url")
    
    if not url:
        return {"success": False, "error": "URL parameter is required"}
    
    return Embedder().embed_dom.remote(url)

@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def web_health_check():
    """GET /health"""
    return {"status": "ok", "service": "website-embed-service"}

# ───────────────────────── 4.  Local test
@app.local_entrypoint()
def main(url: str = "https://example.com"):
    print(Embedder().generate.remote(url))
