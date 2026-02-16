import { EmailSender, EmailSenderOptions } from '../../../src/services/sender/email-sender.js';

describe('EmailSender', () => {
  it('constructs with SMTP config', () => {
    const opts: EmailSenderOptions = {
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      user: 'user',
      pass: 'pass',
      from: 'sender@example.com',
    };
    const sender = new EmailSender(opts);
    expect(sender).toBeInstanceOf(EmailSender);
  });
});
