// The real config (your roster, Jira site, project keys) is git-ignored and lives only on this machine.
// A fresh clone has just the example, which the page flags and the refresh endpoint refuses to use.
const files = import.meta.glob(['../../config/report.config.json', '../../config/report.config.example.json'], { eager: true, import: 'default' })
const local = files['../../config/report.config.json']

export const usingExampleConfig = !local
export default local ?? files['../../config/report.config.example.json']
