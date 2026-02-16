/**
 * EmailSender Service (Sprint 4)
 * Sends emails with PDF/DOCX attachments using SMTP.
 */

import nodemailer from 'nodemailer';
import fs from 'fs';

export interface EmailSenderOptions {
  smtpHost: string;
  smtpPort: number;
  user: string;
  pass: string;
  from: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  attachments: { filename: string; path: string }[];
}

export class EmailSender {
  private transporter;
  private from: string;

  constructor(options: EmailSenderOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.smtpHost,
      port: options.smtpPort,
      secure: options.smtpPort === 465,
      auth: { user: options.user, pass: options.pass },
    });
    this.from = options.from;
  }

  async send(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        attachments: params.attachments.map(a => ({ filename: a.filename, path: a.path })),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}
