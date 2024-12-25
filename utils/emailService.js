// utils/emailService.js
import nodemailer from 'nodemailer';
import { logError } from '../middlewares/error.js';

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Create transporter
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      // Verify connection
      await this.transporter.verify();
      console.log('Email service initialized successfully');
      this.initialized = true;
    } catch (error) {
      logError(error, {
        context: 'Email Service Initialization',
        smtp: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          user: process.env.SMTP_USER ? '****' : undefined
        }
      });
      throw new Error('Failed to initialize email service');
    }
  }

  async sendEmail(options) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Email options
      const mailOptions = {
        from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_FROM_EMAIL}>`,
        to: options.email,
        subject: options.subject,
        text: options.message
      };

      // Add CC if specified
      if (options.cc) {
        mailOptions.cc = options.cc;
      }

      // Add HTML version if provided
      if (options.html) {
        mailOptions.html = options.html;
      }

      // Send email
      const info = await this.transporter.sendMail(mailOptions);
      
      console.log('Email sent successfully:', {
        messageId: info.messageId,
        recipient: options.email,
        subject: options.subject
      });

      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      logError(error, {
        context: 'Send Email',
        recipient: options.email,
        subject: options.subject
      });
      throw error;
    }
  }

  async sendFeedbackEmail(application, customEmail, jobTitle) {
    try {
      const emailContent = customEmail || application.candidateEmail;
      if (!emailContent) {
        throw new Error('No email content provided');
      }

      // Replace placeholders
      const formattedContent = emailContent
        .replace('[Candidate Name]', application.name)
        .replace('[Position]', jobTitle || 'the position');

      await this.sendEmail({
        email: application.email,
        subject: `Application Status Update - ${jobTitle || 'Position'}`,
        message: formattedContent,
        html: formattedContent.replace(/\n/g, '<br>')
      });

      return true;
    } catch (error) {
      logError(error, {
        context: 'Send Feedback Email',
        applicationId: application._id,
        candidateEmail: application.email
      });
      throw error;
    }
  }
}

const emailService = new EmailService();
export default emailService;