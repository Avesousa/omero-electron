import { app } from 'electron'
import path from 'path'
import fs from 'fs'

interface OmeroSetupConfig {
  lanAccess: boolean
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'omero-setup.json')
}

export function readSetupConfig(): OmeroSetupConfig | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as OmeroSetupConfig
  } catch {
    return null
  }
}

export function writeSetupConfig(config: OmeroSetupConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}
