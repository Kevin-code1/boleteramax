import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.join(path.dirname(__filename), '..');

function runServerWithoutDatabaseUrl() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      DOTENV_CONFIG_PATH: path.join(rootDir, 'tests', 'missing-dotenv-for-startup.env'),
      NODE_ENV: 'test',
      PORT: '0',
    };

    delete env.DATABASE_URL;
    delete env.TICKETS_STORAGE;
    delete env.TICKETS_WRITE_MODE;

    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: rootDir,
      env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('server did not fail fast without DATABASE_URL'));
    }, 5000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

test('default postgres-primary startup fails clearly without DATABASE_URL', async () => {
  const result = await runServerWithoutDatabaseUrl();
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.code, 0);
  assert.match(output, /DATABASE_URL no configurada/);
  assert.match(output, /postgres-primary requiere PostgreSQL configurado/);
  assert.equal(/postgres(?:ql)?:\/\//i.test(output), false);
  assert.equal(/token|hash|ADMIN_API_KEY=/i.test(output), false);
});
