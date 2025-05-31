/* packages/embed/index.ts
   CLIP-based image embedding for website screenshot similarity         */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pRetry from 'p-retry';
import pLimit from 'p-limit';

/*─────────────────────────────*
 * 1. Configuration & limits   *
 *─────────────────────────────*/
const limit = pLimit(3);               // only 3 parallel calls for resource management

/*─────────────────────────────*
 * 2. Simple in-process cache  *
 *   key = SHA-256(imageBytes) *
 *─────────────────────────────*/
const cache = new Map<string, number[]>();

function hash(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

/*─────────────────────────────*
 * 3. CLIP embedding via Python*
 *─────────────────────────────*/

/** Call Python CLIP script to embed image */
async function runClipEmbedding(buffer: Buffer): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const python = spawn('.venv/bin/python', ['-c', CLIP_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python CLIP failed (${code}): ${stderr}`));
        return;
      }

      try {
        const embedding = JSON.parse(stdout.trim());
        resolve(embedding);
      } catch (err) {
        reject(new Error(`Failed to parse CLIP output: ${err}`));
      }
    });

    // Send image data as base64
    python.stdin.write(buffer.toString('base64'));
    python.stdin.end();
  });
}

// Python script that uses open-clip to embed images
const CLIP_SCRIPT = `
import sys
import json
import base64
import torch
import open_clip
from PIL import Image
import io

# Load CLIP model - ViT-B/32 produces 512-dimensional embeddings
# You need to update your database schema to vector(512) for CLIP compatibility
model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
model.eval()

# Read base64 image from stdin
img_b64 = sys.stdin.read().strip()
img_bytes = base64.b64decode(img_b64)

# Process image
image = Image.open(io.BytesIO(img_bytes)).convert('RGB')
image_input = preprocess(image).unsqueeze(0)

# Get embedding
with torch.no_grad():
    image_features = model.encode_image(image_input)
    # Normalize for cosine similarity
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    embedding = image_features.squeeze().tolist()

# Output as JSON
print(json.dumps(embedding))
`;

/*─────────────────────────────*
 * 4. Public helper functions  *
 *─────────────────────────────*/

/** Embed a local Buffer or Uint8Array screenshot using CLIP. */
export async function embedImage(buffer: Buffer | Uint8Array): Promise<number[]> {
  const buf = Buffer.from(buffer);
  const key = hash(buf);

  if (cache.has(key)) return cache.get(key)!;

  const vector = await limit(() =>
    pRetry(
      () => runClipEmbedding(buf),
      { retries: 3, factor: 2 } // exponential back-off on failures
    )
  );

  cache.set(key, vector);
  return vector;
}

/*─────────────────────────────*
 * 5. Typed return helpers     *
 *─────────────────────────────*/
export type Embedding = number[];