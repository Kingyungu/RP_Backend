import { Application } from "../models/applicationSchema.js";
import { Job } from "../models/jobSchema.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/error.js";
import { uploadToGridFS, getFileFromGridFS } from "../utils/gridfsStorage.js";
import assistantService from "../utils/assistantService.js";
import emailService from "../utils/emailService.js";

const analyzeWithOpenAI = async (cvText, jobDescription) => {
  try {
    console.log('Starting OpenAI analysis...');
    console.log('Input lengths - CV:', cvText.length, 'Job Description:', jobDescription.length);

    const result = await assistantService.analyzeApplication(cvText, jobDescription);
    
    if (!result.success) {
      throw new ErrorHandler(result.error || 'Analysis failed', 500);
    }

    // Parse out just the recruiter section for the analysis field
    const recruiterSection = result.analysis.split(/2\.\s*CANDIDATE FEEDBACK EMAIL:|---/i)[0]
      .replace(/1\.\s*INTERNAL RECRUITER ANALYSIS:/i, '')
      .trim();

    // Return with separated content
    return {
      success: true,
      recruiterAnalysis: recruiterSection,    // Only recruiter section
      candidateEmail: result.candidateEmail,  // Only candidate email
      score: result.score
    };
  } catch (error) {
    console.error('Error during analysis:', error);
    throw error;
  }
};
export const postApplication = catchAsyncErrors(async (req, res, next) => {
  try {
    // Role validation
    const { role } = req.user;
    if (role === "Employer") {
      return next(
        new ErrorHandler("Employer not allowed to access this resource.", 400)
      );
    }

    // File validation
    if (!req.files || Object.keys(req.files).length === 0) {
      return next(new ErrorHandler("Resume File Required!", 400));
    }

    const { resume } = req.files;
    const allowedFormats = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
    ];
    if (!allowedFormats.includes(resume.mimetype)) {
      return next(
        new ErrorHandler(
          "Invalid file type. Please upload a PDF, PNG, JPEG, or WEBP file.",
          400
        )
      );
    }

    // Upload file
    const uploadedFile = await uploadToGridFS(resume);

    // Extract request data
    const { name, email, coverLetter, phone, address, jobId } = req.body;

    const applicantID = {
      user: req.user._id,
      role: "Job Seeker",
    };

    // Job validation
    if (!jobId) {
      return next(new ErrorHandler("Job not found!", 404));
    }

    const jobDetails = await Job.findById(jobId);
    if (!jobDetails) {
      return next(new ErrorHandler("Job not found!", 404));
    }

    // Get OpenAI analysis
    let aiAnalysisResult;
    try {
      aiAnalysisResult = await analyzeWithOpenAI(
        coverLetter,
        jobDetails.description
      );
      console.log("AI Analysis Result:", aiAnalysisResult);

      if (!aiAnalysisResult.success) {
        console.warn("AI analysis unsuccessful, using fallback");
        aiAnalysisResult = {
          recruiterAnalysis: "Analysis pending manual review.",
          candidateEmail: "Thank you for your application. It is currently under review.",
          score: 0
        };
      }
    } catch (analysisError) {
      console.error("AI analysis failed:", analysisError);
      aiAnalysisResult = {
        recruiterAnalysis: "Analysis failed - manual review required.",
        candidateEmail: "Thank you for your application. Our team will review it shortly.",
        score: 0
      };
    }

    const employerID = {
      user: jobDetails.postedBy,
      role: "Employer",
    };

    // Field validation
    if (
      !name ||
      !email ||
      !coverLetter ||
      !phone ||
      !address ||
      !applicantID ||
      !employerID ||
      !resume
    ) {
      return next(new ErrorHandler("Please fill all fields.", 400));
    }

    // Create application
    const application = await Application.create({
      // Basic info
      name,
      email,
      coverLetter,
      phone,
      address,
      applicantID,
      employerID,

      // Resume info
      resume: {
        public_id: uploadedFile.fileId,
        url: `/api/v1/application/resume/${uploadedFile.fileId}`,
        contentType: resume.mimetype,
        originalName: resume.name,
        size: resume.size,
      },

      // AI Analysis results - stored separately
      analysis: aiAnalysisResult.recruiterAnalysis,     // For recruiter view
      candidateEmail: aiAnalysisResult.candidateEmail,  // For candidate feedback
      emailSent: false,
      matchScore: aiAnalysisResult.score,
      jobId: jobDetails._id,

      // Text analysis
      textAnalysis: {
        coverLetterAnalysis: {
          sentiment: "Neutral",
          keyPoints: analyzeCoverLetter(coverLetter),
          professionalTone: calculateProfessionalTone(coverLetter),
        },
        resumeAnalysis: {
          experience: [],
          skills: extractSkills(coverLetter),
          education: [],
        },
        overallAnalysis: {
          strengths: identifyStrengths(coverLetter),
          improvements: [],
          recommendations: generateRecommendations(),
        },
      },
    });

    // Send response
    res.status(200).json({
      success: true,
      message: "Application Submitted!",
      application,
    });
  } catch (error) {
    console.error("Full error details:", error);
    next(new ErrorHandler(error.message, 500));
  }
});
export const getResume = catchAsyncErrors(async (req, res, next) => {
  try {
    const { fileId } = req.params;

    const { buffer, metadata, contentType } = await getFileFromGridFS(fileId);

    if (!buffer || !metadata) {
      return next(new ErrorHandler("Resume not found", 404));
    }

    const application = await Application.findOne({
      "resume.public_id": fileId,
    });
    if (!application) {
      return next(new ErrorHandler("Application not found", 404));
    }

    const finalContentType =
      contentType || application.resume.contentType || "application/pdf";

    res.setHeader("Content-Type", finalContentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${metadata.metadata?.originalName || application.resume.originalName || "resume.pdf"}"`
    );
    res.setHeader("Content-Length", buffer.length);

    console.log("Resume retrieved:", {
      fileId,
      contentType: finalContentType,
      size: buffer.length,
      filename:
        metadata.metadata?.originalName || application.resume.originalName,
    });

    res.send(buffer);
  } catch (error) {
    console.error("Error in getResume:", error);

    if (error.code === "ERR_HTTP_INVALID_HEADER_VALUE") {
      return next(new ErrorHandler("Invalid file metadata", 500));
    }

    next(new ErrorHandler("Error retrieving resume", 500));
  }
});



