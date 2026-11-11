// Sends the password reset email.
// If email is not set up in .env (SMTP_HOST is empty), the link is printed in the server terminal instead.
// That is the normal way to test a reset during development.
async function sendResetEmail(to, link) {
  if (!process.env.SMTP_HOST) {
    console.log(`\nPASSWORD RESET LINK for ${to}\n(email is not set up, so the link is shown here)\n${link}\n`);
    return;
  }
  const nodemailer = require('nodemailer');   // install with: npm install nodemailer
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT) === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Reset your Ujuzi Connect password',
    text: `We received a request to reset your Ujuzi Connect password.\n\nOpen this link to choose a new one (it works for 30 minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email. Your password will not change.`,
  });
}

module.exports = { sendResetEmail };