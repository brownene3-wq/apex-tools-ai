/**
 * Notification helpers for the scheduler.
 *   notifySuccess — sent after each successful publish
 *   notifyError   — sent if a cron handler throws
 *   plainEmail    — generic shortcut
 */
import { sendEmail } from "./resend.js";

export async function notifySuccess(env, taskName, { title, url, wordCount, tag, target_keyword }) {
  const subject = `[Apex Scheduler] ${taskName}: published "${title}"`;
  const body = [
    `Task: ${taskName}`,
    `Title: ${title}`,
    `URL: ${url}`,
    wordCount ? `Word count: ${wordCount}` : null,
    tag ? `Tag: ${tag}` : null,
    target_keyword ? `Target keyword: ${target_keyword}` : null,
    "",
    `Published at: ${new Date().toISOString()}`,
  ].filter(Boolean).join("\n");

  return sendEmail(env, {
    to: env.NOTIFY_EMAIL_TO || "hello@apextoolsai.com",
    subject,
    text: body,
    html: body.replace(/\n/g, "<br>"),
  });
}

export async function notifyError(env, taskName, err) {
  const subject = `[Apex Scheduler] ${taskName} FAILED`;
  const body = [
    `Task: ${taskName}`,
    `Error: ${err.message}`,
    "",
    `Stack:`,
    String(err.stack || "").slice(0, 1500),
    "",
    `Timestamp: ${new Date().toISOString()}`,
  ].join("\n");

  return sendEmail(env, {
    to: env.NOTIFY_EMAIL_TO || "hello@apextoolsai.com",
    subject,
    text: body,
    html: body.replace(/\n/g, "<br>"),
  });
}

export async function plainEmail(env, { to, subject, body }) {
  return sendEmail(env, {
    to,
    subject,
    text: body,
    html: body.replace(/\n/g, "<br>"),
  });
}
