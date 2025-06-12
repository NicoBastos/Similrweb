#!/usr/bin/env python3
"""
Local DreamSim embedding script for direct use in seed.ts
Runs the DreamSim model locally without Modal infrastructure
Uses OpenCLIP single-branch model for perceptual similarity embeddings
"""

import sys
import json
import base64
import io
import os
import warnings
from contextlib import contextmanager
from PIL import Image
import torch

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

class LocalDreamSimEmbedder:
    def __init__(self):
        self.model = None
        self.preprocess = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.setup()

    def setup(self):
        """Initialize the DreamSim model with OpenCLIP single-branch"""
        try:
            # Suppress warnings and stdout during model loading
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                with suppress_stdout():
                    from dreamsim import dreamsim
                    
                    # Use OpenCLIP single-branch model for ~3x speedup over ensemble
                    self.model, self.preprocess = dreamsim(
                        pretrained=True, 
                        device=self.device,
                        dreamsim_type="open_clip_vitb32"
                    )
                    self.model.eval()
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to initialize DreamSim model: {str(e)}"}))
            sys.exit(1)

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

    def embed_base64(self, base64_image: str) -> torch.Tensor:
        """Generate embedding for a base64-encoded image"""
        image_data = base64.b64decode(base64_image)
        return self.embed_buffer(image_data)

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "Usage: python local_embedder.py <base64_image>"}))
        sys.exit(1)
    
    base64_image = sys.argv[1]
    
    try:
        embedder = LocalDreamSimEmbedder()
        embedding_tensor = embedder.embed_base64(base64_image)
        embedding_list = embedding_tensor.tolist()
        
        result = {
            "success": True,
            "embedding": embedding_list,
            "dimensions": len(embedding_list)
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main() 