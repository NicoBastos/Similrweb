import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the virtual environment
const venvDir = resolve(__dirname, '..', '..', '.venv');

// Determine the correct python executable path
const pythonExecutable = (() => {
  if (process.platform === 'win32') {
    const exePath = path.join(venvDir, 'Scripts', 'python.exe');
    const altPath = path.join(venvDir, 'Scripts', 'python');
    // Prefer python.exe but fall back to python (without extension) for odd setups
    return existsSync(exePath) ? exePath : altPath;
  }
  return path.join(venvDir, 'bin', 'python');
})();

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

// Helper to robustly parse JSON from Python stdout that may contain
// extra log lines before/after the JSON payload. It looks for the first
// opening brace and the last closing brace and attempts to parse the
// slice in between. If parsing still fails we re-throw to the caller.
function safeParsePythonJson(output: string): any {
  const trimmed = output.trim();

  // 1️⃣ Fast path – whole output is JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }

  // 2️⃣ Walk through every "{" looking for a valid JSON object that
  // extends to the end of the string. This is O(n) in practice because
  // we stop at the first success.
  for (let idx = trimmed.indexOf('{'); idx !== -1; idx = trimmed.indexOf('{', idx + 1)) {
    const candidate = trimmed.slice(idx);
    try {
      const parsed = JSON.parse(candidate);
      return parsed; // ✅ Found JSON payload
    } catch {
      // fallback – keep searching
    }
  }

  // 3️⃣ Fallback heuristic – extract between the first and last brace
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      /* ignore */
    }
  }

  throw new Error(
    `Unable to parse JSON from Python output. First 200 chars: ${trimmed.slice(0, 200)}`
  );
}

// Helper to run a python script and feed input via stdin to avoid command-line length limits
async function runPython(scriptPath: string, stdinPayload: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`Python exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    // write payload and close stdin
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

/**
 * Generate an embedding for an image using the CLIP model locally
 * This runs the Python script directly without Modal for better performance in seed scripts
 */
export async function embedImage(imageBuffer: Buffer): Promise<number[]> {
  // Check if python environment is set up
  if (!existsSync(pythonExecutable)) {
    throw new Error(
      `Python executable not found at ${pythonExecutable}. Please run 'npm run setup' first.`
    );
  }

  try {
    // Convert buffer to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Path to the local Python embedder script
    const pythonScript = resolve(__dirname, 'img_embedder.py');
    
    // Execute Python script – pass base64 via stdin to avoid command length limits
    const { stdout, stderr } = await runPython(pythonScript, base64Image);
    
    // Only treat stderr as an error if we don't have valid stdout or if the process failed
    // This allows warnings (like PEFT warnings) to be ignored while still catching real errors
    if (!stdout && stderr) {
      throw new Error(`Python process error: ${stderr}`);
    }
    
    // Log stderr warnings but don't fail the process
    if (stderr) {
      console.warn('Python process warning:', stderr.trim());
    }
    
    const result = safeParsePythonJson(stdout);
    
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

/**
 * Generate an embedding for a DOM tree using MarkupLM locally
 * This runs the Python script directly without Modal for better performance in seed scripts
 */
export async function embedDOM(htmlContent: string): Promise<number[]> {
  // Check if python environment is set up
  if (!existsSync(pythonExecutable)) {
    throw new Error(
      `Python executable not found at ${pythonExecutable}. Please run 'npm run setup' first.`
    );
  }

  try {
    // Path to the DOM Python embedder script
    const pythonScript = resolve(__dirname, 'dom_embedder.py');
    
    // Convert HTML content to base64 to avoid shell escaping issues
    const base64Html = Buffer.from(htmlContent).toString('base64');
    
    // Execute Python script – pass base64 via stdin to avoid command length limits
    const { stdout, stderr } = await runPython(pythonScript, base64Html);
    
    // Log raw output for debugging
    if (stdout) console.log('📤 Debug: Python stdout:', stdout.trim());
    if (stderr) console.log('⚠️ Debug: Python stderr:', stderr.trim());
    
    // Only treat stderr as an error if we don't have valid stdout or if the process failed
    // This allows warnings (like transformers warnings) to be ignored while still catching real errors
    if (!stdout && stderr) {
      throw new Error(`Python process error: ${stderr}`);
    }
    
    // Log stderr warnings but don't fail the process
    if (stderr) {
      console.warn('Python process warning:', stderr.trim());
    }
    
    let result;
    try {
      result = safeParsePythonJson(stdout);
    } catch (error) {
      console.error('❌ Debug: JSON parse error on stdout:', stdout.trim());
      throw new Error(`Failed to parse Python output as JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    if (!result.success) {
      throw new Error(result.error || 'Python DOM embedding process failed');
    }
    
    if (!result.embedding || !Array.isArray(result.embedding)) {
      throw new Error('Invalid embedding received from Python DOM process');
    }
    
    return result.embedding;
  } catch (error) {
    throw new Error(`Failed to generate DOM embedding: ${error instanceof Error ? error.message : String(error)}`);
  }
}
