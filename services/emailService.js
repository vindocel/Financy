import axios from "axios";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import logger from "./logger.js";

function fromAddress() {
  const name = config.email.fromName || "";
  const email = config.email.senderEmail;
  return name ? `${name} <${email}>` : email;
}

export async function sendEmail({ to, subject, html, text }) {
  const driver = config.email.driver;

  if (!to || !subject) throw new Error("sendEmail: 'to' and 'subject' are required");

  if (driver === "console") {
    logger.info({ to, subject }, "Email (console) simulated");
    if (config.logFormat !== "json") {
      console.log("--- EMAIL (console) ---\nTo:", to, "\nSubject:", subject, "\nHTML:\n", html || "", "\nText:\n", text || "");
    }
    return { ok: true, driver };
  }

  if (driver === "mailpit") {
    const transport = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: false,
    });
    const info = await transport.sendMail({
      from: fromAddress(),
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
    });
    logger.info({ messageId: info.messageId }, "Email sent via Mailpit");
    return { ok: true, driver, id: info.messageId };
  }

  if (driver === "resend") {
    if (!config.email.resendApiKey) throw new Error("RESEND_API_KEY ausente para EMAIL_DRIVER=resend");
    const r = await axios.post(
      "https://api.resend.com/emails",
      {
        from: fromAddress(),
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      },
      { headers: { Authorization: `Bearer ${config.email.resendApiKey}` } }
    );
    logger.info({ id: r?.data?.id }, "Email sent via Resend");
    return { ok: true, driver, id: r?.data?.id };
  }

  throw new Error(`EMAIL_DRIVER desconhecido: ${driver}`);
}

export default { sendEmail };

