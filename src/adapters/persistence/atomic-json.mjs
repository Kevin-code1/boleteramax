import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

let _tmpCounter = 0;

export function readJsonArraySync(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new TypeError(`Contenido no es un arreglo JSON: ${filePath}`);
  }
  return parsed;
}

export async function writeJsonFileAtomic(filePath, value, { fsImpl = fsp } = {}) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${_tmpCounter++}.tmp`);
  const data = JSON.stringify(value, null, 2);

  try {
    await fsImpl.writeFile(tmpPath, data);
    await fsImpl.rename(tmpPath, filePath);
  } catch (error) {
    await fsImpl.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}
