// backend/emailSender.js  (SMTP only, via nodemailer)
import nodemailer from "nodemailer";

const {
  SMTP_HOST = "smtp.gmail.com",
  SMTP_PORT = "465",
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  EMAIL_USER,
  EMAIL_PASS,
} = process.env;

const user = SMTP_USER || EMAIL_USER;
const pass = SMTP_PASS || EMAIL_PASS;
const port = Number(SMTP_PORT);

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465, // 465 = SSL, 587 = STARTTLS
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

export async function sendRawEmail({ to, subject, text, html, attachments, cc, bcc }) {
  if (!user || !pass) {
    return { success: false, error: "SMTP credentials not configured (SMTP_USER / SMTP_PASS)" };
  }
  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM || `"ChipEdge Technologies" <${user}>`,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("SMTP send error:", err.message);
    return { success: false, error: err.message };
  }
}