// Resets admin password back to Admin1234! (must_change_password = 1)
// Run with: npx electron scripts/reset-admin-password.js
const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const dbPath = path.join(appData, 'sqlsentinel', 'data.db')
console.log('DB path:', dbPath)

async function main() {
  const db = new Database(dbPath)
  const hash = await bcrypt.hash('Admin1234!', 10)
  const result = db
    .prepare(`UPDATE users SET password = ?, must_change_password = 1 WHERE username = 'admin'`)
    .run(hash)
  if (result.changes === 0) {
    // user doesn't exist — create it
    db.prepare(
      `INSERT INTO users (username, password, role, must_change_password) VALUES ('admin', ?, 'admin', 1)`
    ).run(hash)
    console.log('Admin user created with password: Admin1234!')
  } else {
    console.log('Admin password reset to: Admin1234!')
  }
  db.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
