// utils/emailTemplates.js

export const formatApplicationFeedback = (content, jobTitle) => {
  // Add signature if not present
  if (!content.includes('Best regards')) {
    content = `${content.trim()}\n\nBest regards,\nRecruitPilot AI Team`;
  }

  // Add footer
  const footer = `\n\n---\nThis email was sent via RecruitPilot AI Recruitment System. Please do not reply to this email.`;
  
  return content + footer;
};

export const getEmailSubject = (jobTitle) => {
  return `Application Status Update - ${jobTitle || 'Position'}`;
};

export const createDefaultFeedback = (candidateName, jobTitle) => {
  return `Dear ${candidateName},

Thank you for your application for the ${jobTitle} position. We have received and reviewed your application.

We appreciate the time and effort you put into your application. Our team has carefully evaluated your qualifications and experience.

At this time, we are still in the process of reviewing applications and will be in touch with next steps soon.

Best regards,
RecruitPilot AI Team`;
};