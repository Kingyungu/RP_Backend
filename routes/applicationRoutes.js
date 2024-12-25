// routes/applicationRoutes.js
import express from "express";
import {
  employerGetAllApplications,
  jobseekerDeleteApplication,
  jobseekerGetAllApplications,
  postApplication,
  getResume,
  regenerateFeedback,  // Add this import
  sendFeedbackEmail,
} from "../controllers/applicationController.js";
import { isAuthenticated } from "../middlewares/auth.js";

const router = express.Router();

router.post("/post", isAuthenticated, postApplication);
router.get("/employer/getall", isAuthenticated, employerGetAllApplications);
router.get("/jobseeker/getall", isAuthenticated, jobseekerGetAllApplications);
router.delete("/delete/:id", isAuthenticated, jobseekerDeleteApplication);
router.get("/resume/:fileId", isAuthenticated, getResume);
router.post("/regenerate-feedback/:applicationId", isAuthenticated, regenerateFeedback);  // Add this route
router.post("/send-feedback/:applicationId", isAuthenticated, sendFeedbackEmail);

export default router;