export const sendFeedbackEmail = catchAsyncErrors(async (req, res, next) => {
  const { applicationId } = req.params;
  const { customEmail } = req.body;

  console.log('Received feedback request:', {
    applicationId,
    hasCustomEmail: !!customEmail
  });

  const application = await Application.findById(applicationId);
  if (!application) {
    return next(new ErrorHandler("Application not found!", 404));
  }

  try {
    // Get associated job details for better context
    const job = await Job.findById(application.jobId);
    const jobTitle = job ? job.title : 'Position';

    // Send email using emailService
    await emailService.sendFeedbackEmail(application, customEmail, jobTitle);

    // Update application status
    application.emailSent = true;
    application.sentEmail = customEmail || application.candidateEmail;
    await application.save();

    res.status(200).json({
      success: true,
      message: "Feedback email sent successfully"
    });
  } catch (error) {
    console.error('Email sending error:', error);
    next(new ErrorHandler("Failed to send feedback email", 500));
  }
});
export const regenerateFeedback = catchAsyncErrors(async (req, res, next) => {
  const { applicationId } = req.params;

  try {
    // Find the application
    const application = await Application.findById(applicationId);
    if (!application) {
      return next(new ErrorHandler("Application not found!", 404));
    }

    console.log('Found application:', {
      id: application._id,
      employerId: application.employerID.user,
      jobId: application.jobId
    });

    // Find job - using let so we can reassign
    let jobForAnalysis = await Job.findById(application.jobId);
    console.log('Job lookup result:', {
      searchId: application.jobId,
      found: !!jobForAnalysis
    });

    if (!jobForAnalysis) {
      // If original job not found, try to find the latest active job
      jobForAnalysis = await Job.findOne({
        postedBy: application.employerID.user,
        expired: false
      }).sort({ jobPostedOn: -1 });

      if (!jobForAnalysis) {
        return next(new ErrorHandler("No active jobs found for analysis", 404));
      }

      console.log('Using latest job for analysis:', {
        jobId: jobForAnalysis._id,
        title: jobForAnalysis.title
      });
    }

    // Get new AI analysis
    try {
      const aiAnalysisResult = await analyzeWithOpenAI(
        application.coverLetter, 
        jobForAnalysis.description
      );
      
      if (!aiAnalysisResult.success) {
        return next(new ErrorHandler("Failed to generate new analysis", 500));
      }

      // Update application with new analysis
      const updates = {
        analysis: aiAnalysisResult.recruiterAnalysis,
        candidateEmail: aiAnalysisResult.candidateEmail,
        matchScore: aiAnalysisResult.score,
        emailSent: false
      };

      const updatedApplication = await Application.findByIdAndUpdate(
        applicationId,
        { $set: updates },
        { new: true }
      );

      if (!updatedApplication) {
        return next(new ErrorHandler("Failed to update application", 500));
      }

      res.status(200).json({
        success: true,
        message: "Feedback regenerated successfully",
        analysis: {
          recruiterAnalysis: aiAnalysisResult.recruiterAnalysis,
          candidateEmail: aiAnalysisResult.candidateEmail,
          score: aiAnalysisResult.score
        }
      });

    } catch (analysisError) {
      console.error('Error during analysis:', analysisError);
      return next(new ErrorHandler("Failed to analyze application", 500));
    }

  } catch (error) {
    console.error('Error in regenerateFeedback:', {
      error,
      applicationId,
      message: error.message
    });
    return next(new ErrorHandler(error.message || "Failed to regenerate feedback", 500));
  }
});
export const employerGetAllApplications = catchAsyncErrors(async (req, res, next) => {
  const { role } = req.user;
  if (role === "Job Seeker") {
    return next(new ErrorHandler("Job Seeker not allowed to access this resource.", 400));
  }
  
  // Add pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Get total count for pagination
  const totalCount = await Application.countDocuments({
    "employerID.user": req.user._id,
  });

  // Add field selection and pagination - now including candidateEmail
  const applications = await Application.find({
    "employerID.user": req.user._id,
  })
    .select(
      "name email phone address coverLetter resume analysis candidateEmail matchScore createdAt emailSent sentEmail"
    )
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean(); // Convert to plain JS object for better performance

  // Log what's being sent
  console.log('Sending applications with data:', applications.map(app => ({
    id: app._id,
    hasAnalysis: !!app.analysis,
    hasCandidateEmail: !!app.candidateEmail,
    matchScore: app.matchScore
  })));

  res.status(200).json({
    success: true,
    applications,
    currentPage: page,
    totalPages: Math.ceil(totalCount / limit),
    totalApplications: totalCount,
  });
});

