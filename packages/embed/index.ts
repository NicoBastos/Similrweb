import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Modal endpoint configuration for web API
const MODAL_ENDPOINT = 'https://nicobastos--website-embed-service-web-generate-screensho-5f0b0c.modal.run';
const MODAL_TIMEOUT = 30000; // 30 seconds

export interface EmbedResult {
  success: boolean;
  embedding?: number[];
  dimensions?: number;
  screenshot?: string; // base64 encoded
  error?: string;
}

/**
 * Generate an embedding for an image using the CLIP model locally
 * This runs the Python script directly without Modal for better performance in seed scripts
 */
export async function embedImage(imageBuffer: Buffer): Promise<number[]> {
  try {
    // Convert buffer to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Path to the local Python embedder script
    const pythonScript = resolve(__dirname, 'local_embedder.py');
    
    // Execute Python script
    const { stdout, stderr } = await execAsync(`python3 "${pythonScript}" "${base64Image}"`);
    
    // Only treat stderr as an error if we don't have valid stdout or if the process failed
    // This allows warnings (like PEFT warnings) to be ignored while still catching real errors
    if (!stdout && stderr) {
      throw new Error(`Python process error: ${stderr}`);
    }
    
    // Log stderr warnings but don't fail the process
    if (stderr) {
      console.warn('Python process warning:', stderr.trim());
    }
    
    const result = JSON.parse(stdout.trim());
    
    if (!result.success) {
      throw new Error(result.error || 'Python embedding process failed');
    }
    
    if (!result.embedding || !Array.isArray(result.embedding)) {
      throw new Error('Invalid embedding received from Python process');
    }
    
    return result.embedding;
  } catch (error) {
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
  }
}
