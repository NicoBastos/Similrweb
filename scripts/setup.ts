#!/usr/bin/env tsx
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the virtual environment
const venvDir = resolve(__dirname, '..', '.venv');
const embedDir = resolve(__dirname, '..', 'packages', 'embed');

// Use py launcher to ensure we use Python 3.12
const pythonCommand = 'py -3.12';

// Determine the correct python executable path
const pythonExecutable = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python')
  : path.join(venvDir, 'bin', 'python');

const pipExecutable = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'pip')
  : path.join(venvDir, 'bin', 'pip');

async function runCommand(command: string, cwd?: string) {
  console.log(`🔧 Running: ${command}`);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error('❌ Command failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 Setting up Python environment...');

    // Check if Python 3.12 is installed
    try {
      const { stdout } = await execAsync(`${pythonCommand} --version`);
      console.log(`Using ${stdout.trim()}`);
    } catch {
      throw new Error('Python 3.12 is not installed or not available via py launcher. Please install Python 3.12 and try again.');
    }

    // Create virtual environment if it doesn't exist
    if (!existsSync(venvDir)) {
      console.log('📦 Creating Python virtual environment...');
      await runCommand(`${pythonCommand} -m venv .venv`);
    }

    // Install/upgrade pip in the virtual environment
    console.log('🔄 Upgrading pip...');
    await runCommand(`"${pythonExecutable}" -m pip install --upgrade pip`);

    // Install Python dependencies
    console.log('📥 Installing Python dependencies...');
    await runCommand(`"${pipExecutable}" install -r requirements.txt`, embedDir);

    console.log('✅ Python environment setup complete!');
    
  } catch (error) {
    console.error('❌ Setup failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main(); 