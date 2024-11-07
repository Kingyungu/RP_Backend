// controllers/applicationController.js
import { Application } from "../models/applicationSchema.js";
import { Job } from "../models/jobSchema.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/error.js";
import { uploadToGridFS, getFileFromGridFS } from "../utils/gridfsStorage.js";
import PDFParser from "pdf-parse";
import openai from "../utils/openaiConfig.js";
import fs from "fs/promises";
import assistantService from '../utils/assistantService.js';

// controllers/applicationController.js

const analyzeWithOpenAI = async (cvText, jobDescription) => {
  try {
    console.log('Starting OpenAI analysis...');
    console.log('Input lengths - CV:', cvText.length, 'Job Description:', jobDescription.length);

    const result = await assistantService.analyzeApplication(cvText, jobDescription);
    
    if (!result.success) {
      throw new ErrorHandler(result.error || 'Analysis failed', 500);
    }

    return result;
  } catch (error) {
    // The error will be logged by the error middleware
    throw error;
  }
};
export const postApplication = catchAsyncErrors(async (req, res, next) => {
  try {
    const { role } = req.user;
    if (role === "Employer") {
      return next(new ErrorHandler("Employer not allowed to access this resource.", 400));
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return next(new ErrorHandler("Resume File Required!", 400));
    }

    const { resume } = req.files;
    const allowedFormats = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedFormats.includes(resume.mimetype)) {
      return next(new ErrorHandler("Invalid file type. Please upload a PDF, PNG, JPEG, or WEBP file.", 400));
    }

    // Use GridFS instead of Cloudinary
    const uploadedFile = await uploadToGridFS(resume);

    const { name, email, coverLetter, phone, address, jobId } = req.body;
    
    const applicantID = {
      user: req.user._id,
      role: "Job Seeker",
    };

    if (!jobId) {
      return next(new ErrorHandler("Job not found!", 404));
    }

    const jobDetails = await Job.findById(jobId);
    if (!jobDetails) {
      return next(new ErrorHandler("Job not found!", 404));
    }

    // Get OpenAI analysis
    const aiAnalysisResult = await analyzeWithOpenAI(coverLetter, jobDetails.description);
    console.log('AI Analysis Result:', aiAnalysisResult);

    const employerID = {
      user: jobDetails.postedBy,
      role: "Employer",
    };

    if (!name || !email || !coverLetter || !phone || !address || !applicantID || !employerID || !resume) {
      return next(new ErrorHandler("Please fill all fields.", 400));
    }

    const application = await Application.create({
      name,
      email,
      coverLetter,
      phone,
      address,
      applicantID,
      employerID,
      resume: {
        public_id: uploadedFile.fileId,
        url: `/api/v1/application/resume/${uploadedFile.fileId}`,
        contentType: resume.mimetype,
        originalName: resume.name,  // Add this line
        size: resume.size
      },
      analysis: aiAnalysisResult.analysis,
      matchScore: aiAnalysisResult.score,
      textAnalysis: {
        coverLetterAnalysis: {
          sentiment: 'Neutral',
          keyPoints: analyzeCoverLetter(coverLetter),
          professionalTone: calculateProfessionalTone(coverLetter)
        },
        resumeAnalysis: {
          experience: [],
          skills: extractSkills(coverLetter),
          education: []
        },
        overallAnalysis: {
          strengths: identifyStrengths(coverLetter),
          improvements: [],
          recommendations: generateRecommendations()
        }
      }
    });

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
    
    // Get file from GridFS
    const { buffer, metadata, contentType } = await getFileFromGridFS(fileId);
    
    if (!buffer || !metadata) {
      return next(new ErrorHandler("Resume not found", 404));
    }

    // Get the application to verify access
    const application = await Application.findOne({ "resume.public_id": fileId });
    if (!application) {
      return next(new ErrorHandler("Application not found", 404));
    }

    // Determine content type
    const finalContentType = contentType || application.resume.contentType || 'application/pdf';
    
    // Set headers with fallbacks
    res.setHeader('Content-Type', finalContentType);
    res.setHeader(
      'Content-Disposition', 
      `inline; filename="${metadata.metadata?.originalName || application.resume.originalName || 'resume.pdf'}"`
    );
    res.setHeader('Content-Length', buffer.length);
    
    // Log successful retrieval
    console.log('Resume retrieved:', {
      fileId,
      contentType: finalContentType,
      size: buffer.length,
      filename: metadata.metadata?.originalName || application.resume.originalName
    });

    // Send the file
    res.send(buffer);
  } catch (error) {
    console.error("Error in getResume:", error);
    
    // Handle specific error types
    if (error.code === 'ERR_HTTP_INVALID_HEADER_VALUE') {
      return next(new ErrorHandler("Invalid file metadata", 500));
    }
    
    next(new ErrorHandler("Error retrieving resume", 500));
  }
});
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

  return keyPoints.slice(0, 3); // Return top 3 key points
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

const calculateMatchScore = (jobDetails, coverLetter) => {
  // Basic match score calculation
  let score = 50; // Base score

  // Check if cover letter mentions job-related keywords
  if (
    jobDetails.title &&
    coverLetter.toLowerCase().includes(jobDetails.title.toLowerCase())
  ) {
    score += 10;
  }

  if (
    jobDetails.category &&
    coverLetter.toLowerCase().includes(jobDetails.category.toLowerCase())
  ) {
    score += 10;
  }

  // Add more sophisticated matching logic as needed

  return Math.min(score, 100); // Ensure score doesn't exceed 100
};


// Keep other controller methods unchanged...
export const employerGetAllApplications = catchAsyncErrors(
  async (req, res, next) => {
    const { role } = req.user;
    if (role === "Job Seeker") {
      return next(
        new ErrorHandler("Job Seeker not allowed to access this resource.", 400)
      );
    }
    const { _id } = req.user;
    const applications = await Application.find({ "employerID.user": _id });
    res.status(200).json({
      success: true,
      applications,
    });
  }
);

export const jobseekerGetAllApplications = catchAsyncErrors(
  async (req, res, next) => {
    const { role } = req.user;
    if (role === "Employer") {
      return next(
        new ErrorHandler("Employer not allowed to access this resource.", 400)
      );
    }
    const { _id } = req.user;
    const applications = await Application.find({ "applicantID.user": _id });
    res.status(200).json({
      success: true,
      applications,
    });
  }
);

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
