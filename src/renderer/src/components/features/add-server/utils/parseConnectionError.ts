interface ParsedError {
  title: string
  hints: string[]
}

export function parseConnectionError(raw: string): ParsedError {
  const r = raw.toLowerCase()

  if (r.includes('untrusted domain') || r.includes('cannot be used with integrated')) {
    return {
      title: 'Windows Authentication rejected',
      hints: [
        'The server is in a different domain or workgroup.',
        'Switch to SQL Server Authentication and use a SQL login.',
      ]
    }
  }
  if (r.includes('login failed')) {
    if (r.includes("login failed for user ''") || r.includes('windows')) {
      return {
        title: 'Windows Authentication failed',
        hints: [
          'The current Windows account has no SQL Server access.',
          "Ask the DBA to run: CREATE LOGIN [DOMAIN\\\\user] FROM WINDOWS; GRANT CONNECT SQL TO [DOMAIN\\\\user]",
          'Or switch to SQL Server Authentication.',
        ]
      }
    }
    return {
      title: 'Authentication failed',
      hints: [
        'Wrong username or password.',
        'The SQL login may be disabled or locked.',
      ]
    }
  }
  if (r.includes('econnrefused') || r.includes('connection refused')) {
    return {
      title: 'Connection refused',
      hints: [
        'SQL Server is not listening on this port.',
        'Enable TCP/IP in SQL Server Configuration Manager → Protocols → TCP/IP.',
        'Verify the port under TCP/IP → IP Addresses → IPAll → TCP Port.',
      ]
    }
  }
  if (
    r.includes('etimedout') ||
    r.includes('timed out') ||
    r.includes('failed to connect') ||
    r.includes('could not connect')
  ) {
    return {
      title: 'Connection timed out — server unreachable',
      hints: [
        'Verify the SQL Server service is running (services.msc → SQL Server).',
        'Check that the firewall allows the port (Windows Firewall + network firewall).',
        'Confirm the IP address and port are correct.',
      ]
    }
  }
  if (r.includes('enotfound') || r.includes('getaddrinfo')) {
    return {
      title: 'Hostname not found',
      hints: [
        'DNS cannot resolve this hostname.',
        'Use the IP address instead, or check the spelling.',
      ]
    }
  }
  if (r.includes('ssl') || r.includes('tls') || r.includes('certificate') || r.includes('wrong version')) {
    return {
      title: 'SSL / TLS error',
      hints: [
        'SQL Server certificate issue.',
        'In SQL Server Configuration Manager set "Force Encryption" to No.',
      ]
    }
  }
  if (r.includes('cannot open database')) {
    return {
      title: 'Default database not accessible',
      hints: [
        "Run: ALTER LOGIN [loginname] WITH DEFAULT_DATABASE = master",
      ]
    }
  }
  return { title: 'Connection failed', hints: [raw] }
}