export const jobseekerGetAllApplications = catchAsyncErrors(async (req, res, next) => {
  const { role } = req.user;
  if (role === "Employer") {
    return next(
      new ErrorHandler("Employer not allowed to access this resource.", 400)
    );
  }

  const { _id } = req.user;
  
  // Enhanced populate configuration
  const applications = await Application.find({ "applicantID.user": _id })
    .populate({
      path: 'jobId',
      select: 'title location city country fixedSalary salaryFrom salaryTo', // Specify the fields we need
      model: 'Job' // Explicitly specify the model
    })
    .sort({ createdAt: -1 });
  
  // Add debug logging
  console.log('Applications query result:', JSON.stringify({
    count: applications.length,
    sample: applications[0] ? {
      id: applications[0]._id,
      jobId: applications[0].jobId,
      hasJobDetails: !!applications[0].jobId
    } : null
  }, null, 2));

  res.status(200).json({
    success: true,
    applications,
  });
});
export const jobseekerDeleteApplication = catchAsyncErrors(
  async (req, res, next) => {
    const { role } = req.user;
    if (role === "Employer") {
      return next(
        new ErrorHandler("Employer not allowed to access this resource.", 400)
      );
    }
    const { id } = req.params;
    const application = await Application.findById(id);
    if (!application) {
      return next(new ErrorHandler("Application not found!", 404));
    }
    await application.deleteOne();
    res.status(200).json({
      success: true,
      message: "Application Deleted!",
    });
  }
);

// Helper functions for text analysis
const analyzeCoverLetter = (coverLetter) => {
  const keyPoints = [];
  const sentences = coverLetter.split(/[.!?]+/);

  sentences.forEach((sentence) => {
    if (
      sentence.toLowerCase().includes("experience") ||
      sentence.toLowerCase().includes("skill") ||
      sentence.toLowerCase().includes("project") ||
      sentence.toLowerCase().includes("achieved")
    ) {
      keyPoints.push(sentence.trim());
    }
  });

  return keyPoints.slice(0, 3);
};

const calculateProfessionalTone = (text) => {
  const professionalWords = [
    "professional",
    "experience",
    "skill",
    "achieve",
    "develop",
    "manage",
    "lead",
  ];
  const words = text.toLowerCase().split(/\s+/);

  const professionalCount = words.filter((word) =>
    professionalWords.some((pWord) => word.includes(pWord))
  ).length;

  return Math.min(100, (professionalCount / words.length) * 100);
};

const extractSkills = (text) => {
  const commonSkills = [
    "javascript",
    "python",
    "react",
    "node",
    "management",
    "leadership",
    "communication",
  ];
  const skills = [];

  commonSkills.forEach((skill) => {
    if (text.toLowerCase().includes(skill)) {
      skills.push(skill);
    }
  });

  return skills;
};

const identifyStrengths = (text) => {
  const strengths = [];
  const strengthIndicators = {
    experience: "Relevant experience",
    education: "Strong educational background",
    communication: "Good communication skills",
    leadership: "Leadership qualities",
  };

  Object.entries(strengthIndicators).forEach(([key, value]) => {
    if (text.toLowerCase().includes(key)) {
      strengths.push(value);
    }
  });

  return strengths;
};

const generateRecommendations = () => {
  return [
    "Consider adding more specific examples of project achievements",
    "Include quantifiable results where possible",
    "Highlight relevant technical skills",
  ];
};

export default {
  postApplication,
  getResume,
  sendFeedbackEmail,
  regenerateFeedback,
  employerGetAllApplications,
  jobseekerGetAllApplications,
  jobseekerDeleteApplication,
  sendFeedbackEmail,
};
