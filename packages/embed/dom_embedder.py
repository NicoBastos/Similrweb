#!/usr/bin/env python3
"""
DOM embedding script using MarkupLM
Takes a base64-encoded DOM tree as input and returns embeddings using MarkupLM model
"""

import sys
import json
import warnings
import os
import base64
from contextlib import contextmanager
from bs4 import BeautifulSoup
import torch
from transformers import MarkupLMProcessor, MarkupLMModel
import numpy as np

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

class DOMEmbedder:
    def __init__(self):
        self.processor = None
        self.model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.setup()

    def setup(self):
        """Initialize the MarkupLM model and tokenizer"""
        try:
            # Suppress warnings and stdout during model loading
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                with suppress_stdout():
                    # Load MarkupLM processor (feature extractor + tokenizer) and model
                    self.processor = MarkupLMProcessor.from_pretrained("microsoft/markuplm-base")
                    self.model = MarkupLMModel.from_pretrained("microsoft/markuplm-base")
                    self.model.to(self.device)
                    self.model.eval()
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to initialize MarkupLM model: {str(e)}"}))
            sys.exit(1)

    def preprocess_html(self, html_content: str) -> tuple:
        """
        Preprocess HTML content for MarkupLM
        Returns text tokens and xpath information
        """
        try:
            # Parse HTML with BeautifulSoup
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Extract text and build xpath mapping
            text_tokens = []
            xpath_tags = []
            
            # Simple extraction - get all text content with tag information
            for element in soup.find_all(text=True):
                if element.parent and element.strip():
                    text_tokens.append(element.strip())
                    # Simple xpath approximation - just use tag name
                    tag_name = element.parent.name if element.parent.name else "text"
                    xpath_tags.append(f"//{tag_name}")
            
            # Join text tokens
            text_content = " ".join(text_tokens)
            
            return text_content, xpath_tags
            
        except Exception as e:
            raise ValueError(f"Failed to preprocess HTML: {str(e)}")

    def embed_dom(self, html_content: str) -> torch.Tensor:
        """Generate embedding for DOM tree using MarkupLM with Processor"""
        try:
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
        except Exception as e:
            raise ValueError(f"Failed to generate DOM embedding: {str(e)}")

    def embed_dom_string(self, dom_string: str) -> torch.Tensor:
        """Generate embedding for a DOM string"""
        return self.embed_dom(dom_string)

    def embed_base64(self, base64_html: str) -> torch.Tensor:
        """Generate embedding for a base64-encoded HTML string"""
        try:
            # Decode base64 HTML content
            html_content = base64.b64decode(base64_html).decode('utf-8')
            return self.embed_dom(html_content)
        except Exception as e:
            raise ValueError(f"Failed to decode base64 HTML: {str(e)}")

def main():
    # Accept base64 either as a single CLI arg or via STDIN (for long payloads)
    if len(sys.argv) == 2:
        base64_html = sys.argv[1]
    else:
        base64_html = sys.stdin.read().strip()
        if not base64_html:
            print(json.dumps({"success": False, "error": "No base64 HTML supplied via stdin"}))
            sys.exit(1)
    
    try:
        embedder = DOMEmbedder()
        embedding_tensor = embedder.embed_base64(base64_html)
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