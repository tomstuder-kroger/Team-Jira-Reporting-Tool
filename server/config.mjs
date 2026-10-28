import fs from 'node:fs'
import path from 'node:path'
import { ConfigError } from './errors.mjs'

export const configPath = (root) => path.join(root, 'config/report.config.json')

/** The local (git-ignored) config. Throws ConfigError if it is missing or not JSON. */
export function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(configPath(root), 'utf8'))
  } catch {
    throw new ConfigError('config/report.config.json is missing or is not valid JSON. Copy config/report.config.example.json to that name and fill in your roster and Jira details.')
  }
}
