'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

(async () => {
  const target = path.join(__dirname, '.env');
  if (fs.existsSync(target)) {
    console.log('.env already exists. It was left unchanged. Edit it directly to update settings.');
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\nJimnaya first-time setup\n');
    console.log('Choose a strong admin password of at least 16 characters. Input is visible while typing.');
    let password = '';
    while (password.length < 16) {
      password = await rl.question('Admin password: ');
      if (password.length < 16) console.log('Use at least 16 characters.');
    }
    const env = [
      '# Jimnaya website configuration — keep this file private.',
      'NODE_ENV=development', 'PORT=3000', 'DATA_DIR=./data',
      `ADMIN_PASSWORD=${password.replace(/\\/g, '\\\\').replace(/[\r\n]/g, '')}`,
      `SESSION_SECRET=${crypto.randomBytes(48).toString('hex')}`,
      'PUBLIC_SITE_URL=', 'BUSINESS_PHONE=', 'BUSINESS_EMAIL=', 'WHATSAPP_NUMBER=',
      'BUSINESS_ADDRESS=', 'BUSINESS_HOURS=', 'RESEND_API_KEY=', 'NOTIFICATION_EMAIL=', 'FROM_EMAIL='
    ].join('\n') + '\n';
    fs.writeFileSync(target, env, { flag: 'wx', mode: 0o600 });
    console.log('\nSetup complete. A private .env file and random session secret have been created.');
    console.log('You can add verified business contact details and email settings to .env later.');
    console.log('Run: npm start');
    console.log('Website: http://localhost:3000');
    console.log('Admin:   http://localhost:3000/admin');
  } finally { rl.close(); }
})().catch(error => { console.error('Setup failed:', error.message); process.exitCode = 1; });
