// Resets the local admin account to a RANDOM strong password (must_change_password = 1).
// The generated password is printed once to stdout — copy it, log in, and change it.
//
// NOTE: this is a dev-only recovery utility for the legacy SQLite store. It must
// never be shipped inside a packaged build. Do not hardcode a credential here.
//
// Run with: npx electron scripts/reset-admin-password.js
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

// Must match authService.SALT_ROUNDS — a lower cost would weaken every hash this writes.
const SALT_ROUNDS = 12

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const dbPath = path.join(appData, 'sqlsentinel', 'data.db')
console.log('DB path:', dbPath)

// Generate a 16-char password meeting the policy enforced by changePassword()
// (>=8 chars, at least 1 uppercase, 1 number). base64url + guaranteed prefix.
function generatePassword() {
  const random = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '')
  return `A1${random}`
}

async function main() {
  const db = new Database(dbPath)
  const password = generatePassword()
  const hash = await bcrypt.hash(password, SALT_ROUNDS)
  const result = db
    .prepare(`UPDATE users SET password = ?, must_change_password = 1 WHERE username = 'admin'`)
    .run(hash)
  if (result.changes === 0) {
    // user doesn't exist — create it
    db.prepare(
      `INSERT INTO users (username, password, role, must_change_password) VALUES ('admin', ?, 'admin', 1)`
    ).run(hash)
    console.log('Admin user created.')
  } else {
    console.log('Admin password reset.')
  }
  console.log('\n  username: admin')
  console.log(`  password: ${password}`)
  console.log('\nYou must change this password at first login.')
  db.close()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
