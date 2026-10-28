// Errors whose messages are safe to show in the page. Nothing here may contain credentials.
export class JiraError extends Error {
  constructor(message, upstreamStatus = null) {
    super(message)
    this.name = 'JiraError'
    this.upstreamStatus = upstreamStatus
  }
}

export class SetupError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SetupError'
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}
